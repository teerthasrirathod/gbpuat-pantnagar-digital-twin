//! Cloud-optimised GeoTIFF reader over HTTP range requests.
//!
//! Only the header and the tiles a window needs are downloaded. Fetched blocks are cached on disk
//! (twin/.cache/cog) so re-runs are offline and instant.

use crate::http::{self, Res};
use std::collections::HashMap;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

/// Bytes downloaded by all range readers in this run.
pub static DOWNLOADED: AtomicU64 = AtomicU64::new(0);
use tiff::decoder::{Decoder, DecodingResult, Limits};
use tiff::tags::Tag;
use tiff::ColorType;

const BLOCK: u64 = 1 << 18; // 256 KiB

fn fnv(s: &str) -> u64 {
    s.bytes().fold(0xcbf2_9ce4_8422_2325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100_0000_01b3))
}

pub fn cache_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".cache")
}

pub struct RangeFile {
    url: String,
    pos: u64,
    len: u64,
    blocks: HashMap<u64, Vec<u8>>,
    dir: PathBuf,
}

impl RangeFile {
    pub fn open(url: &str) -> Res<Self> {
        let dir = cache_root().join("cog").join(format!("{:016x}", fnv(url)));
        std::fs::create_dir_all(&dir)?;
        let mut f = RangeFile { url: url.into(), pos: 0, len: 0, blocks: HashMap::new(), dir };
        let len_path = f.dir.join("len");
        match std::fs::read_to_string(&len_path) {
            Ok(s) => f.len = s.trim().parse()?,
            Err(_) => {
                let (b, total) = http::get_range(url, 0, BLOCK - 1)?;
                if total == 0 {
                    return Err(format!("no Content-Range from {url}").into());
                }
                f.len = total;
                DOWNLOADED.fetch_add(b.len() as u64, Ordering::Relaxed);
                std::fs::write(f.dir.join("0.bin"), &b)?;
                std::fs::write(&len_path, total.to_string())?;
                f.blocks.insert(0, b);
            }
        }
        Ok(f)
    }

    fn block(&mut self, i: u64) -> io::Result<&[u8]> {
        if !self.blocks.contains_key(&i) {
            let p = self.dir.join(format!("{i}.bin"));
            let data = match std::fs::read(&p) {
                Ok(d) => d,
                Err(_) => {
                    let start = i * BLOCK;
                    let end = (start + BLOCK).min(self.len) - 1;
                    let (d, _) = http::get_range(&self.url, start, end)
                        .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
                    DOWNLOADED.fetch_add(d.len() as u64, Ordering::Relaxed);
                    let _ = std::fs::write(&p, &d);
                    d
                }
            };
            // Keep memory bounded on big windows: blocks are cached on disk anyway.
            if self.blocks.len() >= 512 {
                self.blocks.clear();
            }
            self.blocks.insert(i, data);
        }
        Ok(&self.blocks[&i])
    }
}

impl Read for RangeFile {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.pos >= self.len || buf.is_empty() {
            return Ok(0);
        }
        let (i, off) = (self.pos / BLOCK, (self.pos % BLOCK) as usize);
        let n = {
            let b = self.block(i)?;
            let n = (b.len().saturating_sub(off)).min(buf.len());
            buf[..n].copy_from_slice(&b[off..off + n]);
            n
        };
        self.pos += n as u64;
        Ok(n)
    }
}

impl Seek for RangeFile {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        self.pos = match to {
            SeekFrom::Start(p) => p,
            SeekFrom::End(d) => (self.len as i64 + d) as u64,
            SeekFrom::Current(d) => (self.pos as i64 + d) as u64,
        };
        Ok(self.pos)
    }
}

#[derive(Clone, Debug)]
pub struct Level {
    pub ifd: usize,
    pub width: u32,
    pub height: u32,
}

#[allow(dead_code)]
pub struct Cog {
    dec: Decoder<RangeFile>,
    pub url: String,
    pub levels: Vec<Level>,
    /// Georeferenced position of the full-resolution image's top-left corner (CRS units).
    pub origin: [f64; 2],
    /// Full-resolution pixel size (CRS units, positive; rows go towards smaller y).
    pub pixel: [f64; 2],
    pub nodata: Option<f64>,
    pub epsg: Option<u32>,
}

fn tag(n: u16) -> Tag {
    Tag::from_u16_exhaustive(n)
}

impl Cog {
    pub fn open(url: &str) -> Res<Cog> {
        let rf = RangeFile::open(url)?;
        let mut dec = Decoder::new(rf)?.with_limits(Limits::unlimited());
        let scale = dec.get_tag_f64_vec(tag(33550))?;
        let tie = dec.get_tag_f64_vec(tag(33922))?;
        let nodata = match dec.find_tag(tag(42113)) {
            Ok(Some(v)) => v.into_string().ok().and_then(|s| s.trim_matches(char::from(0)).trim().parse().ok()),
            _ => None,
        };
        let epsg = match dec.find_tag(tag(34735)) {
            Ok(Some(v)) => v.into_u16_vec().ok().and_then(|k| {
                k.chunks(4).skip(1).find(|c| c.len() == 4 && (c[0] == 3072 || c[0] == 2048)).map(|c| c[3] as u32)
            }),
            _ => None,
        };
        let mut levels = Vec::new();
        let mut ifd = 0usize;
        loop {
            let (w, h) = dec.dimensions()?;
            let sub = match dec.find_tag(Tag::NewSubfileType) {
                Ok(Some(v)) => v.into_u32().unwrap_or(0),
                _ => 0,
            };
            if sub & 4 == 0 {
                levels.push(Level { ifd, width: w, height: h });
            }
            if !dec.more_images() {
                break;
            }
            dec.next_image()?;
            ifd += 1;
        }
        dec.seek_to_image(0)?;
        Ok(Cog {
            dec,
            url: url.into(),
            levels,
            origin: [tie[3] - tie[0] * scale[0], tie[4] + tie[1] * scale[1]],
            pixel: [scale[0], scale[1]],
            nodata,
            epsg,
        })
    }

    /// Pixel size (CRS units) of a level.
    /// One line per level: size, pixel, tile size, planar flag.
    pub fn describe(&mut self) -> Res<String> {
        let mut out = format!("origin {:?} pixel {:?} nodata {:?} epsg {:?}
", self.origin, self.pixel, self.nodata, self.epsg);
        for (i, l) in self.levels.clone().iter().enumerate() {
            self.dec.seek_to_image(l.ifd)?;
            let planar = self.dec.find_tag(Tag::PlanarConfiguration)?.map(|v| v.into_u16().unwrap_or(0));
            out += &format!("  level {i} ifd {} {}x{} px {:.3} chunk {:?} colour {:?} planar {:?}
", l.ifd, l.width, l.height, self.level_pixel(i)[0], self.dec.chunk_dimensions(), self.dec.colortype()?, planar);
        }
        Ok(out)
    }

    pub fn level_pixel(&self, level: usize) -> [f64; 2] {
        let l = &self.levels[level];
        let full = &self.levels[0];
        [
            self.pixel[0] * full.width as f64 / l.width as f64,
            self.pixel[1] * full.height as f64 / l.height as f64,
        ]
    }

    /// Coarsest level whose pixel is no larger than `max_px` (CRS units).
    pub fn level_for(&self, max_px: f64) -> usize {
        // Overviews may be stored in any order: take the largest pixel that is still fine enough.
        let mut best = 0;
        for i in 0..self.levels.len() {
            let p = self.level_pixel(i)[0];
            if p <= max_px * 1.001 && p > self.level_pixel(best)[0] {
                best = i;
            }
        }
        best
    }

    /// Read a window of a level. Returns (values as f32, samples per pixel); pixels outside the
    /// image or equal to nodata are NaN. Layout: row-major, interleaved samples.
    pub fn read_window(&mut self, level: usize, x0: i64, y0: i64, w: usize, h: usize) -> Res<(Vec<f32>, usize)> {
        let ifd = self.levels[level].ifd;
        self.dec.seek_to_image(ifd)?;
        let (iw, ih) = self.dec.dimensions()?;
        let (tw, th) = self.dec.chunk_dimensions();
        let samples = match self.dec.colortype()? {
            ColorType::Gray(_) => 1,
            ColorType::GrayA(_) => 2,
            ColorType::RGB(_) => 3,
            ColorType::RGBA(_) | ColorType::CMYK(_) => 4,
            ColorType::Multiband { num_samples, .. } => num_samples as usize,
            other => return Err(format!("unsupported colour type {other:?}").into()),
        };
        let mut out = vec![f32::NAN; w * h * samples];
        let (tw, th) = (tw as i64, th as i64);
        let across = (iw as i64 + tw - 1) / tw;
        let tx0 = (x0.max(0)) / tw;
        let ty0 = (y0.max(0)) / th;
        let tx1 = ((x0 + w as i64 - 1).min(iw as i64 - 1)) / tw;
        let ty1 = ((y0 + h as i64 - 1).min(ih as i64 - 1)) / th;
        let nd = self.nodata.map(|v| v as f32);
        // Planar configuration 2 stores each band in its own set of tiles.
        let planar = matches!(self.dec.find_tag(Tag::PlanarConfiguration), Ok(Some(v)) if v.clone().into_u16().unwrap_or(1) == 2);
        let tiles_down = (ih as i64 + th - 1) / th;
        let planes = if planar { samples } else { 1 };
        let per_chunk = if planar { 1 } else { samples };
        for plane in 0..planes {
            for ty in ty0..=ty1 {
                for tx in tx0..=tx1 {
                    let idx = (plane as i64 * across * tiles_down + ty * across + tx) as u32;
                    let (cw, ch) = self.dec.chunk_data_dimensions(idx);
                    let vals: Vec<f32> = match self.dec.read_chunk(idx)? {
                        DecodingResult::U8(v) => v.into_iter().map(|x| x as f32).collect(),
                        DecodingResult::U16(v) => v.into_iter().map(|x| x as f32).collect(),
                        DecodingResult::I16(v) => v.into_iter().map(|x| x as f32).collect(),
                        DecodingResult::U32(v) => v.into_iter().map(|x| x as f32).collect(),
                        DecodingResult::I32(v) => v.into_iter().map(|x| x as f32).collect(),
                        DecodingResult::F32(v) => v,
                        DecodingResult::F64(v) => v.into_iter().map(|x| x as f32).collect(),
                        _ => return Err("unsupported sample format".into()),
                    };
                    // Edge tiles may come back padded to the full tile or trimmed to the data.
                    let stride = if vals.len() >= (tw * th) as usize * per_chunk { tw as usize } else { cw as usize };
                    for r in 0..ch as i64 {
                        let gy = ty * th + r;
                        if gy < y0 || gy >= y0 + h as i64 {
                            continue;
                        }
                        for c in 0..cw as i64 {
                            let gx = tx * tw + c;
                            if gx < x0 || gx >= x0 + w as i64 {
                                continue;
                            }
                            let src = (r as usize * stride + c as usize) * per_chunk;
                            let dst = ((gy - y0) as usize * w + (gx - x0) as usize) * samples;
                            for k in 0..per_chunk {
                                let Some(&v) = vals.get(src + k) else { continue };
                                out[dst + plane + k] = if Some(v) == nd { f32::NAN } else { v };
                            }
                        }
                    }
                }
            }
        }
        Ok((out, samples))
    }
}

/// A raster window held in memory with its georeferencing, for point sampling.
pub struct Window {
    pub data: Vec<f32>,
    pub samples: usize,
    pub w: usize,
    pub h: usize,
    /// CRS coordinates of the window's top-left corner and pixel size.
    pub x0: f64,
    pub y0: f64,
    pub px: f64,
    pub py: f64,
}

impl Window {
    /// Read the part of `level` covering CRS box [minx, miny, maxx, maxy] (plus a 2-pixel margin).
    pub fn read(cog: &mut Cog, level: usize, b: [f64; 4]) -> Res<Window> {
        let [px, py] = cog.level_pixel(level);
        let c0 = ((b[0] - cog.origin[0]) / px).floor() as i64 - 2;
        let r0 = ((cog.origin[1] - b[3]) / py).floor() as i64 - 2;
        let c1 = ((b[2] - cog.origin[0]) / px).ceil() as i64 + 2;
        let r1 = ((cog.origin[1] - b[1]) / py).ceil() as i64 + 2;
        let (w, h) = ((c1 - c0) as usize, (r1 - r0) as usize);
        let (data, samples) = cog.read_window(level, c0, r0, w, h)?;
        Ok(Window { data, samples, w, h, x0: cog.origin[0] + c0 as f64 * px, y0: cog.origin[1] - r0 as f64 * py, px, py })
    }

    /// Bilinear sample of band `k` at CRS (x, y); NaN outside or next to nodata.
    pub fn bilinear(&self, x: f64, y: f64, k: usize) -> f32 {
        let fx = (x - self.x0) / self.px - 0.5;
        let fy = (self.y0 - y) / self.py - 0.5;
        let (i, j) = (fx.floor(), fy.floor());
        if i < 0.0 || j < 0.0 || i as usize + 1 >= self.w || j as usize + 1 >= self.h {
            return f32::NAN;
        }
        let (i, j, u, v) = (i as usize, j as usize, (fx - i) as f32, (fy - j) as f32);
        let g = |a: usize, b: usize| self.data[(b * self.w + a) * self.samples + k];
        (g(i, j) * (1.0 - u) + g(i + 1, j) * u) * (1.0 - v) + (g(i, j + 1) * (1.0 - u) + g(i + 1, j + 1) * u) * v
    }

    /// Nearest-pixel sample of band `k`.
    pub fn nearest(&self, x: f64, y: f64, k: usize) -> f32 {
        let i = ((x - self.x0) / self.px).floor();
        let j = ((self.y0 - y) / self.py).floor();
        if i < 0.0 || j < 0.0 || i as usize >= self.w || j as usize >= self.h {
            return f32::NAN;
        }
        self.data[(j as usize * self.w + i as usize) * self.samples + k]
    }
}

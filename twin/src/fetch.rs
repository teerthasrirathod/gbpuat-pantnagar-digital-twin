//! Fetchers. Each reads only the campus window from a public cloud-optimised GeoTIFF (or API) and
//! writes a raster on the local metric grid to twin/.cache/rasters (or vector JSON to data/campus).
//!
//! | command     | source                                                     | output            |
//! |-------------|------------------------------------------------------------|-------------------|
//! | dem         | Copernicus DEM GLO-30 (AWS)                                | dsm30             |
//! | heights     | Google Open Buildings 2.5D Temporal (GCS), presence+height | ob<year>_2m       |
//! | canopy      | Meta + WRI canopy height (AWS)                             | chm2              |
//! | s2          | Sentinel-2 L2A via Earth Search: colour, MNDWI, NDVI       | s2rgb, mndwi10, ndvi10 |
//! | osm         | OpenStreetMap via Overpass                                 | data/campus/osm.json |

use crate::aoi::{root, Aoi};
use crate::cog::{Cog, Window};
use crate::geo;
use crate::http::{self, Res};
use crate::raster::{self, Grid};
use serde_json::Value;
use std::path::PathBuf;

pub fn cache(name: &str) -> PathBuf {
    crate::cog::cache_root().join("rasters").join(name)
}

fn mb() -> f64 {
    crate::cog::DOWNLOADED.load(std::sync::atomic::Ordering::Relaxed) as f64 / 1e6
}

/// Sample a COG level onto `grid` in horizontal bands (bounded memory). `to_crs` maps lon/lat to
/// the COG's CRS; `visit(cell index, window, crs point)` is called for cells inside the image.
fn sample_into(
    grid: &Grid,
    cog: &mut Cog,
    level: usize,
    to_crs: &dyn Fn(f64, f64) -> [f64; 2],
    mut visit: impl FnMut(usize, &Window, [f64; 2]),
) -> Res<()> {
    let lp = cog.level_pixel(level);
    let l = cog.levels[level].clone();
    let img = [cog.origin[0], cog.origin[1] - l.height as f64 * lp[1], cog.origin[0] + l.width as f64 * lp[0], cog.origin[1]];
    let rows = ((900.0 / grid.cell).ceil() as usize).max(1);
    let mut j0 = 0;
    while j0 < grid.nz {
        let j1 = (j0 + rows).min(grid.nz);
        let za = grid.z0 + j0 as f64 * grid.cell;
        let zb = grid.z0 + j1 as f64 * grid.cell;
        let xa = grid.x0;
        let xb = grid.x0 + grid.nx as f64 * grid.cell;
        let mut bb = [f64::MAX, f64::MAX, f64::MIN, f64::MIN];
        for (x, z) in [(xa, za), (xb, za), (xa, zb), (xb, zb), ((xa + xb) / 2.0, za), ((xa + xb) / 2.0, zb)] {
            let [lon, lat] = geo::unproj(x, z);
            let p = to_crs(lon, lat);
            bb = [bb[0].min(p[0]), bb[1].min(p[1]), bb[2].max(p[0]), bb[3].max(p[1])];
        }
        let bb = [bb[0].max(img[0]), bb[1].max(img[1]), bb[2].min(img[2]), bb[3].min(img[3])];
        if bb[0] < bb[2] && bb[1] < bb[3] {
            let win = Window::read(cog, level, bb)?;
            for j in j0..j1 {
                for i in 0..grid.nx {
                    let c = grid.center(i, j);
                    let [lon, lat] = geo::unproj(c[0], c[1]);
                    let p = to_crs(lon, lat);
                    if p[0] >= img[0] && p[0] < img[2] && p[1] > img[1] && p[1] <= img[3] {
                        visit(grid.idx(i, j), &win, p);
                    }
                }
            }
        }
        j0 = j1;
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------

pub fn dem(aoi: &Aoi) -> Res<()> {
    let grid = Grid::cover(aoi.local, 30.0);
    let mut out = vec![f32::NAN; grid.len()];
    let b = aoi.bbox;
    let mut tiles: Vec<(i32, i32)> = Vec::new();
    for la in [b.south.floor() as i32, b.north.floor() as i32] {
        for lo in [b.west.floor() as i32, b.east.floor() as i32] {
            if !tiles.contains(&(la, lo)) {
                tiles.push((la, lo));
            }
        }
    }
    for (la, lo) in tiles {
        let name = format!("N{la:02}_00_E{lo:03}_00");
        let url = format!(
            "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{name}_DEM/Copernicus_DSM_COG_10_{name}_DEM.tif"
        );
        println!("  GLO-30 {name}");
        let mut cog = Cog::open(&url)?;
        sample_into(&grid, &mut cog, 0, &|lon, lat| [lon, lat], |k, w, p| {
            let v = w.bilinear(p[0], p[1], 0);
            if v.is_finite() && v > 1.0 {
                out[k] = v;
            }
        })?;
    }
    let missing = out.iter().filter(|v| !v.is_finite()).count();
    let ok: Vec<f32> = out.iter().cloned().filter(|v| v.is_finite()).collect();
    let (mn, mx) = ok.iter().fold((f32::MAX, f32::MIN), |a, &v| (a.0.min(v), a.1.max(v)));
    println!("  DSM grid {}x{} at 30 m: {:.1} to {:.1} m, {} missing | downloaded {:.1} MB", grid.nx, grid.nz, mn, mx, missing, mb());
    raster::save_f32(&cache("dsm30"), grid, &out, "Copernicus DEM GLO-30 DSM (EGM2008 m), bilinear")
}

// ---------------------------------------------------------------------------------------------

fn utm_box(aoi: &Aoi, zone: u32) -> [f64; 4] {
    let b = aoi.bbox;
    let mut bb = [f64::MAX, f64::MAX, f64::MIN, f64::MIN];
    for lon in [b.west, (b.west + b.east) / 2.0, b.east] {
        for lat in [b.south, (b.south + b.north) / 2.0, b.north] {
            let p = geo::utm_forward(lon, lat, zone);
            bb = [bb[0].min(p[0]), bb[1].min(p[1]), bb[2].max(p[0]), bb[3].max(p[1])];
        }
    }
    bb
}

fn ob_tiles(aoi: &Aoi, year: u32, zone: u32) -> Res<Vec<String>> {
    let path = crate::cog::cache_root().join(format!("ob_tiles_{year}_{zone}.json"));
    if let Ok(s) = std::fs::read_to_string(&path) {
        return Ok(serde_json::from_str(&s)?);
    }
    let bucket = "https://storage.googleapis.com/open-buildings-temporal-data";
    let mut names = Vec::new();
    let mut tok: Option<String> = None;
    loop {
        let mut q = "https://storage.googleapis.com/storage/v1/b/open-buildings-temporal-data/o?prefix=v1/manifests/&maxResults=1000&fields=items(name),nextPageToken".to_string();
        if let Some(t) = &tok {
            q += &format!("&pageToken={t}");
        }
        let j: Value = serde_json::from_slice(&http::get(&q)?)?;
        for it in j["items"].as_array().into_iter().flatten() {
            names.push(it["name"].as_str().unwrap_or_default().to_string());
        }
        tok = j["nextPageToken"].as_str().map(String::from);
        if tok.is_none() {
            break;
        }
    }
    let key = format!("EPSG_{}_{year}_06_30", 32600 + zone);
    let ub = utm_box(aoi, zone);
    let mut urls = Vec::new();
    for m in names.iter().filter(|n| n.contains(&key)) {
        let man: Value = serde_json::from_slice(&http::get(&format!("{bucket}/{m}"))?)?;
        let prefix = man["uriPrefix"].as_str().unwrap_or_default().replace("gs://open-buildings-temporal-data", bucket);
        for ts in man["tilesets"].as_array().into_iter().flatten() {
            for src in ts["sources"].as_array().into_iter().flatten() {
                let a = &src["affineTransform"];
                let d = &src["dimensions"];
                let (x0, y1) = (a["translateX"].as_f64().unwrap_or(0.0), a["translateY"].as_f64().unwrap_or(0.0));
                let x1 = x0 + d["width"].as_f64().unwrap_or(0.0) * a["scaleX"].as_f64().unwrap_or(0.0);
                let y0 = y1 + d["height"].as_f64().unwrap_or(0.0) * a["scaleY"].as_f64().unwrap_or(0.0);
                if x1 > ub[0] && x0 < ub[2] && y1 > ub[1] && y0 < ub[3] {
                    if let Some(u) = src["uris"][0].as_str() {
                        urls.push(format!("{prefix}{u}"));
                    }
                }
            }
        }
    }
    urls.sort();
    urls.dedup();
    std::fs::write(&path, serde_json::to_string(&urls)?)?;
    Ok(urls)
}

/// Google Open Buildings 2.5D Temporal: building presence (0-255) and height (0.25 m units) on a
/// 2 m grid. Bands in the product: 1 fractional count, 2 height (m), 3 presence (0-1).
pub fn heights(aoi: &Aoi, year: u32) -> Res<()> {
    let zone = geo::utm_zone((aoi.bbox.west + aoi.bbox.east) / 2.0);
    let urls = ob_tiles(aoi, year, zone)?;
    println!("  Open Buildings {year}: {} tile(s) in EPSG:{}", urls.len(), 32600 + zone);
    let grid = Grid::cover(aoi.local, 2.0);
    let mut out = vec![0u8; grid.len() * 2];
    for url in &urls {
        let mut cog = Cog::open(url)?;
        let level = cog.level_for(2.0);
        println!("    {} level {} ({:.1} m)", url.rsplit('/').next().unwrap_or(url), level, cog.level_pixel(level)[0]);
        sample_into(&grid, &mut cog, level, &|lon, lat| geo::utm_forward(lon, lat, zone), |k, w, p| {
            let pres = w.nearest(p[0], p[1], 2);
            let h = w.nearest(p[0], p[1], 1);
            if pres.is_finite() {
                let pv = (pres.clamp(0.0, 1.0) * 255.0).round() as u8;
                if pv > out[k * 2] {
                    out[k * 2] = pv;
                    out[k * 2 + 1] = if h.is_finite() && h > 0.0 { (h * 4.0).round().clamp(0.0, 255.0) as u8 } else { 0 };
                }
            }
        })?;
    }
    let built = out.chunks(2).filter(|c| c[0] >= 128).count();
    println!("  grid {}x{} at 2 m: building cover {:.2} % | downloaded {:.1} MB", grid.nx, grid.nz, 100.0 * built as f64 / grid.len() as f64, mb());
    raster::save_u8(&cache(&format!("ob{year}_2m")), grid, 2, &out, "presence 0-255, height 0.25 m units")
}

// ---------------------------------------------------------------------------------------------

fn merc(lon: f64, lat: f64) -> [f64; 2] {
    const R: f64 = 6_378_137.0;
    [R * lon.to_radians(), R * (std::f64::consts::FRAC_PI_4 + lat.to_radians() / 2.0).tan().ln()]
}

/// Meta + WRI canopy height (EPSG:3857, ~1.2 m): max of a 2x2 sub-sample per 2 m cell, metres.
pub fn canopy(aoi: &Aoi) -> Res<()> {
    let b = aoi.bbox;
    let mut keys: Vec<String> = Vec::new();
    for lon in [b.west, b.east] {
        for lat in [b.south, b.north] {
            let k = geo::quadkey(lon, lat, 9);
            if !keys.contains(&k) {
                keys.push(k);
            }
        }
    }
    let grid = Grid::cover(aoi.local, 2.0);
    let mut out = vec![0u8; grid.len()];
    for k in &keys {
        let url = format!("https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/{k}.tif");
        println!("  canopy tile {k}");
        let mut cog = Cog::open(&url)?;
        let d = 0.5 / geo::LAT0.to_radians().cos(); // 0.5 m on the ground in Mercator metres
        sample_into(&grid, &mut cog, 0, &merc, |idx, w, p| {
            let mut m = 0f32;
            for (dx, dy) in [(-d, -d), (d, -d), (-d, d), (d, d)] {
                let v = w.nearest(p[0] + dx, p[1] + dy, 0);
                if v.is_finite() && v < 200.0 {
                    m = m.max(v);
                }
            }
            out[idx] = out[idx].max(m.round().clamp(0.0, 199.0) as u8);
        })?;
    }
    let trees = out.iter().filter(|&&v| v >= 3).count();
    println!("  canopy >= 3 m: {:.1} % of the grid | downloaded {:.1} MB", 100.0 * trees as f64 / grid.len() as f64, mb());
    raster::save_u8(&cache("chm2"), grid, 1, &out, "canopy height m (max of 2x2 sub-sample)")
}

// ---------------------------------------------------------------------------------------------


pub const S2_SCENE: &str = "S2C_44RLT_20251211_0_L2A";

/// Sentinel-2 L2A: true-colour image (bicubic to 3 m, sharpened), MNDWI and NDVI on a 10 m grid.
pub fn s2(aoi: &Aoi) -> Res<()> {
    let item: Value = serde_json::from_slice(&http::get(&format!(
        "https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/{S2_SCENE}"
    ))?)?;
    let href = |k: &str| item["assets"][k]["href"].as_str().map(String::from).ok_or(format!("asset {k} missing"));
    let zone = geo::utm_zone((aoi.bbox.west + aoi.bbox.east) / 2.0);
    let to_utm = move |lon: f64, lat: f64| geo::utm_forward(lon, lat, zone);

    // MNDWI = (green - swir16) / (green + swir16)
    let grid10 = Grid::cover(aoi.local, 10.0);
    let mut green = vec![f32::NAN; grid10.len()];
    let mut swir = vec![f32::NAN; grid10.len()];
    let mut cog = Cog::open(&href("green")?)?;
    sample_into(&grid10, &mut cog, 0, &to_utm, |k, w, p| green[k] = w.bilinear(p[0], p[1], 0))?;
    let mut cog = Cog::open(&href("swir16")?)?;
    sample_into(&grid10, &mut cog, 0, &to_utm, |k, w, p| swir[k] = w.bilinear(p[0], p[1], 0))?;
    let mndwi: Vec<f32> = green.iter().zip(&swir).map(|(g, s)| if g + s > 0.0 { (g - s) / (g + s) } else { f32::NAN }).collect();
    let water = mndwi.iter().filter(|v| **v > 0.0).count();
    println!("  MNDWI > 0 (open water): {:.2} % of the grid", 100.0 * water as f64 / grid10.len() as f64);
    raster::save_f32(&cache("mndwi10"), grid10, &mndwi, "Sentinel-2 MNDWI (B03, B11)")?;

    // NDVI = (nir - red) / (nir + red)
    let mut red = vec![f32::NAN; grid10.len()];
    let mut nir = vec![f32::NAN; grid10.len()];
    let mut cog = Cog::open(&href("red")?)?;
    sample_into(&grid10, &mut cog, 0, &to_utm, |k, w, p| red[k] = w.bilinear(p[0], p[1], 0))?;
    let mut cog = Cog::open(&href("nir")?)?;
    sample_into(&grid10, &mut cog, 0, &to_utm, |k, w, p| nir[k] = w.bilinear(p[0], p[1], 0))?;
    let ndvi: Vec<f32> = red.iter().zip(&nir).map(|(r, n)| if r + n > 0.0 { (n - r) / (n + r) } else { f32::NAN }).collect();
    println!("  NDVI > 0.4 (green cover): {:.1} % of the grid", 100.0 * ndvi.iter().filter(|v| **v > 0.4).count() as f64 / grid10.len() as f64);
    raster::save_f32(&cache("ndvi10"), grid10, &ndvi, "Sentinel-2 NDVI (B04, B08)")?;

    // True colour: bicubic resample of the 10 m TCI to 3 m.
    let grid3 = Grid::cover(aoi.local, 3.0);
    let mut cog = Cog::open(&href("visual")?)?;
    let mut rgb = vec![0f32; grid3.len() * 3];
    sample_into(&grid3, &mut cog, 0, &to_utm, |k, w, p| {
        for c in 0..3 {
            rgb[k * 3 + c] = bicubic(w, p[0], p[1], c);
        }
    })?;
    let img = enhance(&grid3, &rgb);
    raster::save_u8(&cache("s2rgb3"), grid3, 3, &img, "Sentinel-2 true colour, enhanced")?;
    let path = cache("s2rgb.jpg");
    std::fs::create_dir_all(path.parent().unwrap())?;
    let enc = jpeg_encoder::Encoder::new_file(&path, 88)?;
    enc.encode(&img, grid3.nx as u16, grid3.nz as u16, jpeg_encoder::ColorType::Rgb)?;
    std::fs::write(cache("s2rgb.json"), serde_json::to_string(&serde_json::json!({"grid": grid3, "scene": S2_SCENE}))?)?;
    println!("  image {}x{} at 3 m -> {} | downloaded {:.1} MB", grid3.nx, grid3.nz, path.display(), mb());
    Ok(())
}

fn bicubic(w: &Window, x: f64, y: f64, k: usize) -> f32 {
    let fx = (x - w.x0) / w.px - 0.5;
    let fy = (w.y0 - y) / w.py - 0.5;
    let (i, j) = (fx.floor() as i64, fy.floor() as i64);
    let (u, v) = ((fx - i as f64) as f32, (fy - j as f64) as f32);
    let cr = |t: f32| -> [f32; 4] {
        let (t2, t3) = (t * t, t * t * t);
        [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2]
    };
    let (wu, wv) = (cr(u), cr(v));
    let mut s = 0.0;
    for b in 0..4 {
        for a in 0..4 {
            let (ii, jj) = ((i + a as i64 - 1).clamp(0, w.w as i64 - 1) as usize, (j + b as i64 - 1).clamp(0, w.h as i64 - 1) as usize);
            let val = w.data[(jj * w.w + ii) * w.samples + k];
            s += if val.is_finite() { val } else { 0.0 } * wu[a] * wv[b];
        }
    }
    s
}

/// Unsharp mask (sigma 1.5 px, 70 %, threshold 2), contrast 1.12 and saturation 1.15: the same
/// look as the old Python imagery tool.
fn enhance(g: &Grid, rgb: &[f32]) -> Vec<u8> {
    let mut out = vec![0u8; rgb.len()];
    let mut chans = Vec::new();
    for c in 0..3 {
        let ch: Vec<f32> = rgb.iter().skip(c).step_by(3).cloned().collect();
        let bl = raster::gaussian(g, &ch, 1.5);
        chans.push((ch, bl));
    }
    let mean: f32 = rgb.iter().sum::<f32>() / rgb.len() as f32;
    for k in 0..g.len() {
        let mut px = [0f32; 3];
        for c in 0..3 {
            let (ch, bl) = &chans[c];
            let d = ch[k] - bl[k];
            px[c] = if d.abs() > 2.0 { ch[k] + 0.7 * d } else { ch[k] };
            px[c] = mean + (px[c] - mean) * 1.12;
        }
        let l = 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];
        for c in 0..3 {
            out[k * 3 + c] = (l + (px[c] - l) * 1.15).round().clamp(0.0, 255.0) as u8;
        }
    }
    out
}

// ---------------------------------------------------------------------------------------------

pub fn osm(aoi: &Aoi) -> Res<()> {
    let b = aoi.bbox;
    let bb = format!("{:.5},{:.5},{:.5},{:.5}", b.south, b.west, b.north, b.east);
    let mut q = String::from("[out:json][timeout:300];(");
    for k in ["building", "highway", "waterway", "railway", "aeroway", "landuse", "natural", "leisure", "amenity", "man_made", "barrier", "power", "place", "sport", "office", "shop", "tourism", "historic"] {
        q += &format!("way[\"{k}\"]({bb});relation[\"{k}\"]({bb});");
    }
    q += &format!("node[\"name\"]({bb});node[\"amenity\"]({bb});node[\"man_made\"]({bb});node[\"power\"=\"tower\"]({bb});node[\"barrier\"=\"gate\"]({bb});node[\"highway\"~\"street_lamp|traffic_signals|crossing|bus_stop\"]({bb});");
    q += ");out geom;";
    let mut last = None;
    for ep in ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.kumi.systems/api/interpreter"] {
        println!("  Overpass: {ep}");
        match http::post_form(ep, "data", &q) {
            Ok(s) if s.trim_start().starts_with('{') => {
                let j: Value = serde_json::from_str(&s)?;
                let n = j["elements"].as_array().map_or(0, |a| a.len());
                let path = root().join("data/campus/osm.json");
                std::fs::create_dir_all(path.parent().unwrap())?;
                std::fs::write(&path, s)?;
                println!("  {} OSM elements -> {}", n, path.display());
                return Ok(());
            }
            Ok(s) => last = Some(format!("unexpected reply: {}", &s[..s.len().min(200)])),
            Err(e) => last = Some(e.to_string()),
        }
    }
    Err(last.unwrap_or_default().into())
}

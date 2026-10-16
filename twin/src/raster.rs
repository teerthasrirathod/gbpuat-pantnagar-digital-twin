//! Rasters on the local metric grid and the geometry tools the analysis needs:
//! polygon/line rasterising, connected components, outline tracing, simplification,
//! convex hull + minimum-area rectangle, smoothing, depression filling and flow accumulation.

use crate::http::Res;
use serde::{Deserialize, Serialize};
use std::collections::{BinaryHeap, VecDeque};
use std::path::Path;

pub type P = [f64; 2];

/// Regular grid in local metres. (x0, z0) is the north-west corner; cell (i, j) has its centre at
/// (x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell); j grows southwards like z.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Grid {
    pub x0: f64,
    pub z0: f64,
    pub cell: f64,
    pub nx: usize,
    pub nz: usize,
}

impl Grid {
    pub fn cover(b: [f64; 4], cell: f64) -> Grid {
        let nx = ((b[2] - b[0]) / cell).ceil() as usize;
        let nz = ((b[3] - b[1]) / cell).ceil() as usize;
        Grid { x0: b[0], z0: b[1], cell, nx, nz }
    }
    pub fn len(&self) -> usize {
        self.nx * self.nz
    }
    pub fn center(&self, i: usize, j: usize) -> P {
        [self.x0 + (i as f64 + 0.5) * self.cell, self.z0 + (j as f64 + 0.5) * self.cell]
    }
    pub fn cell_of(&self, x: f64, z: f64) -> Option<(usize, usize)> {
        let i = ((x - self.x0) / self.cell).floor();
        let j = ((z - self.z0) / self.cell).floor();
        if i < 0.0 || j < 0.0 || i as usize >= self.nx || j as usize >= self.nz {
            None
        } else {
            Some((i as usize, j as usize))
        }
    }
    pub fn idx(&self, i: usize, j: usize) -> usize {
        j * self.nx + i
    }
}

#[derive(Serialize, Deserialize)]
struct Header {
    grid: Grid,
    bands: usize,
    note: String,
}

/// Save a u8 raster (possibly multi-band, interleaved) as <path>.json + <path>.bin (zlib).
pub fn save_u8(path: &Path, grid: Grid, bands: usize, data: &[u8], note: &str) -> Res<()> {
    use flate2::{write::ZlibEncoder, Compression};
    use std::io::Write;
    std::fs::create_dir_all(path.parent().unwrap())?;
    std::fs::write(path.with_extension("json"), serde_json::to_string(&Header { grid, bands, note: note.into() })?)?;
    let mut e = ZlibEncoder::new(Vec::new(), Compression::fast());
    e.write_all(data)?;
    std::fs::write(path.with_extension("bin"), e.finish()?)?;
    Ok(())
}

pub fn load_u8(path: &Path) -> Res<(Grid, usize, Vec<u8>)> {
    use flate2::read::ZlibDecoder;
    use std::io::Read;
    let h: Header = serde_json::from_str(&std::fs::read_to_string(path.with_extension("json"))?)?;
    let mut d = Vec::new();
    ZlibDecoder::new(std::fs::File::open(path.with_extension("bin"))?).read_to_end(&mut d)?;
    Ok((h.grid, h.bands, d))
}

pub fn save_f32(path: &Path, grid: Grid, data: &[f32], note: &str) -> Res<()> {
    let bytes: Vec<u8> = data.iter().flat_map(|v| v.to_le_bytes()).collect();
    save_u8(path, grid, 4, &bytes, note)
}

pub fn load_f32(path: &Path) -> Res<(Grid, Vec<f32>)> {
    let (g, _, b) = load_u8(path)?;
    Ok((g, b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()))
}

// ---------------------------------------------------------------------------------------------
// Rasterising

/// Mark cells whose centres fall inside the polygon (even-odd over all rings).
pub fn fill_polygon(g: &Grid, rings: &[Vec<P>], mut set: impl FnMut(usize)) {
    let (mut zmin, mut zmax) = (f64::MAX, f64::MIN);
    for r in rings {
        for p in r {
            zmin = zmin.min(p[1]);
            zmax = zmax.max(p[1]);
        }
    }
    let j0 = (((zmin - g.z0) / g.cell) - 0.5).ceil().max(0.0) as usize;
    let j1 = ((((zmax - g.z0) / g.cell) - 0.5).floor() as i64).min(g.nz as i64 - 1);
    if j1 < 0 {
        return;
    }
    let mut xs: Vec<f64> = Vec::new();
    for j in j0..=j1 as usize {
        let z = g.z0 + (j as f64 + 0.5) * g.cell;
        xs.clear();
        for r in rings {
            let n = r.len();
            for k in 0..n {
                let (a, b) = (r[k], r[(k + 1) % n]);
                if (a[1] > z) != (b[1] > z) {
                    xs.push(a[0] + (z - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
                }
            }
        }
        xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        for pair in xs.chunks_exact(2) {
            let i0 = (((pair[0] - g.x0) / g.cell) - 0.5).ceil().max(0.0) as i64;
            let i1 = ((((pair[1] - g.x0) / g.cell) - 0.5).floor() as i64).min(g.nx as i64 - 1);
            for i in i0..=i1 {
                set(g.idx(i as usize, j));
            }
        }
    }
}

/// Mark cells whose centres lie within `half_w` metres of the polyline.
pub fn stroke_line(g: &Grid, pts: &[P], half_w: f64, mut set: impl FnMut(usize)) {
    for s in pts.windows(2) {
        let (a, b) = (s[0], s[1]);
        let i0 = (((a[0].min(b[0]) - half_w - g.x0) / g.cell).floor().max(0.0)) as usize;
        let j0 = (((a[1].min(b[1]) - half_w - g.z0) / g.cell).floor().max(0.0)) as usize;
        let i1 = ((((a[0].max(b[0]) + half_w - g.x0) / g.cell).ceil()) as usize).min(g.nx);
        let j1 = ((((a[1].max(b[1]) + half_w - g.z0) / g.cell).ceil()) as usize).min(g.nz);
        for j in j0..j1 {
            for i in i0..i1 {
                if seg_dist(g.center(i, j), a, b) <= half_w {
                    set(g.idx(i, j));
                }
            }
        }
    }
}

pub fn seg_dist(p: P, a: P, b: P) -> f64 {
    let (dx, dz) = (b[0] - a[0], b[1] - a[1]);
    let l2 = dx * dx + dz * dz;
    let t = if l2 > 0.0 { (((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2).clamp(0.0, 1.0) } else { 0.0 };
    ((p[0] - a[0] - t * dx).powi(2) + (p[1] - a[1] - t * dz).powi(2)).sqrt()
}

/// Binary dilation by `r` cells (square structuring element, separable).
pub fn dilate(g: &Grid, m: &[bool], r: usize) -> Vec<bool> {
    let mut a = vec![false; m.len()];
    for j in 0..g.nz {
        let mut last: i64 = -1_000_000;
        for i in 0..g.nx {
            if m[g.idx(i, j)] {
                last = i as i64;
            }
            if i as i64 - last <= r as i64 {
                a[g.idx(i, j)] = true;
            }
        }
        last = 1_000_000;
        for i in (0..g.nx).rev() {
            if m[g.idx(i, j)] {
                last = i as i64;
            }
            if last - i as i64 <= r as i64 {
                a[g.idx(i, j)] = true;
            }
        }
    }
    let mut b = vec![false; m.len()];
    for i in 0..g.nx {
        let mut last: i64 = -1_000_000;
        for j in 0..g.nz {
            if a[g.idx(i, j)] {
                last = j as i64;
            }
            if j as i64 - last <= r as i64 {
                b[g.idx(i, j)] = true;
            }
        }
        last = 1_000_000;
        for j in (0..g.nz).rev() {
            if a[g.idx(i, j)] {
                last = j as i64;
            }
            if last - j as i64 <= r as i64 {
                b[g.idx(i, j)] = true;
            }
        }
    }
    b
}

// ---------------------------------------------------------------------------------------------
// Connected components

/// 8-connected (or 4-connected) labelling. Returns labels (0 = background) and the number of
/// components; component k has label k + 1.
pub fn label(g: &Grid, m: &[bool], eight: bool) -> (Vec<u32>, usize) {
    let mut lab = vec![0u32; m.len()];
    let mut n = 0u32;
    let mut q = VecDeque::new();
    for s in 0..m.len() {
        if !m[s] || lab[s] != 0 {
            continue;
        }
        n += 1;
        lab[s] = n;
        q.push_back(s);
        while let Some(c) = q.pop_front() {
            let (i, j) = ((c % g.nx) as i64, (c / g.nx) as i64);
            for dj in -1i64..=1 {
                for di in -1i64..=1 {
                    if (di == 0 && dj == 0) || (!eight && di != 0 && dj != 0) {
                        continue;
                    }
                    let (a, b) = (i + di, j + dj);
                    if a < 0 || b < 0 || a >= g.nx as i64 || b >= g.nz as i64 {
                        continue;
                    }
                    let k = b as usize * g.nx + a as usize;
                    if m[k] && lab[k] == 0 {
                        lab[k] = n;
                        q.push_back(k);
                    }
                }
            }
        }
    }
    (lab, n as usize)
}

/// Outer boundary of the cells with label `l` inside the cell box [i0, j0, i1, j1] (inclusive),
/// traced along cell edges, as a ring of local points (staircase, not simplified). Returns the
/// longest ring (the outer one).
pub fn trace_outline(g: &Grid, lab: &[u32], l: u32, bx: [usize; 4]) -> Vec<P> {
    use std::collections::HashMap;
    let inside = |i: i64, j: i64| -> bool {
        i >= 0 && j >= 0 && (i as usize) < g.nx && (j as usize) < g.nz && lab[g.idx(i as usize, j as usize)] == l
    };
    // Directed edges with the region on the left, in vertex (corner) coordinates.
    let mut next: HashMap<(i64, i64), Vec<(i64, i64)>> = HashMap::new();
    for j in bx[1] as i64..=bx[3] as i64 {
        for i in bx[0] as i64..=bx[2] as i64 {
            if !inside(i, j) {
                continue;
            }
            if !inside(i, j - 1) {
                next.entry((i + 1, j)).or_default().push((i, j));
            }
            if !inside(i, j + 1) {
                next.entry((i, j + 1)).or_default().push((i + 1, j + 1));
            }
            if !inside(i - 1, j) {
                next.entry((i, j)).or_default().push((i, j + 1));
            }
            if !inside(i + 1, j) {
                next.entry((i + 1, j + 1)).or_default().push((i + 1, j));
            }
        }
    }
    let mut best: Vec<(i64, i64)> = Vec::new();
    let keys: Vec<(i64, i64)> = next.keys().cloned().collect();
    for k in keys {
        while next.get(&k).map_or(false, |v| !v.is_empty()) {
            let mut ring = vec![k];
            let mut cur = k;
            loop {
                let Some(v) = next.get_mut(&cur) else { break };
                let Some(nx) = v.pop() else { break };
                if nx == k {
                    break;
                }
                ring.push(nx);
                cur = nx;
                if ring.len() > 4_000_000 {
                    break;
                }
            }
            if ring.len() > best.len() {
                best = ring;
            }
        }
    }
    best.into_iter().map(|(i, j)| [g.x0 + i as f64 * g.cell, g.z0 + j as f64 * g.cell]).collect()
}

/// Douglas-Peucker simplification of a closed ring.
pub fn simplify_ring(r: &[P], tol: f64) -> Vec<P> {
    if r.len() < 4 {
        return r.to_vec();
    }
    // Split at the two most distant points so the closed ring becomes two open chains.
    let a = 0;
    let b = (1..r.len())
        .max_by(|&x, &y| dist(r[a], r[x]).partial_cmp(&dist(r[a], r[y])).unwrap())
        .unwrap();
    let mut keep = vec![false; r.len()];
    keep[a] = true;
    keep[b] = true;
    fn dp(r: &[P], i0: usize, i1: usize, tol: f64, keep: &mut [bool]) {
        let n = r.len();
        let (mut best, mut bi) = (0.0, usize::MAX);
        let mut k = (i0 + 1) % n;
        while k != i1 {
            let d = seg_dist(r[k], r[i0], r[i1]);
            if d > best {
                best = d;
                bi = k;
            }
            k = (k + 1) % n;
        }
        if bi != usize::MAX && best > tol {
            keep[bi] = true;
            dp(r, i0, bi, tol, keep);
            dp(r, bi, i1, tol, keep);
        }
    }
    dp(r, a, b, tol, &mut keep);
    dp(r, b, a, tol, &mut keep);
    r.iter().zip(keep).filter(|(_, k)| *k).map(|(p, _)| *p).collect()
}

pub fn simplify_line(r: &[P], tol: f64) -> Vec<P> {
    if r.len() < 3 {
        return r.to_vec();
    }
    let mut keep = vec![false; r.len()];
    keep[0] = true;
    keep[r.len() - 1] = true;
    let mut stack = vec![(0usize, r.len() - 1)];
    while let Some((i0, i1)) = stack.pop() {
        let (mut best, mut bi) = (0.0, 0);
        for k in i0 + 1..i1 {
            let d = seg_dist(r[k], r[i0], r[i1]);
            if d > best {
                best = d;
                bi = k;
            }
        }
        if best > tol {
            keep[bi] = true;
            stack.push((i0, bi));
            stack.push((bi, i1));
        }
    }
    r.iter().zip(keep).filter(|(_, k)| *k).map(|(p, _)| *p).collect()
}

pub fn dist(a: P, b: P) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt()
}

pub fn ring_area(r: &[P]) -> f64 {
    let n = r.len();
    let mut s = 0.0;
    for k in 0..n {
        let (a, b) = (r[k], r[(k + 1) % n]);
        s += a[0] * b[1] - b[0] * a[1];
    }
    s.abs() / 2.0
}

pub fn ring_centroid(r: &[P]) -> P {
    let n = r.len();
    let (mut cx, mut cz, mut a2) = (0.0, 0.0, 0.0);
    for k in 0..n {
        let (a, b) = (r[k], r[(k + 1) % n]);
        let c = a[0] * b[1] - b[0] * a[1];
        cx += (a[0] + b[0]) * c;
        cz += (a[1] + b[1]) * c;
        a2 += c;
    }
    if a2.abs() < 1e-9 {
        let m = r.iter().fold([0.0, 0.0], |s, p| [s[0] + p[0], s[1] + p[1]]);
        return [m[0] / n as f64, m[1] / n as f64];
    }
    [cx / (3.0 * a2), cz / (3.0 * a2)]
}

pub fn point_in_ring(p: P, r: &[P]) -> bool {
    let mut c = false;
    let n = r.len();
    let mut j = n - 1;
    for i in 0..n {
        let (a, b) = (r[i], r[j]);
        if (a[1] > p[1]) != (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0] {
            c = !c;
        }
        j = i;
    }
    c
}

/// Convex hull (monotone chain), counter-clockwise in (x, z).
pub fn convex_hull(mut pts: Vec<P>) -> Vec<P> {
    pts.sort_by(|a, b| a.partial_cmp(b).unwrap());
    pts.dedup();
    if pts.len() < 3 {
        return pts;
    }
    let cross = |o: P, a: P, b: P| (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    let mut lower: Vec<P> = Vec::new();
    for &p in &pts {
        while lower.len() >= 2 && cross(lower[lower.len() - 2], lower[lower.len() - 1], p) <= 0.0 {
            lower.pop();
        }
        lower.push(p);
    }
    let mut upper: Vec<P> = Vec::new();
    for &p in pts.iter().rev() {
        while upper.len() >= 2 && cross(upper[upper.len() - 2], upper[upper.len() - 1], p) <= 0.0 {
            upper.pop();
        }
        upper.push(p);
    }
    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}

/// Minimum-area enclosing rectangle of a convex hull: (corners, area, long side, short side).
pub fn min_area_rect(h: &[P]) -> ([P; 4], f64, f64, f64) {
    let mut best = ([[0.0; 2]; 4], f64::MAX, 0.0, 0.0);
    for k in 0..h.len() {
        let (a, b) = (h[k], h[(k + 1) % h.len()]);
        let l = dist(a, b);
        if l < 1e-9 {
            continue;
        }
        let (ux, uz) = ((b[0] - a[0]) / l, (b[1] - a[1]) / l);
        let (mut s0, mut s1, mut t0, mut t1) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
        for p in h {
            let s = (p[0] - a[0]) * ux + (p[1] - a[1]) * uz;
            let t = -(p[0] - a[0]) * uz + (p[1] - a[1]) * ux;
            s0 = s0.min(s);
            s1 = s1.max(s);
            t0 = t0.min(t);
            t1 = t1.max(t);
        }
        let area = (s1 - s0) * (t1 - t0);
        if area < best.1 {
            let c = |s: f64, t: f64| [a[0] + s * ux - t * uz, a[1] + s * uz + t * ux];
            let (w, d) = (s1 - s0, t1 - t0);
            best = ([c(s0, t0), c(s1, t0), c(s1, t1), c(s0, t1)], area, w.max(d), w.min(d));
        }
    }
    best
}

// ---------------------------------------------------------------------------------------------
// Filters

pub fn gaussian(g: &Grid, v: &[f32], sigma: f64) -> Vec<f32> {
    let r = (sigma * 3.0).ceil() as i64;
    let k: Vec<f32> = (-r..=r).map(|x| (-(x * x) as f64 / (2.0 * sigma * sigma)).exp() as f32).collect();
    let ks: f32 = k.iter().sum();
    let k: Vec<f32> = k.iter().map(|x| x / ks).collect();
    let mut tmp = vec![0f32; v.len()];
    for j in 0..g.nz {
        for i in 0..g.nx {
            let mut s = 0.0;
            for (o, w) in k.iter().enumerate() {
                let a = (i as i64 + o as i64 - r).clamp(0, g.nx as i64 - 1) as usize;
                s += v[g.idx(a, j)] * w;
            }
            tmp[g.idx(i, j)] = s;
        }
    }
    let mut out = vec![0f32; v.len()];
    for j in 0..g.nz {
        for i in 0..g.nx {
            let mut s = 0.0;
            for (o, w) in k.iter().enumerate() {
                let b = (j as i64 + o as i64 - r).clamp(0, g.nz as i64 - 1) as usize;
                s += tmp[g.idx(i, b)] * w;
            }
            out[g.idx(i, j)] = s;
        }
    }
    out
}

/// Cells that are the maximum of their (2r+1)^2 neighbourhood and at least `min`.
pub fn local_maxima(g: &Grid, v: &[f32], r: usize, min: f32) -> Vec<usize> {
    let mut out = Vec::new();
    for j in 0..g.nz {
        for i in 0..g.nx {
            let c = v[g.idx(i, j)];
            if c < min {
                continue;
            }
            let mut is_max = true;
            'n: for b in j.saturating_sub(r)..(j + r + 1).min(g.nz) {
                for a in i.saturating_sub(r)..(i + r + 1).min(g.nx) {
                    let o = v[g.idx(a, b)];
                    if o > c || (o == c && (b, a) < (j, i)) {
                        is_max = false;
                        break 'n;
                    }
                }
            }
            if is_max {
                out.push(g.idx(i, j));
            }
        }
    }
    out
}

#[derive(PartialEq)]
struct Cell(f32, usize);
impl Eq for Cell {}
impl PartialOrd for Cell {
    fn partial_cmp(&self, o: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(o))
    }
}
impl Ord for Cell {
    fn cmp(&self, o: &Self) -> std::cmp::Ordering {
        o.0.partial_cmp(&self.0).unwrap_or(std::cmp::Ordering::Equal).then(o.1.cmp(&self.1))
    }
}

/// Priority-flood depression filling with a tiny epsilon gradient (so every cell drains), then
/// D8 flow directions and flow accumulation (number of upstream cells, including itself).
/// Returns (filled elevation, receiver index or usize::MAX at the edge, accumulation).
pub fn flow_accumulation(g: &Grid, dem: &[f32]) -> (Vec<f32>, Vec<usize>, Vec<u32>) {
    let n = g.len();
    let mut z = dem.to_vec();
    let mut done = vec![false; n];
    let mut heap = BinaryHeap::new();
    let mut order = Vec::with_capacity(n);
    let mut recv = vec![usize::MAX; n];
    for j in 0..g.nz {
        for i in 0..g.nx {
            if i == 0 || j == 0 || i == g.nx - 1 || j == g.nz - 1 {
                let k = g.idx(i, j);
                done[k] = true;
                heap.push(Cell(z[k], k));
            }
        }
    }
    while let Some(Cell(h, c)) = heap.pop() {
        order.push(c);
        let (i, j) = ((c % g.nx) as i64, (c / g.nx) as i64);
        for (di, dj) in [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)] {
            let (a, b) = (i + di, j + dj);
            if a < 0 || b < 0 || a >= g.nx as i64 || b >= g.nz as i64 {
                continue;
            }
            let k = b as usize * g.nx + a as usize;
            if done[k] {
                continue;
            }
            done[k] = true;
            if z[k] <= h {
                z[k] = h + 1e-4;
            }
            recv[k] = c;
            heap.push(Cell(z[k], k));
        }
    }
    // Cells are popped in increasing elevation, so the reverse order visits sources first.
    let mut acc = vec![1u32; n];
    for &c in order.iter().rev() {
        let r = recv[c];
        if r != usize::MAX {
            acc[r] += acc[c];
        }
    }
    (z, recv, acc)
}

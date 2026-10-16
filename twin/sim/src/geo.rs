//! Planar geometry in the campus frame (metres; x east, z south) and a uniform grid index.

pub type P = [f64; 2];

/// Local equirectangular frame centred on the campus origin (same constants as the viewer).
#[derive(Clone, Copy, Debug)]
pub struct Frame {
    pub lat0: f64,
    pub lon0: f64,
    pub m_lat: f64,
    pub m_lon: f64,
}

impl Frame {
    pub fn new(lat0: f64, lon0: f64) -> Self {
        Frame { lat0, lon0, m_lat: 110540.0, m_lon: 111320.0 * lat0.to_radians().cos() }
    }
    pub fn proj(&self, lon: f64, lat: f64) -> P {
        [(lon - self.lon0) * self.m_lon, -(lat - self.lat0) * self.m_lat]
    }
    /// Returns [lon, lat].
    pub fn unproj(&self, p: P) -> [f64; 2] {
        [self.lon0 + p[0] / self.m_lon, self.lat0 - p[1] / self.m_lat]
    }
}

pub fn ring_area(r: &[P]) -> f64 {
    let mut a = 0.0;
    for i in 0..r.len() {
        let p = r[i];
        let q = r[(i + 1) % r.len()];
        a += p[0] * q[1] - q[0] * p[1];
    }
    (a / 2.0).abs()
}

pub fn centroid(r: &[P]) -> P {
    let (mut a, mut cx, mut cz) = (0.0, 0.0, 0.0);
    for i in 0..r.len() {
        let p = r[i];
        let q = r[(i + 1) % r.len()];
        let w = p[0] * q[1] - q[0] * p[1];
        a += w;
        cx += (p[0] + q[0]) * w;
        cz += (p[1] + q[1]) * w;
    }
    if a.abs() < 1e-6 {
        let n = r.len().max(1) as f64;
        return [r.iter().map(|p| p[0]).sum::<f64>() / n, r.iter().map(|p| p[1]).sum::<f64>() / n];
    }
    [cx / (3.0 * a), cz / (3.0 * a)]
}

pub fn pip(x: f64, z: f64, r: &[P]) -> bool {
    let mut c = false;
    let n = r.len();
    let mut j = n.wrapping_sub(1);
    for i in 0..n {
        let a = r[i];
        let b = r[j];
        if (a[1] > z) != (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0] {
            c = !c;
        }
        j = i;
    }
    c
}

pub fn bbox(r: &[P]) -> [f64; 4] {
    let mut b = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
    for p in r {
        b[0] = b[0].min(p[0]);
        b[1] = b[1].min(p[1]);
        b[2] = b[2].max(p[0]);
        b[3] = b[3].max(p[1]);
    }
    b
}

pub fn dist(a: P, b: P) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

/// Distance from p to segment ab and the parameter t of the closest point.
pub fn seg_dist(p: P, a: P, b: P) -> (f64, f64) {
    let dx = b[0] - a[0];
    let dz = b[1] - a[1];
    let l2 = dx * dx + dz * dz;
    let t = if l2 > 0.0 { (((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2).clamp(0.0, 1.0) } else { 0.0 };
    ((p[0] - a[0] - t * dx).hypot(p[1] - a[1] - t * dz), t)
}

/// Proper intersection of segments ab and cd: (t along ab, u along cd).
pub fn seg_x(a: P, b: P, c: P, d: P) -> Option<(f64, f64)> {
    let r = [b[0] - a[0], b[1] - a[1]];
    let s = [d[0] - c[0], d[1] - c[1]];
    let den = r[0] * s[1] - r[1] * s[0];
    if den.abs() < 1e-12 {
        return None;
    }
    let qp = [c[0] - a[0], c[1] - a[1]];
    let t = (qp[0] * s[1] - qp[1] * s[0]) / den;
    let u = (qp[0] * r[1] - qp[1] * r[0]) / den;
    if (0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u) {
        Some((t, u))
    } else {
        None
    }
}

pub fn line_len(p: &[P]) -> f64 {
    p.windows(2).map(|w| dist(w[0], w[1])).sum()
}

pub fn bb_overlap(a: &[f64; 4], b: &[f64; 4]) -> bool {
    a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

/// Points along a polyline every `step` metres (including the first point).
pub fn sample_line(p: &[P], step: f64) -> Vec<(P, f64)> {
    let mut out = Vec::new();
    let mut acc = 0.0;
    let mut along = 0.0;
    for w in p.windows(2) {
        let l = dist(w[0], w[1]);
        if l < 1e-9 {
            continue;
        }
        while acc <= l {
            let t = acc / l;
            out.push(([w[0][0] + (w[1][0] - w[0][0]) * t, w[0][1] + (w[1][1] - w[0][1]) * t], along + acc));
            acc += step;
        }
        acc -= l;
        along += l;
    }
    out
}

/// Uniform grid of item ids over a fixed extent.
#[derive(Clone)]
pub struct Grid {
    pub x0: f64,
    pub z0: f64,
    pub cell: f64,
    pub nx: usize,
    pub nz: usize,
    pub cells: Vec<Vec<u32>>,
}

impl Grid {
    pub fn new(bounds: [f64; 4], cell: f64) -> Self {
        let nx = (((bounds[2] - bounds[0]) / cell).ceil() as usize).max(1) + 1;
        let nz = (((bounds[3] - bounds[1]) / cell).ceil() as usize).max(1) + 1;
        Grid { x0: bounds[0], z0: bounds[1], cell, nx, nz, cells: vec![Vec::new(); nx * nz] }
    }
    fn ij(&self, x: f64, z: f64) -> (i64, i64) {
        (((x - self.x0) / self.cell).floor() as i64, ((z - self.z0) / self.cell).floor() as i64)
    }
    fn clamp_ij(&self, i: i64, j: i64) -> (usize, usize) {
        (i.clamp(0, self.nx as i64 - 1) as usize, j.clamp(0, self.nz as i64 - 1) as usize)
    }
    pub fn insert_bb(&mut self, bb: [f64; 4], id: u32) {
        let (i0, j0) = self.ij(bb[0], bb[1]);
        let (i1, j1) = self.ij(bb[2], bb[3]);
        let (i0, j0) = self.clamp_ij(i0, j0);
        let (i1, j1) = self.clamp_ij(i1, j1);
        for j in j0..=j1 {
            for i in i0..=i1 {
                self.cells[j * self.nx + i].push(id);
            }
        }
    }
    pub fn remove_bb(&mut self, bb: [f64; 4], id: u32) {
        let (i0, j0) = self.ij(bb[0], bb[1]);
        let (i1, j1) = self.ij(bb[2], bb[3]);
        let (i0, j0) = self.clamp_ij(i0, j0);
        let (i1, j1) = self.clamp_ij(i1, j1);
        for j in j0..=j1 {
            for i in i0..=i1 {
                self.cells[j * self.nx + i].retain(|&k| k != id);
            }
        }
    }
    /// Calls f for every id registered in cells overlapping bb (ids may repeat).
    pub fn query_bb(&self, bb: [f64; 4], mut f: impl FnMut(u32)) {
        let (i0, j0) = self.ij(bb[0], bb[1]);
        let (i1, j1) = self.ij(bb[2], bb[3]);
        if i1 < 0 || j1 < 0 || i0 >= self.nx as i64 || j0 >= self.nz as i64 {
            return;
        }
        let (i0, j0) = self.clamp_ij(i0, j0);
        let (i1, j1) = self.clamp_ij(i1, j1);
        for j in j0..=j1 {
            for i in i0..=i1 {
                for &k in &self.cells[j * self.nx + i] {
                    f(k);
                }
            }
        }
    }
    /// Calls f for every id in the cells a segment passes through (grid traversal; ids may repeat).
    pub fn query_seg(&self, a: P, b: P, mut f: impl FnMut(u32)) {
        let (mut i, mut j) = self.ij(a[0], a[1]);
        let (bi, bj) = self.ij(b[0], b[1]);
        let dx = b[0] - a[0];
        let dz = b[1] - a[1];
        let si: i64 = if dx > 0.0 { 1 } else { -1 };
        let sj: i64 = if dz > 0.0 { 1 } else { -1 };
        let next_x = self.x0 + (i + if dx > 0.0 { 1 } else { 0 }) as f64 * self.cell;
        let next_z = self.z0 + (j + if dz > 0.0 { 1 } else { 0 }) as f64 * self.cell;
        let mut tmx = if dx.abs() > 1e-12 { (next_x - a[0]) / dx } else { f64::INFINITY };
        let mut tmz = if dz.abs() > 1e-12 { (next_z - a[1]) / dz } else { f64::INFINITY };
        let tdx = if dx.abs() > 1e-12 { self.cell / dx.abs() } else { f64::INFINITY };
        let tdz = if dz.abs() > 1e-12 { self.cell / dz.abs() } else { f64::INFINITY };
        let max_steps = (i - bi).abs() + (j - bj).abs() + 2;
        for _ in 0..=max_steps {
            if i >= 0 && j >= 0 && (i as usize) < self.nx && (j as usize) < self.nz {
                for &k in &self.cells[j as usize * self.nx + i as usize] {
                    f(k);
                }
            }
            if i == bi && j == bj {
                break;
            }
            if tmx < tmz {
                tmx += tdx;
                i += si;
            } else {
                tmz += tdz;
                j += sj;
            }
        }
    }
}

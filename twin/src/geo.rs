//! Coordinate frames.
//!
//! * WGS84 longitude/latitude (degrees).
//! * The viewer's local frame: x = east, z = south, metres from ORIGIN (same constants as
//!   tools/geo.mjs, so old and new data line up).
//! * UTM (WGS84), used by the Google Open Buildings rasters. Krüger series, sub-millimetre here.

pub const LAT0: f64 = 29.0205;
pub const LON0: f64 = 79.4935;
pub const M_LAT: f64 = 110_540.0;

pub fn m_lon() -> f64 {
    111_320.0 * LAT0.to_radians().cos()
}

/// lon/lat -> local [x, z] metres.
pub fn proj(lon: f64, lat: f64) -> [f64; 2] {
    [(lon - LON0) * m_lon(), -(lat - LAT0) * M_LAT]
}

/// local [x, z] -> [lon, lat].
pub fn unproj(x: f64, z: f64) -> [f64; 2] {
    [LON0 + x / m_lon(), LAT0 - z / M_LAT]
}

#[derive(Clone, Copy, Debug)]
pub struct BBox {
    pub west: f64,
    pub south: f64,
    pub east: f64,
    pub north: f64,
}

impl BBox {
    /// The same box in local metres: (x0, z0) north-west corner, (x1, z1) south-east.
    #[allow(dead_code)]
    pub fn local(&self) -> [f64; 4] {
        let [x0, z0] = proj(self.west, self.north);
        let [x1, z1] = proj(self.east, self.south);
        [x0, z0, x1, z1]
    }
}

// ---------------------------------------------------------------------------------------------
// UTM (Krüger / Karney series, 3 terms)

const A: f64 = 6_378_137.0;
const F: f64 = 1.0 / 298.257_223_563;
const K0: f64 = 0.9996;
const E0: f64 = 500_000.0;

#[allow(dead_code)]
struct Tm {
    n: f64,
    big_a: f64,
    alpha: [f64; 3],
    beta: [f64; 3],
    delta: [f64; 3],
}

fn tm() -> Tm {
    let n = F / (2.0 - F);
    let (n2, n3) = (n * n, n * n * n);
    Tm {
        n,
        big_a: A / (1.0 + n) * (1.0 + n2 / 4.0 + n2 * n2 / 64.0),
        alpha: [n / 2.0 - 2.0 * n2 / 3.0 + 5.0 * n3 / 16.0, 13.0 * n2 / 48.0 - 3.0 * n3 / 5.0, 61.0 * n3 / 240.0],
        beta: [n / 2.0 - 2.0 * n2 / 3.0 + 37.0 * n3 / 96.0, n2 / 48.0 + n3 / 15.0, 17.0 * n3 / 480.0],
        delta: [2.0 * n - 2.0 * n2 / 3.0 - 2.0 * n3, 7.0 * n2 / 3.0 - 8.0 * n3 / 5.0, 56.0 * n3 / 15.0],
    }
}

pub fn utm_zone(lon: f64) -> u32 {
    ((lon + 180.0) / 6.0).floor() as u32 + 1
}

fn central_meridian(zone: u32) -> f64 {
    (zone as f64 * 6.0 - 183.0).to_radians()
}

/// lon/lat -> [easting, northing] in the given northern-hemisphere UTM zone.
pub fn utm_forward(lon: f64, lat: f64, zone: u32) -> [f64; 2] {
    let t = tm();
    let phi = lat.to_radians();
    let dl = lon.to_radians() - central_meridian(zone);
    let c = 2.0 * t.n.sqrt() / (1.0 + t.n);
    let tt = (phi.sin().atanh() - c * (c * phi.sin()).atanh()).sinh();
    let xi_p = (tt / dl.cos()).atan();
    let eta_p = (dl.sin() / (1.0 + tt * tt).sqrt()).atanh();
    let (mut xi, mut eta) = (xi_p, eta_p);
    for j in 0..3 {
        let k = 2.0 * (j as f64 + 1.0);
        xi += t.alpha[j] * (k * xi_p).sin() * (k * eta_p).cosh();
        eta += t.alpha[j] * (k * xi_p).cos() * (k * eta_p).sinh();
    }
    [E0 + K0 * t.big_a * eta, K0 * t.big_a * xi]
}

/// [easting, northing] in a northern-hemisphere UTM zone -> [lon, lat].
#[allow(dead_code)]
pub fn utm_inverse(e: f64, n: f64, zone: u32) -> [f64; 2] {
    let t = tm();
    let xi = n / (K0 * t.big_a);
    let eta = (e - E0) / (K0 * t.big_a);
    let (mut xi_p, mut eta_p) = (xi, eta);
    for j in 0..3 {
        let k = 2.0 * (j as f64 + 1.0);
        xi_p -= t.beta[j] * (k * xi).sin() * (k * eta).cosh();
        eta_p -= t.beta[j] * (k * xi).cos() * (k * eta).sinh();
    }
    let chi = (xi_p.sin() / eta_p.cosh()).asin();
    let mut phi = chi;
    for j in 0..3 {
        phi += t.delta[j] * (2.0 * (j as f64 + 1.0) * chi).sin();
    }
    let lam = central_meridian(zone) + (eta_p.sinh() / xi_p.cos()).atan();
    [lam.to_degrees(), phi.to_degrees()]
}

/// Web Mercator quadkey of the tile containing lon/lat at zoom z (Meta canopy tiles use z9).
pub fn quadkey(lon: f64, lat: f64, z: u32) -> String {
    let n = (1u64 << z) as f64;
    let x = ((lon + 180.0) / 360.0 * n) as u64;
    let lr = lat.to_radians();
    let y = ((1.0 - (lr.tan() + 1.0 / lr.cos()).ln() / std::f64::consts::PI) / 2.0 * n) as u64;
    (1..=z)
        .rev()
        .map(|i| {
            let m = 1u64 << (i - 1);
            char::from(b'0' + ((x & m != 0) as u8) + 2 * ((y & m != 0) as u8))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn utm_roundtrip() {
        let [e, n] = utm_forward(79.4935, 29.0205, 44);
        let [lon, lat] = utm_inverse(e, n, 44);
        assert!((lon - 79.4935).abs() < 1e-9 && (lat - 29.0205).abs() < 1e-9);
        // Zone 44 central meridian is 81 E: about 146.7 km west of it.
        assert!((e - 353_300.0).abs() < 1_000.0, "e = {e}");
        assert!((n - 3_211_000.0).abs() < 5_000.0, "n = {n}");
    }
}

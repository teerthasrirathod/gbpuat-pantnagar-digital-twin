//! The campus area of interest: the census villages that hold the campus (Nagla (CT), Phoolbag),
//! from data/raw/village_boundaries.json (Uttarakhand State GIS Portal / Census 2011).

use crate::geo::{self, BBox};
use crate::http::Res;
use crate::raster::P;
use serde::Deserialize;
use std::path::PathBuf;

pub const VILLAGES: [&str; 2] = ["Nagla (CT)", "Phoolbag"];
const MARGIN_M: f64 = 150.0;

pub fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
}

#[derive(Deserialize)]
struct VillageFile {
    villages: Vec<Village>,
}

#[derive(Deserialize, Clone)]
pub struct Village {
    pub name: String,
    pub census2011_code: String,
    pub rings: Vec<Vec<[f64; 2]>>,
}

pub struct Aoi {
    /// Every village in the file (neighbours too), in lon/lat.
    pub villages: Vec<Village>,
    /// The campus villages' outer rings in local metres.
    pub rings: Vec<Vec<P>>,
    /// Bounding box (lon/lat) of the campus villages plus a margin.
    pub bbox: BBox,
    /// The same box in local metres [x0, z0, x1, z1].
    pub local: [f64; 4],
}

impl Aoi {
    pub fn load() -> Res<Aoi> {
        let path = root().join("data/raw/village_boundaries.json");
        let f: VillageFile = serde_json::from_str(&std::fs::read_to_string(&path)?)?;
        let mut rings = Vec::new();
        let (mut x0, mut z0, mut x1, mut z1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for v in f.villages.iter().filter(|v| VILLAGES.contains(&v.name.as_str())) {
            for r in &v.rings {
                let pr: Vec<P> = r.iter().map(|p| geo::proj(p[0], p[1])).collect();
                for p in &pr {
                    x0 = x0.min(p[0]);
                    z0 = z0.min(p[1]);
                    x1 = x1.max(p[0]);
                    z1 = z1.max(p[1]);
                }
                rings.push(pr);
            }
        }
        if rings.is_empty() {
            return Err("campus villages not found in village_boundaries.json".into());
        }
        let local = [x0 - MARGIN_M, z0 - MARGIN_M, x1 + MARGIN_M, z1 + MARGIN_M];
        let [west, north] = geo::unproj(local[0], local[1]);
        let [east, south] = geo::unproj(local[2], local[3]);
        Ok(Aoi { villages: f.villages, rings, bbox: BBox { west, south, east, north }, local })
    }

    pub fn contains(&self, p: P) -> bool {
        self.rings.iter().any(|r| crate::raster::point_in_ring(p, r))
    }
}

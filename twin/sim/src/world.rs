//! The baseline campus, read from the same JSON the viewer uses (campus-data.js).

use crate::geo::*;
use crate::graph::Graph;
use serde::Deserialize;

#[derive(Deserialize)]
struct RawCampus {
    meta: RawMeta,
    buildings: Vec<RawBld>,
    roads: Vec<RawRoad>,
    graph: RawGraph,
    #[serde(default)]
    trees: Vec<f32>,
    #[serde(default)]
    water: RawWater,
    #[serde(default)]
    villages: Vec<RawVillage>,
}
#[derive(Deserialize)]
struct RawMeta {
    origin: RawOrigin,
    bounds: [f64; 4],
    #[serde(default)]
    types: Vec<(String, String)>,
}
#[derive(Deserialize)]
struct RawOrigin {
    lat: f64,
    lon: f64,
}
#[derive(Deserialize)]
struct RawBld {
    r: Vec<Vec<f64>>,
    h: f64,
    #[serde(default)]
    f: f64,
    t: String,
    #[serde(default)]
    n: Option<String>,
    #[serde(default)]
    id: Option<String>,
}
#[derive(Deserialize)]
struct RawRoad {
    p: Vec<f64>,
    w: f64,
    c: String,
    #[serde(default)]
    s: Option<String>,
    #[serde(default)]
    n: Option<String>,
}
#[derive(Deserialize)]
struct RawGraph {
    nodes: Vec<f64>,
    edges: Vec<[u32; 3]>,
}
#[derive(Deserialize, Default)]
struct RawWater {
    #[serde(default)]
    areas: Vec<RawArea>,
}
#[derive(Deserialize)]
struct RawArea {
    r: Vec<Vec<f64>>,
}
#[derive(Deserialize)]
struct RawVillage {
    r: Vec<Vec<f64>>,
    #[serde(default)]
    campus: bool,
}

#[derive(Clone)]
pub struct Bld {
    pub key: String,
    pub ring: Vec<P>,
    pub bb: [f64; 4],
    pub floors: u32,
    pub t: u8,
    pub name: String,
    pub area: f64,
    pub c: P,
    pub campus: bool,
}

/// Road classes for lighting targets (IS 1944): 0 major, 1 minor, 2 dirt track, 3 path.
pub struct Road {
    pub pts: Vec<P>,
    pub w: f64,
    pub class: u8,
    pub name: String,
}

#[derive(Clone, Copy)]
pub struct RoadSample {
    pub p: P,
    pub target: f32,
}

pub struct World {
    pub frame: Frame,
    pub bounds: [f64; 4],
    pub types: Vec<String>,
    pub type_labels: Vec<String>,
    pub blds: Vec<Bld>,
    pub bgrid: Grid,
    pub roads: Vec<Road>,
    pub graph: Graph,
    pub trees: Vec<[f32; 3]>,
    pub tgrid: Grid,
    pub ponds: Vec<(Vec<P>, [f64; 4])>,
    pub campus: Vec<Vec<P>>,
    pub samples: Vec<RoadSample>,
    pub sgrid: Grid,
}

pub fn ring_of(flat: &[f64]) -> Vec<P> {
    let mut r: Vec<P> = flat.chunks_exact(2).map(|c| [c[0], c[1]]).collect();
    if r.len() > 1 && r[0] == r[r.len() - 1] {
        r.pop();
    }
    r
}

pub fn road_class(c: &str, s: Option<&str>) -> u8 {
    if ["path", "footway", "cycleway", "steps", "bridleway", "pedestrian"].contains(&c) {
        return 3;
    }
    let s = s.unwrap_or("");
    if c == "track" || ["unpaved", "dirt", "earth", "gravel", "ground", "sand", "mud", "grass"].iter().any(|k| s.contains(k)) {
        return 2;
    }
    if c.starts_with("motorway") || c.starts_with("trunk") || c.starts_with("primary") || c.starts_with("secondary") || c.starts_with("tertiary") {
        return 0;
    }
    1
}

/// Lighting target in lux by road class (IS 1944: A2 15, B1 8, B2 4).
pub fn lux_target(class: u8) -> f32 {
    match class {
        0 => 15.0,
        1 => 8.0,
        _ => 4.0,
    }
}

impl World {
    /// `text` is the campus JSON (the object assigned to window.CAMPUS).
    pub fn load(text: &str) -> Result<World, String> {
        let t = text.trim();
        let t = match (t.find('{'), t.rfind('}')) {
            (Some(a), Some(b)) => &t[a..=b],
            _ => return Err("no JSON object found".into()),
        };
        let raw: RawCampus = serde_json::from_str(t).map_err(|e| format!("campus data: {e}"))?;
        let frame = Frame::new(raw.meta.origin.lat, raw.meta.origin.lon);
        let b = raw.meta.bounds;
        let bounds = [b[0] - 500.0, b[1] - 500.0, b[2] + 500.0, b[3] + 500.0];
        let mut types: Vec<String> = raw.meta.types.iter().map(|t| t.0.clone()).collect();
        let mut type_labels: Vec<String> = raw.meta.types.iter().map(|t| t.1.clone()).collect();
        let campus: Vec<Vec<P>> = raw.villages.iter().filter(|v| v.campus).flat_map(|v| v.r.iter().map(|r| ring_of(r))).collect();
        let mut blds = Vec::with_capacity(raw.buildings.len());
        let mut bgrid = Grid::new(bounds, 50.0);
        for rb in &raw.buildings {
            let Some(r0) = rb.r.first() else { continue };
            let ring = ring_of(r0);
            if ring.len() < 3 {
                continue;
            }
            let tcode = match types.iter().position(|x| *x == rb.t) {
                Some(i) => i,
                None => {
                    types.push(rb.t.clone());
                    type_labels.push(rb.t.clone());
                    types.len() - 1
                }
            } as u8;
            // Key: OSM-style id when present, else the rounded vertex mean (as the viewer computes it).
            let n = ring.len() as f64;
            let vm = [ring.iter().map(|p| p[0]).sum::<f64>() / n, ring.iter().map(|p| p[1]).sum::<f64>() / n];
            let key = rb.id.clone().unwrap_or_else(|| format!("g{}_{}", vm[0].round(), vm[1].round()));
            let bb = bbox(&ring);
            let c = centroid(&ring);
            let floors = if rb.f >= 1.0 { rb.f.round() as u32 } else { ((rb.h / 3.2).round() as u32).max(1) };
            let id = blds.len() as u32;
            bgrid.insert_bb(bb, id);
            blds.push(Bld {
                key,
                area: ring_area(&ring),
                campus: campus.iter().any(|r| pip(c[0], c[1], r)),
                ring,
                bb,
                floors,
                t: tcode,
                name: rb.n.clone().unwrap_or_default(),
                c,
            });
        }
        let roads: Vec<Road> = raw
            .roads
            .iter()
            .map(|r| Road { pts: ring_of(&r.p), w: r.w, class: road_class(&r.c, r.s.as_deref()), name: r.n.clone().unwrap_or_default() })
            .collect();
        let nodes: Vec<P> = raw.graph.nodes.chunks_exact(2).map(|c| [c[0], c[1]]).collect();
        let graph = Graph::new(bounds, nodes, &raw.graph.edges);
        let trees: Vec<[f32; 3]> = raw.trees.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
        let mut tgrid = Grid::new(bounds, 20.0);
        for (i, t) in trees.iter().enumerate() {
            let (x, z) = (t[0] as f64, t[1] as f64);
            tgrid.insert_bb([x, z, x, z], i as u32);
        }
        let ponds = raw.water.areas.iter().filter_map(|a| a.r.first()).map(|r| ring_of(r)).filter(|r| r.len() >= 3).map(|r| {
            let bb = bbox(&r);
            (r, bb)
        }).collect();
        let mut samples = Vec::new();
        let mut sgrid = Grid::new(bounds, 25.0);
        for r in &roads {
            let target = lux_target(r.class);
            for (p, _) in sample_line(&r.pts, 2.0) {
                sgrid.insert_bb([p[0], p[1], p[0], p[1]], samples.len() as u32);
                samples.push(RoadSample { p, target });
            }
        }
        Ok(World { frame, bounds, types, type_labels, blds, bgrid, roads, graph, trees, tgrid, ponds, campus, samples, sgrid })
    }

    pub fn type_code(&self, t: &str) -> Option<u8> {
        self.types.iter().position(|x| x == t).map(|i| i as u8)
    }

    pub fn type_name(&self, c: u8) -> &str {
        self.types.get(c as usize).map(|s| s.as_str()).unwrap_or("unknown")
    }

    pub fn in_campus(&self, p: P) -> bool {
        self.campus.iter().any(|r| pip(p[0], p[1], r))
    }

    /// Nearest tree within max_d.
    pub fn tree_near(&self, p: P, max_d: f64) -> Option<u32> {
        let mut best: Option<(u32, f64)> = None;
        self.tgrid.query_bb([p[0] - max_d, p[1] - max_d, p[0] + max_d, p[1] + max_d], |k| {
            let t = self.trees[k as usize];
            let d = (t[0] as f64 - p[0]).hypot(t[1] as f64 - p[1]);
            if d <= max_d && best.map_or(true, |b| d < b.1) {
                best = Some((k, d));
            }
        });
        best.map(|b| b.0)
    }

    pub fn on_pond(&self, p: P) -> bool {
        self.ponds.iter().any(|(r, bb)| p[0] >= bb[0] && p[0] <= bb[2] && p[1] >= bb[1] && p[1] <= bb[3] && pip(p[0], p[1], r))
    }

    /// Distance from p to the nearest road edge (centreline distance minus half width), within max_d.
    pub fn road_clearance(&self, p: P, max_d: f64) -> Option<f64> {
        let mut best: Option<f64> = None;
        self.graph.grid.query_bb([p[0] - max_d, p[1] - max_d, p[0] + max_d, p[1] + max_d], |k| {
            let e = &self.graph.edges[k as usize];
            if (k as usize) >= self.graph.base_edges {
                return;
            }
            let (d, _) = seg_dist(p, self.graph.nodes[e.a as usize], self.graph.nodes[e.b as usize]);
            let w = self.roads.get(e.road as usize).map_or(4.0, |r| r.w);
            let c = d - w / 2.0;
            if d <= max_d && best.map_or(true, |b| c < b) {
                best = Some(c);
            }
        });
        best
    }
}

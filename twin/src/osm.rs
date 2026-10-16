//! OpenStreetMap (Overpass `out geom`) parsing: nodes, ways with node ids + coordinates, and
//! multipolygon relations stitched into rings.

use crate::geo;
use crate::http::Res;
use crate::raster::P;
use serde_json::Value;
use std::collections::HashMap;

pub type Tags = HashMap<String, String>;

#[allow(dead_code)]
pub struct Node {
    pub id: i64,
    pub p: P,
    pub tags: Tags,
}

pub struct Way {
    pub id: i64,
    pub nodes: Vec<i64>,
    /// Local metres.
    pub pts: Vec<P>,
    pub tags: Tags,
}

pub struct Rel {
    pub id: i64,
    pub tags: Tags,
    /// Stitched outer and inner rings (local metres).
    pub outers: Vec<Vec<P>>,
    pub inners: Vec<Vec<P>>,
}

pub struct Osm {
    pub nodes: Vec<Node>,
    pub ways: Vec<Way>,
    pub rels: Vec<Rel>,
}

fn tags(v: &Value) -> Tags {
    v["tags"]
        .as_object()
        .map(|m| m.iter().map(|(k, v)| (k.clone(), v.as_str().unwrap_or_default().to_string())).collect())
        .unwrap_or_default()
}

fn geom(v: &Value) -> Vec<[f64; 2]> {
    v["geometry"]
        .as_array()
        .map(|a| a.iter().filter_map(|g| Some([g["lon"].as_f64()?, g["lat"].as_f64()?])).collect())
        .unwrap_or_default()
}

/// Join open segments (lon/lat, exact shared end points) into closed rings.
fn stitch(mut segs: Vec<Vec<[f64; 2]>>) -> Vec<Vec<[f64; 2]>> {
    let mut rings = Vec::new();
    segs.retain(|s| s.len() >= 2);
    while let Some(mut cur) = segs.pop() {
        loop {
            if cur.first() == cur.last() && cur.len() >= 4 {
                break;
            }
            let end = *cur.last().unwrap();
            let Some(k) = segs.iter().position(|s| s.first() == Some(&end) || s.last() == Some(&end)) else { break };
            let mut s = segs.swap_remove(k);
            if s.first() != Some(&end) {
                s.reverse();
            }
            cur.extend(s.into_iter().skip(1));
        }
        if cur.len() >= 4 {
            rings.push(cur);
        }
    }
    rings
}

pub fn load(path: &std::path::Path) -> Res<Osm> {
    let j: Value = serde_json::from_str(&std::fs::read_to_string(path)?)?;
    let (mut nodes, mut ways, mut rels) = (Vec::new(), Vec::new(), Vec::new());
    let mut seen = std::collections::HashSet::new();
    for e in j["elements"].as_array().ok_or("no elements")? {
        let id = e["id"].as_i64().unwrap_or(0);
        let ty = e["type"].as_str().unwrap_or("");
        if !seen.insert((ty.to_string(), id)) {
            continue;
        }
        match ty {
            "node" => {
                if let (Some(lon), Some(lat)) = (e["lon"].as_f64(), e["lat"].as_f64()) {
                    nodes.push(Node { id, p: geo::proj(lon, lat), tags: tags(e) });
                }
            }
            "way" => {
                let g = geom(e);
                let ids: Vec<i64> = e["nodes"].as_array().map(|a| a.iter().filter_map(|n| n.as_i64()).collect()).unwrap_or_default();
                if g.len() >= 2 {
                    ways.push(Way { id, nodes: ids, pts: g.iter().map(|p| geo::proj(p[0], p[1])).collect(), tags: tags(e) });
                }
            }
            "relation" => {
                let t = tags(e);
                if t.get("type").map(String::as_str) != Some("multipolygon") {
                    continue;
                }
                let (mut outer, mut inner) = (Vec::new(), Vec::new());
                for m in e["members"].as_array().into_iter().flatten() {
                    if m["type"] != "way" {
                        continue;
                    }
                    let g = geom(m);
                    if m["role"] == "inner" {
                        inner.push(g);
                    } else {
                        outer.push(g);
                    }
                }
                let to_local = |rs: Vec<Vec<[f64; 2]>>| -> Vec<Vec<P>> {
                    rs.into_iter().map(|r| r.iter().map(|p| geo::proj(p[0], p[1])).collect()).collect()
                };
                let outers = to_local(stitch(outer));
                if !outers.is_empty() {
                    rels.push(Rel { id, tags: t, outers, inners: to_local(stitch(inner)) });
                }
            }
            _ => {}
        }
    }
    Ok(Osm { nodes, ways, rels })
}

impl Way {
    pub fn closed(&self) -> bool {
        self.pts.len() >= 4 && self.nodes.first() == self.nodes.last()
    }
    pub fn tag(&self, k: &str) -> &str {
        self.tags.get(k).map(String::as_str).unwrap_or("")
    }
}

pub fn tag<'a>(t: &'a Tags, k: &str) -> &'a str {
    t.get(k).map(String::as_str).unwrap_or("")
}

pub fn name(t: &Tags) -> Option<String> {
    t.get("name").or_else(|| t.get("name:en")).filter(|s| !s.trim().is_empty()).cloned()
}

/// Parse "12", "12 m", "12.5m" -> metres.
pub fn metres(s: &str) -> Option<f64> {
    let s = s.trim().trim_end_matches('m').trim();
    s.parse::<f64>().ok().filter(|v| *v > 0.0)
}

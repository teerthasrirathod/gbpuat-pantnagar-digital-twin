//! Scenario files: GeoJSON FeatureCollections with a `sandbox` member for plan metadata.
//! Each feature is one item; `properties.kind` says what it is, `status` is "existing" (mapped
//! from the ground, part of the baseline) or "proposed" (part of the plan). Everything else in
//! `properties` is a parameter of that kind (see catalog.rs).

use crate::geo::*;
use serde_json::{Map, Value};

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Status {
    Existing,
    Proposed,
}

#[derive(Clone, Debug)]
pub enum Geom {
    Point(P),
    Line(Vec<P>),
    Poly(Vec<P>),
}

#[derive(Clone, Debug)]
pub struct Item {
    pub id: String,
    pub kind: String,
    pub status: Status,
    pub name: String,
    pub geom: Geom,
    pub props: Map<String, Value>,
}

impl Item {
    pub fn num(&self, k: &str, d: f64) -> f64 {
        match self.props.get(k) {
            Some(Value::Number(n)) => n.as_f64().unwrap_or(d),
            Some(Value::String(s)) => s.trim().parse().unwrap_or(d),
            Some(Value::Bool(b)) => {
                if *b {
                    1.0
                } else {
                    0.0
                }
            }
            _ => d,
        }
    }
    pub fn text(&self, k: &str, d: &str) -> String {
        match self.props.get(k) {
            Some(Value::String(s)) if !s.is_empty() => s.clone(),
            Some(Value::Number(n)) => n.to_string(),
            _ => d.to_string(),
        }
    }
    pub fn point(&self) -> P {
        match &self.geom {
            Geom::Point(p) => *p,
            Geom::Line(l) => l[0],
            Geom::Poly(r) => centroid(r),
        }
    }
    pub fn line(&self) -> Option<&[P]> {
        match &self.geom {
            Geom::Line(l) if l.len() >= 2 => Some(l),
            _ => None,
        }
    }
    pub fn poly(&self) -> Option<&[P]> {
        match &self.geom {
            Geom::Poly(r) if r.len() >= 3 => Some(r),
            _ => None,
        }
    }
    pub fn proposed(&self) -> bool {
        self.status == Status::Proposed
    }
}

pub struct Scenario {
    pub meta: Map<String, Value>,
    pub items: Vec<Item>,
}

impl Scenario {
    pub fn meta_num(&self, path: &[&str], d: f64) -> f64 {
        let mut v = self.meta.get(path[0]);
        for k in &path[1..] {
            v = v.and_then(|x| x.get(*k));
        }
        v.and_then(|x| x.as_f64().or_else(|| x.as_str().and_then(|s| s.parse().ok()))).unwrap_or(d)
    }
}

fn lonlat(v: &Value, f: &Frame) -> Option<P> {
    let a = v.as_array()?;
    Some(f.proj(a.first()?.as_f64()?, a.get(1)?.as_f64()?))
}

fn line_of(v: &Value, f: &Frame) -> Vec<P> {
    v.as_array().map(|a| a.iter().filter_map(|p| lonlat(p, f)).collect()).unwrap_or_default()
}

pub fn parse(text: &str, frame: &Frame) -> Result<Scenario, String> {
    let v: Value = serde_json::from_str(text).map_err(|e| format!("scenario is not valid JSON: {e}"))?;
    let meta = v.get("sandbox").and_then(|m| m.as_object()).cloned().unwrap_or_default();
    let feats = v.get("features").and_then(|f| f.as_array()).ok_or("scenario has no features array")?;
    let mut items = Vec::new();
    for (i, f) in feats.iter().enumerate() {
        let props = f.get("properties").and_then(|p| p.as_object()).cloned().unwrap_or_default();
        let Some(kind) = props.get("kind").and_then(|k| k.as_str()).map(|s| s.to_string()) else { continue };
        let g = f.get("geometry").unwrap_or(&Value::Null);
        let coords = g.get("coordinates").unwrap_or(&Value::Null);
        let geom = match g.get("type").and_then(|t| t.as_str()) {
            Some("Point") => match lonlat(coords, frame) {
                Some(p) => Geom::Point(p),
                None => continue,
            },
            Some("LineString") => Geom::Line(line_of(coords, frame)),
            Some("Polygon") => {
                let mut r = coords.as_array().and_then(|a| a.first()).map(|r| line_of(r, frame)).unwrap_or_default();
                if r.len() > 1 && r[0] == r[r.len() - 1] {
                    r.pop();
                }
                Geom::Poly(r)
            }
            _ => continue,
        };
        let status = match props.get("status").and_then(|s| s.as_str()) {
            Some("existing") => Status::Existing,
            _ => Status::Proposed,
        };
        let id = match f.get("id").or_else(|| props.get("id")) {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Number(n)) => n.to_string(),
            _ => format!("f{i}"),
        };
        let name = props.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
        let mut params = props;
        for k in ["kind", "status", "name", "id"] {
            params.remove(k);
        }
        items.push(Item { id, kind, status, name, geom, props: params });
    }
    Ok(Scenario { meta, items })
}

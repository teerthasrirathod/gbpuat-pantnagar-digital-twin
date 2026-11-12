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
            Geom::Line(l) => l.first().copied().unwrap_or([0.0, 0.0]),
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
    let (lon, lat) = (a.first()?.as_f64()?, a.get(1)?.as_f64()?);
    if !lon.is_finite() || !lat.is_finite() || !(-180.0..=180.0).contains(&lon) || !(-90.0..=90.0).contains(&lat) {
        return None;
    }
    Some(f.proj(lon, lat))
}

/// Every position must be a valid [lon, lat]; one bad position rejects the whole line, so a
/// shape is never silently changed into a different one.
fn line_of(v: &Value, f: &Frame) -> Result<Vec<P>, String> {
    let a = v.as_array().ok_or("coordinates must be an array of [longitude, latitude] positions")?;
    a.iter()
        .enumerate()
        .map(|(j, p)| lonlat(p, f).ok_or_else(|| format!("position {} is not a valid [longitude, latitude] pair", j + 1)))
        .collect()
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
        let label = match f.get("id").or_else(|| props.get("id")) {
            Some(Value::String(s)) => format!("feature {} (\"{s}\", {kind})", i + 1),
            _ => format!("feature {} ({kind})", i + 1),
        };
        let geom = match g.get("type").and_then(|t| t.as_str()) {
            Some("Point") => match lonlat(coords, frame) {
                Some(p) => Geom::Point(p),
                None => return Err(format!("{label}: the point needs coordinates [longitude, latitude]")),
            },
            Some("LineString") => {
                let l = line_of(coords, frame).map_err(|e| format!("{label}: line {e}"))?;
                if l.len() < 2 {
                    return Err(format!("{label}: a line needs at least 2 positions, found {}", l.len()));
                }
                Geom::Line(l)
            }
            Some("Polygon") => {
                let ring = coords.as_array().and_then(|a| a.first()).ok_or_else(|| format!("{label}: a polygon needs an outer ring"))?;
                let mut r = line_of(ring, frame).map_err(|e| format!("{label}: polygon ring {e}"))?;
                if r.len() > 1 && r[0] == r[r.len() - 1] {
                    r.pop();
                }
                if r.len() < 3 {
                    return Err(format!("{label}: a polygon needs at least 3 distinct corners, found {}", r.len()));
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

#[cfg(test)]
mod tests {
    use super::*;

    fn frame() -> Frame {
        Frame::new(29.0205, 79.4935)
    }
    fn err(text: &str) -> String {
        match parse(text, &frame()) {
            Ok(_) => panic!("should be rejected: {text}"),
            Err(e) => e,
        }
    }
    fn one(kind: &str, geom: &str) -> String {
        format!(r#"{{"type":"FeatureCollection","features":[{{"type":"Feature","id":"a1","geometry":{geom},"properties":{{"kind":"{kind}"}}}}]}}"#)
    }

    #[test]
    fn rejects_empty_and_short_lines() {
        for g in [r#"{"type":"LineString","coordinates":[]}"#, r#"{"type":"LineString","coordinates":[[79.49,29.02]]}"#, r#"{"type":"LineString","coordinates":"x"}"#] {
            let e = err(&one("footpath", g));
            assert!(e.contains("feature 1") && e.contains("footpath"), "{e}");
        }
    }

    #[test]
    fn rejects_bad_positions_instead_of_dropping_them() {
        let e = err(&one("footpath", r#"{"type":"LineString","coordinates":[[79.49,29.02],[null,29.02],[79.5,29.03]]}"#));
        assert!(e.contains("position 2"), "{e}");
        let e = err(&one("bin", r#"{"type":"Point","coordinates":[500,29.02]}"#));
        assert!(e.contains("point"), "{e}");
    }

    #[test]
    fn rejects_degenerate_polygons() {
        for g in [r#"{"type":"Polygon","coordinates":[[]]}"#, r#"{"type":"Polygon","coordinates":[]}"#, r#"{"type":"Polygon","coordinates":[[[79.49,29.02],[79.5,29.02],[79.49,29.02]]]}"#] {
            assert!(parse(&one("garden", g), &frame()).is_err(), "{g}");
        }
    }

    #[test]
    fn accepts_valid_shapes() {
        let sc = parse(&one("footpath", r#"{"type":"LineString","coordinates":[[79.49,29.02],[79.5,29.02]]}"#), &frame()).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(sc.items.len(), 1);
        let sc = parse(&one("garden", r#"{"type":"Polygon","coordinates":[[[79.49,29.02],[79.5,29.02],[79.5,29.03],[79.49,29.02]]]}"#), &frame()).unwrap_or_else(|e| panic!("{e}"));
        assert!(matches!(&sc.items[0].geom, Geom::Poly(r) if r.len() == 3));
    }

    #[test]
    fn every_sample_scenario_still_parses() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../scenarios");
        let mut n = 0;
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            if e.path().extension().is_some_and(|x| x == "geojson") {
                let t = std::fs::read_to_string(e.path()).unwrap();
                parse(&t, &frame()).unwrap_or_else(|err| panic!("{}: {err}", e.path().display()));
                n += 1;
            }
        }
        assert!(n > 0);
    }
}

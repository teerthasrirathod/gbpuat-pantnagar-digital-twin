//! Types shared by the v3 engine modules (traffic, ev, build, hydro, finance, sites).
//! Frozen in docs/v3-architecture.md section 4. Add fields; do not rename or remove.

use serde_json::{json, Map, Value};

/// Where an input value came from. An `Unknown` input blocks the results that need it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provenance {
    Measured,
    Sourced,
    Calculated,
    Assumed,
    Unknown,
}

impl Provenance {
    pub fn as_str(self) -> &'static str {
        match self {
            Provenance::Measured => "measured",
            Provenance::Sourced => "sourced",
            Provenance::Calculated => "calculated",
            Provenance::Assumed => "assumed",
            Provenance::Unknown => "unknown",
        }
    }
    pub fn parse(s: &str) -> Provenance {
        match s {
            "measured" => Provenance::Measured,
            "sourced" => Provenance::Sourced,
            "calculated" => Provenance::Calculated,
            "unknown" => Provenance::Unknown,
            _ => Provenance::Assumed,
        }
    }
}

/// A model input with its unit and provenance. A bare JSON number reads as an assumed value.
#[derive(Clone, Debug)]
pub struct Quantity {
    pub v: Option<f64>,
    pub unit: String,
    pub p: Provenance,
}

impl Quantity {
    pub fn assumed(v: f64, unit: &str) -> Quantity {
        Quantity { v: Some(v), unit: unit.to_string(), p: Provenance::Assumed }
    }
    pub fn unknown(unit: &str) -> Quantity {
        Quantity { v: None, unit: unit.to_string(), p: Provenance::Unknown }
    }
    /// Reads `{v, unit, p}` or a bare number. Anything else, or `v: null`, is unknown.
    pub fn from_json(x: Option<&Value>, default: Quantity) -> Quantity {
        match x {
            None | Some(Value::Null) => default,
            Some(Value::Number(n)) => match n.as_f64().filter(|f| f.is_finite()) {
                Some(f) => Quantity { v: Some(f), unit: default.unit, p: Provenance::Assumed },
                None => Quantity::unknown(&default.unit),
            },
            Some(Value::Object(o)) => {
                let v = o.get("v").and_then(|v| v.as_f64()).filter(|f| f.is_finite());
                let p = o.get("p").and_then(|p| p.as_str()).map(Provenance::parse).unwrap_or(Provenance::Assumed);
                let unit = o.get("unit").and_then(|u| u.as_str()).unwrap_or(&default.unit).to_string();
                if v.is_none() || p == Provenance::Unknown {
                    Quantity { v: None, unit, p: Provenance::Unknown }
                } else {
                    Quantity { v, unit, p }
                }
            }
            _ => Quantity::unknown(&default.unit),
        }
    }
    pub fn to_json(&self) -> Value {
        json!({ "v": self.v, "unit": self.unit, "p": self.p.as_str() })
    }
}

/// Collects the provenance of every input a result used, and the unknown ones that block it.
#[derive(Default)]
pub struct Inputs {
    pub used: Map<String, Value>,
    pub blocked: Vec<String>,
}

impl Inputs {
    /// Records the input and returns its value, or `None` (and a blocked path) when unknown.
    pub fn take(&mut self, path: &str, q: &Quantity) -> Option<f64> {
        self.used.insert(path.to_string(), json!(q.p.as_str()));
        if q.v.is_none() {
            self.blocked.push(path.to_string());
        }
        q.v
    }
}

/// Vehicle classes, in the order used by the traffic frame buffer.
pub const CLASSES: [&str; 7] = ["pedestrian", "bicycle", "two_wheeler", "e_rickshaw", "car", "bus", "service"];

pub fn class_index(name: &str) -> Option<usize> {
    CLASSES.iter().position(|c| *c == name)
}

/// What the EV model needs from a traffic run: how many vehicles of a class crossed an edge
/// in a day, and how fast. Produced by `traffic::simulate`.
#[derive(Clone, Debug)]
pub struct EdgeLoad {
    pub edge: u32,
    pub class: u8,
    pub passes_day: f64,
    pub mean_speed_ms: f64,
}

/// Trips that end at a place, by class, per day: demand for static charging near that place.
#[derive(Clone, Debug)]
pub struct Arrivals {
    pub p: [f64; 2],
    pub class: u8,
    pub per_day: f64,
    pub mean_dwell_min: f64,
}

/// Result of a traffic run, kept by the WASM bridge and the CLI for the calls that follow it.
#[derive(Clone, Debug, Default)]
pub struct TrafficRun {
    pub summary: Value,
    pub loads: Vec<EdgeLoad>,
    pub arrivals: Vec<Arrivals>,
    /// Frame buffer in the layout of docs/v3-architecture.md section 4.3.
    pub frames: Vec<f32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bare_number_is_assumed_and_null_is_unknown() {
        let q = Quantity::from_json(Some(&json!(7.5)), Quantity::unknown("INR/kWh"));
        assert_eq!((q.v, q.p), (Some(7.5), Provenance::Assumed));
        let q = Quantity::from_json(Some(&json!({ "v": null, "p": "measured" })), Quantity::assumed(1.0, "kVA"));
        assert_eq!((q.v, q.p), (None, Provenance::Unknown));
        let q = Quantity::from_json(None, Quantity::assumed(2.0, "x"));
        assert_eq!(q.v, Some(2.0));
    }

    #[test]
    fn unknown_inputs_are_reported_as_blocking() {
        let mut i = Inputs::default();
        assert_eq!(i.take("ev.tariff_buy", &Quantity::assumed(7.5, "INR/kWh")), Some(7.5));
        assert_eq!(i.take("ev.grid.headroom_kva", &Quantity::unknown("kVA")), None);
        assert_eq!(i.blocked, vec!["ev.grid.headroom_kva"]);
        assert_eq!(i.used["ev.grid.headroom_kva"], "unknown");
    }
}

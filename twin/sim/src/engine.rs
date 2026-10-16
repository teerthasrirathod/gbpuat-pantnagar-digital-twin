//! Applies a scenario to the campus and runs the models. Two variants are built from every
//! scenario: the baseline (the campus plus items marked "existing") and the plan (everything).

use crate::catalog::catalog;
use crate::geo::*;
use crate::graph::{Graph, Snap, NEW_ROAD};
use crate::plan::*;
use crate::world::*;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::f64::consts::PI;

pub const FLOOR_H: f64 = 3.3;
pub const GOOD: f64 = -67.0;
pub const FAIR: f64 = -75.0;
const WIFI_REACH: f64 = 350.0;
const LIGHT_REACH: f64 = 60.0;

pub struct Assume {
    pub rain_mm: f64,
    pub storm_mm: f64,
    pub runoff_roof: f64,
    pub tariff: f64,
    pub solar_yield: f64,
    pub grid_co2: f64,
    pub tree_co2: f64,
    pub light_hours: f64,
    pub walk_speed: f64,
}

#[derive(Clone)]
pub struct Ap {
    pub p: P,
    pub h: f64,
    pub ptx: f64,
    pub ghz: f64,
    pub floor: f64,
    pub item: usize,
    /// Building the access point is in (None outdoors).
    pub bld: Option<usize>,
}

impl Ap {
    /// Farthest distance at which this access point could still give a usable signal inside
    /// building `target`, counting only the walls it must cross at least (none in its own
    /// building, one from outside, two from another building).
    pub fn reach(&self, target: usize) -> f64 {
        let (pl1, wdb, _, _, _) = band(self.ghz);
        let walls = match self.bld {
            Some(b) if b == target => 0.0,
            Some(_) => 2.0,
            None => 1.0,
        };
        10f64.powf((self.ptx + 2.0 - pl1 - walls * wdb - FAIR) / 20.0).min(WIFI_REACH)
    }
}

#[derive(Clone)]
pub struct Light {
    pub p: P,
    pub h: f64,
    pub lm: f64,
    pub watts: f64,
    pub solar: bool,
    pub item: usize,
    /// Unit vector along the road the light faces (None: no road nearby, round footprint).
    pub dir: Option<P>,
}

impl Light {
    fn new(p: P, h: f64, lm: f64, watts: f64, solar: bool, item: usize, dir: Option<P>) -> Light {
        Light { p, h, lm, watts, solar, item, dir }
    }
    /// Footprint half-widths (along, across the road) in metres.
    fn ab(&self) -> (f64, f64) {
        match self.dir {
            Some(_) => (1.6 * self.h, 0.8 * self.h),
            None => (1.15 * self.h, 1.15 * self.h),
        }
    }
}

pub struct Variant {
    pub removed: Vec<bool>,
    pub floors: Vec<u32>,
    pub tcode: Vec<u8>,
    pub new_blds: Vec<Bld>,
    pub new_src: Vec<usize>,
    pub graph: Graph,
    pub aps: Vec<Ap>,
    pub lights: Vec<Light>,
    pub facilities: BTreeMap<String, Vec<P>>,
    pub trees_off: HashSet<u32>,
    pub samples: Vec<RoadSample>,
    pub junctions: HashMap<usize, usize>,
    pub gen_lights: Vec<(P, usize)>,
}

#[derive(Default)]
pub struct Scratch {
    cand: Vec<u32>,
    ts: Vec<f64>,
}

pub struct Ctx {
    pub sc: Scenario,
    pub base: Variant,
    pub plan: Variant,
    pub a: Assume,
    pub cat: Value,
    /// Budget rates: the catalogue's, plus the scenario's own item types and upkeep overrides.
    pub rates: Map<String, Value>,
    /// Walking reach (m) of every item type that counts as an amenity in this scenario.
    pub fac: Map<String, Value>,
    /// Display name of every item type.
    pub labels: HashMap<String, String>,
}

/// Width (m) and lighting class of a new road type.
pub fn road_spec(t: &str) -> (f64, u8) {
    match t {
        "footpath" => (1.8, 3),
        "cycle_track" => (2.5, 3),
        "two_lane" => (7.0, 0),
        _ => (3.75, 1),
    }
}

/// (1 m reference loss, exterior wall dB, dB per metre indoors, first slab dB, further slab dB)
fn band(ghz: f64) -> (f64, f64, f64, f64, f64) {
    if ghz < 3.0 {
        (40.0, 10.0, 0.45, 15.0, 4.0)
    } else {
        (47.3, 14.0, 0.70, 16.0, 5.0)
    }
}

fn slab_loss(ghz: f64, slabs: u32) -> f64 {
    if slabs == 0 {
        return 0.0;
    }
    let (_, _, _, f1, fx) = band(ghz);
    (f1 + fx * (slabs - 1) as f64).min(40.0)
}

pub fn rssi(ap: &Ap, d2: f64, rx_h: f64, walls: u32, inside: f64, slabs: u32) -> f64 {
    let (pl1, wdb, alpha, _, _) = band(ap.ghz);
    let d3 = d2.hypot(ap.h - rx_h).max(1.0);
    let obstr = (walls as f64 * wdb + inside * alpha).min(70.0);
    ap.ptx + 2.0 - (pl1 + 20.0 * d3.log10() + obstr + slab_loss(ap.ghz, slabs))
}

/// Street-light optics throw light along the road, so each light lights an elongated patch:
/// a Gaussian footprint 1.6 h along and 0.8 h across the road carrying 60% of the lamp's
/// output (maintenance 0.8 x light output ratio 0.75). A 9,000 lm light at 8 m spaced 30 m
/// apart gives about 15 lux on average, in line with usual LED street-light design.
fn lux_from(l: &Light, p: P) -> f64 {
    let (dx, dz) = (p[0] - l.p[0], p[1] - l.p[1]);
    if dx.abs() > LIGHT_REACH || dz.abs() > LIGHT_REACH {
        return 0.0;
    }
    let (a, b) = l.ab();
    let (u, v) = match l.dir {
        Some(d) => (dx * d[0] + dz * d[1], -dx * d[1] + dz * d[0]),
        None => (dx, dz),
    };
    let q = (u / a) * (u / a) + (v / b) * (v / b);
    if q > 9.0 {
        return 0.0;
    }
    0.6 * l.lm / (PI * a * b) * (-q).exp()
}

/// Inside the useful part of a light's footprint (two half-widths)?
fn in_footprint(l: &Light, p: P) -> bool {
    let (dx, dz) = (p[0] - l.p[0], p[1] - l.p[1]);
    let (a, b) = l.ab();
    let (u, v) = match l.dir {
        Some(d) => (dx * d[0] + dz * d[1], -dx * d[1] + dz * d[0]),
        None => (dx, dz),
    };
    (u / (2.0 * a)).powi(2) + (v / (2.0 * b)).powi(2) <= 1.0
}

fn bb_dist(p: P, bb: &[f64; 4]) -> f64 {
    let dx = (bb[0] - p[0]).max(0.0).max(p[0] - bb[2]);
    let dz = (bb[1] - p[1]).max(0.0).max(p[1] - bb[3]);
    dx.hypot(dz)
}

fn samples_in(ring: &[P], bb: &[f64; 4], area: f64, s: Option<f64>) -> (Vec<P>, f64) {
    let s = s.unwrap_or((area.sqrt() / 10.0).clamp(2.0, 5.0));
    let mut out = Vec::new();
    let mut z = bb[1] + s / 2.0;
    while z < bb[3] {
        let mut x = bb[0] + s / 2.0;
        while x < bb[2] {
            if pip(x, z, ring) {
                out.push([x, z]);
            }
            x += s;
        }
        z += s;
    }
    if out.is_empty() {
        out.push(centroid(ring));
    }
    (out, s)
}

impl Variant {
    pub fn nb(&self, w: &World) -> usize {
        w.blds.len() + self.new_blds.len()
    }
    pub fn bld<'a>(&'a self, w: &'a World, i: usize) -> &'a Bld {
        if i < w.blds.len() {
            &w.blds[i]
        } else {
            &self.new_blds[i - w.blds.len()]
        }
    }
    pub fn alive(&self, w: &World, i: usize) -> bool {
        i >= w.blds.len() || !self.removed[i]
    }
    pub fn building_at(&self, w: &World, p: P) -> Option<usize> {
        for (k, b) in self.new_blds.iter().enumerate() {
            if p[0] >= b.bb[0] && p[0] <= b.bb[2] && p[1] >= b.bb[1] && p[1] <= b.bb[3] && pip(p[0], p[1], &b.ring) {
                return Some(w.blds.len() + k);
            }
        }
        world_building_at(w, &self.removed, p)
    }
    /// Exterior walls crossed and metres spent inside buildings along a-b.
    pub fn walls(&self, w: &World, a: P, b: P, sc: &mut Scratch) -> (u32, f64) {
        let Scratch { cand, ts } = sc;
        cand.clear();
        w.bgrid.query_seg(a, b, |k| cand.push(k));
        cand.sort_unstable();
        cand.dedup();
        let sb = [a[0].min(b[0]), a[1].min(b[1]), a[0].max(b[0]), a[1].max(b[1])];
        let l = dist(a, b);
        let mut walls = 0u32;
        let mut inside = 0.0;
        let mut each = |bl: &Bld| {
            if !bb_overlap(&bl.bb, &sb) {
                return;
            }
            ts.clear();
            let n = bl.ring.len();
            for i in 0..n {
                if let Some((t, _)) = seg_x(a, b, bl.ring[i], bl.ring[(i + 1) % n]) {
                    ts.push(t);
                }
            }
            let ina = a[0] >= bl.bb[0] && a[0] <= bl.bb[2] && a[1] >= bl.bb[1] && a[1] <= bl.bb[3] && pip(a[0], a[1], &bl.ring);
            if ts.is_empty() {
                if ina {
                    inside += l;
                }
                return;
            }
            ts.sort_by(|x, y| x.total_cmp(y));
            walls += ts.len() as u32;
            let mut state = ina;
            let mut prev = 0.0;
            for &t in ts.iter() {
                if state {
                    inside += (t - prev) * l;
                }
                state = !state;
                prev = t;
            }
            if state {
                inside += (1.0 - prev) * l;
            }
        };
        for &k in cand.iter() {
            if !self.removed[k as usize] {
                each(&w.blds[k as usize]);
            }
        }
        for b in &self.new_blds {
            each(b);
        }
        (walls, inside)
    }

    /// Best signal per (sample, floor) inside building bi from this variant's access points.
    fn wifi_best(&self, w: &World, bi: usize, pts: &[P], sc: &mut Scratch) -> Vec<f64> {
        let b = self.bld(w, bi);
        let floors = self.floors[bi].max(1) as usize;
        let mut best = vec![-200.0; pts.len() * floors];
        for ap in self.aps.iter() {
            let reach = ap.reach(bi);
            if bb_dist(ap.p, &b.bb) > reach {
                continue;
            }
            for (si, p) in pts.iter().enumerate() {
                let d2 = dist(ap.p, *p);
                if d2 > reach {
                    continue;
                }
                let (wl, ins) = self.walls(w, ap.p, *p, sc);
                for f in 0..floors {
                    let slabs = (f as f64 - ap.floor).abs().round() as u32;
                    let r = rssi(ap, d2, f as f64 * FLOOR_H + 1.2, wl, ins, slabs);
                    let c = &mut best[si * floors + f];
                    if r > *c {
                        *c = r;
                    }
                }
            }
        }
        best
    }

    pub fn coverage(&self, w: &World, bi: usize, sc: &mut Scratch) -> (f64, f64) {
        let b = self.bld(w, bi);
        if !self.aps.iter().any(|ap| bb_dist(ap.p, &b.bb) <= ap.reach(bi)) {
            return (0.0, 0.0);
        }
        let (pts, _) = samples_in(&b.ring, &b.bb, b.area, None);
        let best = self.wifi_best(w, bi, &pts, sc);
        let n = best.len().max(1) as f64;
        (best.iter().filter(|&&r| r >= GOOD).count() as f64 / n, best.iter().filter(|&&r| r >= FAIR).count() as f64 / n)
    }

    /// The same building in another variant (world index, or the same scenario item).
    fn same_in(&self, other: &Variant, w: &World, i: usize) -> Option<usize> {
        let nw = w.blds.len();
        if i < nw {
            return if other.removed[i] { None } else { Some(i) };
        }
        let item = self.new_src[i - nw];
        other.new_src.iter().position(|&s| s == item).map(|k| nw + k)
    }
}

pub fn world_building_at(w: &World, removed: &[bool], p: P) -> Option<usize> {
    let mut hit = None;
    w.bgrid.query_bb([p[0], p[1], p[0], p[1]], |k| {
        let b = &w.blds[k as usize];
        if hit.is_none() && !removed[k as usize] && p[0] >= b.bb[0] && p[0] <= b.bb[2] && p[1] >= b.bb[1] && p[1] <= b.bb[3] && pip(p[0], p[1], &b.ring) {
            hit = Some(k as usize);
        }
    });
    hit
}

fn build_variant(w: &World, sc: &Scenario, facilities: &Map<String, Value>, include: impl Fn(&Item) -> bool) -> Variant {
    let nw = w.blds.len();
    let mut v = Variant {
        removed: vec![false; nw],
        floors: w.blds.iter().map(|b| b.floors).collect(),
        tcode: w.blds.iter().map(|b| b.t).collect(),
        new_blds: Vec::new(),
        new_src: Vec::new(),
        graph: w.graph.clone(),
        aps: Vec::new(),
        lights: Vec::new(),
        facilities: BTreeMap::new(),
        trees_off: HashSet::new(),
        samples: Vec::new(),
        junctions: HashMap::new(),
        gen_lights: Vec::new(),
    };
    // Pass 1: buildings.
    for (idx, it) in sc.items.iter().enumerate() {
        if !include(it) {
            continue;
        }
        match it.kind.as_str() {
            "building" => {
                if let Some(r) = it.poly() {
                    let ring = r.to_vec();
                    let bb = bbox(&ring);
                    let c = centroid(&ring);
                    let t = w.type_code(&it.text("type", "academic")).unwrap_or(0);
                    let floors = it.num("floors", 3.0).round().max(1.0) as u32;
                    v.new_blds.push(Bld { key: format!("item:{}", it.id), area: ring_area(&ring), campus: w.in_campus(c), ring, bb, floors, t, name: it.name.clone(), c });
                    v.floors.push(floors);
                    v.tcode.push(t);
                    v.new_src.push(idx);
                }
            }
            "demolish" => {
                if let Some(b) = world_building_at(w, &v.removed, it.point()) {
                    v.removed[b] = true;
                }
            }
            "building_edit" => {
                if let Some(b) = world_building_at(w, &v.removed, it.point()) {
                    let f = it.num("floors", 0.0);
                    if f >= 1.0 {
                        v.floors[b] = f.round() as u32;
                    }
                    if let Some(c) = w.type_code(&it.text("type", "")) {
                        v.tcode[b] = c;
                    }
                }
            }
            _ => {}
        }
    }
    // Pass 2: roads (lights need to know which road they face), then points.
    for (idx, it) in sc.items.iter().enumerate() {
        if !include(it) || it.kind != "road" {
            continue;
        }
        match it.kind.as_str() {
            "road" => {
                if let Some(l) = it.line() {
                    let (wd, class) = road_spec(&it.text("type", "lane"));
                    let (j, _) = v.graph.insert_line(l, NEW_ROAD + idx as u32, 12.0);
                    v.junctions.insert(idx, j);
                    for (q, _) in sample_line(l, 2.0) {
                        v.samples.push(RoadSample { p: q, target: lux_target(class) });
                    }
                    let spacing = it.num("lights", 0.0);
                    if spacing >= 10.0 {
                        let mut side = 1.0;
                        let pts = sample_line(l, spacing);
                        for (k, (q, _)) in pts.iter().enumerate() {
                            // direction from neighbouring samples
                            let a = pts[k.saturating_sub(1)].0;
                            let b = pts[(k + 1).min(pts.len() - 1)].0;
                            let (dx, dz) = (b[0] - a[0], b[1] - a[1]);
                            let len = dx.hypot(dz).max(1e-9);
                            let off = wd / 2.0 + 1.0;
                            let lp = [q[0] - dz / len * off * side, q[1] + dx / len * off * side];
                            v.lights.push(Light::new(lp, 8.0, 9000.0, 70.0, false, idx, Some([dx / len, dz / len])));
                            v.gen_lights.push((lp, idx));
                            side = -side;
                        }
                    }
                }
            }
            _ => {}
        }
    }
    for (idx, it) in sc.items.iter().enumerate() {
        if !include(it) {
            continue;
        }
        let p = it.point();
        match it.kind.as_str() {
            "wifi_ap" => {
                let ghz = if it.text("band", "5").starts_with('2') { 2.4 } else { 5.0 };
                let ptx = it.num("power", 20.0);
                let (h, floor) = match v.building_at(w, p) {
                    Some(b) => {
                        let fl = it.num("floor", 0.0).round().clamp(0.0, (v.floors[b].max(1) - 1) as f64);
                        (fl * FLOOR_H + 2.7, fl)
                    }
                    None => {
                        let h = it.num("pole", 6.0);
                        (h, ((h - 1.2) / FLOOR_H).round().max(0.0))
                    }
                };
                let bld = v.building_at(w, p);
                v.aps.push(Ap { p, h, ptx, ghz, floor, item: idx, bld });
            }
            "street_light" => {
                let dir = v.graph.nearest_edge(p, 30.0, None).map(|s| {
                    let e = &v.graph.edges[s.k as usize];
                    let (a, b) = (v.graph.nodes[e.a as usize], v.graph.nodes[e.b as usize]);
                    let l = dist(a, b).max(1e-9);
                    [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
                });
                v.lights.push(Light::new(p, it.num("height", 8.0), it.num("lumens", 9000.0), it.num("watts", 70.0), it.text("supply", "grid") == "solar", idx, dir));
            }
            "tree_remove" => {
                if let Some(t) = w.tree_near(p, 4.0) {
                    v.trees_off.insert(t);
                }
            }
            k if facilities.contains_key(k) => v.facilities.entry(k.to_string()).or_default().push(p),
            _ => {}
        }
    }
    v
}

impl Assume {
    fn from(sc: &Scenario, cat: &Value) -> Assume {
        let g = |k: &str| sc.meta_num(&["assumptions", k], cat["assumptions"][k]["value"].as_f64().unwrap_or(0.0));
        Assume {
            rain_mm: g("rain_mm"),
            storm_mm: g("storm_mm"),
            runoff_roof: g("runoff_roof"),
            tariff: g("tariff"),
            solar_yield: g("solar_yield"),
            grid_co2: g("grid_co2"),
            tree_co2: g("tree_co2"),
            light_hours: g("light_hours"),
            walk_speed: g("walk_speed"),
        }
    }
}

pub fn prepare(w: &World, sc: Scenario) -> Ctx {
    let cat = catalog();
    let mut rates = cat["rates"].as_object().cloned().unwrap_or_default();
    let mut fac = cat["facilities"].as_object().cloned().unwrap_or_default();
    let mut labels: HashMap<String, String> = cat["kinds"].as_array().into_iter().flatten().filter_map(|k| Some((k["key"].as_str()?.to_string(), k["label"].as_str()?.to_string()))).collect();
    // Item types the user created travel inside the scenario file.
    for k in sc.meta.get("custom_kinds").and_then(|v| v.as_array()).into_iter().flatten() {
        let Some(key) = k["key"].as_str().filter(|s| !s.is_empty()) else { continue };
        let label = k["label"].as_str().unwrap_or(key).to_string();
        let unit = match k["geom"].as_str() {
            Some("line") => "m",
            Some("polygon") => "m²",
            _ => "each",
        };
        let num = |f: &str| k[f].as_f64().or_else(|| k[f].as_str().and_then(|s| s.parse().ok())).unwrap_or(0.0);
        rates.insert(key.to_string(), json!({ "label": label, "unit": unit, "rate": num("rate"), "maint": num("maint"), "kwh": num("kwh") }));
        if num("reach") > 0.0 {
            fac.insert(key.to_string(), json!(num("reach")));
        }
        labels.insert(key.to_string(), label);
    }
    // Upkeep (% a year) and walking reach overrides for any item type.
    for (k, v) in sc.meta.get("maint").and_then(|v| v.as_object()).into_iter().flatten() {
        if let (Some(r), Some(x)) = (rates.get_mut(k), v.as_f64()) {
            r["maint"] = json!(x);
        }
    }
    for (k, v) in sc.meta.get("reach").and_then(|v| v.as_object()).into_iter().flatten() {
        match v.as_f64() {
            Some(x) if x > 0.0 => {
                fac.insert(k.clone(), json!(x));
            }
            _ => {
                fac.remove(k);
            }
        }
    }
    let base = build_variant(w, &sc, &fac, |it| it.status == Status::Existing);
    let plan = build_variant(w, &sc, &fac, |_| true);
    let a = Assume::from(&sc, &cat);
    Ctx { sc, base, plan, a, cat, rates, fac, labels }
}

fn plural(n: usize, what: &str) -> String {
    if n == 1 {
        format!("1 {what}")
    } else {
        format!("{n} {what}s")
    }
}

fn r1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}
fn r3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

// ------------------------------------------------------------------------------------------
// Wi-Fi

fn wifi_targets(w: &World, ctx: &Ctx) -> (Vec<String>, Vec<usize>) {
    let types: Vec<String> = ctx.sc.meta.get("wifi_targets").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect()).unwrap_or_else(|| vec!["hostel".into()]);
    let picks: Vec<P> = ctx
        .sc
        .meta
        .get("wifi_buildings")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|p| Some(w.frame.proj(p.get(0)?.as_f64()?, p.get(1)?.as_f64()?))).collect())
        .unwrap_or_default();
    let v = &ctx.plan;
    let codes: Vec<u8> = types.iter().filter_map(|t| w.type_code(t)).collect();
    let mut set: Vec<usize> = Vec::new();
    for i in 0..v.nb(w) {
        if !v.alive(w, i) {
            continue;
        }
        let b = v.bld(w, i);
        if (b.campus || i >= w.blds.len()) && codes.contains(&v.tcode[i]) {
            set.push(i);
        }
    }
    for p in picks {
        if let Some(i) = v.building_at(w, p) {
            if !set.contains(&i) {
                set.push(i);
            }
        }
    }
    (types, set)
}

pub fn wifi_eval(w: &World, ctx: &Ctx, sc: &mut Scratch) -> Value {
    let (types, targets) = wifi_targets(w, ctx);
    let mut rows = Vec::new();
    let (mut tot, mut bg, mut bf, mut pg, mut pf) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for &i in &targets {
        let b = ctx.plan.bld(w, i);
        let gfa = b.area * ctx.plan.floors[i] as f64;
        let (g, f) = ctx.plan.coverage(w, i, sc);
        let (g0, f0) = match ctx.plan.same_in(&ctx.base, w, i) {
            Some(j) => ctx.base.coverage(w, j, sc),
            None => (0.0, 0.0),
        };
        tot += gfa;
        pg += g * gfa;
        pf += f * gfa;
        bg += g0 * gfa;
        bf += f0 * gfa;
        rows.push(json!({
            "name": if b.name.is_empty() { format!("{} building", w.type_name(ctx.plan.tcode[i])) } else { b.name.clone() },
            "type": w.type_name(ctx.plan.tcode[i]), "floors": ctx.plan.floors[i], "gfa": b.area.round() * ctx.plan.floors[i] as f64,
            "c": [r1(b.c[0]), r1(b.c[1])], "new": i >= w.blds.len(),
            "base": { "good": r3(g0), "fair": r3(f0) }, "plan": { "good": r3(g), "fair": r3(f) }
        }));
    }
    let t = tot.max(1.0);
    json!({
        "types": types, "targets": rows, "gfa": tot.round(),
        "base": { "good": r3(bg / t), "fair": r3(bf / t), "aps": ctx.base.aps.len() },
        "plan": { "good": r3(pg / t), "fair": r3(pf / t), "aps": ctx.plan.aps.len() }
    })
}

/// Signal heatmap (dBm, -200 = no data) on a display window, for one floor. Rays are marched out
/// from every access point over a building raster, so walls and indoor distance accumulate.
pub fn wifi_grid(w: &World, v: &Variant, x0: f64, z0: f64, cell: f64, nx: usize, nz: usize, floor: f64) -> Vec<f32> {
    let reach = 500.0;
    let pad = (reach / cell).ceil() as usize;
    let (pnx, pnz) = (nx + 2 * pad, nz + 2 * pad);
    let (px0, pz0) = (x0 - pad as f64 * cell, z0 - pad as f64 * cell);
    let mut rast = vec![-1i32; pnx * pnz];
    let wb = [px0, pz0, px0 + pnx as f64 * cell, pz0 + pnz as f64 * cell];
    let mut fill = |bi: usize, b: &Bld| {
        if !bb_overlap(&b.bb, &wb) {
            return;
        }
        let j0 = (((b.bb[1] - pz0) / cell - 0.5).ceil().max(0.0)) as usize;
        let j1 = (((b.bb[3] - pz0) / cell - 0.5).floor().min(pnz as f64 - 1.0)) as i64;
        let n = b.ring.len();
        let mut xs: Vec<f64> = Vec::new();
        for j in j0 as i64..=j1 {
            let zc = pz0 + (j as f64 + 0.5) * cell;
            xs.clear();
            for k in 0..n {
                let (p, q) = (b.ring[k], b.ring[(k + 1) % n]);
                if (p[1] > zc) != (q[1] > zc) {
                    xs.push(p[0] + (zc - p[1]) / (q[1] - p[1]) * (q[0] - p[0]));
                }
            }
            xs.sort_by(|a, b| a.total_cmp(b));
            for pair in xs.chunks_exact(2) {
                let i0 = ((pair[0] - px0) / cell - 0.5).ceil().max(0.0) as i64;
                let i1 = ((pair[1] - px0) / cell - 0.5).floor().min(pnx as f64 - 1.0) as i64;
                for i in i0..=i1 {
                    rast[j as usize * pnx + i as usize] = bi as i32;
                }
            }
        }
    };
    for (i, b) in w.blds.iter().enumerate() {
        if !v.removed[i] {
            fill(i, b);
        }
    }
    for (k, b) in v.new_blds.iter().enumerate() {
        fill(w.blds.len() + k, b);
    }
    let mut out = vec![-200.0f32; nx * nz];
    let view = [x0, z0, x0 + nx as f64 * cell, z0 + nz as f64 * cell];
    let step = cell * 0.5;
    let nsteps = (reach / step) as usize;
    for ap in &v.aps {
        if bb_dist(ap.p, &view) > reach {
            continue;
        }
        let (pl1, wdb, alpha, _, _) = band(ap.ghz);
        let base_db = ap.ptx + 2.0 - pl1;
        // Rays end where even open air (plus the wall out, for indoor points) drops below -90 dBm.
        let r_ap = 10f64.powf((base_db + 90.0 - if ap.bld.is_some() { wdb } else { 0.0 }) / 20.0).clamp(20.0, reach);
        let nsteps = ((r_ap / step) as usize).min(nsteps);
        let rx_in = floor * FLOOR_H + 1.2;
        let slab = slab_loss(ap.ghz, (floor - ap.floor).abs().round() as u32);
        let dl_in: Vec<f64> = (0..=nsteps).map(|s| 20.0 * ((s as f64 * step).hypot(ap.h - rx_in).max(1.0)).log10()).collect();
        let dl_out: Vec<f64> = (0..=nsteps).map(|s| 20.0 * ((s as f64 * step).hypot(ap.h - 1.2).max(1.0)).log10()).collect();
        let nrays = ((2.0 * PI * r_ap / (cell * 0.7)).ceil() as usize).min(16000);
        let ci = ((ap.p[0] - px0) / cell).floor() as i64;
        let cj = ((ap.p[1] - pz0) / cell).floor() as i64;
        let start = if ci >= 0 && cj >= 0 && (ci as usize) < pnx && (cj as usize) < pnz { rast[cj as usize * pnx + ci as usize] } else { -1 };
        for r in 0..nrays {
            let th = r as f64 / nrays as f64 * 2.0 * PI;
            let (dx, dz) = (th.cos(), th.sin());
            let mut prev = start;
            let mut walls = 0u32;
            let mut inside = 0.0;
            for s in 0..=nsteps {
                let d = s as f64 * step;
                let pi = ((ap.p[0] + dx * d - px0) / cell).floor() as i64;
                let pj = ((ap.p[1] + dz * d - pz0) / cell).floor() as i64;
                if pi < 0 || pj < 0 || pi as usize >= pnx || pj as usize >= pnz {
                    break;
                }
                let bv = rast[pj as usize * pnx + pi as usize];
                if bv != prev {
                    walls += (prev >= 0) as u32 + (bv >= 0) as u32;
                    prev = bv;
                }
                if bv >= 0 {
                    inside += step;
                }
                let obstr = (walls as f64 * wdb + inside * alpha).min(70.0);
                if base_db - dl_out[s] - obstr < -92.0 {
                    break;
                }
                let (di, dj) = (pi - pad as i64, pj - pad as i64);
                if di < 0 || dj < 0 || di as usize >= nx || dj as usize >= nz {
                    continue;
                }
                let val = if bv >= 0 {
                    if (v.floors[bv as usize] as f64) <= floor {
                        continue;
                    }
                    base_db - dl_in[s] - obstr - slab
                } else {
                    if floor > 0.0 {
                        continue;
                    }
                    base_db - dl_out[s] - obstr
                };
                let o = &mut out[dj as usize * nx + di as usize];
                if val as f32 > *o {
                    *o = val as f32;
                }
            }
        }
    }
    let src = out.clone();
    for j in 1..nz.saturating_sub(1) {
        for i in 1..nx.saturating_sub(1) {
            let k = j * nx + i;
            if src[k] > -199.0 {
                continue;
            }
            let (mut sum, mut n) = (0.0f32, 0);
            for (di, dj) in [(-1i64, 0i64), (1, 0), (0, -1), (0, 1)] {
                let v = src[(j as i64 + dj) as usize * nx + (i as i64 + di) as usize];
                if v > -199.0 {
                    sum += v;
                    n += 1;
                }
            }
            if n >= 2 {
                out[k] = sum / n as f32;
            }
        }
    }
    out
}

/// Greedy access-point placement inside buildings until the share of floor area at -67 dBm or
/// better reaches the target. Existing and planned access points count towards coverage.
pub fn suggest_wifi(w: &World, ctx: &Ctx, req: &Value) -> Value {
    let v = &ctx.plan;
    let ghz = if req["band"].as_str().unwrap_or("5").starts_with('2') { 2.4 } else { 5.0 };
    let ptx = req["power"].as_f64().unwrap_or(20.0);
    let target = req["target"].as_f64().unwrap_or(0.95);
    let max_per = req["max"].as_u64().unwrap_or(40) as usize;
    let mut blds: Vec<usize> = Vec::new();
    if let Some(pts) = req["points"].as_array() {
        for p in pts {
            if let (Some(x), Some(z)) = (p[0].as_f64(), p[1].as_f64()) {
                if let Some(i) = v.building_at(w, [x, z]) {
                    if !blds.contains(&i) {
                        blds.push(i);
                    }
                }
            }
        }
    }
    if blds.is_empty() {
        blds = wifi_targets(w, ctx).1;
        // One building per call keeps each call short (the page asks for them in turn).
        if let Some(k) = req["only"].as_u64() {
            blds = blds.get(k as usize).map(|&b| vec![b]).unwrap_or_default();
        }
    }
    let mut sc = Scratch::default();
    let mut out = Vec::new();
    let mut rows = Vec::new();
    for bi in blds {
        let b = v.bld(w, bi);
        let floors = v.floors[bi].max(1) as usize;
        // At most ~150 samples and ~36 candidate spots per floor, whatever the size.
        let s0 = (b.area.sqrt() / 10.0).clamp(2.0, 5.0).max((b.area / 150.0).sqrt());
        let (pts, s) = samples_in(&b.ring, &b.bb, b.area, Some(s0));
        let mut best = v.wifi_best(w, bi, &pts, &mut sc);
        let before = best.iter().filter(|&&r| r >= GOOD).count();
        let total = best.len();
        let (cands, _) = samples_in(&b.ring, &b.bb, b.area, Some((s * 2.0).max(6.0).max((b.area / 36.0).sqrt())));
        // Geometry between every candidate and sample is the same on all floors.
        let mut geo: Vec<(f64, u32, f64)> = Vec::with_capacity(cands.len() * pts.len());
        for c in &cands {
            for p in &pts {
                let (wl, ins) = v.walls(w, *c, *p, &mut sc);
                geo.push((dist(*c, *p), wl, ins));
            }
        }
        let mut added = 0;
        let mut covered = before;
        let np = pts.len();
        while (covered as f64) < target * total as f64 && added < max_per {
            let mut best_gain = 0usize;
            let mut pick = (0usize, 0usize);
            for ci in 0..cands.len() {
                for fa in 0..floors {
                    let ap = Ap { p: cands[ci], h: fa as f64 * FLOOR_H + 2.7, ptx, ghz, floor: fa as f64, item: 0, bld: Some(bi) };
                    let mut gain = 0;
                    for si in 0..np {
                        let (d2, wl, ins) = geo[ci * np + si];
                        for f in 0..floors {
                            if best[si * floors + f] >= GOOD {
                                continue;
                            }
                            if rssi(&ap, d2, f as f64 * FLOOR_H + 1.2, wl, ins, (f as i64 - fa as i64).unsigned_abs() as u32) >= GOOD {
                                gain += 1;
                            }
                        }
                    }
                    if gain > best_gain {
                        best_gain = gain;
                        pick = (ci, fa);
                    }
                }
            }
            if best_gain == 0 {
                break;
            }
            let (ci, fa) = pick;
            let ap = Ap { p: cands[ci], h: fa as f64 * FLOOR_H + 2.7, ptx, ghz, floor: fa as f64, item: 0, bld: Some(bi) };
            for si in 0..np {
                let (d2, wl, ins) = geo[ci * np + si];
                for f in 0..floors {
                    let r = rssi(&ap, d2, f as f64 * FLOOR_H + 1.2, wl, ins, (f as i64 - fa as i64).unsigned_abs() as u32);
                    let c = &mut best[si * floors + f];
                    if r > *c {
                        *c = r;
                    }
                }
            }
            covered = best.iter().filter(|&&r| r >= GOOD).count();
            added += 1;
            out.push(json!({ "x": r1(ap.p[0]), "z": r1(ap.p[1]), "floor": fa, "building": b.name }));
        }
        rows.push(json!({ "name": b.name, "floors": floors, "before": r3(before as f64 / total.max(1) as f64), "after": r3(covered as f64 / total.max(1) as f64), "added": added }));
    }
    json!({ "aps": out, "buildings": rows })
}

// ------------------------------------------------------------------------------------------
// Lighting

fn light_grid_of(w: &World, lights: &[Light]) -> Grid {
    let mut g = Grid::new(w.bounds, 40.0);
    for (i, l) in lights.iter().enumerate() {
        g.insert_bb([l.p[0] - LIGHT_REACH, l.p[1] - LIGHT_REACH, l.p[0] + LIGHT_REACH, l.p[1] + LIGHT_REACH], i as u32);
    }
    g
}

fn lux_at(lights: &[Light], g: &Grid, p: P) -> f64 {
    let mut e = 0.0;
    g.query_bb([p[0], p[1], p[0], p[1]], |k| e += lux_from(&lights[k as usize], p));
    e
}

pub fn lux_grid(w: &World, v: &Variant, x0: f64, z0: f64, cell: f64, nx: usize, nz: usize) -> Vec<f32> {
    let mut out = vec![0.0f32; nx * nz];
    for l in &v.lights {
        let i0 = (((l.p[0] - LIGHT_REACH - x0) / cell).floor().max(0.0)) as usize;
        let i1 = (((l.p[0] + LIGHT_REACH - x0) / cell).ceil().max(0.0) as usize).min(nx);
        let j0 = (((l.p[1] - LIGHT_REACH - z0) / cell).floor().max(0.0)) as usize;
        let j1 = (((l.p[1] + LIGHT_REACH - z0) / cell).ceil().max(0.0) as usize).min(nz);
        for j in j0..j1 {
            for i in i0..i1 {
                let p = [x0 + (i as f64 + 0.5) * cell, z0 + (j as f64 + 0.5) * cell];
                out[j * nx + i] += lux_from(l, p) as f32;
            }
        }
    }
    let _ = w;
    out
}

pub fn light_eval(w: &World, ctx: &Ctx) -> Value {
    let (base, plan, a) = (&ctx.base, &ctx.plan, &ctx.a);
    // Study set: road samples within 40 m of any light in the plan.
    let mut study: Vec<RoadSample> = Vec::new();
    let mut seen = HashSet::new();
    for l in &plan.lights {
        w.sgrid.query_bb([l.p[0] - 40.0, l.p[1] - 40.0, l.p[0] + 40.0, l.p[1] + 40.0], |k| {
            if in_footprint(l, w.samples[k as usize].p) && seen.insert(k) {
                study.push(w.samples[k as usize]);
            }
        });
    }
    for s in &plan.samples {
        if plan.lights.iter().any(|l| in_footprint(l, s.p)) {
            study.push(*s);
        }
    }
    let stats = |v: &Variant| -> (Value, Vec<f64>) {
        let g = light_grid_of(w, &v.lights);
        let e: Vec<f64> = study.iter().map(|s| lux_at(&v.lights, &g, s.p)).collect();
        let n = e.len().max(1) as f64;
        let avg = e.iter().sum::<f64>() / n;
        let min = e.iter().cloned().fold(f64::INFINITY, f64::min);
        let ok = study.iter().zip(&e).filter(|(s, &x)| x >= s.target as f64).count();
        (json!({ "ok_m": ok * 2, "avg": r1(avg), "min": if e.is_empty() { 0.0 } else { r1(min) }, "u0": if avg > 0.0 { r3(min / avg) } else { 0.0 }, "lights": v.lights.len() }), e)
    };
    let (sb, _) = stats(base);
    let (sp, ep) = stats(plan);
    let mut dark: Vec<P> = Vec::new();
    for (s, &e) in study.iter().zip(&ep) {
        if e < s.target as f64 * 0.25 && dark.iter().all(|d| dist(*d, s.p) > 25.0) && dark.len() < 80 {
            dark.push(s.p);
        }
    }
    let kwh: f64 = plan.lights.iter().filter(|l| !l.solar && !base.lights.iter().any(|b| b.item == l.item && dist(b.p, l.p) < 0.1)).map(|l| l.watts * a.light_hours * 365.0 / 1000.0).sum();
    json!({
        "study_m": study.len() * 2, "base": sb, "plan": sp, "kwh": kwh.round(),
        "dark": dark.iter().map(|p| json!([r1(p[0]), r1(p[1])])).collect::<Vec<_>>()
    })
}

// ------------------------------------------------------------------------------------------
// Walking access

fn people_of(w: &World, v: &Variant, i: usize, pm2: &Map<String, Value>) -> f64 {
    let b = v.bld(w, i);
    match pm2.get(w.type_name(v.tcode[i])).and_then(|x| x.as_f64()) {
        Some(m2) if m2 > 0.0 => b.area * v.floors[i] as f64 / m2,
        _ => 0.0,
    }
}

pub fn access_eval(w: &World, ctx: &Ctx) -> Value {
    let pm2 = ctx.cat["people_m2"].as_object().cloned().unwrap_or_default();
    let fac = &ctx.fac;
    let labels = &ctx.labels;
    let mut kinds: Vec<String> = ctx.plan.facilities.keys().chain(ctx.base.facilities.keys()).cloned().collect();
    kinds.sort();
    kinds.dedup();
    let mut out = Vec::new();
    let origins = |v: &Variant| -> Vec<(Snap, f64)> {
        (0..v.nb(w))
            .filter(|&i| v.alive(w, i) && (v.bld(w, i).campus || i >= w.blds.len()))
            .filter_map(|i| {
                let pp = people_of(w, v, i, &pm2);
                if pp <= 0.0 {
                    return None;
                }
                v.graph.nearest_edge(v.bld(w, i).c, 250.0, None).map(|s| (s, pp))
            })
            .collect()
    };
    if kinds.is_empty() {
        return Value::Array(out);
    }
    let ob = origins(&ctx.base);
    let op = origins(&ctx.plan);
    for k in kinds {
        let radius = fac.get(&k).and_then(|x| x.as_f64()).unwrap_or(300.0);
        let run = |v: &Variant, orig: &[(Snap, f64)]| -> Value {
            let pts = v.facilities.get(&k).cloned().unwrap_or_default();
            let mut src = Vec::new();
            let mut on_edge: HashMap<u32, Vec<(f64, f64)>> = HashMap::new();
            for p in &pts {
                if let Some(s) = v.graph.nearest_edge(*p, 150.0, None) {
                    src.extend(v.graph.snap_sources(&s));
                    on_edge.entry(s.k).or_default().push((s.t, s.d));
                }
            }
            let total: f64 = orig.iter().map(|o| o.1).sum();
            if src.is_empty() {
                return json!({ "count": pts.len(), "pct": 0.0, "avg_m": null, "people": total.round() });
            }
            let (d, _) = v.graph.dijkstra(&src, 4000.0);
            let (mut served, mut sum_d, mut wsum) = (0.0, 0.0, 0.0);
            for (s, pp) in orig {
                let mut x = v.graph.dist_at(&d, s);
                if let Some(list) = on_edge.get(&s.k) {
                    let len = v.graph.edges[s.k as usize].len;
                    for (t, fd) in list {
                        x = x.min((t - s.t).abs() * len + fd + s.d);
                    }
                }
                if x <= radius {
                    served += pp;
                }
                if x.is_finite() {
                    sum_d += x.min(3000.0) * pp;
                    wsum += pp;
                }
            }
            json!({ "count": pts.len(), "pct": r3(served / total.max(1.0)), "avg_m": if wsum > 0.0 { Some((sum_d / wsum).round()) } else { None }, "people": total.round() })
        };
        out.push(json!({ "kind": k, "label": labels.get(&k).cloned().unwrap_or(k.clone()), "radius": radius, "base": run(&ctx.base, &ob), "plan": run(&ctx.plan, &op) }));
    }
    Value::Array(out)
}

/// Shortest walking route between two points on the baseline (which = 0) or plan network.
pub fn route(_w: &World, ctx: &Ctx, which: u32, a: P, b: P) -> Value {
    let v = if which == 0 { &ctx.base } else { &ctx.plan };
    let g = &v.graph;
    let (Some(sa), Some(sb)) = (g.nearest_edge(a, 400.0, None), g.nearest_edge(b, 400.0, None)) else {
        return json!({ "ok": false, "msg": "No road or path within 400 m of one of the points" });
    };
    let pa = g.point_on(&sa);
    let pb = g.point_on(&sb);
    let mut path: Vec<P> = vec![a, pa];
    let total;
    let (d, pred) = g.dijkstra(&g.snap_sources(&sa), f64::INFINITY);
    let e = &g.edges[sb.k as usize];
    let da = d[e.a as usize] + sb.t * e.len;
    let db = d[e.b as usize] + (1.0 - sb.t) * e.len;
    let direct = if sa.k == sb.k { Some((sa.t - sb.t).abs() * e.len + sa.d) } else { None };
    if let Some(dd) = direct.filter(|&dd| dd <= da.min(db)) {
        total = dd + sb.d;
    } else {
        if !da.is_finite() && !db.is_finite() {
            return json!({ "ok": false, "msg": "These points are not connected by the network" });
        }
        let mut n = if da <= db { e.a } else { e.b };
        total = da.min(db) + sb.d;
        let mut back = vec![g.nodes[n as usize]];
        let mut guard = 0;
        while pred[n as usize] >= 0 && guard < 100000 {
            n = g.other(pred[n as usize] as u32, n);
            back.push(g.nodes[n as usize]);
            guard += 1;
        }
        back.reverse();
        path.extend(back);
    }
    path.push(pb);
    path.push(b);
    json!({
        "ok": true, "dist": total.round(), "straight": dist(a, b).round(),
        "minutes": r1(total / ctx.a.walk_speed / 60.0),
        "path": path.iter().flat_map(|p| [r1(p[0]), r1(p[1])]).collect::<Vec<_>>()
    })
}

// ------------------------------------------------------------------------------------------
// Everything together

struct Budget {
    lines: BTreeMap<String, f64>,
}

impl Budget {
    fn add(&mut self, key: &str, qty: f64) {
        *self.lines.entry(key.to_string()).or_insert(0.0) += qty;
    }
}

pub fn evaluate(w: &World, ctx: &Ctx) -> Value {
    let mut sc = Scratch::default();
    let (sc_, base, plan, a, cat) = (&ctx.sc, &ctx.base, &ctx.plan, &ctx.a, &ctx.cat);
    let nw = w.blds.len();
    let pm2 = cat["people_m2"].as_object().cloned().unwrap_or_default();
    let mut budget = Budget { lines: BTreeMap::new() };
    let mut items: Vec<Value> = Vec::new();
    let (mut new_b, mut new_fp, mut new_gfa, mut new_people) = (0usize, 0.0, 0.0, 0.0);
    let (mut demo_n, mut demo_gfa, mut add_gfa) = (0usize, 0.0, 0.0);
    let mut road_m: BTreeMap<String, f64> = BTreeMap::new();
    let (mut junctions, mut loose) = (0usize, 0usize);
    let (mut planted, mut removed, mut tagged) = (0usize, 0usize, 0usize);
    let mut affected: HashSet<u32> = HashSet::new();
    let (mut solar_kwp, mut rwh_m3, mut runoff, mut captured) = (0.0, 0.0, 0.0, 0.0);
    let storm = a.storm_mm / 1000.0;
    let trees_in = |ring: &[P], set: &mut HashSet<u32>| -> usize {
        let bb = bbox(ring);
        let mut n = 0;
        w.tgrid.query_bb(bb, |k| {
            let t = w.trees[k as usize];
            if pip(t[0] as f64, t[1] as f64, ring) && set.insert(k) {
                n += 1;
            }
        });
        n
    };
    for (idx, it) in sc_.items.iter().enumerate() {
        let mut warn: Vec<String> = Vec::new();
        let mut info = Map::new();
        let prop = it.proposed();
        match it.kind.as_str() {
            "building" => {
                if let Some(r) = it.poly() {
                    let area = ring_area(r);
                    let floors = it.num("floors", 3.0).round().max(1.0);
                    let t = it.text("type", "academic");
                    let gfa = area * floors;
                    let people = pm2.get(&t).and_then(|x| x.as_f64()).map_or(0.0, |m| gfa / m);
                    info.insert("area".into(), json!(area.round()));
                    info.insert("gfa".into(), json!(gfa.round()));
                    info.insert("people".into(), json!(people.round()));
                    if prop {
                        new_b += 1;
                        new_fp += area;
                        new_gfa += gfa;
                        new_people += people;
                        budget.add("building", gfa);
                        runoff += area * 0.6 * storm;
                    }
                    // Checks: overlaps, water, roads, trees.
                    let bb = bbox(r);
                    let (pts, s) = samples_in(r, &bb, area, Some(2.0));
                    let over = pts.iter().filter(|p| world_building_at(w, &plan.removed, **p).is_some()).count() as f64 * s * s;
                    if over > 10.0 {
                        warn.push(format!("Overlaps existing buildings (about {} m²). Demolish them in the plan or move it.", over.round()));
                    }
                    if pts.iter().any(|p| w.on_pond(*p)) {
                        warn.push("Sits on a pond or water body.".into());
                    }
                    if r.iter().chain(pts.iter()).any(|p| w.road_clearance(*p, 25.0).map_or(false, |c| c < 0.0)) {
                        warn.push("Sits on a road.".into());
                    }
                    let nt = if prop { trees_in(r, &mut affected) } else { 0 };
                    if nt > 0 {
                        warn.push(format!("Would remove about {}.", plural(nt, "mapped tree")));
                    }
                    if !w.in_campus(centroid(r)) {
                        info.insert("outside".into(), json!(true));
                    }
                }
            }
            "road" => {
                if let Some(l) = it.line() {
                    let t = it.text("type", "lane");
                    let (wd, _) = road_spec(&t);
                    let len = line_len(l);
                    let j = plan.junctions.get(&idx).copied().unwrap_or(0);
                    info.insert("length".into(), json!(len.round()));
                    info.insert("junctions".into(), json!(j));
                    if j == 0 {
                        warn.push("Not joined to any road or path. Start or end it on one.".into());
                        loose += 1;
                    }
                    let mut crossed = 0;
                    for s in l.windows(2) {
                        crossed += plan.walls(w, s[0], s[1], &mut sc).0 / 2;
                    }
                    if crossed > 0 {
                        warn.push(format!("Passes through {}.", plural(crossed as usize, "building")));
                    }
                    if prop {
                        *road_m.entry(t.clone()).or_insert(0.0) += len;
                        junctions += j;
                        budget.add(&format!("road:{t}"), len);
                        runoff += len * wd * 0.55 * storm;
                        let lights = plan.gen_lights.iter().filter(|g| g.1 == idx).count();
                        if lights > 0 {
                            budget.add("street_light", lights as f64);
                            info.insert("lights".into(), json!(lights));
                        }
                        // Trees in the corridor.
                        let mut n = 0;
                        for s in l.windows(2) {
                            let bb = [s[0][0].min(s[1][0]) - wd, s[0][1].min(s[1][1]) - wd, s[0][0].max(s[1][0]) + wd, s[0][1].max(s[1][1]) + wd];
                            w.tgrid.query_bb(bb, |k| {
                                let tp = w.trees[k as usize];
                                if seg_dist([tp[0] as f64, tp[1] as f64], s[0], s[1]).0 <= wd / 2.0 + 1.0 && affected.insert(k) {
                                    n += 1;
                                }
                            });
                        }
                        if n > 0 {
                            warn.push(format!("Would remove about {} along the way.", plural(n, "mapped tree")));
                        }
                    }
                }
            }
            "area" => {
                if let Some(r) = it.poly() {
                    let area = ring_area(r);
                    let u = it.text("use", "garden");
                    info.insert("area".into(), json!(area.round()));
                    let c = match u.as_str() {
                        "garden" => 0.25,
                        "parking" | "plaza" => 0.85,
                        "sports" => 0.6,
                        "solar_farm" => 0.35,
                        _ => 0.0,
                    };
                    if prop {
                        if u == "solar_farm" {
                            let kwp = area / 12.0;
                            solar_kwp += kwp;
                            budget.add("area:solar_farm", kwp);
                            info.insert("kwp".into(), json!(r1(kwp)));
                        } else {
                            budget.add(&format!("area:{u}"), area);
                        }
                        runoff += area * (c - 0.3) * storm;
                        if u == "rain_garden" {
                            captured += area * 0.3;
                        }
                        if !["garden", "rain_garden"].contains(&u.as_str()) {
                            let nt = trees_in(r, &mut affected);
                            if nt > 0 {
                                warn.push(format!("Would remove about {}.", plural(nt, "mapped tree")));
                            }
                        }
                    }
                    let bb = bbox(r);
                    let (pts, s) = samples_in(r, &bb, area, Some(3.0));
                    let over = pts.iter().filter(|p| plan.building_at(w, **p).map_or(false, |b| b < nw)).count() as f64 * s * s;
                    if over > 20.0 {
                        warn.push(format!("Covers existing buildings (about {} m²).", over.round()));
                    }
                }
            }
            "solar_roof" | "rwh" | "demolish" | "building_edit" => {
                let v = if prop { plan } else { base };
                let at = if it.kind == "demolish" || it.kind == "building_edit" { world_building_at(w, &vec![false; nw], it.point()) } else { v.building_at(w, it.point()) };
                match at {
                    None => warn.push("Not on a building. Place it on a roof.".into()),
                    Some(bi) => {
                        let b = v.bld(w, bi);
                        let floors0 = if bi < nw { w.blds[bi].floors } else { v.floors[bi] };
                        info.insert("building".into(), json!({ "name": b.name, "type": w.type_name(if bi < nw { w.blds[bi].t } else { v.tcode[bi] }), "floors": floors0, "area": b.area.round() }));
                        if prop {
                            match it.kind.as_str() {
                                "solar_roof" => {
                                    let kwp = b.area * it.num("share", 50.0) / 100.0 / 10.0;
                                    solar_kwp += kwp;
                                    budget.add("solar_roof", kwp);
                                    info.insert("kwp".into(), json!(r1(kwp)));
                                    info.insert("kwh".into(), json!((kwp * a.solar_yield).round()));
                                }
                                "rwh" => {
                                    let m3 = b.area * a.rain_mm / 1000.0 * a.runoff_roof;
                                    rwh_m3 += m3;
                                    captured += b.area * storm * a.runoff_roof;
                                    budget.add("rwh", b.area);
                                    info.insert("m3".into(), json!(m3.round()));
                                }
                                "demolish" => {
                                    demo_n += 1;
                                    demo_gfa += b.area * floors0 as f64;
                                    budget.add("demolish", b.area * floors0 as f64);
                                    runoff -= b.area * 0.6 * storm;
                                }
                                _ => {
                                    let f = it.num("floors", 0.0).round();
                                    if f > floors0 as f64 {
                                        let g = b.area * (f - floors0 as f64);
                                        add_gfa += g;
                                        budget.add("building_add", g);
                                        info.insert("added".into(), json!(g.round()));
                                    }
                                }
                            }
                        }
                    }
                }
            }
            "tree_remove" | "tree_tag" => match w.tree_near(it.point(), 4.0) {
                None => warn.push("No mapped tree here. Click on a tree.".into()),
                Some(t) => {
                    info.insert("tree".into(), json!(format!("T{t}")));
                    info.insert("height".into(), json!(r1(w.trees[t as usize][2] as f64)));
                    if it.kind == "tree_tag" {
                        tagged += 1;
                    } else if prop {
                        removed += 1;
                        affected.remove(&t);
                        budget.add("tree_remove", 1.0);
                    }
                }
            },
            "tree" => {
                if prop {
                    planted += 1;
                    budget.add("tree", 1.0);
                }
            }
            "street_light" => {
                if prop {
                    budget.add(if it.text("supply", "grid") == "solar" { "street_light:solar" } else { "street_light" }, 1.0);
                }
                if w.road_clearance(it.point(), 60.0).is_none() && !plan.samples.iter().any(|s| dist(s.p, it.point()) < 60.0) {
                    warn.push("More than 60 m from any road or path.".into());
                }
            }
            "bike_dock" => {
                if prop {
                    budget.add("bike_dock", it.num("docks", 10.0).round().max(1.0));
                }
            }
            "note" => {}
            k => {
                // Built-in points count one each; user-made line and area types count metres and m².
                let qty = match &it.geom {
                    Geom::Point(_) => 1.0,
                    Geom::Line(l) => line_len(l),
                    Geom::Poly(r) => ring_area(r),
                };
                match &it.geom {
                    Geom::Line(_) => {
                        info.insert("length".into(), json!(qty.round()));
                    }
                    Geom::Poly(_) => {
                        info.insert("area".into(), json!(qty.round()));
                    }
                    _ => {}
                }
                if prop && ctx.rates.get(k).is_some() {
                    budget.add(k, qty);
                }
                if ctx.fac.get(k).is_some() && w.road_clearance(it.point(), 60.0).is_none() && !plan.samples.iter().any(|s| dist(s.p, it.point()) < 60.0) {
                    warn.push("More than 60 m from any road or path, so walking access cannot be measured.".into());
                }
            }
        }
        items.push(json!({ "id": it.id, "warn": warn, "info": info }));
    }
    // Budget with rates (scenario overrides first).
    let rates = &ctx.rates;
    let mut lines = Vec::new();
    let (mut capex, mut opex, mut kwh_total) = (0.0, 0.0, 0.0);
    for (key, qty) in &budget.lines {
        let Some(r) = rates.get(key) else { continue };
        let rate = sc_.meta_num(&["costs", key], r["rate"].as_f64().unwrap_or(0.0));
        let c = rate * qty;
        let mut kwh = r["kwh"].as_f64().unwrap_or(0.0) * qty;
        if key == "street_light" {
            kwh = plan.lights.iter().filter(|l| !l.solar && sc_.items[l.item].proposed()).map(|l| l.watts * a.light_hours * 365.0 / 1000.0).sum();
        }
        let o = c * r["maint"].as_f64().unwrap_or(0.0) / 100.0 + kwh * a.tariff;
        capex += c;
        opex += o;
        kwh_total += kwh;
        lines.push(json!({ "key": key, "label": r["label"], "unit": r["unit"], "qty": r1(*qty), "rate": rate, "capex": c.round(), "opex": o.round(), "kwh": kwh.round() }));
    }
    let solar_kwh = solar_kwp * a.solar_yield;
    let savings = solar_kwh * a.tariff;
    let affected_n = affected.len();
    let graph = {
        let g = &plan.graph;
        let nodes: Vec<f64> = g.nodes[g.base_nodes..].iter().flat_map(|p| [r1(p[0]), r1(p[1])]).collect();
        let edges: Vec<Value> = g.edges[g.base_edges..]
            .iter()
            .filter(|e| e.on)
            .map(|e| if e.road >= NEW_ROAD { json!([e.a, e.b, -((e.road - NEW_ROAD) as i64) - 1]) } else { json!([e.a, e.b, e.road]) })
            .collect();
        let off: Vec<usize> = (0..g.base_edges).filter(|&k| !g.edges[k].on).collect();
        json!({ "nodes": nodes, "edges": edges, "off": off, "base_nodes": g.base_nodes })
    };
    let warnings = items.iter().filter(|i| i["warn"].as_array().map_or(false, |a| !a.is_empty())).count();
    json!({
        "ok": true,
        "items": items,
        "warnings": warnings,
        "budget": { "lines": lines, "capex": capex.round(), "opex": opex.round(), "kwh": kwh_total.round(), "savings": savings.round(),
                    "payback_solar": if savings > 0.0 { Some(r1(budget.lines.get("solar_roof").copied().unwrap_or(0.0) * sc_.meta_num(&["costs", "solar_roof"], 50000.0) / savings)) } else { None } },
        "build": { "new": new_b, "footprint": new_fp.round(), "gfa": new_gfa.round(), "people": new_people.round(), "demolished": demo_n, "demolished_gfa": demo_gfa.round(), "added_gfa": add_gfa.round() },
        "roads": { "new_m": road_m.iter().map(|(k, v)| (k.clone(), json!(v.round()))).collect::<Map<String, Value>>(), "junctions": junctions, "loose": loose },
        "green": { "planted": planted, "removed": removed, "affected": affected_n, "tagged": tagged,
                   "co2_kg": ((planted as f64 - removed as f64 - affected_n as f64) * a.tree_co2).round(),
                   "solar_kwp": r1(solar_kwp), "solar_kwh": solar_kwh.round(), "solar_co2_t": r1(solar_kwh * a.grid_co2 / 1000.0),
                   "rwh_m3": rwh_m3.round(), "runoff_m3": runoff.round(), "captured_m3": captured.round(), "storm_mm": a.storm_mm },
        "wifi": wifi_eval(w, ctx, &mut sc),
        "light": light_eval(w, ctx),
        "access": access_eval(w, ctx),
        "graph": graph,
        "gen_lights": plan.gen_lights.iter().map(|(p, i)| json!([r1(p[0]), r1(p[1]), i])).collect::<Vec<_>>()
    })
}

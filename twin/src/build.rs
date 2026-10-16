//! Campus analysis and packing: turns the fetched rasters and vectors into the viewer's data.
//!
//! Inputs: data/raw/village_boundaries.json, data/campus/osm.json, data/raw/overture_buildings.json,
//! data/raw/overture_places.json and the rasters in twin/.cache/rasters (see fetch.rs).
//! Outputs: campus/data/campus-data.js and campus/data/campus-imagery.js.

use crate::aoi::{root, Aoi};
use crate::fetch::cache;
use crate::geo;
use crate::http::Res;
use crate::osm::{self, Osm, Tags};
use crate::raster::{self, Grid, P};
use serde_json::{json, Value};
use std::collections::HashMap;

fn r1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

fn flat(r: &[P]) -> Vec<f64> {
    r.iter().flat_map(|p| [r1(p[0]), r1(p[1])]).collect()
}

fn line_len(p: &[P]) -> f64 {
    p.windows(2).map(|s| raster::dist(s[0], s[1])).sum()
}

// ---------------------------------------------------------------------------------------------
// Land cover (10 m): 1 built, 2 trees, 3 water, 4 crops/grass, 5 bare/fallow.

pub const LC_NAMES: [&str; 6] = ["none", "built", "trees", "water", "crops_grass", "bare"];
const LC_RGB: [[u8; 3]; 6] = [[0, 0, 0], [158, 146, 132], [52, 92, 44], [58, 102, 140], [116, 152, 72], [176, 156, 116]];

struct Rasters {
    dsm: (Grid, Vec<f32>),
    ob: (Grid, Vec<u8>),
    chm: (Grid, Vec<u8>),
    mndwi: (Grid, Vec<f32>),
    ndvi: (Grid, Vec<f32>),
    rgb: (Grid, Vec<u8>),
}

fn load_rasters() -> Res<Rasters> {
    let need = |n: &str| -> Res<std::path::PathBuf> {
        let p = cache(n);
        if !p.with_extension("json").exists() {
            return Err(format!("missing raster {n}: run `twin fetch all` first").into());
        }
        Ok(p)
    };
    let (g, _, ob) = raster::load_u8(&need("ob2023_2m")?)?;
    let (gc, _, chm) = raster::load_u8(&need("chm2")?)?;
    let (gr, _, rgb) = raster::load_u8(&need("s2rgb3")?)?;
    Ok(Rasters {
        dsm: raster::load_f32(&need("dsm30")?)?,
        ob: (g, ob),
        chm: (gc, chm),
        mndwi: raster::load_f32(&need("mndwi10")?)?,
        ndvi: raster::load_f32(&need("ndvi10")?)?,
        rgb: (gr, rgb),
    })
}

fn land_cover(r: &Rasters) -> (Grid, Vec<u8>) {
    let (g10, mndwi) = (&r.mndwi.0, &r.mndwi.1);
    let ndvi = &r.ndvi.1;
    let (g2, ob) = (&r.ob.0, &r.ob.1);
    let chm = &r.chm.1;
    let mut lc = vec![0u8; g10.len()];
    for j in 0..g10.nz {
        for i in 0..g10.nx {
            let k = g10.idx(i, j);
            let c = g10.center(i, j);
            let (mut built, mut tree, mut n) = (0, 0, 0);
            for dj in -2..=2 {
                for di in -2..=2 {
                    if let Some((a, b)) = g2.cell_of(c[0] + di as f64 * 2.0, c[1] + dj as f64 * 2.0) {
                        let q = g2.idx(a, b);
                        n += 1;
                        if ob[q * 2] >= 102 {
                            built += 1;
                        }
                        if chm[q] >= 3 {
                            tree += 1;
                        }
                    }
                }
            }
            let n = n.max(1) as f64;
            lc[k] = if mndwi[k] > 0.05 {
                3
            } else if built as f64 / n >= 0.35 {
                1
            } else if tree as f64 / n >= 0.4 {
                2
            } else if ndvi[k] > 0.42 {
                4
            } else {
                5
            };
        }
    }
    (*g10, lc)
}

// ---------------------------------------------------------------------------------------------
// Terrain: GLO-30 DSM minus half the mean canopy and building height, lightly smoothed.

fn terrain(r: &Rasters) -> (Grid, Vec<f32>) {
    let (g, mut z) = (r.dsm.0, r.dsm.1.clone());
    // Fill gaps (tile seams) from neighbours.
    for _ in 0..20 {
        let prev = z.clone();
        let mut left = 0;
        for j in 0..g.nz {
            for i in 0..g.nx {
                let k = g.idx(i, j);
                if prev[k].is_finite() {
                    continue;
                }
                let (mut s, mut n) = (0.0, 0.0);
                for (a, b) in [(i.wrapping_sub(1), j), (i + 1, j), (i, j.wrapping_sub(1)), (i, j + 1)] {
                    if a < g.nx && b < g.nz && prev[g.idx(a, b)].is_finite() {
                        s += prev[g.idx(a, b)];
                        n += 1.0;
                    }
                }
                if n > 0.0 {
                    z[k] = s / n;
                } else {
                    left += 1;
                }
            }
        }
        if left == 0 {
            break;
        }
    }
    let (g2, ob, chm) = (&r.ob.0, &r.ob.1, &r.chm.1);
    for j in 0..g.nz {
        for i in 0..g.nx {
            let c = g.center(i, j);
            let (mut sc, mut sb, mut n) = (0.0f32, 0.0f32, 0.0f32);
            let mut dz = -14.0;
            while dz <= 14.0 {
                let mut dx = -14.0;
                while dx <= 14.0 {
                    if let Some((a, b)) = g2.cell_of(c[0] + dx, c[1] + dz) {
                        let q = g2.idx(a, b);
                        sc += chm[q] as f32;
                        if ob[q * 2] >= 128 {
                            sb += ob[q * 2 + 1] as f32 / 4.0;
                        }
                        n += 1.0;
                    }
                    dx += 4.0;
                }
                dz += 4.0;
            }
            if n > 0.0 {
                z[g.idx(i, j)] -= 0.5 * sc / n + 0.5 * sb / n;
            }
        }
    }
    let z = raster::gaussian(&g, &z, 0.8);
    (g, z)
}

fn terrain_at(g: &Grid, z: &[f32], p: P) -> f64 {
    let fx = ((p[0] - g.x0) / g.cell - 0.5).clamp(0.0, g.nx as f64 - 1.001);
    let fz = ((p[1] - g.z0) / g.cell - 0.5).clamp(0.0, g.nz as f64 - 1.001);
    let (i, j) = (fx.floor() as usize, fz.floor() as usize);
    let (u, v) = (fx - i as f64, fz - j as f64);
    let h = |a: usize, b: usize| z[g.idx(a.min(g.nx - 1), b.min(g.nz - 1))] as f64;
    (h(i, j) * (1.0 - u) + h(i + 1, j) * u) * (1.0 - v) + (h(i, j + 1) * (1.0 - u) + h(i + 1, j + 1) * u) * v
}

// ---------------------------------------------------------------------------------------------
// Buildings

#[derive(Clone)]
struct Bld {
    id: String,
    rings: Vec<Vec<P>>,
    name: Option<String>,
    btag: String,
    tags: Tags,
    src: u8, // 0 OSM, 1 Google (Overture), 2 Microsoft (Overture), 3 detected from presence raster
    h: f64,
    hs: &'static str, // tagged | measured | estimated | detected
    levels: Option<f64>,
    ty: &'static str,
    ts: &'static str, // tag | name | place | context | shape
    roof: u32,
    area: f64,
    c: P,
    block: u32,
}

const TYPES: [(&str, &str); 15] = [
    ("academic", "Academic / research"),
    ("hostel", "Hostel"),
    ("residential", "Residential / staff quarters"),
    ("house", "House"),
    ("admin", "Office / admin"),
    ("health", "Health"),
    ("school", "School"),
    ("commercial", "Shop / market / canteen"),
    ("religious", "Religious"),
    ("sports", "Sports"),
    ("farm", "Farm building / shed"),
    ("industrial", "Workshop / store / hangar"),
    ("utility", "Utility"),
    ("institutional", "Institutional (unnamed)"),
    ("unknown", "Building (unclassified)"),
];

fn type_from_tag(v: &str) -> Option<&'static str> {
    Some(match v {
        "house" | "residential" | "apartments" | "detached" | "terrace" | "semidetached_house" | "bungalow" => "residential",
        "dormitory" => "hostel",
        "university" | "college" => "academic",
        "school" | "kindergarten" => "school",
        "hospital" | "clinic" => "health",
        "commercial" | "retail" | "shop" | "kiosk" | "supermarket" => "commercial",
        "industrial" | "warehouse" | "hangar" | "storage_tank" | "garage" | "garages" => "industrial",
        "farm_auxiliary" | "barn" | "cowshed" | "greenhouse" | "shed" | "stable" | "sty" | "silo" | "farm" => "farm",
        "temple" | "mosque" | "church" | "religious" | "chapel" | "gurdwara" | "shrine" => "religious",
        "office" | "government" | "public" | "civic" | "bank" | "post_office" => "admin",
        "sports_hall" | "stadium" | "grandstand" | "pavilion" | "sports_centre" => "sports",
        "transformer_tower" | "water_tower" | "pumping_station" | "service" => "utility",
        _ => return None,
    })
}

fn type_from_name(n: &str) -> Option<&'static str> {
    let n = n.to_lowercase();
    let has = |ws: &[&str]| ws.iter().any(|w| n.contains(w));
    // Order matters: specific words beat the generic "bhawan" (most bhawans here are hostels).
    Some(if has(&["hospital", "dispensary", "health", "clinic", "medical"]) {
        "health"
    } else if has(&["temple", "mandir", "masjid", "mosque", "church", "gurudwara", "gurdwara"]) {
        "religious"
    } else if has(&["school", "vidyalaya", "kendriya", "academy", "inter college"]) {
        "school"
    } else if has(&["bank", "post office", "office", "administrative", "registrar", "comptroller", "guest house", "police", "thana", "kulpati", "insurance"]) {
        "admin"
    } else if has(&["college", "department", "library", "laboratory", "lab ", "institute", "faculty", "auditorium", "research", "centre for", "center for", "directorate", "biotech", "genetic"]) {
        "academic"
    } else if has(&["bhawan", "bhavan", "hostel", "chhatravas", "dormitory"]) {
        "hostel"
    } else if has(&["stadium", "gym", "sports", "pavilion", "swimming", "court"]) {
        "sports"
    } else if has(&["shop", "market", "store", "canteen", "cafe", "dhaba", "restaurant", "mart", "stall"]) {
        "commercial"
    } else if has(&["dairy", "poultry", "farm", "shed", "nursery", "seed", "godown"]) {
        "farm"
    } else if has(&["workshop", "factory", "hangar", "plant", "mill"]) {
        "industrial"
    } else {
        return None;
    })
}

fn norm_name(s: &str) -> String {
    let cleaned: String = s.to_lowercase().chars().map(|c| if c.is_alphanumeric() { c } else { ' ' }).collect();
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Two names refer to the same place: equal after normalising, or one contains the other.
fn same_name(a: &str, b: &str) -> bool {
    let (a, b) = (norm_name(a), norm_name(b));
    !a.is_empty() && !b.is_empty() && (a == b || a.contains(&b) || b.contains(&a))
}

/// Roads, localities and area names must not be used as a building's name.
fn building_like_place(name: &str, cat: &str) -> bool {
    let n = name.to_lowercase();
    let road_or_area = ["road", " marg", "highway", "chowk", "colony", "nagar", "gate", "crossing", "bypass"]
        .iter()
        .any(|w| n.contains(w));
    let area_cat = ["place", "town", "city", "village", "hamlet", "locality", "neighbourhood", "suburb", "street", "road"].contains(&cat);
    !road_or_area && !area_cat
}

fn type_from_landuse(t: &Tags) -> Option<&'static str> {
    let lu = osm::tag(t, "landuse");
    let am = osm::tag(t, "amenity");
    Some(match (lu, am) {
        ("residential", _) => "residential",
        ("farmyard", _) | ("farmland", _) | ("orchard", _) | ("plant_nursery", _) | ("greenhouse_horticulture", _) => "farm",
        ("industrial", _) => "industrial",
        ("religious", _) | (_, "place_of_worship") => "religious",
        ("commercial", _) | ("retail", _) => "commercial",
        (_, "hospital") | (_, "clinic") => "health",
        (_, "school") => "school",
        (_, "university") | (_, "college") | ("education", _) => "institutional",
        _ => return None,
    })
}

fn estimated_height(area: f64) -> f64 {
    if area < 60.0 {
        3.2
    } else if area < 200.0 {
        4.5
    } else if area < 600.0 {
        7.0
    } else {
        9.5
    }
}

fn polys_of_geojson(g: &Value) -> Vec<Vec<Vec<P>>> {
    let ring = |r: &Value| -> Vec<P> {
        r.as_array().into_iter().flatten().filter_map(|p| Some(geo::proj(p[0].as_f64()?, p[1].as_f64()?))).collect()
    };
    let poly = |p: &Value| -> Vec<Vec<P>> { p.as_array().into_iter().flatten().map(ring).filter(|r| r.len() >= 4).collect() };
    match g["type"].as_str() {
        Some("Polygon") => vec![poly(&g["coordinates"])],
        Some("MultiPolygon") => g["coordinates"].as_array().into_iter().flatten().map(poly).collect(),
        _ => vec![],
    }
}

/// Uniform grid index over item bounding boxes for point queries.
struct Index {
    cell: f64,
    map: HashMap<(i64, i64), Vec<usize>>,
}

impl Index {
    fn new(cell: f64) -> Index {
        Index { cell, map: HashMap::new() }
    }
    fn insert(&mut self, i: usize, r: &[P]) {
        let (mut a, mut b) = ([f64::MAX; 2], [f64::MIN; 2]);
        for p in r {
            a = [a[0].min(p[0]), a[1].min(p[1])];
            b = [b[0].max(p[0]), b[1].max(p[1])];
        }
        for x in (a[0] / self.cell).floor() as i64..=(b[0] / self.cell).floor() as i64 {
            for z in (a[1] / self.cell).floor() as i64..=(b[1] / self.cell).floor() as i64 {
                self.map.entry((x, z)).or_default().push(i);
            }
        }
    }
    fn query(&self, p: P) -> &[usize] {
        self.map.get(&((p[0] / self.cell).floor() as i64, (p[1] / self.cell).floor() as i64)).map(|v| v.as_slice()).unwrap_or(&[])
    }
}

fn buildings(aoi: &Aoi, o: &Osm, r: &Rasters, pois: &[(String, String, P)], landuse: &[(Tags, Vec<Vec<P>>)]) -> Res<(Vec<Bld>, Value)> {
    let [bx0, bz0, bx1, bz1] = aoi.local;
    let inside_box = |p: P| p[0] >= bx0 && p[0] <= bx1 && p[1] >= bz0 && p[1] <= bz1;
    let mut out: Vec<Bld> = Vec::new();
    let new_b = |id: String, rings: Vec<Vec<P>>, tags: Tags, src: u8| -> Bld {
        let area = raster::ring_area(&rings[0]) - rings[1..].iter().map(|r| raster::ring_area(r)).sum::<f64>();
        Bld {
            id,
            c: raster::ring_centroid(&rings[0]),
            name: osm::name(&tags),
            btag: osm::tag(&tags, "building").to_string(),
            levels: osm::tag(&tags, "building:levels").parse().ok(),
            tags,
            rings,
            src,
            h: 0.0,
            hs: "estimated",
            ty: "unknown",
            ts: "shape",
            roof: 0,
            area,
            block: 0,
        }
    };
    for w in &o.ways {
        if w.tags.contains_key("building") && w.closed() {
            let b = new_b(format!("w{}", w.id), vec![w.pts.clone()], w.tags.clone(), 0);
            if inside_box(b.c) {
                out.push(b);
            }
        }
    }
    for rel in &o.rels {
        if rel.tags.contains_key("building") {
            for outer in &rel.outers {
                let holes: Vec<Vec<P>> = rel.inners.iter().filter(|h| raster::point_in_ring(h[0], outer)).cloned().collect();
                let mut rings = vec![outer.clone()];
                rings.extend(holes);
                let b = new_b(format!("r{}", rel.id), rings, rel.tags.clone(), 0);
                if inside_box(b.c) {
                    out.push(b);
                }
            }
        }
    }
    let n_osm = out.len();

    // Overture (Google + Microsoft footprints); drop those mostly covered by an OSM building.
    let (g2, ob) = (r.ob.0, &r.ob.1);
    let mut osm_mask = vec![false; g2.len()];
    for b in &out {
        raster::fill_polygon(&g2, &b.rings, |k| osm_mask[k] = true);
    }
    let ov_path = root().join("data/raw/overture_buildings.json");
    let (mut n_g, mut n_m, mut n_dup) = (0, 0, 0);
    if ov_path.exists() {
        let ov: Value = serde_json::from_str(&std::fs::read_to_string(&ov_path)?)?;
        for b in ov["buildings"].as_array().into_iter().flatten() {
            let s = b["source"].as_str().unwrap_or("");
            if s.contains("OpenStreetMap") {
                continue;
            }
            let src = if s.contains("Google") { 1 } else { 2 };
            for rings in polys_of_geojson(&b["geom"]) {
                if rings.is_empty() {
                    continue;
                }
                let c = raster::ring_centroid(&rings[0]);
                if !inside_box(c) {
                    continue;
                }
                let (mut cov, mut tot) = (0, 0);
                raster::fill_polygon(&g2, &rings, |k| {
                    tot += 1;
                    if osm_mask[k] {
                        cov += 1;
                    }
                });
                if tot > 0 && cov as f64 / tot as f64 > 0.3 || osm_mask.get(g2.cell_of(c[0], c[1]).map_or(usize::MAX, |(i, j)| g2.idx(i, j))) == Some(&true) {
                    n_dup += 1;
                    continue;
                }
                let mut t = Tags::new();
                if let Some(n) = b["name"].as_str() {
                    t.insert("name".into(), n.into());
                }
                if let Some(cls) = b["cls"].as_str() {
                    t.insert("building".into(), cls.into());
                }
                if src == 1 {
                    n_g += 1;
                } else {
                    n_m += 1;
                }
                out.push(new_b(b["id"].as_str().unwrap_or("").chars().take(12).collect(), rings, t, src));
            }
        }
    }

    // Buildings visible in the 2023 presence raster but in no footprint dataset.
    let mut fp = vec![false; g2.len()];
    for b in &out {
        raster::fill_polygon(&g2, &b.rings, |k| fp[k] = true);
    }
    let fp_d = raster::dilate(&g2, &fp, 2);
    let cand: Vec<bool> = (0..g2.len()).map(|k| ob[k * 2] >= 128 && ob[k * 2 + 1] >= 10 && !fp_d[k]).collect();
    let (lab, n) = raster::label(&g2, &cand, true);
    let mut comps: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (k, &l) in lab.iter().enumerate() {
        if l > 0 {
            comps[l as usize - 1].push(k);
        }
    }
    let mut n_det = 0;
    for cells in comps {
        let area = cells.len() as f64 * g2.cell * g2.cell;
        if area < 40.0 {
            continue;
        }
        let mut corners = Vec::with_capacity(cells.len() * 4);
        for &k in &cells {
            let c = g2.center(k % g2.nx, k / g2.nx);
            let h = g2.cell / 2.0;
            corners.extend([[c[0] - h, c[1] - h], [c[0] + h, c[1] - h], [c[0] + h, c[1] + h], [c[0] - h, c[1] + h]]);
        }
        let hull = raster::convex_hull(corners);
        let (rect, rarea, long, short) = raster::min_area_rect(&hull);
        if short < 3.5 || long / short > 8.0 || area / rarea < 0.45 {
            continue;
        }
        // The product's ~4 m effective resolution blurs outlines: pull each side in by 0.75 m.
        let c = raster::ring_centroid(&rect);
        let shrink = |p: P| -> P {
            let (dx, dz) = (p[0] - c[0], p[1] - c[1]);
            let d = (dx * dx + dz * dz).sqrt().max(1e-6);
            [p[0] - dx / d * 1.06, p[1] - dz / d * 1.06]
        };
        let ring: Vec<P> = rect.iter().map(|p| shrink(*p)).collect();
        let mut hs: Vec<u8> = cells.iter().map(|&k| ob[k * 2 + 1]).collect();
        hs.sort_unstable();
        let mut b = new_b(format!("d{n_det}"), vec![ring], Tags::new(), 3);
        b.h = (hs[hs.len() / 2] as f64 / 4.0).clamp(2.5, 60.0);
        b.hs = "detected";
        out.push(b);
        n_det += 1;
    }

    // Heights from the presence/height raster (p75 of covered cells), tags, or estimates.
    let mut n_meas = 0;
    for b in out.iter_mut() {
        if b.src == 3 {
            continue;
        }
        let tag_h = osm::metres(osm::tag(&b.tags, "height")).or(b.levels.map(|l| l * 3.2 + 0.6));
        let mut hs = Vec::new();
        raster::fill_polygon(&g2, &b.rings, |k| {
            if ob[k * 2] >= 128 && ob[k * 2 + 1] > 0 {
                hs.push(ob[k * 2 + 1]);
            }
        });
        if let Some(h) = tag_h {
            b.h = h;
            b.hs = "tagged";
        } else if hs.len() >= 3 {
            hs.sort_unstable();
            b.h = (hs[hs.len() * 3 / 4] as f64 / 4.0).clamp(2.5, 60.0);
            b.hs = "measured";
            n_meas += 1;
        } else {
            b.h = estimated_height(b.area);
        }
    }

    // Roof colour from the Sentinel-2 image (only meaningful for roofs larger than a few pixels).
    let (g3, rgb) = (r.rgb.0, &r.rgb.1);
    for b in out.iter_mut() {
        let (mut s, mut n) = ([0u32; 3], 0u32);
        raster::fill_polygon(&g3, &b.rings, |k| {
            for c in 0..3 {
                s[c] += rgb[k * 3 + c] as u32;
            }
            n += 1;
        });
        if n >= 3 {
            b.roof = ((s[0] / n) << 16) | ((s[1] / n) << 8) | (s[2] / n);
        }
    }

    // Classification: tags, then names (own name or a place inside), then land use, then shape.
    let mut bidx = Index::new(60.0);
    for (i, b) in out.iter().enumerate() {
        bidx.insert(i, &b.rings[0]);
    }
    let mut named_inside: HashMap<usize, (String, String)> = HashMap::new();
    // Only places that are plausibly a building lend it their name (not roads or localities).
    for (name, cat, p) in pois.iter().filter(|(n, c, _)| building_like_place(n, c)) {
        for &i in bidx.query(*p) {
            if raster::point_in_ring(*p, &out[i].rings[0]) {
                named_inside.entry(i).or_insert((name.clone(), cat.clone()));
            }
        }
    }
    let mut luidx = Index::new(200.0);
    for (i, (_, rings)) in landuse.iter().enumerate() {
        luidx.insert(i, &rings[0]);
    }
    let sizes: Vec<(P, f64)> = out.iter().map(|b| (b.c, b.area)).collect();
    for (i, b) in out.iter_mut().enumerate() {
        if let Some(t) = b.name.as_deref().and_then(type_from_name) {
            b.ty = t;
            b.ts = "name";
        } else if let Some(t) = type_from_tag(&b.btag) {
            b.ty = t;
            b.ts = "tag";
        } else if let Some((n, cat)) = named_inside.get(&i) {
            if b.name.is_none() {
                b.name = Some(n.clone());
            }
            if let Some(t) = type_from_name(n).or_else(|| type_from_name(cat)) {
                b.ty = t;
                b.ts = "place";
            }
        }
        if b.ty == "unknown" {
            for &li in luidx.query(b.c) {
                let (t, rings) = &landuse[li];
                if raster::point_in_ring(b.c, &rings[0]) {
                    if let Some(ty) = osm::name(t).as_deref().and_then(type_from_name).or_else(|| type_from_landuse(t)) {
                        b.ty = ty;
                        b.ts = "context";
                        break;
                    }
                }
            }
        }
        if b.ty == "unknown" || (b.ty == "institutional" && b.area < 250.0) {
            // Clusters of similar small buildings are housing (staff quarters, village houses).
            let similar = sizes
                .iter()
                .filter(|(c, a)| raster::dist(*c, b.c) < 45.0 && *a > b.area * 0.6 && *a < b.area * 1.6)
                .count();
            b.ty = if b.area < 10.0 {
                "utility"
            } else if b.area >= 30.0 && b.area < 320.0 && b.h <= 9.5 && similar >= 5 {
                "residential"
            } else if b.area < 160.0 && b.h <= 8.0 {
                "house"
            } else if b.h < 6.0 && b.area >= 300.0 {
                "farm"
            } else if b.area >= 500.0 {
                "institutional"
            } else {
                b.ty
            };
            b.ts = "shape";
        }
    }
    let stats = json!({
        "osm": n_osm, "google": n_g, "microsoft": n_m, "duplicates_dropped": n_dup,
        "detected_from_presence": n_det, "height_measured": n_meas,
    });
    println!("  buildings: {} (OSM {n_osm}, Google {n_g}, Microsoft {n_m}, detected {n_det}; {n_dup} duplicates dropped; {n_meas} heights measured)", out.len());
    Ok((out, stats))
}

// ---------------------------------------------------------------------------------------------
// Roads and the street-view graph

struct Road {
    class: String,
    w: f64,
    name: Option<String>,
    pts: Vec<P>,
    nodes: Vec<i64>,
    bridge: bool,
    surface: String,
}

fn road_width(c: &str) -> f64 {
    match c {
        "motorway" | "trunk" => 10.0,
        "primary" => 9.0,
        "secondary" => 8.0,
        "tertiary" => 7.0,
        "unclassified" => 6.0,
        "residential" => 5.5,
        "living_street" | "pedestrian" => 5.0,
        "service" => 4.0,
        "track" => 3.0,
        "footway" | "cycleway" | "steps" | "bridleway" => 2.0,
        "path" => 1.5,
        c if c.ends_with("_link") => 6.0,
        _ => 4.0,
    }
}

const BLOCK_ROADS: [&str; 15] = [
    "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service",
    "track", "pedestrian", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
];

fn roads(o: &Osm, aoi: &Aoi) -> Vec<Road> {
    let [bx0, bz0, bx1, bz1] = aoi.local;
    let mut out = Vec::new();
    for w in &o.ways {
        let c = w.tag("highway");
        if c.is_empty() || w.tag("area") == "yes" || ["proposed", "platform", "elevator", "corridor", "raceway"].contains(&c) {
            continue;
        }
        if !w.pts.iter().any(|p| p[0] >= bx0 && p[0] <= bx1 && p[1] >= bz0 && p[1] <= bz1) {
            continue;
        }
        let lanes: Option<f64> = w.tag("lanes").parse().ok();
        let wid = osm::metres(w.tag("width")).or(lanes.map(|l| l * 3.2)).unwrap_or_else(|| road_width(c));
        out.push(Road {
            class: c.into(),
            w: wid,
            name: osm::name(&w.tags),
            pts: w.pts.clone(),
            nodes: w.nodes.clone(),
            bridge: w.tag("bridge") == "yes",
            surface: w.tag("surface").into(),
        });
    }
    out
}

/// Nodes = OSM nodes on roads (flat x, z), edges = [a, b, road index]. Street view walks these.
fn road_graph(rs: &[Road]) -> (Vec<f64>, Vec<[u32; 3]>) {
    let mut id: HashMap<i64, u32> = HashMap::new();
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    for (ri, r) in rs.iter().enumerate() {
        if r.nodes.len() != r.pts.len() {
            continue;
        }
        let mut prev: Option<u32> = None;
        for (n, p) in r.nodes.iter().zip(&r.pts) {
            let k = *id.entry(*n).or_insert_with(|| {
                nodes.extend([r1(p[0]), r1(p[1])]);
                (nodes.len() / 2 - 1) as u32
            });
            if let Some(a) = prev {
                if a != k {
                    edges.push([a, k, ri as u32]);
                }
            }
            prev = Some(k);
        }
    }
    (nodes, edges)
}

// ---------------------------------------------------------------------------------------------
// Water

struct WLine {
    k: String,
    w: f64,
    pts: Vec<P>,
    src: &'static str, // osm | modelled
    name: Option<String>,
}

fn water(o: &Osm, aoi: &Aoi, r: &Rasters, tz: &(Grid, Vec<f32>)) -> (Vec<(String, Vec<Vec<P>>, &'static str, Option<String>)>, Vec<WLine>, Value) {
    let mut areas = Vec::new();
    let mut lines = Vec::new();
    for w in &o.ways {
        let ww = w.tag("waterway");
        let is_area = w.tag("natural") == "water" || !w.tag("water").is_empty() || ["reservoir", "basin"].contains(&w.tag("landuse")) || ww == "riverbank";
        if is_area && w.closed() {
            let k = if w.tag("water").is_empty() { "water".to_string() } else { w.tag("water").to_string() };
            areas.push((k, vec![w.pts.clone()], "osm", osm::name(&w.tags)));
        } else if ["river", "stream", "canal", "drain", "ditch"].contains(&ww) {
            let width = osm::metres(w.tag("width")).unwrap_or(match ww {
                "river" => 20.0,
                "canal" => 6.0,
                "stream" => 4.0,
                "drain" => 2.5,
                _ => 1.5,
            });
            lines.push(WLine { k: ww.into(), w: width, pts: w.pts.clone(), src: "osm", name: osm::name(&w.tags) });
        }
    }
    for rel in &o.rels {
        if osm::tag(&rel.tags, "natural") == "water" || osm::tag(&rel.tags, "landuse") == "reservoir" {
            let mut rings = rel.outers.clone();
            rings.extend(rel.inners.clone());
            areas.push(("water".into(), rings, "osm", osm::name(&rel.tags)));
        }
    }
    let n_osm = (areas.len(), lines.len());

    // Open water seen by Sentinel-2 (MNDWI > 0.05) that OSM does not have.
    let (g10, mndwi) = (&r.mndwi.0, &r.mndwi.1);
    let mut osm_w = vec![false; g10.len()];
    for (_, rings, _, _) in &areas {
        raster::fill_polygon(g10, rings, |k| osm_w[k] = true);
    }
    let wet: Vec<bool> = (0..g10.len()).map(|k| mndwi[k] > 0.05).collect();
    let (lab, n) = raster::label(g10, &wet, true);
    let mut bbox = vec![[usize::MAX, usize::MAX, 0, 0]; n];
    let mut cnt = vec![0usize; n];
    let mut overlap = vec![0usize; n];
    for (k, &l) in lab.iter().enumerate() {
        if l == 0 {
            continue;
        }
        let (i, j, c) = (k % g10.nx, k / g10.nx, l as usize - 1);
        bbox[c] = [bbox[c][0].min(i), bbox[c][1].min(j), bbox[c][2].max(i), bbox[c][3].max(j)];
        cnt[c] += 1;
        if osm_w[k] {
            overlap[c] += 1;
        }
    }
    let mut n_det = 0;
    for c in 0..n {
        if cnt[c] < 3 || overlap[c] * 2 > cnt[c] {
            continue;
        }
        let ring = raster::simplify_ring(&raster::trace_outline(g10, &lab, c as u32 + 1, bbox[c]), 6.0);
        if ring.len() >= 4 && aoi.contains(raster::ring_centroid(&ring)) {
            areas.push(("pond".into(), vec![ring], "sentinel2", None));
            n_det += 1;
        }
    }

    // Modelled drainage lines from the terrain (D8 after depression filling).
    let (g, z) = tz;
    let (_, recv, acc) = raster::flow_accumulation(g, z);
    let thresh = (600_000.0 / (g.cell * g.cell)) as u32; // 0.6 km2 upstream area
    let chan: Vec<bool> = acc.iter().map(|&a| a >= thresh).collect();
    let mut has_up = vec![false; g.len()];
    for k in 0..g.len() {
        if chan[k] && recv[k] != usize::MAX {
            has_up[recv[k]] = true;
        }
    }
    let mut used = vec![false; g.len()];
    let mut n_mod = 0;
    for s in 0..g.len() {
        if !chan[s] || has_up[s] {
            continue;
        }
        let mut pts = Vec::new();
        let mut k = s;
        loop {
            pts.push(g.center(k % g.nx, k / g.nx));
            if used[k] || recv[k] == usize::MAX {
                break;
            }
            used[k] = true;
            k = recv[k];
        }
        // Chaikin smoothing twice, then simplify.
        let mut p = pts;
        for _ in 0..2 {
            if p.len() < 3 {
                break;
            }
            let mut q = vec![p[0]];
            for s in p.windows(2) {
                q.push([0.75 * s[0][0] + 0.25 * s[1][0], 0.75 * s[0][1] + 0.25 * s[1][1]]);
                q.push([0.25 * s[0][0] + 0.75 * s[1][0], 0.25 * s[0][1] + 0.75 * s[1][1]]);
            }
            q.push(*p.last().unwrap());
            p = q;
        }
        let p: Vec<P> = raster::simplify_line(&p, 4.0).into_iter().filter(|q| aoi.contains(*q)).collect();
        if p.len() >= 2 && line_len(&p) > 150.0 {
            lines.push(WLine { k: "drainage".into(), w: 3.0, pts: p, src: "modelled", name: None });
            n_mod += 1;
        }
    }
    println!("  water: OSM {} areas + {} lines, Sentinel-2 {} ponds, {} modelled drainage lines", n_osm.0, n_osm.1, n_det, n_mod);
    let stats = json!({"osm_areas": n_osm.0, "osm_lines": n_osm.1, "sentinel2_ponds": n_det, "modelled_lines": n_mod});
    (areas, lines, stats)
}

// ---------------------------------------------------------------------------------------------
// Trees: local maxima of the smoothed canopy height (2 m grid, 10 m window).

fn trees(r: &Rasters, blds: &[Bld]) -> Vec<f64> {
    let (g, chm) = (&r.chm.0, &r.chm.1);
    let v: Vec<f32> = chm.iter().map(|&c| c as f32).collect();
    let sm = raster::gaussian(g, &v, 1.0);
    let mut fp = vec![false; g.len()];
    for b in blds {
        raster::fill_polygon(g, &b.rings, |k| fp[k] = true);
    }
    let mut out = Vec::new();
    for k in raster::local_maxima(g, &sm, 2, 3.0) {
        if fp[k] {
            continue;
        }
        let c = g.center(k % g.nx, k / g.nx);
        out.extend([r1(c[0]), r1(c[1]), r1(sm[k] as f64)]);
    }
    out
}

// ---------------------------------------------------------------------------------------------
// Blocks: connected areas between roads, railways, runways and waterways inside the campus.

struct BlockOut {
    json: Vec<Value>,
    label: (Grid, Vec<u32>),
}

#[allow(clippy::too_many_arguments)]
fn blocks(
    aoi: &Aoi,
    rs: &[Road],
    wl: &[WLine],
    o: &Osm,
    blds: &mut [Bld],
    tree_xyz: &[f64],
    lc: &(Grid, Vec<u8>),
    names: &[(String, Vec<Vec<P>>)],
) -> BlockOut {
    let g = Grid::cover(aoi.local, 4.0);
    let mut inside = vec![false; g.len()];
    for r in &aoi.rings {
        raster::fill_polygon(&g, std::slice::from_ref(r), |k| inside[k] = true);
    }
    let mut bar = vec![false; g.len()];
    for r in rs.iter().filter(|r| BLOCK_ROADS.contains(&r.class.as_str())) {
        raster::stroke_line(&g, &r.pts, r.w / 2.0 + 1.5, |k| bar[k] = true);
    }
    for w in &o.ways {
        if !w.tag("railway").is_empty() && w.tag("railway") != "abandoned" {
            raster::stroke_line(&g, &w.pts, 3.0, |k| bar[k] = true);
        }
        if ["runway", "taxiway"].contains(&w.tag("aeroway")) && !w.closed() {
            raster::stroke_line(&g, &w.pts, osm::metres(w.tag("width")).unwrap_or(30.0) / 2.0, |k| bar[k] = true);
        }
    }
    for w in wl.iter().filter(|w| w.src == "osm") {
        raster::stroke_line(&g, &w.pts, w.w / 2.0 + 1.0, |k| bar[k] = true);
    }
    let free: Vec<bool> = (0..g.len()).map(|k| inside[k] && !bar[k]).collect();
    let (mut lab, n) = raster::label(&g, &free, false);
    let mut cnt = vec![0usize; n];
    let mut bb = vec![[usize::MAX, usize::MAX, 0, 0]; n];
    for (k, &l) in lab.iter().enumerate() {
        if l > 0 {
            let (i, j, c) = (k % g.nx, k / g.nx, l as usize - 1);
            cnt[c] += 1;
            bb[c] = [bb[c][0].min(i), bb[c][1].min(j), bb[c][2].max(i), bb[c][3].max(j)];
        }
    }
    // Keep blocks of at least 1000 m2; renumber 1..
    let min_cells = (1000.0 / (g.cell * g.cell)) as usize;
    let mut remap = vec![0u32; n + 1];
    let mut kept = Vec::new();
    for c in 0..n {
        if cnt[c] >= min_cells {
            kept.push(c);
            remap[c + 1] = kept.len() as u32;
        }
    }
    for l in lab.iter_mut() {
        *l = remap[*l as usize];
    }
    let nb = kept.len();
    let at = |p: P| -> u32 {
        if let Some((i, j)) = g.cell_of(p[0], p[1]) {
            let l = lab[g.idx(i, j)];
            if l > 0 {
                return l;
            }
            // Nearest labelled cell within 3 cells (buildings touching a road buffer).
            for r in 1..=3i64 {
                for dj in -r..=r {
                    for di in -r..=r {
                        let (a, b) = (i as i64 + di, j as i64 + dj);
                        if a >= 0 && b >= 0 && (a as usize) < g.nx && (b as usize) < g.nz {
                            let l = lab[g.idx(a as usize, b as usize)];
                            if l > 0 {
                                return l;
                            }
                        }
                    }
                }
            }
        }
        0
    };

    #[derive(Default, Clone)]
    struct S {
        nb: usize,
        foot: f64,
        floor_area: f64,
        by_type: HashMap<&'static str, usize>,
        trees: usize,
        lc: [usize; 6],
        roads: HashMap<String, f64>,
        roads_inside: f64,
        water: HashMap<String, f64>,
        names: Vec<String>,
    }
    let mut st = vec![S::default(); nb + 1];
    for b in blds.iter_mut() {
        let l = at(b.c);
        b.block = l;
        let s = &mut st[l as usize];
        s.nb += 1;
        s.foot += b.area;
        s.floor_area += b.area * ((b.h - 0.6) / 3.2).round().max(1.0);
        *s.by_type.entry(b.ty).or_insert(0) += 1;
    }
    for t in tree_xyz.chunks(3) {
        let l = at([t[0], t[1]]);
        st[l as usize].trees += 1;
    }
    let (g10, lcv) = (&lc.0, &lc.1);
    for j in 0..g10.nz {
        for i in 0..g10.nx {
            let c = g10.center(i, j);
            if let Some((a, b)) = g.cell_of(c[0], c[1]) {
                let l = lab[g.idx(a, b)];
                if l > 0 {
                    st[l as usize].lc[lcv[g10.idx(i, j)] as usize] += 1;
                }
            }
        }
    }
    // Roads and waterways: a segment inside a block counts as internal; otherwise it borders
    // the blocks on both sides.
    let credit = |pts: &[P], half: f64, mut f: Box<dyn FnMut(u32, f64, bool) + '_>| {
        for s in pts.windows(2) {
            let len = raster::dist(s[0], s[1]);
            let pieces = (len / 20.0).ceil().max(1.0) as usize;
            for q in 0..pieces {
                let t0 = (q as f64 + 0.5) / pieces as f64;
                let m = [s[0][0] + (s[1][0] - s[0][0]) * t0, s[0][1] + (s[1][1] - s[0][1]) * t0];
                let (dx, dz) = ((s[1][0] - s[0][0]) / len.max(1e-9), (s[1][1] - s[0][1]) / len.max(1e-9));
                let l_here = g.cell_of(m[0], m[1]).map(|(i, j)| lab[g.idx(i, j)]).unwrap_or(0);
                let piece = len / pieces as f64;
                if l_here > 0 {
                    f(l_here, piece, true);
                } else {
                    let o = half + 4.0;
                    let a = g.cell_of(m[0] - dz * o, m[1] + dx * o).map(|(i, j)| lab[g.idx(i, j)]).unwrap_or(0);
                    let b = g.cell_of(m[0] + dz * o, m[1] - dx * o).map(|(i, j)| lab[g.idx(i, j)]).unwrap_or(0);
                    if a > 0 {
                        f(a, piece, false);
                    }
                    if b > 0 && b != a {
                        f(b, piece, false);
                    }
                }
            }
        }
    };
    for r in rs {
        let class = r.class.clone();
        credit(&r.pts, r.w / 2.0 + 1.5, Box::new(|l, len, inside| {
            let s = &mut st[l as usize];
            *s.roads.entry(class.clone()).or_insert(0.0) += len;
            if inside {
                s.roads_inside += len;
            }
        }));
    }
    for w in wl {
        let key = if w.src == "modelled" { "modelled_drainage".to_string() } else { w.k.clone() };
        credit(&w.pts, w.w / 2.0 + 1.0, Box::new(|l, len, _| {
            *st[l as usize].water.entry(key.clone()).or_insert(0.0) += len;
        }));
    }
    for (n, rings) in names {
        let c = raster::ring_centroid(&rings[0]);
        let l = at(c);
        if l > 0 && !st[l as usize].names.contains(n) {
            st[l as usize].names.push(n.clone());
        }
    }
    let mut out = Vec::new();
    for (bi, &c) in kept.iter().enumerate() {
        let l = bi as u32 + 1;
        let s = &st[l as usize];
        let ring = raster::simplify_ring(&raster::trace_outline(&g, &lab, l, bb[c]), 4.0);
        if ring.len() < 4 {
            continue;
        }
        let area = cnt[c] as f64 * g.cell * g.cell;
        let lc_tot: usize = s.lc.iter().sum::<usize>().max(1);
        let share = |i: usize| s.lc[i] as f64 / lc_tot as f64;
        let top = s.by_type.iter().max_by_key(|(_, v)| **v).map(|(k, v)| (*k, *v));
        let use_ = if s.names.iter().any(|n| { let n = n.to_lowercase(); n.contains("airport") || n.contains("aerodrome") }) {
            "Airport"
        } else if s.nb >= 3 && top.map_or(false, |(k, v)| (k == "residential" || k == "house") && v * 2 >= s.nb) {
            "Housing"
        } else if s.nb >= 2 && top.map_or(false, |(k, _)| ["academic", "admin", "institutional", "school", "health"].contains(&k)) {
            "Academic / institutional"
        } else if s.nb >= 2 && top.map_or(false, |(k, _)| k == "hostel") {
            "Hostels"
        } else if share(3) > 0.4 {
            "Water"
        } else if share(2) > 0.5 {
            "Wooded"
        } else if share(4) + share(5) > 0.6 && s.foot < area * 0.03 {
            "Fields / farm"
        } else if s.nb >= 3 {
            "Mixed built-up"
        } else {
            "Open land"
        };
        let mut cpt = raster::ring_centroid(&ring);
        if !raster::point_in_ring(cpt, &ring) {
            cpt = ring[0];
        }
        let roads: serde_json::Map<String, Value> = s.roads.iter().map(|(k, v)| (k.clone(), json!(r1(v / 1000.0)))).collect();
        let water: serde_json::Map<String, Value> = s.water.iter().map(|(k, v)| (k.clone(), json!(r1(v / 1000.0)))).collect();
        let by_type: serde_json::Map<String, Value> = s.by_type.iter().map(|(k, v)| (k.to_string(), json!(v))).collect();
        out.push(json!({
            "id": l, "use": use_, "n": s.names.first(), "names": s.names,
            "a": area.round(), "c": [r1(cpt[0]), r1(cpt[1])], "r": flat(&ring),
            "s": {
                "buildings": s.nb, "footprint_m2": s.foot.round(), "floor_area_m2": s.floor_area.round(),
                "by_type": by_type, "trees": s.trees,
                "cover": {"built": r1(100.0 * share(1)), "trees": r1(100.0 * share(2)), "water": r1(100.0 * share(3)),
                          "crops_grass": r1(100.0 * share(4)), "bare": r1(100.0 * share(5))},
                "roads_km": roads, "roads_inside_km": r1(s.roads_inside / 1000.0), "water_km": water,
            }
        }));
    }
    println!("  blocks: {} (from {} raw areas)", out.len(), n);
    BlockOut { json: out, label: (g, lab) }
}

// ---------------------------------------------------------------------------------------------

fn data_uri(mime: &str, bytes: &[u8]) -> String {
    use base64::Engine;
    format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

pub fn run() -> Res<()> {
    let aoi = Aoi::load()?;
    let o = osm::load(&root().join("data/campus/osm.json"))?;
    println!("  OSM: {} nodes, {} ways, {} multipolygons", o.nodes.len(), o.ways.len(), o.rels.len());
    let r = load_rasters()?;

    let lc = land_cover(&r);
    let tz = terrain(&r);
    let base = tz.1.iter().cloned().fold(f32::MAX, f32::min).floor() as f64;
    for (n, lon, lat, aai) in [
        ("AAI THR 10", 79.0 + 27.0 / 60.0 + 55.69 / 3600.0, 29.0 + 2.0 / 60.0 + 3.82 / 3600.0, 234.4),
        ("AAI THR 28", 79.0 + 28.0 / 60.0 + 45.85 / 3600.0, 29.0 + 1.0 / 60.0 + 57.27 / 3600.0, 235.3),
        ("AAI ARP", 79.0 + 28.0 / 60.0 + 20.89 / 3600.0, 29.0 + 1.0 / 60.0 + 55.73 / 3600.0, 232.9),
    ] {
        println!("  terrain check {n}: surveyed {aai:.1} m, model {:.1} m", terrain_at(&tz.0, &tz.1, geo::proj(lon, lat)));
    }

    // Places: OSM named nodes + Overture places (lon/lat) for labels and classification.
    let mut pois: Vec<(String, String, P)> = Vec::new();
    for n in &o.nodes {
        if let Some(nm) = osm::name(&n.tags) {
            let k = ["amenity", "shop", "office", "leisure", "tourism", "place", "man_made", "building", "historic"]
                .iter()
                .find_map(|k| n.tags.get(*k).map(|v| v.clone()))
                .unwrap_or_else(|| "place".into());
            pois.push((nm, k, n.p));
        }
    }
    let pv = root().join("data/raw/overture_places.json");
    if pv.exists() {
        let j: Value = serde_json::from_str(&std::fs::read_to_string(pv)?)?;
        for p in j["places"].as_array().into_iter().flatten() {
            if let (Some(n), Some(lon), Some(lat)) = (p["name"].as_str(), p["lon"].as_f64(), p["lat"].as_f64()) {
                let pt = geo::proj(lon, lat);
                if !pois.iter().any(|(m, _, q)| same_name(m, n) && raster::dist(*q, pt) < 200.0) {
                    pois.push((n.into(), p["category"].as_str().unwrap_or("place").into(), pt));
                }
            }
        }
    }
    let [bx0, bz0, bx1, bz1] = aoi.local;
    pois.retain(|(_, _, p)| p[0] >= bx0 && p[0] <= bx1 && p[1] >= bz0 && p[1] <= bz1);

    // Land use / named areas from OSM.
    let mut landuse: Vec<(Tags, Vec<Vec<P>>)> = Vec::new();
    for w in &o.ways {
        if w.closed() && !w.tags.contains_key("building") && ["landuse", "amenity", "leisure", "natural", "aeroway", "place"].iter().any(|k| w.tags.contains_key(*k)) {
            landuse.push((w.tags.clone(), vec![w.pts.clone()]));
        }
    }
    for rel in &o.rels {
        if !rel.tags.contains_key("building") {
            for outer in &rel.outers {
                landuse.push((rel.tags.clone(), vec![outer.clone()]));
            }
        }
    }

    let (mut blds, bstats) = buildings(&aoi, &o, &r, &pois, &landuse)?;
    let rs = roads(&o, &aoi);
    let (gnodes, gedges) = road_graph(&rs);
    println!("  roads: {} ways, {:.1} km; street-view graph {} nodes / {} edges", rs.len(), rs.iter().map(|r| line_len(&r.pts)).sum::<f64>() / 1000.0, gnodes.len() / 2, gedges.len());
    let (wareas, wlines, wstats) = water(&o, &aoi, &r, &tz);
    let tr = trees(&r, &blds);
    println!("  trees: {}", tr.len() / 3);
    let mut named: Vec<(String, Vec<Vec<P>>)> = landuse.iter().filter_map(|(t, rings)| osm::name(t).map(|n| (n, rings.clone()))).collect();
    // Blocks take names from named areas, then from named OSM landmark buildings (not shops or
    // agents from place listings, and not road names).
    for b in &blds {
        if let Some(n) = &b.name {
            let landmark = ["academic", "hostel", "admin", "health", "school", "religious", "sports", "institutional"].contains(&b.ty);
            if b.src == 0 && landmark && building_like_place(n, "") {
                named.push((n.clone(), b.rings.clone()));
            }
        }
    }
    let bo = blocks(&aoi, &rs, &wlines, &o, &mut blds, &tr, &lc, &named);
    let _ = &bo.label;

    // Summary counts for the campus villages.
    let in_campus = |p: P| aoi.contains(p);
    let mut by_type: HashMap<&str, usize> = HashMap::new();
    for b in blds.iter().filter(|b| in_campus(b.c)) {
        *by_type.entry(b.ty).or_insert(0) += 1;
    }
    let mut road_km: HashMap<String, f64> = HashMap::new();
    for r in &rs {
        let l: f64 = r.pts.windows(2).filter(|s| in_campus([(s[0][0] + s[1][0]) / 2.0, (s[0][1] + s[1][1]) / 2.0])).map(|s| raster::dist(s[0], s[1])).sum();
        *road_km.entry(r.class.clone()).or_insert(0.0) += l / 1000.0;
    }
    let mut water_km: HashMap<String, f64> = HashMap::new();
    for w in &wlines {
        let l: f64 = w.pts.windows(2).filter(|s| in_campus([(s[0][0] + s[1][0]) / 2.0, (s[0][1] + s[1][1]) / 2.0])).map(|s| raster::dist(s[0], s[1])).sum();
        let k = if w.src == "modelled" { "modelled_drainage".into() } else { w.k.clone() };
        *water_km.entry(k).or_insert(0.0) += l / 1000.0;
    }
    println!("  campus buildings by type: {:?}", by_type);

    // ---- write ----------------------------------------------------------------------------
    let tg = tz.0;
    let terr: Vec<i64> = tz.1.iter().map(|v| ((*v as f64 - base) * 10.0).round() as i64).collect();
    let bj: Vec<Value> = blds
        .iter()
        .map(|b| {
            json!({
                "id": b.id, "n": b.name, "t": b.ty, "ts": b.ts, "src": b.src, "h": r1(b.h), "hs": b.hs,
                "f": ((b.h - 0.6) / 3.2).round().max(1.0), "a": b.area.round(), "roof": b.roof, "b": b.block,
                "tag": if b.btag.is_empty() || b.btag == "yes" { Value::Null } else { json!(b.btag) },
                "r": b.rings.iter().map(|r| flat(r)).collect::<Vec<_>>(),
            })
        })
        .collect();
    let rj: Vec<Value> = rs
        .iter()
        .map(|r| json!({"c": r.class, "w": r1(r.w), "n": r.name, "br": r.bridge, "s": r.surface, "p": flat(&r.pts)}))
        .collect();
    let mut misc_lines = Vec::new();
    for w in &o.ways {
        let k = if ["wall", "fence", "retaining_wall", "hedge"].contains(&w.tag("barrier")) {
            format!("barrier:{}", w.tag("barrier"))
        } else if !w.tag("railway").is_empty() {
            format!("rail:{}", w.tag("railway"))
        } else if w.tag("power") == "line" || w.tag("power") == "minor_line" {
            "power".into()
        } else if ["runway", "taxiway"].contains(&w.tag("aeroway")) && !w.closed() {
            format!("aeroway:{}", w.tag("aeroway"))
        } else {
            continue;
        };
        misc_lines.push(json!({"k": k, "w": osm::metres(w.tag("width")), "p": flat(&w.pts)}));
    }
    let areas_j: Vec<Value> = landuse
        .iter()
        .filter_map(|(t, rings)| {
            let k = ["aeroway", "leisure", "landuse", "amenity", "natural"].iter().find_map(|k| t.get(*k).map(|v| format!("{k}:{v}")))?;
            Some(json!({"k": k, "n": osm::name(t), "r": rings.iter().map(|r| flat(r)).collect::<Vec<_>>()}))
        })
        .collect();
    let water_j = json!({
        "areas": wareas.iter().map(|(k, rings, src, n)| json!({"k": k, "src": src, "n": n, "r": rings.iter().map(|r| flat(r)).collect::<Vec<_>>()})).collect::<Vec<_>>(),
        "lines": wlines.iter().map(|w| json!({"k": w.k, "w": w.w, "src": w.src, "n": w.name, "p": flat(&w.pts)})).collect::<Vec<_>>(),
    });
    let villages: Vec<Value> = aoi
        .villages
        .iter()
        .map(|v| json!({"n": v.name, "code": v.census2011_code, "campus": crate::aoi::VILLAGES.contains(&v.name.as_str()),
                        "r": v.rings.iter().map(|r| flat(&r.iter().map(|p| geo::proj(p[0], p[1])).collect::<Vec<_>>())).collect::<Vec<_>>()}))
        .collect();
    let pois_j: Vec<Value> = pois.iter().map(|(n, k, p)| json!({"n": n, "k": k, "x": r1(p[0]), "z": r1(p[1])})).collect();
    let types_j: Vec<Value> = TYPES.iter().map(|(k, l)| json!([k, l])).collect();
    let km = |m: &HashMap<String, f64>| -> Value { m.iter().map(|(k, v)| (k.clone(), json!(r1(*v)))).collect::<serde_json::Map<_, _>>().into() };

    let data = json!({
        "meta": {
            "name": "GBPUAT Pantnagar campus - detailed digital twin",
            "origin": {"lat": geo::LAT0, "lon": geo::LON0},
            "bounds": aoi.local.iter().map(|v| r1(*v)).collect::<Vec<_>>(),
            "bbox": [aoi.bbox.west, aoi.bbox.south, aoi.bbox.east, aoi.bbox.north],
            "campus_villages": crate::aoi::VILLAGES,
            "generated_by": "twin (Rust) build",
            "types": types_j,
            "lc_names": LC_NAMES,
            "sources": [
                {"layer": "Campus area", "name": "Census 2011 village boundaries via Uttarakhand State GIS Portal (Bharat Maps, NIC)"},
                {"layer": "Buildings, roads, water, land use, places", "name": "OpenStreetMap contributors", "licence": "ODbL"},
                {"layer": "Building footprints", "name": "Overture Maps (Google Open Buildings, Microsoft ML Buildings)", "licence": "ODbL / CDLA-Permissive-2.0"},
                {"layer": "Building heights, extra buildings", "name": "Google Open Buildings 2.5D Temporal 2023", "licence": "CC BY 4.0"},
                {"layer": "Image, water, greenness", "name": format!("Copernicus Sentinel-2 L2A {}", crate::fetch::S2_SCENE), "licence": "Copernicus open"},
                {"layer": "Trees", "name": "Meta + WRI canopy height", "licence": "CC BY 4.0"},
                {"layer": "Terrain, modelled drainage", "name": "Copernicus DEM GLO-30", "licence": "Copernicus open"},
            ],
            "counts": {
                "buildings": bstats, "buildings_in_campus_by_type": by_type,
                "roads_in_campus_km": km(&road_km), "water_in_campus_km": km(&water_km),
                "water": wstats, "trees": tr.len() / 3, "blocks": bo.json.len(),
                "graph_nodes": gnodes.len() / 2, "graph_edges": gedges.len(),
            },
        },
        "terrain": {"x0": r1(tg.x0), "z0": r1(tg.z0), "cell": tg.cell, "nx": tg.nx, "nz": tg.nz, "base": base, "h": terr},
        "villages": villages,
        "buildings": bj,
        "roads": rj,
        "graph": {"nodes": gnodes, "edges": gedges},
        "water": water_j,
        "lines": misc_lines,
        "areas": areas_j,
        "blocks": bo.json,
        "trees": tr,
        "pois": pois_j,
    });
    let outdir = root().join("campus/data");
    std::fs::create_dir_all(&outdir)?;
    let js = format!("/* Generated by `twin build` (Rust). Do not edit by hand. */\nwindow.CAMPUS = {};\n", serde_json::to_string(&data)?);
    std::fs::write(outdir.join("campus-data.js"), &js)?;
    println!("  wrote campus/data/campus-data.js ({:.0} KB)", js.len() as f64 / 1024.0);

    // Imagery: Sentinel-2 JPEG and the land-cover PNG, as data URIs (works from file://).
    let sat = std::fs::read(cache("s2rgb.jpg"))?;
    let sat_meta: Value = serde_json::from_str(&std::fs::read_to_string(cache("s2rgb.json"))?)?;
    let mut lc_rgb = Vec::with_capacity(lc.1.len() * 3);
    for v in &lc.1 {
        lc_rgb.extend_from_slice(&LC_RGB[*v as usize]);
    }
    let lc_png = crate::png::encode(lc.0.nx, lc.0.nz, 3, &lc_rgb);
    let img = json!({
        "sat": data_uri("image/jpeg", &sat), "satGrid": sat_meta["grid"],
        "lc": data_uri("image/png", &lc_png), "lcGrid": lc.0, "lcColors": LC_RGB,
    });
    let js = format!("/* Generated by `twin build` (Rust). */\nwindow.CAMPUS_IMG = {};\n", serde_json::to_string(&img)?);
    std::fs::write(outdir.join("campus-imagery.js"), &js)?;
    println!("  wrote campus/data/campus-imagery.js ({:.0} KB)", js.len() as f64 / 1024.0);
    Ok(())
}

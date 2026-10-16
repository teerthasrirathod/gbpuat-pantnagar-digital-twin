//! Pantnagar Sandbox simulation engine. The same code runs natively (`twin sim`) and in the
//! browser (compiled to WebAssembly by the `sim-wasm` crate).

pub mod catalog;
pub mod engine;
pub mod geo;
pub mod graph;
pub mod plan;
pub mod world;

pub use catalog::catalog;
pub use engine::{evaluate, lux_grid, prepare, route, suggest_wifi, wifi_grid, Ctx};
pub use plan::{parse, Scenario};
pub use world::World;

#[cfg(test)]
mod tests {
    #[test]
    fn timing() {
        let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../campus/data/campus-data.js")).unwrap();
        let t = std::time::Instant::now();
        let w = crate::World::load(&text).unwrap();
        println!("load {:?}", t.elapsed());
        let sc = crate::parse(r#"{"type":"FeatureCollection","features":[]}"#, &w.frame).unwrap();
        let t = std::time::Instant::now();
        let ctx = crate::prepare(&w, sc);
        println!("prepare {:?}", t.elapsed());
        let t = std::time::Instant::now();
        let r = crate::evaluate(&w, &ctx);
        println!("evaluate {:?} {}", t.elapsed(), r["warnings"]);
    }
}

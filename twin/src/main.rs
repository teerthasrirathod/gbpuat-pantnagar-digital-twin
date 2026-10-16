//! twin - the GBPUAT Pantnagar digital-twin pipeline.
//!
//!   twin fetch <dem|heights|canopy|s2|osm|all>   download the campus window
//!   twin build                                            analyse and pack campus/data/*.js
//!   twin bundle                                           single-file HTML for sharing
//!   twin serve [port]                                     static server for development
//!   twin sim-pack                                         build the planning engine for the browser
//!   twin sim <scenario.geojson> [--json]                  evaluate a planning scenario

mod aoi;
mod build;
mod bundle;
mod cog;
mod fetch;
mod geo;
mod http;
mod osm;
mod png;
mod raster;
mod serve;
mod simcli;

use http::Res;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let t = Instant::now();
    let r = run(&args);
    match r {
        // `sim` output is Markdown meant for reports, so it carries no timing line.
        Ok(()) if args.first().map(|a| a.as_str()) == Some("sim") => {}
        Ok(()) => println!("done in {:.1} s", t.elapsed().as_secs_f64()),
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(1);
        }
    }
}

fn run(args: &[String]) -> Res<()> {
    let a: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    match a.as_slice() {
        ["fetch", what] => {
            let aoi = aoi::Aoi::load()?;
            let b = aoi.bbox;
            println!(
                "campus window {:.4},{:.4} to {:.4},{:.4} ({:.1} x {:.1} km)",
                b.west,
                b.south,
                b.east,
                b.north,
                (aoi.local[2] - aoi.local[0]) / 1000.0,
                (aoi.local[3] - aoi.local[1]) / 1000.0
            );
            let all = *what == "all";
            if all || *what == "osm" {
                fetch::osm(&aoi)?;
            }
            if all || *what == "dem" {
                fetch::dem(&aoi)?;
            }
            if all || *what == "s2" {
                fetch::s2(&aoi)?;
            }
            if all || *what == "canopy" {
                fetch::canopy(&aoi)?;
            }
            if all || *what == "heights" {
                fetch::heights(&aoi, 2023)?;
            }
            Ok(())
        }
        ["info", url] => {
            println!("{}", cog::Cog::open(url)?.describe()?);
            Ok(())
        }
        ["build"] => build::run(),
        ["bundle"] => bundle::run(),
        ["sim-pack"] => simcli::pack(),
        ["sim", file] => simcli::run(file, false),
        ["sim", file, "--json"] => simcli::run(file, true),
        ["serve"] => serve::run(8080),
        ["serve", port] => serve::run(port.parse()?),
        _ => {
            println!("usage: twin fetch <dem|heights|canopy|s2|osm|all> | build | bundle | serve [port] | sim-pack | sim <scenario.geojson> [--json]");
            Ok(())
        }
    }
}

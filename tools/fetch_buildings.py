"""Fetch building footprints for the study window from Overture Maps (buildings theme).

Overture merges OpenStreetMap, Microsoft ML Building Footprints, Google Open Buildings and Esri
Community Maps, so it fills many buildings that are not mapped in OSM. Footprints from the ML
sources are detected from satellite imagery; heights are only present for some of them.

Output: data/raw/overture_buildings.json  (list of {id, source, name, height, floors, cls, geom})

Usage (needs: duckdb):
    python tools/fetch_buildings.py                 # uses the latest release
    python tools/fetch_buildings.py --release 2026-09-23.1

Licence: Overture buildings are ODbL (OSM-derived) / CDLA-Permissive-2.0 (Microsoft, Google) -
attribute "Overture Maps Foundation" and its sources.
"""

import argparse
import json
import urllib.request
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
R = json.loads((ROOT / "tools" / "region.json").read_text())["region"]


def latest_release():
    with urllib.request.urlopen("https://stac.overturemaps.org/catalog.json", timeout=30) as r:
        return json.load(r)["latest"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--release")
    ap.add_argument("--out", default=str(ROOT / "data" / "raw" / "overture_buildings.json"))
    args = ap.parse_args()
    release = args.release or latest_release()
    print("Overture release:", release)

    con = duckdb.connect()
    con.execute("INSTALL spatial; INSTALL httpfs; LOAD spatial; LOAD httpfs;")
    con.execute("SET s3_region='us-west-2';")
    path = f"s3://overturemaps-us-west-2/release/{release}/theme=buildings/type=building/*"
    cols = [c[0] for c in con.execute(f"DESCRIBE SELECT * FROM read_parquet('{path}', hive_partitioning=1)").fetchall()]
    print("columns:", cols)

    where = (
        f"bbox.xmin < {R['east']} AND bbox.xmax > {R['west']} "
        f"AND bbox.ymin < {R['north']} AND bbox.ymax > {R['south']}"
    )
    optional = lambda c, alias: (f"{c} AS {alias}" if c in cols else f"NULL AS {alias}")
    sql = f"""
        SELECT id,
               sources[1].dataset AS source,
               names.primary AS name,
               {optional('height', 'height')},
               {optional('num_floors', 'floors')},
               {optional('class', 'cls')},
               {optional('subtype', 'subtype')},
               ST_AsGeoJSON(geometry) AS geom
        FROM read_parquet('{path}', hive_partitioning=1)
        WHERE {where}
    """
    rows = con.execute(sql).fetchall()
    keys = ["id", "source", "name", "height", "floors", "cls", "subtype", "geom"]
    out = []
    for row in rows:
        d = dict(zip(keys, row))
        d["geom"] = json.loads(d["geom"])
        out.append(d)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps({"release": release, "buildings": out}))
    by_source = {}
    for d in out:
        by_source[d["source"]] = by_source.get(d["source"], 0) + 1
    with_h = sum(1 for d in out if d["height"])
    with_f = sum(1 for d in out if d["floors"])
    print("buildings:", len(out), "by source:", by_source, "| with height:", with_h, "| with floors:", with_f)
    print("wrote", args.out, "%.0f KB" % (Path(args.out).stat().st_size / 1024))


if __name__ == "__main__":
    main()

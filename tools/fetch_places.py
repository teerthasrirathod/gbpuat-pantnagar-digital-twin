"""Fetch points of interest for the study window from Overture Maps (places theme).

Overture places merge Meta, Microsoft and other open sources (names, categories, websites).
Only places with confidence >= MIN_CONFIDENCE are kept.

Output: data/raw/overture_places.json  (list of {id, name, category, confidence, lon, lat, website})

Usage (needs: duckdb):  python tools/fetch_places.py [--release 2026-09-23.1]
Licence: CDLA-Permissive-2.0 - attribute "Overture Maps Foundation".
"""

import argparse
import json
import urllib.request
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
R = json.loads((ROOT / "tools" / "region.json").read_text())["region"]
MIN_CONFIDENCE = 0.5


def latest_release():
    with urllib.request.urlopen("https://stac.overturemaps.org/catalog.json", timeout=30) as r:
        return json.load(r)["latest"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--release")
    args = ap.parse_args()
    release = args.release or latest_release()
    print("Overture release:", release)

    con = duckdb.connect()
    con.execute("INSTALL spatial; INSTALL httpfs; LOAD spatial; LOAD httpfs; SET s3_region='us-west-2';")
    path = f"s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*"
    rows = con.execute(f"""
        SELECT id, names.primary AS name, COALESCE(taxonomy.primary, basic_category) AS category, confidence,
               ST_X(geometry) AS lon, ST_Y(geometry) AS lat,
               CASE WHEN websites IS NOT NULL AND len(websites) > 0 THEN websites[1] END AS website
        FROM read_parquet('{path}', hive_partitioning=1)
        WHERE bbox.xmin BETWEEN {R['west']} AND {R['east']}
          AND bbox.ymin BETWEEN {R['south']} AND {R['north']}
          AND confidence >= {MIN_CONFIDENCE}
    """).fetchall()
    keys = ["id", "name", "category", "confidence", "lon", "lat", "website"]
    places = [dict(zip(keys, r)) for r in rows if r[1]]
    cats = {}
    for p in places:
        cats[p["category"]] = cats.get(p["category"], 0) + 1
    print("places:", len(places), "| top categories:", sorted(cats.items(), key=lambda kv: -kv[1])[:15])
    out = ROOT / "data" / "raw" / "overture_places.json"
    out.write_text(json.dumps({"release": release, "places": places}))
    print("wrote", out, "%.0f KB" % (out.stat().st_size / 1024))


if __name__ == "__main__":
    main()

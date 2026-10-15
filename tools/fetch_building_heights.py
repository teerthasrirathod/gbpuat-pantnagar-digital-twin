"""Fetch measured building heights for the study window (Google Open Buildings 2.5D Temporal).

Source: Google Open Buildings 2.5D Temporal Dataset v1 (2023 layer), public GeoTIFFs in
gs://open-buildings-temporal-data (no account or credits needed). Bands: building_fractional_count,
building_height (metres above ground, mean absolute error ~1.5 m), building_presence (0-1).
Tiles are 12.5 km UTM squares at 0.5 m with overviews; we read the ~4 m effective resolution.

Output: data/raw/building_heights.json
        {bbox, width, height, cell_m, data: base64(zlib(uint8 height in 0.5 m units, 0 = no building))}
        north-up, row-major, over the study window in lon/lat (same frame as the other rasters)

Usage (needs: rasterio numpy):  python tools/fetch_building_heights.py [--year 2023]
Licence: CC BY 4.0 or ODbL v1.0 (user's choice) - "Google Open Buildings 2.5D Temporal".
"""

import argparse
import base64
import json
import math
import urllib.request
import zlib
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.vrt import WarpedVRT
from rasterio.warp import transform as warp_transform

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "tools" / "region.json").read_text())
R, O = CFG["region"], CFG["origin"]
BUCKET = "https://storage.googleapis.com/open-buildings-temporal-data"
CELL_M = 4.0           # effective resolution of the product
PRESENCE_MIN = 0.5     # pixels below this building presence are treated as "no building"


def utm_epsg(lon, lat):
    return (32600 if lat >= 0 else 32700) + int((lon + 180) // 6) + 1


def list_manifests(epsg, year):
    names, tok = [], None
    while True:
        q = f"{BUCKET.replace('storage.googleapis.com/', 'storage.googleapis.com/storage/v1/b/')}/o?prefix=v1/manifests/&maxResults=1000&fields=items(name),nextPageToken"
        if tok:
            q += "&pageToken=" + tok
        j = json.load(urllib.request.urlopen(q, timeout=60))
        names += [i["name"] for i in j.get("items", [])]
        tok = j.get("nextPageToken")
        if not tok:
            break
    return [n for n in names if f"EPSG_{epsg}_{year}_06_30" in n]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=2023)
    ap.add_argument("--out", help="output path (default data/raw/building_heights.json, or _<year> for other years)")
    args = ap.parse_args()

    epsg = utm_epsg((R["west"] + R["east"]) / 2, (R["south"] + R["north"]) / 2)
    xs, ys = warp_transform("EPSG:4326", f"EPSG:{epsg}",
                            [R["west"], R["east"], R["west"], R["east"]],
                            [R["south"], R["south"], R["north"], R["north"]])
    bx0, bx1, by0, by1 = min(xs), max(xs), min(ys), max(ys)

    tiles = []
    for m in list_manifests(epsg, args.year):
        man = json.loads(urllib.request.urlopen(f"{BUCKET}/{m}", timeout=120).read())
        prefix = man["uriPrefix"].replace("gs://open-buildings-temporal-data", BUCKET)
        for ts in man["tilesets"]:
            for src in ts["sources"]:
                a, d = src["affineTransform"], src["dimensions"]
                x0, y1 = a["translateX"], a["translateY"]
                x1, y0 = x0 + d["width"] * a["scaleX"], y1 + d["height"] * a["scaleY"]
                if x1 > bx0 and x0 < bx1 and y1 > by0 and y0 < by1:
                    tiles.append(prefix + src["uris"][0])
    tiles = sorted(set(tiles))
    print(f"EPSG:{epsg} {args.year}: {len(tiles)} tiles intersect the window")

    mw = (R["east"] - R["west"]) * 111320 * math.cos(math.radians(O["lat"]))
    mh = (R["north"] - R["south"]) * 110540
    W, H = round(mw / CELL_M), round(mh / CELL_M)
    t = from_bounds(R["west"], R["south"], R["east"], R["north"], W, H)
    height = np.zeros((H, W), dtype=np.float32)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
                      GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="2"):
        for url in tiles:
            # Open the overview level closest to CELL_M (e.g. factor 8 = 4 m) so only coarse data is read.
            with rasterio.open(url) as probe:
                factors = probe.overviews(1)
                want = CELL_M / probe.res[0]
            level = min(range(len(factors)), key=lambda i: abs(factors[i] - want)) if factors else None
            with rasterio.open(url, overview_level=level) as src:
                with WarpedVRT(src, crs="EPSG:4326", transform=t, width=W, height=H,
                               resampling=Resampling.bilinear, src_nodata=-99, nodata=-99) as vrt:
                    h, p = vrt.read([2, 3])
            ok = (p >= PRESENCE_MIN) & (h > 0)
            height = np.where(ok, np.maximum(height, h), height)
            print("  read", url.rsplit("/", 2)[-2:], "| building pixels so far:", int((height > 0).sum()))

    q = np.clip(np.round(height * 2), 0, 255).astype(np.uint8)  # 0.5 m units
    built = q > 0
    print("window %dx%d px at %.0f m | building cover %.2f %% | height median %.1f m, p95 %.1f m, max %.1f m"
          % (W, H, CELL_M, 100 * built.mean(), np.median(height[built]), np.percentile(height[built], 95), height.max()))
    default_name = "building_heights.json" if args.year == 2023 else f"building_heights_{args.year}.json"
    out = Path(args.out) if args.out else ROOT / "data" / "raw" / default_name
    out.write_text(json.dumps({
        "source": f"Google Open Buildings 2.5D Temporal v1, {args.year} (CC BY 4.0 / ODbL)",
        "bbox": [R["west"], R["south"], R["east"], R["north"]],
        "width": W, "height": H, "cell_m": CELL_M, "units": "0.5 m",
        "data": base64.b64encode(zlib.compress(q.tobytes(), 9)).decode(),
    }))
    print("wrote", out, "%.0f KB" % (out.stat().st_size / 1024))


if __name__ == "__main__":
    main()

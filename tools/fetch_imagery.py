"""Fetch a Sentinel-2 true-colour image of the study window and save it as a ground texture.

Source: Copernicus Sentinel-2 L2A cloud-optimised GeoTIFFs on AWS (Earth Search STAC,
https://earth-search.aws.element84.com/v1). Only the study window is read, via HTTP range
requests, so nothing close to the full 330 MB tile is downloaded.

The output is in plain lon/lat (EPSG:4326) over the study window, which maps linearly onto
the viewer's local metre frame, so UV = (x - x0) / width, (z - z0) / depth.

Usage (needs: rasterio numpy pillow):
    python tools/fetch_imagery.py                      # picks the clearest recent scene
    python tools/fetch_imagery.py --scene S2C_44RLT_20251211_0_L2A
    python tools/fetch_imagery.py --list               # list candidate scenes

Imagery: contains modified Copernicus Sentinel data (free, full and open; attribution required).
"""

import argparse
import base64
import json
import math
import sys
import urllib.request
import zlib
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image, ImageEnhance, ImageFilter
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.vrt import WarpedVRT

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "tools" / "region.json").read_text())
R = CFG["region"]
O = CFG["origin"]
STAC = "https://earth-search.aws.element84.com/v1/search"


def stac_search(limit=12, max_cloud=3, datetime="2025-10-01T00:00:00Z/2026-10-14T00:00:00Z"):
    body = {
        "collections": ["sentinel-2-l2a"],
        "bbox": [R["west"], R["south"], R["east"], R["north"]],
        "datetime": datetime,
        "query": {"eo:cloud_cover": {"lt": max_cloud}},
        "sortby": [{"field": "properties.eo:cloud_cover", "direction": "asc"}],
        "limit": limit,
    }
    req = urllib.request.Request(
        STAC, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["features"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scene", help="Earth Search item id, e.g. S2C_44RLT_20251211_0_L2A")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--width", type=int, default=2340, help="output width in pixels (10 m native = 1170)")
    ap.add_argument("--out", default=str(ROOT / "data" / "imagery" / "satellite.jpg"))
    args = ap.parse_args()

    feats = stac_search()
    if args.list:
        for f in feats:
            print(f["id"], f["properties"]["datetime"][:10], "cloud %.4f" % f["properties"]["eo:cloud_cover"])
        return
    item = next((f for f in feats if f["id"] == args.scene), None) if args.scene else feats[0]
    if item is None:
        sys.exit("scene not found among candidates; use --list")
    href = item["assets"]["visual"]["href"]
    print("scene:", item["id"], item["properties"]["datetime"][:10], "cloud", item["properties"]["eo:cloud_cover"])

    # Output grid: width x height pixels over the study window, in lon/lat.
    metres_w = (R["east"] - R["west"]) * 111320 * math.cos(math.radians(O["lat"]))
    metres_h = (R["north"] - R["south"]) * 110540
    width = args.width
    height = round(width * metres_h / metres_w)
    # Read at the native 10 m, then upsample with Lanczos (sharper than resampling in the warp).
    native_w = round(metres_w / 10)
    native_h = round(metres_h / 10)
    dst_transform = from_bounds(R["west"], R["south"], R["east"], R["north"], native_w, native_h)

    env = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif")
    with rasterio.Env(**env):
        with rasterio.open(href) as src:
            print("source:", src.crs, src.width, "x", src.height, "px, res", src.res)
            with WarpedVRT(
                src, crs="EPSG:4326", transform=dst_transform, width=native_w, height=native_h,
                resampling=Resampling.cubic,
            ) as vrt:
                rgb = vrt.read([1, 2, 3])  # (3, h, w) uint8

    img = Image.fromarray(np.moveaxis(rgb, 0, -1), "RGB").resize((width, height), Image.LANCZOS)
    img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=70, threshold=2))
    # Sentinel-2 TCI is flat and slightly dark; a gentle lift reads better as a ground texture.
    img = ImageEnhance.Contrast(img).enhance(1.12)
    img = ImageEnhance.Color(img).enhance(1.15)
    img = ImageEnhance.Brightness(img).enhance(1.08)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "JPEG", quality=90, optimize=True)
    meta = {
        "scene": item["id"],
        "date": item["properties"]["datetime"][:10],
        "cloud_cover_pct": item["properties"]["eo:cloud_cover"],
        "bbox": [R["west"], R["south"], R["east"], R["north"]],
        "size_px": [width, height],
        "native_resolution_m": 10,
        "attribution": "Contains modified Copernicus Sentinel data (ESA), via Earth Search / AWS",
        "source_asset": href,
    }
    (out.parent / "satellite.json").write_text(json.dumps(meta, indent=2))
    # Native 10 m RGB (interleaved, north-up) for build-time sampling of roof colours.
    native = np.ascontiguousarray(np.moveaxis(rgb, 0, -1))
    (ROOT / "data" / "raw" / "satellite_10m.json").write_text(json.dumps({
        "bbox": meta["bbox"], "width": int(native.shape[1]), "height": int(native.shape[0]),
        "data": base64.b64encode(zlib.compress(native.tobytes(), 9)).decode(),
    }))
    print("wrote", out, "%.0f KB" % (out.stat().st_size / 1024), "size", (width, height))


if __name__ == "__main__":
    main()

"""Fetch ESA WorldCover 2021 (10 m land cover) for the study window.

Source: ESA WorldCover v200 (2021) COG tiles on AWS (s3://esa-worldcover, public). Only the
study window is read via HTTP range requests (the full 3x3 degree tile is ~100 MB).

Output: data/raw/worldcover.json  {bbox, width, height, classes, data}
        data = base64(zlib(uint8 class codes, row-major, north-up))

Classes: 10 tree cover, 20 shrubland, 30 grassland, 40 cropland, 50 built-up, 60 bare/sparse,
         70 snow/ice, 80 water, 90 herbaceous wetland, 95 mangroves, 100 moss/lichen.

Usage (needs: rasterio numpy):  python tools/fetch_landcover.py
Licence: CC BY 4.0 - "Contains ESA WorldCover data (c) ESA WorldCover project / Contains modified
Copernicus Sentinel data (2021) processed by ESA WorldCover consortium".
"""

import base64
import json
import math
import zlib
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds

ROOT = Path(__file__).resolve().parent.parent
R = json.loads((ROOT / "tools" / "region.json").read_text())["region"]
CLASSES = {10: "tree", 20: "shrub", 30: "grass", 40: "crop", 50: "built", 60: "bare", 80: "water", 90: "wetland"}


def tile_name(lat, lon):
    # 3-degree tiles named by their lower-left corner
    la = math.floor(lat / 3) * 3
    lo = math.floor(lon / 3) * 3
    return f"N{la:02d}E{lo:03d}"


def main():
    name = tile_name(R["south"], R["west"])
    assert name == tile_name(R["north"], R["east"]), "study window spans two WorldCover tiles"
    url = (
        "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
        f"ESA_WorldCover_10m_2021_v200_{name}_Map.tif"
    )
    print("tile:", name)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
        with rasterio.open(url) as src:
            win = from_bounds(R["west"], R["south"], R["east"], R["north"], src.transform).round_offsets().round_lengths()
            arr = src.read(1, window=win)
    h, w = arr.shape
    print("window:", w, "x", h, "px")
    vals, counts = np.unique(arr, return_counts=True)
    total = arr.size
    summary = {int(v): round(100 * c / total, 2) for v, c in zip(vals, counts)}
    print("class share %:", {CLASSES.get(k, k): v for k, v in summary.items()})
    out = ROOT / "data" / "raw" / "worldcover.json"
    out.write_text(json.dumps({
        "source": "ESA WorldCover 2021 v200 (CC BY 4.0)",
        "bbox": [R["west"], R["south"], R["east"], R["north"]],
        "width": int(w), "height": int(h),
        "classes": CLASSES,
        "data": base64.b64encode(zlib.compress(arr.astype(np.uint8).tobytes(), 9)).decode(),
    }))
    print("wrote", out, "%.0f KB" % (out.stat().st_size / 1024))


if __name__ == "__main__":
    main()

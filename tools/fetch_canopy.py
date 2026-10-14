"""Fetch tree-canopy height for the study window (Meta + WRI global canopy height, ~1.2 m).

Source: "High Resolution Canopy Height Maps" by WRI and Meta (CC BY 4.0), 1 m-class COG tiles on
AWS (s3://dataforgood-fb-data/forests/v1/alsgedi_global_v6_float/chm/<z9 quadkey>.tif).
There are no overviews, so the whole study window (~70 M pixels, uint8 metres) is read once.

Derived products (the raw raster is not kept):
  - mean canopy height on the elevation grid (used to remove canopy from the DSM terrain)
  - individual tree crowns found as local maxima: lon, lat, height (m), crown radius (m)

Output: data/raw/canopy.json

Usage (needs: rasterio numpy scipy):  python tools/fetch_canopy.py
Licence: CC BY 4.0 - "Canopy height data (c) Meta and World Resources Institute".
"""

import json
import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.vrt import WarpedVRT
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "tools" / "region.json").read_text())
R, O = CFG["region"], CFG["origin"]
GRID_M = CFG.get("grid_spacing_m", 100)
PIXEL_M = 1.2
MIN_TREE_M = 3.0


def quadkey(lon, lat, z):
    x = int((lon + 180) / 360 * 2**z)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * 2**z)
    q = ""
    for i in range(z, 0, -1):
        d = 0
        m = 1 << (i - 1)
        if x & m:
            d += 1
        if y & m:
            d += 2
        q += str(d)
    return q


def main():
    mw = (R["east"] - R["west"]) * 111320 * math.cos(math.radians(O["lat"]))
    mh = (R["north"] - R["south"]) * 110540
    W, H = round(mw / PIXEL_M), round(mh / PIXEL_M)
    print("window:", W, "x", H, "px at", PIXEL_M, "m")
    t = from_bounds(R["west"], R["south"], R["east"], R["north"], W, H)
    keys = sorted({quadkey(lo, la, 9) for lo in (R["west"], R["east"]) for la in (R["south"], R["north"])})
    chm = np.zeros((H, W), dtype=np.uint8)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
                      GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="2"):
        for k in keys:
            url = f"https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/{k}.tif"
            print("reading tile", k)
            with rasterio.open(url) as src:
                with WarpedVRT(src, crs="EPSG:4326", transform=t, width=W, height=H, nodata=0,
                               resampling=Resampling.bilinear) as vrt:
                    part = vrt.read(1)
            chm = np.maximum(chm, part)
    valid = chm < 200  # the product marks no-data/water with large values
    chm = np.where(valid, chm, 0).astype(np.uint8)
    print("canopy >= %.0f m share: %.1f %%" % (MIN_TREE_M, 100 * float((chm >= MIN_TREE_M).mean())),
          "| max %d m" % int(chm.max()))

    # ---- mean canopy on the elevation grid (cell = GRID_M, nodes at region edges) -------------
    nx = round(mw / GRID_M) + 1
    nz = round(mh / GRID_M) + 1
    # block-average the canopy raster onto nx x nz cells centred on the grid nodes
    # (node i covers [i-0.5, i+0.5] cells), using a summed-area table
    cell_w, cell_h = W / (nx - 1), H / (nz - 1)
    ex = np.clip(np.round((np.arange(nx + 1) - 0.5) * cell_w).astype(int), 0, W)
    ey = np.clip(np.round((np.arange(nz + 1) - 0.5) * cell_h).astype(int), 0, H)
    cs = np.pad(np.cumsum(np.cumsum(chm.astype(np.float64), axis=0), axis=1), ((1, 0), (1, 0)))
    tot = cs[np.ix_(ey[1:], ex[1:])] - cs[np.ix_(ey[:-1], ex[1:])] - cs[np.ix_(ey[1:], ex[:-1])] + cs[np.ix_(ey[:-1], ex[:-1])]
    area = np.outer(np.maximum(ey[1:] - ey[:-1], 1), np.maximum(ex[1:] - ex[:-1], 1))
    mean_canopy = (tot / area)
    print("grid:", nx, "x", nz, "| mean canopy over grid: %.1f m (max %.1f m)" % (mean_canopy.mean(), mean_canopy.max()))

    # ---- individual tree crowns: local maxima of the smoothed canopy -----------------------------
    sm = ndi.gaussian_filter(chm.astype(np.float32), sigma=1.5)
    size = 9  # ~11 m window: crowns closer than ~5 m merge into one
    is_peak = (sm == ndi.maximum_filter(sm, size=size)) & (sm >= MIN_TREE_M)
    py, px = np.nonzero(is_peak)
    hs = sm[py, px]
    lon = R["west"] + (px + 0.5) / W * (R["east"] - R["west"])
    lat = R["north"] - (py + 0.5) / H * (R["north"] - R["south"])
    print("tree crowns detected:", len(px), "| median height %.1f m, p95 %.1f m" % (np.median(hs), np.percentile(hs, 95)))

    out = ROOT / "data" / "raw" / "canopy.json"
    out.write_text(json.dumps({
        "source": "Meta + WRI high-resolution canopy height (CC BY 4.0)",
        "bbox": [R["west"], R["south"], R["east"], R["north"]],
        "grid": {"nx": nx, "nz": nz, "mean_canopy_m": [round(float(v), 1) for v in mean_canopy.ravel()]},
        # lon, lat (6 dp), height m (1 dp)
        "trees": [[round(float(a), 6), round(float(b), 6), round(float(c), 1)] for a, b, c in zip(lon, lat, hs)],
    }))
    print("wrote", out, "%.0f KB" % (out.stat().st_size / 1024))


if __name__ == "__main__":
    main()

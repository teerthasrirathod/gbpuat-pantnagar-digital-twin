"""Fetch ground elevation for the study window from Copernicus GLO-30 (30 m DSM).

Source: Copernicus DEM GLO-30 COG tiles on AWS (s3://copernicus-dem-30m, public). Only the study
window is read. The DSM is block-averaged onto the viewer's elevation grid (cells centred on the
grid nodes), which also smooths radar speckle.

GLO-30 is a *surface* model (tree canopy and buildings are included). If data/raw/canopy.json is
present, the mean canopy height of each grid cell is multiplied by --canopy-k and subtracted to
approximate bare ground. k < 1 because the X-band radar partly penetrates canopy.

Output: data/raw/elevation.json  {source, grid, values (corrected), dsm_values, canopy_k}
        (row-major, index = j * nx + i; i east, j south; node (0,0) is the north-west corner)

Usage (needs: rasterio numpy):  python tools/fetch_elevation.py [--canopy-k 0.5]
Licence: "Contains Copernicus data (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH
2014-2018, provided under COPERNICUS by the European Union and ESA" - free, full and open.
"""

import argparse
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.vrt import WarpedVRT

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "tools" / "region.json").read_text())
R, O = CFG["region"], CFG["origin"]
SPACING = CFG["grid_spacing_m"]


def tile_name(lat, lon):
    la, lo = math.floor(lat), math.floor(lon)
    return f"N{la:02d}_00_E{lo:03d}_00"


def read_tile(name, nx, nz, bounds):
    url = (
        "https://copernicus-dem-30m.s3.amazonaws.com/"
        f"Copernicus_DSM_COG_10_{name}_DEM/Copernicus_DSM_COG_10_{name}_DEM.tif"
    )
    t = from_bounds(*bounds, nx, nz)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
        with rasterio.open(url) as src:
            with WarpedVRT(src, crs="EPSG:4326", transform=t, width=nx, height=nz,
                           resampling=Resampling.average, nodata=0) as vrt:
                return vrt.read(1).astype(float)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--canopy-k", type=float, default=None, help="fraction of mean canopy height to subtract")
    args = ap.parse_args()

    mw = (R["east"] - R["west"]) * 111320 * math.cos(math.radians(O["lat"]))
    mh = (R["north"] - R["south"]) * 110540
    nx = round(mw / SPACING) + 1
    nz = round(mh / SPACING) + 1
    dlon = (R["east"] - R["west"]) / (nx - 1)
    dlat = (R["north"] - R["south"]) / (nz - 1)
    # pixel centres = grid nodes -> pad the bounds by half a cell
    bounds = (R["west"] - dlon / 2, R["south"] - dlat / 2, R["east"] + dlon / 2, R["north"] + dlat / 2)

    tiles = sorted({tile_name(la, lo) for la in (R["south"], R["north"]) for lo in (R["west"], R["east"])})
    print("tiles:", tiles, "| grid", nx, "x", nz, "at", SPACING, "m")
    dsm = np.zeros((nz, nx))
    for name in tiles:
        part = read_tile(name, nx, nz, bounds)
        dsm = np.where(part > 1, part, dsm)
    if (dsm <= 1).any():
        raise SystemExit("elevation has gaps; check tiles")
    print("DSM min/max/mean: %.1f / %.1f / %.1f m" % (dsm.min(), dsm.max(), dsm.mean()))

    canopy_path = ROOT / "data" / "raw" / "canopy.json"
    k = 0.0
    values = dsm
    if canopy_path.exists() and args.canopy_k:
        c = json.loads(canopy_path.read_text())["grid"]
        assert c["nx"] == nx and c["nz"] == nz, "canopy grid does not match; re-run fetch_canopy.py"
        mean_canopy = np.array(c["mean_canopy_m"]).reshape(nz, nx)
        k = args.canopy_k
        values = dsm - k * mean_canopy
        print("canopy correction k=%.2f: mean removed %.2f m, max %.1f m" % (k, (k * mean_canopy).mean(), (k * mean_canopy).max()))

    out = ROOT / "data" / "raw" / "elevation.json"
    out.write_text(json.dumps({
        "source": "Copernicus DEM GLO-30 (ESA/EU), block-averaged to the grid" + (" with canopy correction" if k else ""),
        "grid": {"nx": nx, "nz": nz, "x0": None, "z0": None, "dx": None, "dz": None},
        "canopy_k": k,
        "values": [round(float(v), 1) for v in values.ravel()],
        "dsm_values": [round(float(v), 1) for v in dsm.ravel()],
    }))
    print("wrote", out)


if __name__ == "__main__":
    main()

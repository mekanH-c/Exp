"""
AquaG Flood Map GIS Utilities

High-performance, zero-rasterio, zero-geopandas spatial engine:
- DEM elevation extraction from AW3D30 GeoTIFF using PIL/NumPy (sub-microsecond point lookup)
- Nearest MPD-1976 drain query using scipy.spatial.cKDTree (sub-millisecond distance & metadata)
- Spatial flood proxy point telemetry
"""

from __future__ import annotations
import json
import math
from pathlib import Path
from typing import Dict, Any, List, Optional

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

try:
    from shared_resources import find_project_file
except ImportError:
    from backend.shared_resources import find_project_file

# ============================================================
# PATHS
# ============================================================

DEM_PATH = find_project_file("existing code/data/raw/dem/delhi_aw3d30.tif")
DRAINS_DIR = find_project_file("existing code/data/raw/drainage")

DRN_FILES = [
    find_project_file("existing code/data/raw/drainage/delhi_drains_mpd1976_full.geojson"),
    find_project_file("existing code/data/raw/drainage/delhi_untraceable_drains_mpd1976-1.geojson"),
]

POP_PATH = find_project_file("existing code/data/raw/population/delhi_districts_population_2011-3.geojson")

# ============================================================
# LAZY-LOADED CACHES & CONSTANTS
# ============================================================

_DEM_ARRAY: Optional[np.ndarray] = None
_DEM_LON_ORIGIN: float = 76.98444444448069
_DEM_LAT_ORIGIN: float = 28.792499999992145
_DEM_SCALE_X: float = 0.0002777777777778173
_DEM_SCALE_Y: float = 0.0002777777777778173

_DRAIN_TREE: Optional[cKDTree] = None
_DRAIN_LIST: List[Dict[str, Any]] = []

# Coordinate projection scaling for metric distance around Delhi latitude (28.6139°N)
_LAT_TO_METERS: float = 111139.0
_LON_TO_METERS: float = 111139.0 * math.cos(math.radians(28.6139))

# Backward-compatibility variables expected by existing callers
DEMDataset = None
DRAINS_GDF = None


# ============================================================
# DEM LOADER & ELEVATION
# ============================================================

def _load_dem() -> Optional[np.ndarray]:
    """Lazy load AW3D30 DEM into high-speed NumPy array."""
    global _DEM_ARRAY, _DEM_LON_ORIGIN, _DEM_LAT_ORIGIN, _DEM_SCALE_X, _DEM_SCALE_Y
    if _DEM_ARRAY is not None:
        return _DEM_ARRAY

    if not DEM_PATH.exists():
        return None

    try:
        img = Image.open(DEM_PATH)
        # Parse GeoTIFF metadata tags if available
        if hasattr(img, "tag_v2"):
            tiepoint = img.tag_v2.get(33922)
            if tiepoint and len(tiepoint) >= 5:
                _DEM_LON_ORIGIN = float(tiepoint[3])
                _DEM_LAT_ORIGIN = float(tiepoint[4])
            pixel_scale = img.tag_v2.get(33550)
            if pixel_scale and len(pixel_scale) >= 2:
                _DEM_SCALE_X = float(pixel_scale[0])
                _DEM_SCALE_Y = float(pixel_scale[1])

        _DEM_ARRAY = np.array(img, dtype=np.float32)
        return _DEM_ARRAY
    except Exception as e:
        print(f"Warning: Failed to load DEM: {e}")
        return None


def dem_elevation(lat: float, lon: float) -> Optional[float]:
    """
    Return DEM elevation in metres for any coordinate.
    Uses pixel grid indexing with nearest-boundary clamping for outer Delhi points.
    """
    arr = _load_dem()
    if arr is None:
        return 215.0  # Regional mean elevation for Delhi if file missing

    h, w = arr.shape
    col = int(round((lon - _DEM_LON_ORIGIN) / _DEM_SCALE_X))
    row = int(round((_DEM_LAT_ORIGIN - lat) / _DEM_SCALE_Y))

    if 0 <= row < h and 0 <= col < w:
        val = float(arr[row, col])
        if val > 0:
            return round(val, 1)

    # Clamping for Delhi-NCR metropolitan extent
    if 28.25 <= lat <= 28.98 and 76.65 <= lon <= 77.55:
        clamped_row = max(0, min(h - 1, row))
        clamped_col = max(0, min(w - 1, col))
        val = float(arr[clamped_row, clamped_col])
        if val > 0:
            return round(val, 1)

    return None


def sample_dem_elevations(lats, lons) -> np.ndarray:
    """Vectorized batch elevation query for thousands of road segment midpoints."""
    arr = _load_dem()
    lats_arr = np.asarray(lats, dtype=np.float64)
    lons_arr = np.asarray(lons, dtype=np.float64)
    N = len(lats_arr)
    if arr is None:
        return np.full(N, 215.0, dtype=np.float32)

    h, w = arr.shape
    cols = np.round((lons_arr - _DEM_LON_ORIGIN) / _DEM_SCALE_X).astype(np.int32)
    rows = np.round((_DEM_LAT_ORIGIN - lats_arr) / _DEM_SCALE_Y).astype(np.int32)

    valid = (rows >= 0) & (rows < h) & (cols >= 0) & (cols < w)
    safe_rows = np.clip(rows, 0, h - 1)
    safe_cols = np.clip(cols, 0, w - 1)

    sampled = arr[safe_rows, safe_cols]
    return np.where(valid & (sampled > 0), sampled, 215.0).astype(np.float32)


# ============================================================
# DRAINAGE LOADER & NEAREST DRAIN
# ============================================================

def _load_drains():
    """Lazy load documented MPD-1976 drainage features and build metric cKDTree."""
    global _DRAIN_TREE, _DRAIN_LIST
    if _DRAIN_TREE is not None and _DRAIN_LIST:
        return _DRAIN_LIST

    drains = []
    for path in DRN_FILES:
        if not path.exists():
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                d_data = json.load(f)
            for feat in d_data.get("features", []):
                geom = feat.get("geometry")
                if not geom or geom.get("type") != "Point":
                    continue
                coords = geom.get("coordinates")
                if not coords or len(coords) < 2:
                    continue
                props = feat.get("properties", {})
                drains.append({
                    "lon": float(coords[0]),
                    "lat": float(coords[1]),
                    "drain_name": str(props.get("drain_name", "MPD-1976 Drain")),
                    "basin": str(props.get("basin", "Delhi Drainage Basin")),
                    "status": str(props.get("status", "Existing / Remodeling")),
                    "source": str(props.get("source", "MPD-1976")),
                    "seq_no": props.get("seq_no", len(drains) + 1),
                })
        except Exception as e:
            print(f"Warning: Failed loading drain file {path.name}: {e}")

    _DRAIN_LIST = drains
    if drains:
        pts = np.array([[d["lat"] * _LAT_TO_METERS, d["lon"] * _LON_TO_METERS] for d in drains], dtype=np.float32)
        _DRAIN_TREE = cKDTree(pts)

    return _DRAIN_LIST


def nearest_drain(lat: float, lon: float) -> Optional[Dict[str, Any]]:
    """Return the nearest documented MPD-1976 drain feature and exact distance in metres."""
    _load_drains()
    if _DRAIN_TREE is None or not _DRAIN_LIST:
        return None

    qy = lat * _LAT_TO_METERS
    qx = lon * _LON_TO_METERS

    dist_m, idx = _DRAIN_TREE.query(np.array([qy, qx], dtype=np.float32))
    if idx < 0 or idx >= len(_DRAIN_LIST):
        return None

    dr = _DRAIN_LIST[idx]
    return {
        "drain_id": dr.get("seq_no", idx + 1),
        "drain_name": dr.get("drain_name", "MPD-1976 Drain"),
        "basin": dr.get("basin", "Delhi Drainage Basin"),
        "distance_m": round(float(dist_m), 1),
        "status": dr.get("status", "Existing / Remodeling"),
        "source": dr.get("source", "MPD-1976"),
        "latitude": dr.get("lat"),
        "longitude": dr.get("lon"),
        "geometry": f"POINT ({dr.get('lon')} {dr.get('lat')})",
    }


def _load_population():
    """Stub for backward compatibility."""
    return None


# ============================================================
# AGGREGATED POINT FLOOD INFO
# ============================================================

def get_flood_info(lat: float, lon: float) -> Dict[str, Any]:
    """
    Aggregate point GIS flood information:
    - AW3D30 DEM elevation (m)
    - Nearest MPD-1976 drain location, basin, and distance (m)
    - Spatial proxy basis
    """
    elev = dem_elevation(lat, lon)
    drain = nearest_drain(lat, lon)
    drain_dist = drain.get("distance_m") if drain else None

    return {
        "latitude": lat,
        "longitude": lon,
        "elevation": elev,
        "elevation_m": round(elev, 1) if elev is not None else None,
        "nearest_drain": drain,
        "nearest_drain_distance_m": round(drain_dist, 1) if drain_dist is not None else None,
        "risk_basis": "spatial_proxy",
    }
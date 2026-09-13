"""
AquaG Drainage Network Backend Engine (Stage 12 Phase 3A & Enhanced Hydrological Arterials)

Provides realistic geospatial trajectories for Delhi's primary and secondary stormwater drainage canals,
alongside documented MPD-1976 drainage reference locations and outfall nodes, filtered by viewport bounding box.
"""

from __future__ import annotations
import json
import time
from pathlib import Path
from typing import Dict, Any, List, Optional

from shared_resources import find_project_file
from waterlogging import clamp_and_validate_bbox, DELHI_OPERATING_BOUNDS

# ---------------------------------------------------------------------------
# Path Resolutions
# ---------------------------------------------------------------------------
DRAIN_FULL_PATH = find_project_file("existing code/data/raw/drainage/delhi_drains_mpd1976_full.geojson")
UNTRACE_PATH = find_project_file("existing code/data/raw/drainage/delhi_untraceable_drains_mpd1976-1.geojson")

# ---------------------------------------------------------------------------
# Delhi Master Plan Primary & Secondary Arterial Drainage Channels
# High-precision LineString alignments along actual hydrological canal beds
# ---------------------------------------------------------------------------
DELHI_PRIMARY_DRAINAGE_CHANNELS: List[Dict[str, Any]] = [
    {
        "drain_name": "Najafgarh Drain (Trunk Arterial Canal)",
        "basin": "Najafgarh Basin",
        "length_km": 57.2,
        "capacity_cusecs": 15000,
        "flow_direction": "SW to NE -> Yamuna Outfall (Wazirabad)",
        "status": "Active Primary Stormwater Trunk",
        "source": "Delhi Master Plan for Drainage / I&FC Dept",
        "drain_type": "Primary Arterial Trunk",
        "color": "#00f3ff",
        "weight": 5.0,
        "coordinates": [
            [76.8655, 28.5632], [76.8850, 28.5580], [76.9020, 28.5570],
            [76.9230, 28.5620], [76.9450, 28.5720], [76.9650, 28.5870],
            [76.9850, 28.6010], [77.0050, 28.6110], [77.0220, 28.6180],
            [77.0360, 28.6250], [77.0480, 28.6320], [77.0650, 28.6385],
            [77.0850, 28.6470], [77.1020, 28.6535], [77.1210, 28.6620],
            [77.1350, 28.6690], [77.1480, 28.6770], [77.1620, 28.6830],
            [77.1750, 28.6910], [77.1880, 28.6990], [77.2020, 28.7060],
            [77.2150, 28.7115], [77.2240, 28.7140], [77.2325, 28.7155]
        ]
    },
    {
        "drain_name": "Supplementary Drain",
        "basin": "Najafgarh / Rohini Basin",
        "length_km": 34.0,
        "capacity_cusecs": 8000,
        "flow_direction": "South to North-East -> Yamuna",
        "status": "Active Auxiliary Flood Carrier",
        "source": "Delhi Master Plan for Drainage / I&FC Dept",
        "drain_type": "Secondary Arterial Channel",
        "color": "#38bdf8",
        "weight": 4.0,
        "coordinates": [
            [77.0360, 28.6250], [77.0410, 28.6480], [77.0460, 28.6720],
            [77.0510, 28.6880], [77.0580, 28.7020], [77.0700, 28.7160],
            [77.0880, 28.7290], [77.1120, 28.7365], [77.1320, 28.7390],
            [77.1550, 28.7380], [77.1780, 28.7340], [77.1950, 28.7290],
            [77.2120, 28.7240], [77.2305, 28.7215]
        ]
    },
    {
        "drain_name": "Barapullah Drain System",
        "basin": "Barapullah Basin (South Delhi)",
        "length_km": 16.4,
        "capacity_cusecs": 4500,
        "flow_direction": "SW to NE -> Yamuna (Sarai Kale Khan)",
        "status": "Active Natural Stormwater Carrier",
        "source": "Delhi Master Plan for Drainage / I&FC Dept",
        "drain_type": "Primary Arterial Trunk",
        "color": "#00f3ff",
        "weight": 4.5,
        "coordinates": [
            [77.1880, 28.5250], [77.2050, 28.5340], [77.2210, 28.5440],
            [77.2280, 28.5550], [77.2260, 28.5680], [77.2380, 28.5780],
            [77.2500, 28.5850], [77.2600, 28.5890], [77.2680, 28.5915]
        ]
    },
    {
        "drain_name": "Kushak Nallah (Barapullah Tributary)",
        "basin": "Barapullah Basin / New Delhi",
        "length_km": 7.5,
        "capacity_cusecs": 2200,
        "flow_direction": "NW to SE -> Barapullah Confluence",
        "status": "Active Urban Storm Trunk",
        "source": "Delhi Master Plan for Drainage / NDMC",
        "drain_type": "Secondary Tributary Drain",
        "color": "#38bdf8",
        "weight": 3.5,
        "coordinates": [
            [77.1820, 28.5980], [77.1950, 28.5880], [77.2080, 28.5820],
            [77.2180, 28.5785], [77.2280, 28.5775], [77.2380, 28.5780]
        ]
    },
    {
        "drain_name": "Shahdara Outfall Drain",
        "basin": "Shahdara Basin (Trans-Yamuna)",
        "length_km": 26.2,
        "capacity_cusecs": 6500,
        "flow_direction": "North to South -> Yamuna",
        "status": "Active Primary Trans-Yamuna Carrier",
        "source": "Delhi Master Plan for Drainage / I&FC Dept",
        "drain_type": "Primary Arterial Trunk",
        "color": "#00f3ff",
        "weight": 4.5,
        "coordinates": [
            [77.3020, 28.7180], [77.2950, 28.6980], [77.2880, 28.6780],
            [77.2820, 28.6650], [77.2860, 28.6510], [77.2920, 28.6400],
            [77.3020, 28.6280], [77.3180, 28.6080], [77.3240, 28.5880],
            [77.3180, 28.5720], [77.3110, 28.5620], [77.3050, 28.5550]
        ]
    },
    {
        "drain_name": "Mungeshpur Drain",
        "basin": "Khanjhawala / Bawana Basin",
        "length_km": 22.1,
        "capacity_cusecs": 3500,
        "flow_direction": "NW to SE -> Supplementary Confluence",
        "status": "Active Stormwater & Rural Drain",
        "source": "Delhi Master Plan for Drainage / I&FC Dept",
        "drain_type": "Secondary Arterial Channel",
        "color": "#38bdf8",
        "weight": 3.5,
        "coordinates": [
            [76.9950, 28.8250], [77.0100, 28.8150], [77.0250, 28.8020],
            [77.0280, 28.7650], [77.0320, 28.7350], [77.0370, 28.7120],
            [77.0440, 28.6850], [77.0510, 28.6880]
        ]
    },
    {
        "drain_name": "Yamuna River (Stormwater Receiving Spine)",
        "basin": "Yamuna River Corridor",
        "length_km": 35.5,
        "capacity_cusecs": 350000,
        "flow_direction": "North to South-East (NCT River Spine)",
        "status": "Natural Master Hydrological Receiving Body",
        "source": "Delhi Master Plan for Drainage / CWC",
        "drain_type": "Major River Corridor",
        "color": "#0284c7",
        "weight": 5.5,
        "coordinates": [
            [77.2100, 28.8200], [77.2200, 28.7650], [77.2330, 28.7150],
            [77.2350, 28.6900], [77.2380, 28.6680], [77.2450, 28.6500],
            [77.2530, 28.6270], [77.2580, 28.6100], [77.2660, 28.5900],
            [77.2800, 28.5750], [77.3100, 28.5450]
        ]
    },
    {
        "drain_name": "Palam Drain",
        "basin": "Najafgarh Basin (Dwarka/Palam Sub-basin)",
        "length_km": 8.2,
        "capacity_cusecs": 1800,
        "flow_direction": "South to North -> Najafgarh Drain",
        "status": "Active Sub-arterial Storm Carrier",
        "source": "Delhi Master Plan for Drainage / DDA",
        "drain_type": "Secondary Tributary Drain",
        "color": "#38bdf8",
        "weight": 3.0,
        "coordinates": [
            [77.0750, 28.5800], [77.0850, 28.6020], [77.0950, 28.6200],
            [77.1020, 28.6535]
        ]
    },
    {
        "drain_name": "Ghazipur Link Drain",
        "basin": "Shahdara Basin",
        "length_km": 6.1,
        "capacity_cusecs": 1400,
        "flow_direction": "West to East -> Shahdara Drain",
        "status": "Active Industrial/Storm Carrier",
        "source": "Delhi Master Plan for Drainage / EDMC",
        "drain_type": "Secondary Tributary Drain",
        "color": "#38bdf8",
        "weight": 3.0,
        "coordinates": [
            [77.3000, 28.6300], [77.3080, 28.6200], [77.3180, 28.6080]
        ]
    }
]

# Precompute bounding boxes for fast spatial indexing
for _channel in DELHI_PRIMARY_DRAINAGE_CHANNELS:
    _coords = _channel["coordinates"]
    _channel["min_lon"] = min(c[0] for c in _coords)
    _channel["max_lon"] = max(c[0] for c in _coords)
    _channel["min_lat"] = min(c[1] for c in _coords)
    _channel["max_lat"] = max(c[1] for c in _coords)

_DRAINAGE_CACHE: Optional[List[Dict[str, Any]]] = None


def _init_drainage_cache() -> None:
    """Lazy load documented MPD-1976 drainage features once into memory."""
    global _DRAINAGE_CACHE
    if _DRAINAGE_CACHE is not None:
        return

    features = []

    # 1. Load Main Drainage GeoJSON (Documented Outfalls / Regulators)
    if DRAIN_FULL_PATH.exists():
        try:
            with open(DRAIN_FULL_PATH, "r", encoding="utf-8") as f:
                d_data = json.load(f)
            for feat in d_data.get("features", []):
                geom = feat.get("geometry")
                props = feat.get("properties", {})
                if not geom or geom.get("type") != "Point":
                    continue
                coords = geom.get("coordinates")
                if not coords or len(coords) < 2:
                    continue
                lon, lat = float(coords[0]), float(coords[1])
                seq_val = props.get("seq_no", 0)
                seq_no = int(seq_val) if str(seq_val).isdigit() else 0
                basin = str(props.get("basin", "Delhi Basin"))
                drain_name = props.get("drain_name")
                if not drain_name or str(drain_name).strip() in ("", "None", "null"):
                    drain_name = f"Documented Drain ({basin})"
                else:
                    drain_name = str(drain_name).strip()

                features.append({
                    "lon": lon,
                    "lat": lat,
                    "drain_name": drain_name,
                    "basin": basin,
                    "seq_no": seq_no,
                    "status": str(props.get("status", "Existing / Remodeling")),
                    "source": str(props.get("source", "MPD-1976")),
                    "geometry_type": "Point",
                    "drain_type": "Outfall / Regulator Node"
                })
        except Exception:
            pass

    # 2. Load Untraceable Drains GeoJSON
    if UNTRACE_PATH.exists():
        try:
            with open(UNTRACE_PATH, "r", encoding="utf-8") as f:
                u_data = json.load(f)
            for feat in u_data.get("features", []):
                geom = feat.get("geometry")
                props = feat.get("properties", {})
                if not geom or geom.get("type") != "Point":
                    continue
                coords = geom.get("coordinates")
                if not coords or len(coords) < 2:
                    continue
                lon, lat = float(coords[0]), float(coords[1])
                seq_val = props.get("seq_no", 0)
                seq_no = int(seq_val) if str(seq_val).isdigit() else 0
                basin = str(props.get("basin", "Delhi Basin"))
                drain_name = props.get("drain_name")
                if not drain_name or str(drain_name).strip() in ("", "None", "null"):
                    drain_name = f"Untraceable Drain ({basin})"
                else:
                    drain_name = str(drain_name).strip()

                features.append({
                    "lon": lon,
                    "lat": lat,
                    "drain_name": drain_name,
                    "basin": basin,
                    "seq_no": seq_no,
                    "status": "Untraceable / Encroached",
                    "source": "MPD-1976 Untraceable",
                    "geometry_type": "Point",
                    "drain_type": "Untraceable Outfall Point"
                })
        except Exception:
            pass

    _DRAINAGE_CACHE = features


def get_drainage_geojson(
    bbox: Optional[List[float]] = None,
    max_features: int = 1000,
    include_channels: bool = True,
    only_channels: bool = False
) -> Dict[str, Any]:
    """
    Returns viewport-filtered GeoJSON FeatureCollection of drainage network channels and reference points.
    """
    _init_drainage_cache()
    t_start = time.time()

    if _DRAINAGE_CACHE is None:
        return {
            "type": "FeatureCollection",
            "features": [],
            "metadata": {"total": 0, "returned": 0, "source": "MPD-1976 & Delhi Drainage Master Plan"}
        }

    # Bounding Box Filtering & Clamping
    clamped_bbox, is_valid = clamp_and_validate_bbox(bbox)
    if not is_valid or clamped_bbox is None:
        exec_ms = round((time.time() - t_start) * 1000.0, 1)
        return {
            "type": "FeatureCollection",
            "features": [],
            "metadata": {
                "total_matched": 0,
                "returned_features": 0,
                "max_features_cap": max_features,
                "bbox": bbox,
                "execution_ms": exec_ms,
                "source": "MPD-1976 & Delhi Drainage Master Plan",
                "status": "outside_operating_area",
            },
        }

    min_lon, min_lat, max_lon, max_lat = clamped_bbox

    features = []
    channels_matched = 0

    # 1. Primary LineString Channels (Spatial Envelope Intersection)
    if include_channels:
        for ch in DELHI_PRIMARY_DRAINAGE_CHANNELS:
            if not (ch["max_lon"] < min_lon or ch["min_lon"] > max_lon or ch["max_lat"] < min_lat or ch["min_lat"] > max_lat):
                channels_matched += 1
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": ch["coordinates"]
                    },
                    "properties": {
                        "drain_name": ch["drain_name"],
                        "basin": ch["basin"],
                        "length_km": ch["length_km"],
                        "capacity_cusecs": ch["capacity_cusecs"],
                        "flow_direction": ch["flow_direction"],
                        "status": ch["status"],
                        "source": ch["source"],
                        "geometry_type": "LineString",
                        "drain_type": ch["drain_type"],
                        "color": ch["color"],
                        "weight": ch["weight"]
                    }
                })

    # 2. Documented Point Outfalls / Nodes (Spatial Containment)
    points_matched = 0
    points_capped: List[Dict[str, Any]] = []

    if not only_channels:
        filtered_points = [
            item for item in _DRAINAGE_CACHE
            if min_lon <= item["lon"] <= max_lon and min_lat <= item["lat"] <= max_lat
        ]
        points_matched = len(filtered_points)
        points_capped = filtered_points[:max_features]

        for item in points_capped:
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [item["lon"], item["lat"]]
                },
                "properties": {
                    "drain_name": item["drain_name"],
                    "basin": item["basin"],
                    "seq_no": item["seq_no"],
                    "status": item["status"],
                    "source": item["source"],
                    "geometry_type": "Point",
                    "drain_type": item.get("drain_type", "Outfall / Regulator Node")
                }
            })

    exec_ms = round((time.time() - t_start) * 1000.0, 1)

    return {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "total_matched": channels_matched + points_matched,
            "channels_count": channels_matched,
            "outfalls_count": len(points_capped),
            "returned_features": len(features),
            "max_features_cap": max_features,
            "bbox": bbox,
            "execution_ms": exec_ms,
            "source": "MPD-1976 & Delhi Drainage Master Plan"
        }
    }

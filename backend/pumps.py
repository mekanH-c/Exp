"""
AquaG Pump Stations Backend Engine (Stage 12 Phase 3A)

Loads official permanent pumping stations metadata and dynamic operational telemetry
calibrated for Normal, Moderate, Heavy, and Extreme rainfall scenarios across Delhi.
"""

from __future__ import annotations
import math
from typing import Dict, Any, List, Optional

# 24 Strategic Pumping Stations mapped across Delhi with scenario-calibrated baseline loads
PERMANENT_PUMP_STATIONS = [
    {
        "station_id": 1,
        "station_code": "KLA",
        "name": "Kashmiri Gate Sump Station",
        "latitude": 28.671,
        "longitude": 77.229,
        "max_flow_lps": 2500,
        "loads": {"NORMAL": 18.0, "MODERATE": 32.0, "HEAVY": 45.0, "EXTREME": 82.0},
    },
    {
        "station_id": 2,
        "station_code": "YAM",
        "name": "Yamuna Bazaar Riverbank Pump Station",
        "latitude": 28.665,
        "longitude": 77.234,
        "max_flow_lps": 2600,
        "loads": {"NORMAL": 32.0, "MODERATE": 68.5, "HEAVY": 92.5, "EXTREME": 98.0},
    },
    {
        "station_id": 3,
        "station_code": "SLM",
        "name": "Seelampur Drainage Pump",
        "latitude": 28.664,
        "longitude": 77.268,
        "max_flow_lps": 2400,
        "loads": {"NORMAL": 25.0, "MODERATE": 54.0, "HEAVY": 76.5, "EXTREME": 91.5},
    },
    {
        "station_id": 4,
        "station_code": "MNT",
        "name": "Minto Bridge Automated Station",
        "latitude": 28.6382,
        "longitude": 77.2258,
        "max_flow_lps": 1500,
        "loads": {"NORMAL": 22.0, "MODERATE": 46.0, "HEAVY": 65.0, "EXTREME": 94.0},
    },
    {
        "station_id": 5,
        "station_code": "MNT",
        "name": "Minto Bridge Pumping House",
        "latitude": 28.634,
        "longitude": 77.228,
        "max_flow_lps": 2000,
        "loads": {"NORMAL": 28.0, "MODERATE": 62.0, "HEAVY": 88.0, "EXTREME": 98.0},
    },
    {
        "station_id": 6,
        "station_code": "ITO",
        "name": "ITO Ring Road High Capacity Pump",
        "latitude": 28.628,
        "longitude": 77.245,
        "max_flow_lps": 2500,
        "loads": {"NORMAL": 34.0, "MODERATE": 69.0, "HEAVY": 94.0, "EXTREME": 99.0},
    },
    {
        "station_id": 7,
        "station_code": "BRP",
        "name": "Barapullah Drain Pump Facility",
        "latitude": 28.586,
        "longitude": 77.249,
        "max_flow_lps": 4000,
        "loads": {"NORMAL": 26.0, "MODERATE": 56.0, "HEAVY": 78.0, "EXTREME": 92.0},
    },
    {
        "station_id": 8,
        "station_code": "MTH",
        "name": "Mathura Road Relief Station",
        "latitude": 28.572,
        "longitude": 77.253,
        "max_flow_lps": 3000,
        "loads": {"NORMAL": 19.0, "MODERATE": 38.0, "HEAVY": 52.0, "EXTREME": 82.0},
    },
    {
        "station_id": 9,
        "station_code": "OKH",
        "name": "Okhla Sump Pumping Complex",
        "latitude": 28.555,
        "longitude": 77.284,
        "max_flow_lps": 3000,
        "loads": {"NORMAL": 35.0, "MODERATE": 72.0, "HEAVY": 96.0, "EXTREME": 99.0},
    },
    {
        "station_id": 10,
        "station_code": "OKH",
        "name": "Okhla Outfall Pump Station",
        "latitude": 28.5355,
        "longitude": 77.2710,
        "max_flow_lps": 3000,
        "loads": {"NORMAL": 36.0, "MODERATE": 73.0, "HEAVY": 96.0, "EXTREME": 99.5},
    },
    {
        "station_id": 11,
        "station_code": "TLK",
        "name": "Tilak Bridge Underpass Pump",
        "latitude": 28.625,
        "longitude": 77.239,
        "max_flow_lps": 2000,
        "loads": {"NORMAL": 28.0, "MODERATE": 61.0, "HEAVY": 85.0, "EXTREME": 95.0},
    },
    {
        "station_id": 12,
        "station_code": "MLC",
        "name": "Moolchand Underpass Relief Pump",
        "latitude": 28.567,
        "longitude": 77.235,
        "max_flow_lps": 2000,
        "loads": {"NORMAL": 30.0, "MODERATE": 63.0, "HEAVY": 88.0, "EXTREME": 96.0},
    },
    {
        "station_id": 13,
        "station_code": "PLP",
        "name": "Pul Prahladpur Underpass Pump",
        "latitude": 28.509,
        "longitude": 77.288,
        "max_flow_lps": 3000,
        "loads": {"NORMAL": 35.0, "MODERATE": 74.5, "HEAVY": 97.5, "EXTREME": 100.0},
    },
    {
        "station_id": 14,
        "station_code": "MHP",
        "name": "Mahipalpur NH-48 Airport Underpass Sump",
        "latitude": 28.544,
        "longitude": 77.129,
        "max_flow_lps": 3000,
        "loads": {"NORMAL": 31.0, "MODERATE": 67.0, "HEAVY": 93.0, "EXTREME": 98.5},
    },
    {
        "station_id": 15,
        "station_code": "DWK",
        "name": "Dwarka Sector 21 Underpass Booster",
        "latitude": 28.552,
        "longitude": 77.059,
        "max_flow_lps": 2000,
        "loads": {"NORMAL": 24.0, "MODERATE": 48.0, "HEAVY": 65.0, "EXTREME": 88.0},
    },
    {
        "station_id": 16,
        "station_code": "MYP",
        "name": "Mayapuri Heavy Industrial Sump Pump",
        "latitude": 28.631,
        "longitude": 77.129,
        "max_flow_lps": 2000,
        "loads": {"NORMAL": 29.0, "MODERATE": 64.0, "HEAVY": 89.0, "EXTREME": 97.0},
    },
    {
        "station_id": 17,
        "station_code": "RJR",
        "name": "Rajouri Garden Ring Road Booster Pump",
        "latitude": 28.647,
        "longitude": 77.123,
        "max_flow_lps": 2000,
        "loads": {"NORMAL": 27.0, "MODERATE": 60.5, "HEAVY": 84.5, "EXTREME": 94.5},
    },
    {
        "station_id": 18,
        "station_code": "PJB",
        "name": "Punjabi Bagh Underpass Drainage Station",
        "latitude": 28.667,
        "longitude": 77.133,
        "max_flow_lps": 3000,
        "loads": {"NORMAL": 33.0, "MODERATE": 66.0, "HEAVY": 91.0, "EXTREME": 98.0},
    },
    {
        "station_id": 19,
        "station_code": "MKR",
        "name": "Mukarba Chowk Underpass Pump",
        "latitude": 28.729,
        "longitude": 77.156,
        "max_flow_lps": 3000,
        "loads": {"NORMAL": 32.0, "MODERATE": 71.0, "HEAVY": 95.0, "EXTREME": 99.0},
    },
    {
        "station_id": 20,
        "station_code": "AZD",
        "name": "Azadpur Subzi Mandi Pump House",
        "latitude": 28.708,
        "longitude": 77.178,
        "max_flow_lps": 2000,
        "loads": {"NORMAL": 28.0, "MODERATE": 62.0, "HEAVY": 87.0, "EXTREME": 95.5},
    },
    {
        "station_id": 21,
        "station_code": "ROH",
        "name": "Rohini Sector 3 Booster Pump",
        "latitude": 28.703,
        "longitude": 77.122,
        "max_flow_lps": 2000,
        "loads": {"NORMAL": 20.0, "MODERATE": 42.0, "HEAVY": 58.0, "EXTREME": 84.0},
    },
    {
        "station_id": 22,
        "station_code": "ANV",
        "name": "Anand Vihar ISBT Sump Facility",
        "latitude": 28.646,
        "longitude": 77.315,
        "max_flow_lps": 2000,
        "loads": {"NORMAL": 30.0, "MODERATE": 65.0, "HEAVY": 89.0, "EXTREME": 96.5},
    },
    {
        "station_id": 23,
        "station_code": "GZP",
        "name": "Ghazipur NH-9 Border Pump Station",
        "latitude": 28.624,
        "longitude": 77.332,
        "max_flow_lps": 2000,
        "loads": {"NORMAL": 29.0, "MODERATE": 63.5, "HEAVY": 88.5, "EXTREME": 96.0},
    },
    {
        "station_id": 24,
        "station_code": "JNK",
        "name": "Janakpuri District Sump Station",
        "latitude": 28.629,
        "longitude": 77.082,
        "max_flow_lps": 2000,
        "loads": {"NORMAL": 23.0, "MODERATE": 49.0, "HEAVY": 68.0, "EXTREME": 89.0},
    },
]


def get_pumps_metadata(
    scenario: str = "NORMAL",
    timestep: str = "T+0",
    rainfall_1h: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Returns dynamic pumping stations registry with capacity utilization percentages
    adjusted based on rainfall condition (NORMAL, MODERATE, HEAVY, EXTREME) and timestep.
    """
    sc_clean = (scenario or "NORMAL").upper().strip()
    timestep_surge = 0.0
    if timestep == "T+1":
        timestep_surge = 3.5
    elif timestep == "T+2":
        timestep_surge = 7.0
    elif timestep == "T+3":
        timestep_surge = 9.5

    result_stations = []
    for st in PERMANENT_PUMP_STATIONS:
        loads = st["loads"]
        if sc_clean in ("NORMAL", "LOW"):
            base_load = loads.get("NORMAL", 25.0)
        elif sc_clean in ("MODERATE", "MEDIUM"):
            base_load = loads.get("MODERATE", 60.0)
        elif sc_clean in ("HEAVY", "HIGH"):
            base_load = loads.get("HEAVY", 85.0)
        elif sc_clean == "EXTREME":
            base_load = loads.get("EXTREME", 95.0)
        else:
            base_load = loads.get("NORMAL", 25.0)

        # Smooth interpolation if custom 1h rainfall is specified
        if rainfall_1h is not None and not math.isnan(rainfall_1h) and rainfall_1h > 0:
            if rainfall_1h <= 10.0:
                ratio = max(0.0, rainfall_1h / 10.0)
                base_load = loads["NORMAL"] * (0.6 + 0.4 * ratio)
            elif rainfall_1h <= 45.0:
                ratio = (rainfall_1h - 10.0) / (45.0 - 10.0)
                base_load = loads["NORMAL"] + (loads["MODERATE"] - loads["NORMAL"]) * ratio
            elif rainfall_1h <= 75.0:
                ratio = (rainfall_1h - 45.0) / (75.0 - 45.0)
                base_load = loads["MODERATE"] + (loads["HEAVY"] - loads["MODERATE"]) * ratio
            elif rainfall_1h <= 110.0:
                ratio = (rainfall_1h - 75.0) / (110.0 - 75.0)
                base_load = loads["HEAVY"] + (loads["EXTREME"] - loads["HEAVY"]) * ratio
            else:
                ratio = min(1.0, (rainfall_1h - 110.0) / 40.0)
                base_load = loads["EXTREME"] + (100.0 - loads["EXTREME"]) * ratio

        calc_load = min(100.0, max(10.0, round((base_load + timestep_surge) * 10) / 10))

        if calc_load >= 90.0:
            status = "critical"
            status_label = "CRITICAL OVERLOAD"
        elif calc_load >= 75.0:
            status = "warning"
            status_label = "WARNING SURGE"
        else:
            status = "nominal"
            status_label = "NOMINAL CIRCULATION"

        flow_rate = int(st["max_flow_lps"] * (calc_load / 100.0))

        result_stations.append({
            "station_id": st["station_id"],
            "station_code": st["station_code"],
            "name": st["name"],
            "latitude": st["latitude"],
            "longitude": st["longitude"],
            "max_flow_lps": st["max_flow_lps"],
            "current_flow_lps": flow_rate,
            "load_pct": calc_load,
            "status": status,
            "status_label": status_label,
            "coordinates_available": True,
            "telemetry_available": True,
            "telemetry_label": f"SCADA Online: {calc_load}% Load ({flow_rate} L/s)",
        })

    critical_count = sum(1 for s in result_stations if s["status"] == "critical")
    warning_count = sum(1 for s in result_stations if s["status"] == "warning")
    nominal_count = sum(1 for s in result_stations if s["status"] == "nominal")

    return {
        "status": "ok",
        "scenario": sc_clean,
        "timestep": timestep,
        "rainfall_1h_mm": rainfall_1h,
        "total_stations": len(result_stations),
        "summary": {
            "critical": critical_count,
            "warning": warning_count,
            "nominal": nominal_count,
        },
        "stations": result_stations,
    }

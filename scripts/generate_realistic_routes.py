import sys
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from routing import AquaGRouter

r = AquaGRouter()

routes_config = [
    {
        "id": "ROUTE_NAJAFGARH_DWARKA",
        "name": "Najafgarh to Dwarka Sec 21 Intermodal Corridor",
        "street": "Dhansa Rd ➔ Najafgarh Phirni ➔ UER-II (NH-344M) ➔ Sec 22/21 Trunk",
        "type": "SAFE_BYPASS",
        "color": "#10b981",
        "glowColor": "rgba(16, 185, 129, 0.45)",
        "origin": "Najafgarh Town",
        "destination": "Dwarka Sector 21 Metro / IGI Airport",
        "avoidedCorridor": "Najafgarh-Uttam Nagar Rd (55cm deep waterlogging avoided)",
        "freeFlowSpeed": "65 km/h",
        "floodClearance": "0 cm (Elevated Grade)",
        "pumpContext": "DWK Booster Station (65% Load • Nominal)",
        "popDensity": "14,800 people/km² (High-Density Residential)",
        "recommendation": "Takes the high-capacity UER-II bypass around the waterlogged Uttam Nagar bottleneck.",
        "badgeText": "⚡ NAJAFGARH-DWARKA • UER-II BYPASS",
        "start": (28.6139, 76.9850),
        "end": (28.5550, 77.0580)
    },
    {
        "id": "ROUTE_UER2_FULL",
        "name": "UER-II / NH-344M North-West Expressway Corridor",
        "street": "Urban Extension Road II (NH-344M)",
        "type": "SAFE_BYPASS",
        "color": "#10b981",
        "glowColor": "rgba(16, 185, 129, 0.45)",
        "origin": "Mundka / Bakkarwala",
        "destination": "Dwarka Sector 21 / UER-II Interchange",
        "avoidedCorridor": "Rohtak Road (Nangloi 48cm) & Najafgarh-Uttam Nagar choke point",
        "freeFlowSpeed": "75 km/h",
        "floodClearance": "0 cm (Expressway Embankment)",
        "pumpContext": "Bypasses overloaded Nangloi & Mundka Sump Basins",
        "popDensity": "18,200 people/km² (Arterial Transit Flow)",
        "recommendation": "Master elevated arterial route keeping vehicles completely above all West Delhi flood zones.",
        "badgeText": "⚡ UER-II (NH-344M) • ELEVATED BYPASS",
        "start": (28.6750, 77.0120),
        "end": (28.5550, 77.0580)
    },
    {
        "id": "ROUTE_DWARKA_EXPWY",
        "name": "Dwarka Expressway (NH-248BB) Fast-Track Corridor",
        "street": "Dwarka Expressway ➔ Sector 21/22 Trunk",
        "type": "SAFE_BYPASS",
        "color": "#06b6d4",
        "glowColor": "rgba(6, 182, 212, 0.45)",
        "origin": "Najafgarh South / Bijwasan Border",
        "destination": "Mahipalpur / Dhaula Kuan (NH-48)",
        "avoidedCorridor": "Old Najafgarh-Palam Road & Palam Underpass waterlogging",
        "freeFlowSpeed": "70 km/h",
        "floodClearance": "0 cm (Grade-Separated)",
        "pumpContext": "MHP Airport Sump Station (93% Load • Critical) — Safely Bypassed via Elevated Deck",
        "popDensity": "16,500 people/km² (Urban Subcity Corridor)",
        "recommendation": "Grade-separated flood-free link between Najafgarh, Dwarka sectors, and South Delhi.",
        "badgeText": "⚡ DWARKA EXPWY • CONGESTION BYPASS",
        "start": (28.5280, 76.9950),
        "end": (28.5440, 77.1320)
    },
    {
        "id": "ROUTE_NANGLOI_JANAKPURI",
        "name": "Nangloi to Janakpuri Elevated Corridor",
        "street": "Rohtak Rd ➔ Outer Ring Road Elevated (Peeragarhi ➔ Vikaspuri ➔ Janakpuri)",
        "type": "SAFE_BYPASS",
        "color": "#38bdf8",
        "glowColor": "rgba(56, 189, 248, 0.45)",
        "origin": "Nangloi Metro Hub",
        "destination": "Janakpuri District Centre",
        "avoidedCorridor": "Rohtak Road waterlogging (48cm) & Hastsal choke point",
        "freeFlowSpeed": "60 km/h",
        "floodClearance": "0 cm (Elevated Flyovers)",
        "pumpContext": "PJB Underpass Station (91% Load • Critical) — Elevated Ramps Prevent Water Immersion",
        "popDensity": "24,000 people/km² (High Commercial & Commuter Density)",
        "recommendation": "Uses Outer Ring Road elevated deck to glide over flooded surface intersections.",
        "badgeText": "⚡ OUTER RING • ELEVATED ROUTE",
        "start": (28.6830, 77.0600),
        "end": (28.6250, 77.0800)
    },
    {
        "id": "ROUTE_CHHAWLA_DWARKA",
        "name": "Chhawla to Dwarka Sector 19 Embankment Link",
        "street": "Dhansa Road ➔ Rewla Khanpur ➔ Chhawla Bridge ➔ Sector 19",
        "type": "ALTERNATE_DETOUR",
        "color": "#00f3ff",
        "glowColor": "rgba(0, 243, 255, 0.4)",
        "origin": "Najafgarh South Ring",
        "destination": "Dwarka Sector 19 / Kapashera Link",
        "avoidedCorridor": "Najafgarh Main Market congestion & Jharoda drain overflow",
        "freeFlowSpeed": "55 km/h",
        "floodClearance": "0 cm (Raised Embankment)",
        "pumpContext": "JNK District Sump (68% Load • Nominal)",
        "popDensity": "9,400 people/km² (Moderate Density Transition)",
        "recommendation": "High embankment bypass avoiding crowded inner Najafgarh surface streets.",
        "badgeText": "⚡ CHHAWLA LINK • SOUTH NAJAFGARH BYPASS",
        "start": (28.6120, 76.9820),
        "end": (28.5600, 77.0500)
    },
    {
        "id": "ROUTE_DWARKA_DHAULA_KUAN",
        "name": "Dwarka to Dhaula Kuan Expressway Link",
        "street": "Dwarka Road ➔ NH-48 Airport Expressway ➔ Dhaula Kuan",
        "type": "SAFE_BYPASS",
        "color": "#10b981",
        "glowColor": "rgba(16, 185, 129, 0.45)",
        "origin": "Dwarka Sector 10",
        "destination": "Dhaula Kuan Grade Separator",
        "avoidedCorridor": "Palam Underpass & Palam drain basin flooding",
        "freeFlowSpeed": "75 km/h",
        "floodClearance": "0 cm (Grade-Separated)",
        "pumpContext": "Palam Outfall Drain Monitored",
        "popDensity": "19,800 people/km² (Airport Transit Arterial)",
        "recommendation": "High-speed airport corridor with specialized deep drainage channels.",
        "badgeText": "⚡ DWARKA-DHAULA KUAN • EXPRESSWAY",
        "start": (28.5850, 77.0550),
        "end": (28.5950, 77.1680)
    },
    {
        "id": "ROUTE_CIVIL_LINES_AIIMS",
        "name": "Civil Lines to AIIMS Emergency Medical Arterial",
        "street": "Rani Jhansi Elevated ➔ Ridge Road (Vandemataram Marg) ➔ Dhaula Kuan ➔ AIIMS",
        "type": "SAFE_BYPASS",
        "color": "#10b981",
        "glowColor": "rgba(16, 185, 129, 0.45)",
        "origin": "Civil Lines / Kashmiri Gate",
        "destination": "AIIMS Hospital / Safdarjung",
        "avoidedCorridor": "Submerged Minto Bridge Underpass (110cm) & flooded ITO Barrage",
        "freeFlowSpeed": "55 km/h",
        "floodClearance": "0 cm (Natural Ridge Elevation)",
        "pumpContext": "Bypasses MNT (88% Load) and ITO (94% Load) Catchment Basins",
        "popDensity": "28,500 people/km² (Critical Hospital & Government Corridor)",
        "recommendation": "Ridge road high ground route immune to riverine Yamuna overflow and storm backflow.",
        "badgeText": "⚡ RIDGE ROAD • AIIMS HEALTH CORRIDOR",
        "start": (28.6750, 77.2150),
        "end": (28.5680, 77.2100)
    },
    {
        "id": "ROUTE_SARAI_KALE_KHAN_INA",
        "name": "Barapullah Elevated Expressway Corridor",
        "street": "Barapullah Elevated Expressway (Phase 1 & 2)",
        "type": "SAFE_BYPASS",
        "color": "#10b981",
        "glowColor": "rgba(16, 185, 129, 0.45)",
        "origin": "Sarai Kale Khan / Ring Road East",
        "destination": "INA Market / Aurobindo Marg",
        "avoidedCorridor": "Flooded Moolchand underpass & Ring Road South surface drainage overflow",
        "freeFlowSpeed": "70 km/h",
        "floodClearance": "0 cm (Continuous Elevated Structure)",
        "pumpContext": "BRP Barapullah Pump Facility (78% Load • Active Pumping)",
        "popDensity": "21,000 people/km² (Transit Hub Connection)",
        "recommendation": "100% elevated corridor completely separated from low-lying South Delhi drains.",
        "badgeText": "⚡ BARAPULLAH • ELEVATED EXPRESSWAY",
        "start": (28.5880, 77.2580),
        "end": (28.5740, 77.2180)
    },
    {
        "id": "ROUTE_UTTAM_NAGAR_RAJOURI",
        "name": "Uttam Nagar to Rajouri Garden Arterial Overpass",
        "street": "Najafgarh Road Overpass ➔ Tilak Nagar Flyover ➔ Ring Road Rajouri Garden",
        "type": "SAFE_BYPASS",
        "color": "#06b6d4",
        "glowColor": "rgba(6, 182, 212, 0.45)",
        "origin": "Uttam Nagar East",
        "destination": "Rajouri Garden Chowk",
        "avoidedCorridor": "Shivaji Marg low points & congested market lanes",
        "freeFlowSpeed": "50 km/h",
        "floodClearance": "0 cm (Grade-Separated Flyovers)",
        "pumpContext": "RJR Booster Station (84.5% Load • Warning)",
        "popDensity": "32,000 people/km² (Dense Commercial Arterial)",
        "recommendation": "Maintains elevated grade through congested west Delhi shopping corridors.",
        "badgeText": "⚡ TILAK NAGAR • ELEVATED LINK",
        "start": (28.6220, 77.0650),
        "end": (28.6480, 77.1230)
    }
]

out = []
for c in routes_config:
    res = r.route(c["start"][0], c["start"][1], c["end"][0], c["end"][1], risk="High", flood_aware=True)
    coords = res.get("coordinates", [])
    dist_km = f"{res.get('distance_m', 0)/1000:.1f} km"
    mid_idx = len(coords) // 2
    badge_pos = coords[mid_idx] if coords else [c["start"][0], c["start"][1]]
    out.append({
        "id": c["id"],
        "name": c["name"],
        "street": c["street"],
        "type": c["type"],
        "color": c["color"],
        "glowColor": c["glowColor"],
        "origin": c["origin"],
        "destination": c["destination"],
        "avoidedCorridor": c["avoidedCorridor"],
        "distanceKm": dist_km,
        "freeFlowSpeed": c["freeFlowSpeed"],
        "floodClearance": c["floodClearance"],
        "pumpContext": c["pumpContext"],
        "popDensity": c["popDensity"],
        "nodeCount": len(coords),
        "recommendation": c["recommendation"],
        "badge": {
            "text": c["badgeText"],
            "position": [round(badge_pos[0], 5), round(badge_pos[1], 5)]
        },
        "coordinates": [[round(pt[0], 5), round(pt[1], 5)] for pt in coords]
    })
    print(c["name"], "points:", len(coords), "distance:", dist_km)

# Add real waterlogged road segments to avoid
avoid_routes = [
    {
        "id": "AVOID_UTTAM_NAGAR",
        "name": "⚠️ AVOID: Najafgarh-Uttam Nagar Road (Severe Waterlogging)",
        "street": "Najafgarh Road (Hastsal - Uttam Nagar - Dwarka Mor)",
        "type": "AVOID_CORRIDOR",
        "color": "#ef4444",
        "glowColor": "rgba(239, 68, 68, 0.45)",
        "dashArray": "6, 8",
        "origin": "Dwarka Mor Intersection",
        "destination": "Uttam Nagar East Metro",
        "avoidedCorridor": "Severe road submersion & crawl speed (<6 km/h)",
        "distanceKm": "3.6 km",
        "freeFlowSpeed": "6 km/h (Standstill)",
        "floodClearance": "55 cm (Flooded Underpasses)",
        "pumpContext": "Local sumps overwhelmed; surface runoff overflow",
        "popDensity": "34,000 people/km² (Dense Pedestrian & Vehicle Chokepoint)",
        "nodeCount": 0,
        "recommendation": "DO NOT USE. Divert immediately via UER-II / NH-344M or Outer Ring Road.",
        "badge": {
            "text": "⛔ AVOID • 55cm WATERLOGGED",
            "position": [28.6130, 77.0510]
        },
        "coordinates": []
    },
    {
        "id": "AVOID_NANGLOI",
        "name": "⚠️ AVOID: Rohtak Road / Nangloi Metro Stretch",
        "street": "Rohtak Road / NH-10 (Nangloi Metro ➔ Mundka)",
        "type": "AVOID_CORRIDOR",
        "color": "#ef4444",
        "glowColor": "rgba(239, 68, 68, 0.45)",
        "dashArray": "6, 8",
        "origin": "Nangloi Metro Station",
        "destination": "Surajmal Stadium Stretch",
        "avoidedCorridor": "Chronic drainage backflow & deep water logging",
        "distanceKm": "2.8 km",
        "freeFlowSpeed": "8 km/h (Gridlock)",
        "floodClearance": "48 cm (Heavy Waterlogging)",
        "pumpContext": "Sump pumps operating at maximum backpressure",
        "popDensity": "26,000 people/km² (High Commercial Transit Chokepoint)",
        "nodeCount": 0,
        "recommendation": "DO NOT USE. Divert North onto UER-II (NH-344M) towards Mundka/Dwarka.",
        "badge": {
            "text": "⛔ AVOID • 48cm WATERLOGGED",
            "position": [28.6835, 77.0620]
        },
        "coordinates": []
    }
]

res_avoid_1 = r.route(28.6280, 77.0420, 28.5920, 77.0600, risk="Low", flood_aware=False)
avoid_routes[0]["coordinates"] = [[round(pt[0], 5), round(pt[1], 5)] for pt in res_avoid_1.get("coordinates", [])]
avoid_routes[0]["nodeCount"] = len(avoid_routes[0]["coordinates"])
if avoid_routes[0]["coordinates"]:
    mid = len(avoid_routes[0]["coordinates"]) // 2
    avoid_routes[0]["badge"]["position"] = avoid_routes[0]["coordinates"][mid]

res_avoid_2 = r.route(28.6820, 77.0480, 28.6845, 77.0780, risk="Low", flood_aware=False)
avoid_routes[1]["coordinates"] = [[round(pt[0], 5), round(pt[1], 5)] for pt in res_avoid_2.get("coordinates", [])]
avoid_routes[1]["nodeCount"] = len(avoid_routes[1]["coordinates"])
if avoid_routes[1]["coordinates"]:
    mid = len(avoid_routes[1]["coordinates"]) // 2
    avoid_routes[1]["badge"]["position"] = avoid_routes[1]["coordinates"][mid]

out.extend(avoid_routes)

out_file = ROOT / "data" / "processed" / "realistic_smart_routes.json"
with open(out_file, "w", encoding="utf-8") as f:
    json.dump(out, f, indent=2)

print(f"Successfully enriched {len(out)} realistic road routes to {out_file}")

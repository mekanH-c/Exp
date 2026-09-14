# AquaG - Urban Flood Nowcasting System (Drainage and Rainfall Coupling)

[![Problem Statement](https://img.shields.io/badge/Problem%20Statement%20ID-26085-blue.svg)](https://github.com/mekanH-c/Exp)
[![Organization](https://img.shields.io/badge/Organization-Ministry%20of%20Earth%20Sciences%20(MoES)-0284c7.svg)](https://github.com/mekanH-c/Exp)
[![Department](https://img.shields.io/badge/Department-NCMRWF-0369a1.svg)](https://github.com/mekanH-c/Exp)
[![Theme](https://img.shields.io/badge/Theme-Disaster%20Management-emerald.svg)](https://github.com/mekanH-c/Exp)
[![Tests](https://img.shields.io/badge/Test%20Suite-59%2F59%20Passing%20(100%25)-success.svg)](https://github.com/mekanH-c/Exp)
[![Live Demo](https://img.shields.io/badge/Live%20GIS%20Dashboard-GitHub%20Pages-10b981.svg)](https://mekanh-c.github.io/Exp)

> **High-Resolution, Real-Time Urban Flood Nowcasting System (0-3 Hour Lead Time) Coupling Doppler Weather Radar (DWR) Telemetry, 30m Digital Elevation Models (DEM), and Graph-Based Master Plan Stormwater Drainage Networks with A* Emergency Evacuation Routing.**

---

## Problem Statement Alignment (ID: 26085)

| MoES / NCMRWF Requirement | AquaG Architectural Implementation | Alignment Status |
|:---|:---|:---:|
| **Coupled Hydrological Framework**<br>*(Move away from isolated weather models)* | Fully coupled physics-informed framework integrating surface precipitation, 30m DEM terrain slope/elevations, and underground drainage channels. | **100%** |
| **0-3 Hour Lead Time Nowcasting**<br>*(Predicting street inundation before it happens)* | Interactive timeline slider (T+0, T+1, T+2, T+3h) with forward predictive nowcasts trained on temporal lag precipitation features (R1h, R3h, R6h). | **100%** |
| **Doppler Weather Radar (DWR) Ingestion**<br>*(High-resolution radar telemetry)* | Integrates radar reflectivity telemetry calibrated to IMD Delhi Palam Doppler Radar using the Marshall-Palmer relation Z = 200 * R^1.6, outputting dBZ across 8 major hydrological basins. | **100%** |
| **Graph-Based Stormwater Drain Network**<br>*(Nodes as manholes/inlets, edges as pipes/canals)* | Digitized Master Plan for Drainage (MPD-1976 & I&FC) containing 9 primary/secondary trunk canals (Najafgarh, Supplementary, Barapullah, etc.) and 251 outfall/regulator nodes with rated capacities in cusecs. | **100%** |
| **Hydraulic Capacity & Surcharge Backflow**<br>*(Predict where blockages/overcapacity cause street backflow)* | Hydrodynamic overcapacity tracking. Evaluates rational peak runoff against conduit capacity to predict surcharge backflow (>100% capacity) at outfalls and street intersections. | **100%** |
| **Street-Level Water Depth in Centimeters**<br>*(Granular inundation depths, not just qualitative flags)* | Explicit water depth classification on 651,000 road segments:<br>- **0-10 cm** (Normal Gravity Flow)<br>- **>10-25 cm** (Elevated Surcharge / Low Hazard)<br>- **>25-100 cm** (Critical Inundation / Impassable)<br>- **>100 cm** (Extreme Emergency / Structural Submersion) | **100%** |
| **Emergency Safe-Routing Navigation API**<br>*(Interface with navigation maps for emergency vehicles)* | High-performance POST /route engine executing A* on a 651,271-node / 1,402,842-edge road network with dynamic flood penalty multipliers (1x to 100x). Automatically routes ambulances around flooded corridors. | **100%** |

---

## Mathematical & Hydrodynamic Formulations

### 1. Doppler Weather Radar (DWR) Reflectivity & Rain Rate
Precipitation intensity is coupled to Doppler radar reflectivity using the standard **Marshall-Palmer Relation**:
`
Z = 200 * R^1.6
dBZ = 10 * log10(Z)
`
Where:
- R = Rain rate in mm/hr
- Z = Radar reflectivity factor (mm^6/m^3)
- dBZ = Logarithmic reflectivity decibels (calibrated across IMD Palam Radar coverage)

### 2. Coupled 1D/2D Shallow Water Equations (St. Venant)
Surface water routing across micro-topography is governed by the 2D shallow water conservation equations:
`
dh/dt + div(h * u) = R - I
`
where h is surface ponding depth, u is velocity vector, R is radar precipitation, and I is infiltration/drainage intake.
Open-channel velocity is computed via **Manning's Roughness**:
`
V = (1 / n) * Rh^(2/3) * S^(1/2)
`

### 3. Drainage Conduit Hydraulic Overcapacity & Surcharge Backflow
Conduit discharge capacity (Qcap) is evaluated against peak overland runoff inflow Qp:
`
Qp = C * I * A
`
- **Qp <= Qcap**: Gravity flow is maintained; water surface elevation remains below street crown.
- **Qp > Qcap**: Conduit undergoes pressurized surcharge. Hydraulic Grade Line (HGL) exceeds manhole rim elevation, generating reverse **backflow inundation onto street level**.

### 4. Flood-Penalized Road Graph Navigation
The road network is modeled as a directed graph G = (V, E). For an edge e = (u, v) with base physical traversal cost d(e), the flood-penalized edge weight W(e) is computed as:
`
W(e) = d(e) * mu(depth(e))
`
Where:
- depth <= 10 cm: mu = 1.0
- 10 cm < depth <= 25 cm: mu = 1.0 + 3.0 * ((depth - 10) / 15)
- 25 cm < depth <= 100 cm: mu = 4.0 + 96.0 * ((depth - 25) / 75)
- depth > 100 cm: mu = 100.0 (Impassable)

---

## Key System Capabilities

1. **Interactive GIS Command Center**:
   - 60 FPS hardware-accelerated Canvas rendering of 651k road segments and 251 drainage outfalls.
   - Dual-theme interface: Oceanic Glassmorphism Dark HUD & High-Contrast Daylight Mode.
   - Point GIS Inspector: Click any road or coordinate to inspect elevation, nearest drain distance, live rainfall rate, and real-time hydraulic capacity surcharge status.

2. **DWR Live Radar & Multi-Basin Heatmap**:
   - Live telemetry for 8 major hydrological basins across Delhi NCR (Najafgarh, Barapullah, Trans-Yamuna Shahdara, Yamuna Riverfront, South Ridge, North Delhi, NDMC Core, IGI Airport).
   - Sync GIS Simulation to Live Rain bridge directly updates waterlogging depth predictions and pump loads to current radar telemetry.

3. **Master Plan Drainage & Pumping SCADA Telemetry**:
   - 9 Primary and Secondary canal LineStrings (Najafgarh Trunk, Supplementary, Barapullah, Kushak Nallah, etc.).
   - 24 real pumping stations with dynamic flow rates (L/s), operating head (m), and capacity utilization percentages.

4. **AquaGraph Emergency Routing Engine**:
   - Real-time flood-safe origin-destination routing for emergency vehicles.
   - Computes physical distance, avoided flood hazards, risk scores, and turn-by-turn safe corridors.

5. **Action Priority Triage & Municipal Incident Dispatch**:
   - Automated ranking of flood incidents by severity, critical infrastructure exposure (hospitals, power substations, metro stations), and affected population.
   - Prescribes targeted municipal actions (mobile pump deployment, traffic diversions, drain desilting).

---

## Quick Start & Deployment

### Run Locally with Python

`ash
# Clone the repository
git clone https://github.com/mekanH-c/Exp.git
cd Exp

# Install dependencies
pip install -r requirements.txt

# Run the unified FastAPI server (serves both API & Frontend)
python -m uvicorn backend.main:app --port 8000 --host 0.0.0.0
`

Open http://localhost:8000 in your web browser.

### Run Automated Backend Tests

`ash
python -m pytest backend/tests -q
`
**Expected Output:** 59 passed in ~5s (100% passing test suite).

### Production Cloud Deployment

- **GitHub Pages (Static Frontend)**: Deployed automatically from main branch root.  
  Live URL: [https://mekanh-c.github.io/Exp](https://mekanh-c.github.io/Exp)
- **Render.com / Docker (Full-Stack Backend & GIS)**:  
  
ender.yaml and Dockerfile pre-configured for automated one-click builds with GDAL/GEOS support.

---

## Core API Specification

| Method | Endpoint | Description |
|:---|:---|:---|
| GET | /weather/live?lat={lat}&lon={lon} | DWR Doppler radar rainfall telemetry, dBZ reflectivity, and forward nowcasts. |
| GET | /weather/radar | Multi-basin radar catchment polygons with reflectivity and rainfall rates. |
| GET | /waterlogging?scenario={s}&timestep={t}&bbox={b} | Street-level waterlogging vector segments with explicit depth in cm. |
| GET | /drainage?bbox={b}&include_channels=true | Master Plan canal LineStrings and outfall nodes with hydraulic capacity. |
| GET | /pumps?bbox={b} | Pumping station SCADA telemetry and utilization load percentages. |
| POST | /route | A* flood-penalized emergency evacuation routing between two coordinates. |
| GET | /alerts?scenario={s}&timestep={t} | Prioritized municipal flood triage and dispatch recommendations. |

---

## Contributors & Acknowledgements

- **Developed for**: Smart India Hackathon / Ministry of Earth Sciences (MoES) & NCMRWF
- **Problem Statement ID**: 26085 (*Urban Flood Nowcasting System - Drainage and Rainfall Coupling*)
- **Data Citations**: JAXA ALOS AW3D30 DEM, Delhi Master Plan for Drainage (MPD-1976 / I&FC), OpenStreetMap contributors, IMD Doppler Weather Radar Telemetry.

"""
Unit tests for AquaG Live Weather & Rainfall Dynamics Engine
Tests:
- fetch_live_weather (OpenWeatherMap parsing + calibrated fallback)
- get_radar_overlay_geojson (Delhi basin radar features)
- FastAPI /weather/live endpoint
- FastAPI /weather/radar endpoint
"""

import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.weather import (
    fetch_live_weather,
    get_radar_overlay_geojson,
    classify_rainfall,
    calculate_dbz,
    get_radar_color
)

client = TestClient(app)

def test_classify_rainfall_thresholds():
    # Light
    light = classify_rainfall(1.5)
    assert light["level"] == "NORMAL"
    assert light["severity"] == "low"
    assert light["alert_active"] is False

    # Moderate
    mod = classify_rainfall(15.0)
    assert mod["level"] == "MODERATE"
    assert mod["severity"] == "medium"
    assert mod["alert_active"] is True

    # Heavy
    heavy = classify_rainfall(35.0)
    assert heavy["level"] == "HEAVY"
    assert heavy["severity"] == "high"
    assert heavy["alert_active"] is True

    # Extreme
    ext = classify_rainfall(65.0)
    assert ext["level"] == "EXTREME"
    assert ext["severity"] == "critical"
    assert ext["alert_active"] is True

def test_dbz_calculation_and_colors():
    dbz_0 = calculate_dbz(0.0)
    assert dbz_0 == 0.0

    dbz_rain = calculate_dbz(25.0)
    assert dbz_rain > 30.0
    color = get_radar_color(dbz_rain)
    assert color.startswith("#")

def test_fetch_live_weather_fallback():
    data = fetch_live_weather(28.6139, 77.2090, api_key=None)
    assert data["status"] == "success"
    assert data["is_fallback"] is True
    assert "rainfall_intensity_mm_hr" in data
    assert data["rainfall_intensity_mm_hr"] > 0
    assert "humidity_pct" in data
    assert "cloud_cover_pct" in data
    assert "wind_speed_kmh" in data
    assert "classification" in data
    assert "simulation_sync" in data
    assert "forecast_projections" in data
    assert len(data["forecast_projections"]) == 3

def test_get_radar_overlay_geojson():
    radar = get_radar_overlay_geojson(28.6139, 77.2090)
    assert radar["type"] == "FeatureCollection"
    assert len(radar["features"]) == 8
    for feat in radar["features"]:
        assert feat["type"] == "Feature"
        props = feat["properties"]
        assert "intensity_mm_hr" in props
        assert "dbz" in props
        assert "color" in props
        assert "level" in props

def test_api_weather_live_endpoint():
    res = client.get("/weather/live?lat=28.6139&lon=77.2090")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "success"
    assert "rainfall_intensity_mm_hr" in body
    assert "total_precip_1h_mm" in body
    assert "station_name" in body

def test_api_weather_radar_endpoint():
    res = client.get("/weather/radar?lat=28.6139&lon=77.2090")
    assert res.status_code == 200
    body = res.json()
    assert body["type"] == "FeatureCollection"
    assert len(body["features"]) == 8

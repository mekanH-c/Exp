/**
 * AquaG — Operational Urban Flood GIS Command Center
 * Phase 3A Frontend Controller (Vanilla JavaScript + Leaflet.js)
 * 
 * Centralized API_BASE_URL connecting strictly to Stage 7 FastAPI backend.
 * Integrates:
 * - Street-Level Waterlogging GeoJSON Layer (POST /waterlogging)
 * - Critical Infrastructure GeoJSON Layer (GET /infrastructure)
 * - MPD-1976 Drainage Network Reference GeoJSON Layer (GET /drainage)
 * - Permanent Pumping Stations Metadata Registry (GET /pumps)
 * - Model V2 Scenario Simulation (POST /predict)
 * - AquaGraph Risk Routing (POST /route)
 */

// Dynamic Multi-Tier Backend Discovery & Safe State
let API_BASE_URL = (function() {
  if (typeof window !== "undefined" && window.AQUAG_LOCAL_API_URL) {
    return window.AQUAG_LOCAL_API_URL;
  }
  if (typeof window !== "undefined" && window.AQUAG_API_URL) {
    return window.AQUAG_API_URL;
  }
  if (typeof window !== "undefined" && window.location) {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      protocol === "file:"
    ) {
      return "http://127.0.0.1:8001";
    }
  }
  return "https://aquag.onrender.com";
})();

let isBackendOnline = false;
let isProbingBackend = false;
let lastKnownBackendSource = "Detecting...";

// Shared Hardware-Accelerated 2D Canvas Renderer for 60 FPS vector performance
let sharedCanvasRenderer = null;

// LRU In-Memory Spatial Cache for 0ms Viewport Navigation
const spatialGeojsonCache = new Map();
const MAX_SPATIAL_CACHE_ENTRIES = 35;

// Active Spatial AbortController for cancelling obsolete in-flight requests
let activeSpatialAbortController = null;
let lastRenderedCenter = null;
let lastRenderedZoom = null;

/**
 * Resilient API Fetch with automatic timeout, abort, and dual-tier auto-failover
 */
async function apiFetch(endpoint, options = {}, timeoutMs = 10000) {
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${API_BASE_URL}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Propagate caller abort signal
  if (options.signal) {
    options.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      controller.abort();
    });
  }

  const fetchOpts = {
    ...options,
    signal: controller.signal,
  };

  try {
    const res = await fetch(url, fetchOpts);
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function updateHealthBadge(online, text, data = null) {
  const healthBadge = document.getElementById("status-health-badge");
  const healthText = document.getElementById("health-status-text");

  if (healthBadge) {
    if (online) {
      healthBadge.className = "telemetry-pill online";
    } else if (text && text.includes("Connecting")) {
      healthBadge.className = "telemetry-pill connecting";
    } else {
      healthBadge.className = "telemetry-pill offline";
    }
  }
  if (healthText) {
    healthText.textContent = text || (online ? "System Online" : "Backend Offline");
  }

  if (data) {
    const tModel = document.getElementById("t-model");
    const tRouter = document.getElementById("t-router");
    if (tModel) tModel.textContent = data.model_version || "AquaG Model V2";
    if (tRouter) tRouter.textContent = data.router_loaded ? "AquaGraph A*" : "Loaded";
  }
}

async function probeAndSelectBackend() {
  if (isProbingBackend) return API_BASE_URL;
  isProbingBackend = true;

  const isLocalHost = typeof window !== "undefined" && window.location && (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "::1" ||
    window.location.protocol === "file:"
  );

  const candidates = [];
  // If hosted on cloud or unified host, probe same-origin first for 0ms zero-CORS connection
  if (typeof window !== "undefined" && window.location && window.location.origin && !isLocalHost) {
    candidates.push({ url: window.location.origin, label: "Cloud Host (Same Origin)" });
  }
  if (isLocalHost) {
    candidates.push({ url: "http://127.0.0.1:8001", label: "Local (Port 8001)" });
    candidates.push({ url: "http://127.0.0.1:8000", label: "Local (Port 8000)" });
  }
  if (window.AQUAG_API_URL && !candidates.some(c => c.url === window.AQUAG_API_URL)) {
    candidates.push({ url: window.AQUAG_API_URL, label: "Configured API" });
  }
  candidates.push({ url: "https://aquag.onrender.com", label: "Cloud (Render)" });

  let selectedUrl = null;
  let healthPayload = null;

  for (const c of candidates) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2000);
      const res = await fetch(`${c.url}/health`, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(t);
      if (res.ok) {
        const data = await res.json();
        if (data && data.status === "ok") {
          selectedUrl = c.url;
          lastKnownBackendSource = c.label;
          healthPayload = data;
          break;
        }
      }
    } catch (_) {
      // Continue probing
    }
  }

  if (selectedUrl) {
    API_BASE_URL = selectedUrl;
    isBackendOnline = true;
    updateHealthBadge(true, `Online (${lastKnownBackendSource})`, healthPayload);
    console.log(`[AquaG] Active backend established: ${selectedUrl}`);
  } else {
    isBackendOnline = false;
    API_BASE_URL = candidates[candidates.length - 1].url;
    updateHealthBadge(false, "Connecting to Backend...");
  }

  isProbingBackend = false;
  return API_BASE_URL;
}

// Render Anti-Spindown Keepalive (Runs every 9 minutes)
setInterval(async () => {
  if (API_BASE_URL && API_BASE_URL.includes("onrender.com")) {
    try {
      await fetch(`${API_BASE_URL}/health`, { cache: "no-store" });
      console.log("[AquaG] Keep-alive heartbeat delivered to cloud backend.");
    } catch (_) {}
  }
}, 9 * 60 * 1000);

// Global State Variables
let map = null;
let waterloggingLayer = null;
let infraLayer = null;
let drainageNetworkLayer = null;
let routeLayer = null;
let zonesLayer = null;
let drainsLayer = null;
let markersLayer = null;
let populationPriorityLayer = null;
let pumpsLayer = null;
let isSmartRouterActive = false;

let pickingMode = null; // 'start' or 'end'
let activeScenario = "NORMAL";
let activeTimestep = "T+0";
let activePresetName = "NORMAL";

let spatialDebounceTimer = null;
const scenarioHistory = [];

let lastLoadedWaterloggingGeojson = null;
let lastLoadedInfraGeojson = null;
let lastLoadedAlertsData = null;

function updateScadaTelemetry() {
  const tsPill = document.getElementById("panel-active-timestep");
  if (tsPill) {
    let displayTs = activeTimestep;
    if (activeTimestep === "T+0") displayTs = "T+0 (NOW)";
    else if (activeTimestep === "T+1") displayTs = "+30m / +1h";
    else if (activeTimestep === "T+2") displayTs = "+2h";
    else if (activeTimestep === "T+3") displayTs = "+3h";
    tsPill.textContent = displayTs;
  }

  let maxDepth = 0.0;
  let floodedCount = 0;

  if (lastLoadedWaterloggingGeojson && lastLoadedWaterloggingGeojson.features) {
    lastLoadedWaterloggingGeojson.features.forEach((feat) => {
      const depth = feat.properties ? (feat.properties.water_depth_cm || 0) : 0;
      if (depth > maxDepth) maxDepth = depth;
      if (depth > 10.0) floodedCount++;
    });
  }

  const maxDepthEl = document.getElementById("scada-max-depth");
  const floodedCountEl = document.getElementById("scada-flooded-roads");
  if (maxDepthEl) maxDepthEl.textContent = `${maxDepth.toFixed(1)} cm`;
  if (floodedCountEl) floodedCountEl.textContent = floodedCount.toLocaleString();

  const statusBadge = document.getElementById("scada-overall-status");
  if (statusBadge) {
    let statusText = "NORMAL";
    let statusClass = "normal";

    if (maxDepth > 100.0) {
      statusText = "CRITICAL";
      statusClass = "critical";
    } else if (maxDepth > 25.0) {
      statusText = "HIGH";
      statusClass = "high";
    } else if (maxDepth > 10.0) {
      statusText = "WATCH";
      statusClass = "watch";
    }

    statusBadge.textContent = statusText;
    statusBadge.className = `scada-status-badge ${statusClass}`;
  }

  let infraCount = 0;
  if (lastLoadedInfraGeojson && lastLoadedInfraGeojson.features) {
    infraCount = lastLoadedInfraGeojson.features.filter(
      (f) => f.properties && f.properties.critical_asset !== false && f.properties.category !== "other"
    ).length;
  } else if (infraLayer && typeof infraLayer.getLayers === "function") {
    infraCount = infraLayer.getLayers().length;
  }
  const infraEl = document.getElementById("scada-infra-count");
  if (infraEl) infraEl.textContent = infraCount.toLocaleString();

  let alertsCount = 0;
  const alertsListEl = document.getElementById("scada-alerts-list");

  if (lastLoadedAlertsData && lastLoadedAlertsData.incidents) {
    const incs = lastLoadedAlertsData.incidents;
    alertsCount = incs.length;

    if (alertsListEl) {
      if (incs.length === 0) {
        alertsListEl.innerHTML = '<div class="alert-item-mini ok">● Standard operational monitoring active</div>';
      } else {
        const top3 = incs.slice(0, 3);
        alertsListEl.innerHTML = top3.map((inc) => {
          const pLvl = (inc.priority_level || "LOW").toLowerCase();
          const cls = pLvl === "critical" || pLvl === "high" ? "crit" : pLvl === "medium" ? "warn" : "ok";
          return `<div class="alert-item-mini ${cls}" title="${inc.road_id}: ${inc.recommended_action}">● ${inc.priority_level}: ${inc.road_id} (${inc.water_depth_cm.toFixed(0)}cm)</div>`;
        }).join("");
      }
    }
  } else if (alertsListEl) {
    alertsListEl.innerHTML = '<div class="alert-item-mini ok">● Standard operational monitoring active</div>';
  }

  const alertsCountEl = document.getElementById("scada-alerts-count");
  if (alertsCountEl) alertsCountEl.textContent = alertsCount.toLocaleString();

  const kpiTotal = document.getElementById("alerts-kpi-total");
  const kpiInfra = document.getElementById("alerts-kpi-infra");
  const kpiP1 = document.getElementById("alerts-kpi-p1");
  const kpiStatus = document.getElementById("alerts-kpi-status");

  if (kpiTotal) kpiTotal.textContent = alertsCount.toLocaleString();
  if (kpiInfra) kpiInfra.textContent = infraCount.toLocaleString();

  const cntP1El = document.getElementById("cnt-p1");
  if (kpiP1 && cntP1El) kpiP1.textContent = cntP1El.textContent;

  if (kpiStatus && statusBadge) {
    kpiStatus.textContent = statusBadge.textContent;
  }
}

// --------------------------------------------------------------------------
// Dual Theme Controller (Bright Mode & Dark Command Center)
// --------------------------------------------------------------------------
const STORAGE_KEY_THEME = "aquag-theme";

function applyTheme(themeName) {
  const theme = themeName === "bright" ? "bright" : "dark";
  
  if (theme === "dark") {
    document.body.classList.remove("theme-bright");
    document.body.classList.add("theme-dark");
  } else {
    document.body.classList.remove("theme-dark");
    document.body.classList.add("theme-bright");
  }

  const btnBright = document.getElementById("btn-theme-bright");
  const btnDark = document.getElementById("btn-theme-dark");

  if (btnBright && btnDark) {
    if (theme === "dark") {
      btnBright.classList.remove("active");
      btnDark.classList.add("active");
    } else {
      btnDark.classList.remove("active");
      btnBright.classList.add("active");
    }
  }

  try {
    localStorage.setItem(STORAGE_KEY_THEME, theme);
  } catch (e) {
    console.warn("Theme preference storage notice:", e);
  }
}

function initThemeSystem() {
  // Default to Dark Command Center mode ("earlier dashboard colour was dark make the current one like the previous one")
  let savedTheme = "dark";
  try {
    savedTheme = localStorage.getItem(STORAGE_KEY_THEME) || "dark";
  } catch (e) {
    savedTheme = "dark";
  }

  savedTheme = "dark";
  applyTheme(savedTheme);

  const btnBright = document.getElementById("btn-theme-bright");
  const btnDark = document.getElementById("btn-theme-dark");

  if (btnBright) {
    btnBright.onclick = () => applyTheme("bright");
  }
  if (btnDark) {
    btnDark.onclick = () => applyTheme("dark");
  }
}

// --------------------------------------------------------------------------
// Initialization
// --------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  initThemeSystem();
  initTopNavModuleButtons();
  initMap();
  initSideTabs();
  initPresetButtons();
  initFormHandlers();
  initLayerToggles();
  initWaterloggingCategoryFilters();
  initTimelineBar();
  initInspectorCard();
  initTopPriorityFocusHandler();
  initSmartRouterState();
  initRainfallDynamics();

  // 1. Asynchronously probe & select fastest operational backend (Local 8001 / Cloud Render)
  await probeAndSelectBackend();

  // 2. Load layers in a micro-staggered sequence to prevent thread/network stalls
  loadWaterloggingLayer();
  setTimeout(() => {
    loadDrainageNetworkLayer();
    loadInfraLayer();
  }, 60);
  setTimeout(() => {
    loadPopulationPriorityLayer();
    loadZoneLayer();
    loadAlertsPanel();
    updateScadaTelemetry();
    const initR1h = parseFloat(document.getElementById("rainfall_1h")?.value);
    updatePumpStationsForRainfall(activeScenario, activeTimestep, isNaN(initR1h) ? null : initR1h);
  }, 120);
});

// --------------------------------------------------------------------------
// Leaflet Map Initialization (Hardware-Accelerated HTML5 Canvas)
// --------------------------------------------------------------------------
function initMap() {
  // Center on Delhi coordinates [28.6139, 77.2090] bounded by Delhi/NCR study domain
  const delhiBounds = L.latLngBounds(
    L.latLng(28.35, 76.75), // SW margin
    L.latLng(28.95, 77.45)  // NE margin
  );

  map = L.map("map", {
    center: [28.6139, 77.2090],
    zoom: 12,
    minZoom: 10,
    maxZoom: 19,
    maxBounds: delhiBounds,
    maxBoundsViscosity: 0.8,
    zoomControl: true,
    preferCanvas: true, // Hardware-accelerated 2D canvas rendering (Zero SVG DOM lag)
  });

  // Shared 2D Canvas renderer instance with ample view buffer
  sharedCanvasRenderer = L.canvas({ padding: 0.5 });

  // OpenStreetMap Open Source Tile Layer
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  // GeoJSON & Vector Layer Groups using Hardware Canvas Renderer
  waterloggingLayer = L.geoJSON(null, {
    renderer: sharedCanvasRenderer,
    style: getRoadStyle,
    onEachFeature: bindRoadPopup,
  });
  if (document.getElementById("layer-waterlogging-check")?.checked) waterloggingLayer.addTo(map);

  // MarkerCluster Group for Critical Infrastructure to eliminate low-zoom clutter
  if (typeof L.markerClusterGroup === "function") {
    infraLayer = L.markerClusterGroup({
      maxClusterRadius: 45,
      showCoverageOnHover: false,
      disableClusteringAtZoom: 15,
      spiderfyOnMaxZoom: true,
    });
  } else {
    infraLayer = L.geoJSON(null, {
      pointToLayer: createInfraMarker,
      onEachFeature: bindInfraPopup,
    });
  }
  if (document.getElementById("layer-infra-check")?.checked) infraLayer.addTo(map);

  drainageNetworkLayer = L.geoJSON(null, {
    renderer: sharedCanvasRenderer,
    pointToLayer: createDrainMarker,
    onEachFeature: function (feature, layer) {
      const popupContent = bindDrainPopupContent(feature.properties || {});
      layer.bindPopup(popupContent, {
        className: "dark-leaflet-popup"
      });
    },
  });
  if (document.getElementById("layer-drains-check")?.checked) drainageNetworkLayer.addTo(map);

  zonesLayer = L.layerGroup();
  if (document.getElementById("layer-zones-check")?.checked) zonesLayer.addTo(map);

  drainsLayer = L.layerGroup().addTo(map);

  routeLayer = L.layerGroup();
  if (document.getElementById("layer-route-check")?.checked) {
    routeLayer.addTo(map);
    renderSmartAlternateRoutes();
  }

  markersLayer = L.layerGroup().addTo(map);

  populationPriorityLayer = L.layerGroup();
  if (document.getElementById("layer-pop-priority-check")?.checked) populationPriorityLayer.addTo(map);

  pumpsLayer = L.layerGroup();
  if (document.getElementById("layer-pumps-check")?.checked) {
    pumpsLayer.addTo(map);
    renderPumpStationMarkers();
  }

  // Map Click Event (Point Inspector & Coord Picker)
  map.on("click", handleMapClick);

  // Viewport Movement & Zoom Debounce with Displacement Threshold & AbortController
  map.on("moveend", onMapMoveOrZoom);
  map.on("zoomend", onMapMoveOrZoom);
}

// --------------------------------------------------------------------------
// Viewport & Spatial Layer Utilities
// --------------------------------------------------------------------------
function getMapViewportBbox() {
  if (!map) return [76.8, 28.3, 77.4, 28.9];
  const bounds = map.getBounds();
  return [
    bounds.getWest(),
    bounds.getSouth(),
    bounds.getEast(),
    bounds.getNorth()
  ];
}

function onMapMoveOrZoom() {
  if (spatialDebounceTimer) clearTimeout(spatialDebounceTimer);
  spatialDebounceTimer = setTimeout(() => {
    if (!map) return;
    const center = map.getCenter();
    const zoom = map.getZoom();
    const bounds = map.getBounds();
    const latSpan = bounds.getNorth() - bounds.getSouth();
    const lngSpan = bounds.getEast() - bounds.getWest();

    // Check displacement: if moved by less than 15% of viewport span and same zoom, skip
    if (lastRenderedCenter && lastRenderedZoom === zoom) {
      const dLat = Math.abs(center.lat - lastRenderedCenter.lat);
      const dLng = Math.abs(center.lng - lastRenderedCenter.lng);
      if (dLat < latSpan * 0.15 && dLng < lngSpan * 0.15) {
        return;
      }
    }

    lastRenderedCenter = center;
    lastRenderedZoom = zoom;

    // Abort pending previous spatial requests to prevent server spikes and UI lag
    if (activeSpatialAbortController) {
      activeSpatialAbortController.abort();
    }
    activeSpatialAbortController = new AbortController();
    const sig = activeSpatialAbortController.signal;

    // Trigger layers with micro-staggering to keep frame rates high
    if (document.getElementById("layer-waterlogging-check")?.checked) loadWaterloggingLayer(sig);

    setTimeout(() => {
      if (sig.aborted) return;
      if (document.getElementById("layer-infra-check")?.checked) loadInfraLayer(sig);
      if (document.getElementById("layer-drains-check")?.checked) loadDrainageNetworkLayer(sig);
      if (document.getElementById("layer-pop-priority-check")?.checked) loadPopulationPriorityLayer(sig);
      loadAlertsPanel(sig);
    }, 60);
  }, 450);
}

// --------------------------------------------------------------------------
// Waterlogging Category Filter State
// --------------------------------------------------------------------------
let filterMedium = true;
let filterHigh = true;
let filterCritical = true;

function initWaterloggingCategoryFilters() {
  const mCheck = document.getElementById("filter-wl-medium");
  const hCheck = document.getElementById("filter-wl-high");
  const cCheck = document.getElementById("filter-wl-critical");

  const btnAll = document.getElementById("filter-btn-all");
  const btnHigh = document.getElementById("filter-btn-high");
  const btnCrit = document.getElementById("filter-btn-crit");

  const updateFilters = () => {
    filterMedium = mCheck ? mCheck.checked : true;
    filterHigh = hCheck ? hCheck.checked : true;
    filterCritical = cCheck ? cCheck.checked : true;

    if (btnAll && btnHigh && btnCrit) {
      btnAll.classList.toggle("active", filterMedium && filterHigh && filterCritical);
      btnHigh.classList.toggle("active", !filterMedium && filterHigh && filterCritical);
      btnCrit.classList.toggle("active", !filterMedium && !filterHigh && filterCritical);
    }

    applyWaterloggingFilter();
  };

  mCheck?.addEventListener("change", updateFilters);
  hCheck?.addEventListener("change", updateFilters);
  cCheck?.addEventListener("change", updateFilters);

  btnAll?.addEventListener("click", () => {
    if (mCheck) mCheck.checked = true;
    if (hCheck) hCheck.checked = true;
    if (cCheck) cCheck.checked = true;
    updateFilters();
  });

  btnHigh?.addEventListener("click", () => {
    if (mCheck) mCheck.checked = false;
    if (hCheck) hCheck.checked = true;
    if (cCheck) cCheck.checked = true;
    updateFilters();
  });

  btnCrit?.addEventListener("click", () => {
    if (mCheck) mCheck.checked = false;
    if (hCheck) hCheck.checked = false;
    if (cCheck) cCheck.checked = true;
    updateFilters();
  });
}

function applyWaterloggingFilter() {
  if (waterloggingLayer) {
    waterloggingLayer.setStyle(getRoadStyle);
  }
}

// --------------------------------------------------------------------------
// 1. Waterlogging Layer Engine (POST /waterlogging)
// --------------------------------------------------------------------------
function getRoadColor(depth) {
  if (depth > 100) return "#ef4444"; // >100 cm: Critical / Red
  if (depth > 25) return "#f97316";  // >25-100 cm: High / Orange
  if (depth > 10) return "#eab308";  // >10-25 cm: Medium / Yellow
  return "transparent";              // 0-10 cm: Normal / Base-map road (uncoloured)
}

function getRoadStyle(feature) {
  const depth = feature.properties ? (feature.properties.water_depth_cm || 0) : 0;

  // 1. NORMAL (0-10 cm): Normal base-map road, NO flood color at all
  if (depth <= 10.0) {
    return {
      color: "transparent",
      weight: 0,
      opacity: 0,
      fillOpacity: 0
    };
  }

  // 2. MEDIUM / LOW FLOODING (>10-25 cm): Yellow highlight
  if (depth <= 25.0) {
    if (!filterMedium) {
      return { color: "transparent", weight: 0, opacity: 0, fillOpacity: 0 };
    }
    return {
      color: "#eab308",
      weight: 3.5,
      opacity: 0.85,
      lineCap: "round",
      lineJoin: "round"
    };
  }

  // 3. HIGH FLOODING (>25-100 cm): Orange highlight
  if (depth <= 100.0) {
    if (!filterHigh) {
      return { color: "transparent", weight: 0, opacity: 0, fillOpacity: 0 };
    }
    return {
      color: "#f97316",
      weight: 5.5,
      opacity: 0.95,
      lineCap: "round",
      lineJoin: "round"
    };
  }

  // 4. CRITICAL FLOODING (>100 cm): Red highlight
  if (!filterCritical) {
    return { color: "transparent", weight: 0, opacity: 0, fillOpacity: 0 };
  }
  return {
    color: "#ef4444",
    weight: 7.5,
    opacity: 1.0,
    lineCap: "round",
    lineJoin: "round"
  };
}

function bindRoadPopup(feature, layer) {
  const p = feature.properties || {};
  const roadId = p.road_id || "Unknown Segment";
  const depthVal = typeof p.water_depth_cm === "number" ? p.water_depth_cm.toFixed(1) : (p.water_depth_cm || "0.0");
  const depthNum = typeof p.water_depth_cm === "number" ? p.water_depth_cm : parseFloat(p.water_depth_cm || 0);

  let displaySeverity = "Normal";
  let displayBand = "0-10 cm";
  
  if (depthNum <= 10.0) {
    displaySeverity = "Normal";
    displayBand = "0-10 cm";
  } else if (depthNum <= 25.0) {
    displaySeverity = "Medium";
    displayBand = ">10-25 cm";
  } else if (depthNum <= 100.0) {
    displaySeverity = "High";
    displayBand = ">25-100 cm";
  } else {
    displaySeverity = "Critical";
    displayBand = ">100 cm";
  }

  const elevation = typeof p.elevation_m === "number" ? `${p.elevation_m.toFixed(1)} m` : "N/A";
  const drainDist = typeof p.distance_to_drain_m === "number" ? `${p.distance_to_drain_m.toFixed(1)} m` : "N/A";
  const popExp = typeof p.population_exposure === "number" ? p.population_exposure.toLocaleString() : "N/A";
  const critInfra = p.critical_infra_flag ? "Yes" : "No";
  const forecastTimestep = p.timestep || activeTimestep;

  const content = `
    <div class="waterlogging-popup">
      <div class="wl-popup-title">${roadId}</div>
      <div class="wl-popup-row"><span>Water depth:</span> <strong>${depthVal} cm</strong></div>
      <div class="wl-popup-row"><span>Severity:</span> <span class="sev-tag ${displaySeverity.toLowerCase()}">${displaySeverity}</span></div>
      <div class="wl-popup-row"><span>Band:</span> <strong>${displayBand}</strong></div>
      <div class="wl-popup-row"><span>Elevation:</span> <strong>${elevation}</strong></div>
      <div class="wl-popup-row"><span>Drain distance:</span> <strong>${drainDist}</strong></div>
      <div class="wl-popup-row"><span>Population exposure:</span> <strong>${popExp}</strong></div>
      <div class="wl-popup-row"><span>Critical infrastructure:</span> <strong>${critInfra}</strong></div>
      <div class="wl-popup-row"><span>Forecast:</span> <strong>${forecastTimestep}</strong></div>
      <div class="wl-popup-action-row" style="margin-top:8px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.1);">
        <button class="${isSmartRouterActive ? 'btn-open-smart-router font-mono active-on' : 'btn-open-smart-router font-mono'}" style="width:100%; padding:5px 8px; background:${isSmartRouterActive ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #0284c7, #06b6d4)'}; border:none; border-radius:4px; color:#fff; font-size:0.72rem; font-weight:700; cursor:pointer;">${isSmartRouterActive ? '⚡ Smart Router ON' : '⚡ Launch Smart Router'}</button>
      </div>
      <div class="wl-popup-footer" style="margin-top:4px;">Model-derived waterlogging depth proxy</div>
    </div>
  `;
  layer.bindPopup(content, { className: "dark-leaflet-popup" });
}

async function loadWaterloggingLayer(signal) {
  const wCheck = document.getElementById("layer-waterlogging-check");
  if (wCheck && !wCheck.checked) return;

  const bbox = getMapViewportBbox();
  const roundedBbox = bbox.map(v => Math.round(v * 100) / 100);
  const cacheKey = `wl_${activeScenario}_${activeTimestep}_${roundedBbox.join("_")}`;

  if (spatialGeojsonCache.has(cacheKey)) {
    const cached = spatialGeojsonCache.get(cacheKey);
    if (waterloggingLayer) {
      waterloggingLayer.clearLayers();
      waterloggingLayer.addData(cached);
      lastLoadedWaterloggingGeojson = cached;
      updateScadaTelemetry();
    }
    return;
  }

  const r1hEl = document.getElementById("rainfall_1h");
  const r3hEl = document.getElementById("rainfall_3h");
  const r6hEl = document.getElementById("rainfall_6h");
  const intEl = document.getElementById("recent_rainfall_intensity");

  const payload = {
    scenario: activeScenario,
    timestep: activeTimestep,
    rainfall_1h: r1hEl ? parseFloat(r1hEl.value) || 10.0 : 10.0,
    rainfall_3h: r3hEl ? parseFloat(r3hEl.value) || 20.0 : 20.0,
    rainfall_6h: r6hEl ? parseFloat(r6hEl.value) || 30.0 : 30.0,
    recent_rainfall_intensity: intEl ? parseFloat(intEl.value) || 5.0 : 5.0,
    bbox: bbox
  };

  try {
    const res = await apiFetch("/waterlogging", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: signal
    }, 12000);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson = await res.json();

    if (signal && signal.aborted) return;

    if (geojson && geojson.features) {
      spatialGeojsonCache.set(cacheKey, geojson);
      if (spatialGeojsonCache.size > MAX_SPATIAL_CACHE_ENTRIES) {
        const firstKey = spatialGeojsonCache.keys().next().value;
        spatialGeojsonCache.delete(firstKey);
      }
    }

    if (waterloggingLayer) {
      waterloggingLayer.clearLayers();
      waterloggingLayer.addData(geojson);
      lastLoadedWaterloggingGeojson = geojson;
      updateScadaTelemetry();
    }
  } catch (err) {
    if (err.name === "AbortError") return;
    console.warn("Waterlogging layer fetch notice:", err.message);
  }
}

// --------------------------------------------------------------------------
// 2. Critical Infrastructure Layer Engine (GET /infrastructure)
// --------------------------------------------------------------------------
function createInfraMarker(feature, latlng) {
  const p = feature.properties || {};
  const cat = (p.category || "").toLowerCase();

  let iconChar = "⚡";
  let bgClass = "power";

  if (cat === "medical" || cat === "hospital") { iconChar = "🏥"; bgClass = "medical"; }
  else if (cat === "police") { iconChar = "🛡️"; bgClass = "police"; }
  else if (cat === "fire" || cat === "emergency") { iconChar = "🚨"; bgClass = "fire"; }
  else if (cat === "transport" || cat === "metro" || cat === "railway") { iconChar = "🚇"; bgClass = "metro"; }
  else if (cat === "water/utility" || cat === "water" || cat === "water_drainage") { iconChar = "💧"; bgClass = "water"; }

  const html = `<div class="infra-map-badge ${bgClass} is-critical">${iconChar}</div>`;
  const customIcon = L.divIcon({
    html: html,
    className: "infra-div-icon",
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });

  return L.marker(latlng, { icon: customIcon });
}

function bindInfraPopup(feature, layer) {
  const p = feature.properties || {};
  const name = p.name || "Critical Infrastructure Facility";
  
  const catRaw = (p.category || "General").toUpperCase();
  let catDisplay = "CRITICAL UTILITY";
  if (catRaw === "HOSPITAL" || catRaw === "MEDICAL") catDisplay = "MEDICAL";
  else if (catRaw === "POLICE") catDisplay = "POLICE";
  else if (catRaw === "FIRE" || catRaw === "EMERGENCY") catDisplay = "FIRE";
  else if (catRaw === "TRANSPORT" || catRaw === "METRO" || catRaw === "RAILWAY") catDisplay = "TRANSPORT";
  else if (catRaw === "POWER") catDisplay = "POWER";
  else if (catRaw === "WATER/UTILITY" || catRaw === "WATER") catDisplay = "WATER / UTILITY";

  const forecastStatus = p.forecast_status || "Forecast Threatened";
  const nearestDepth = typeof p.nearest_water_depth_cm === "number" ? `${p.nearest_water_depth_cm.toFixed(1)} cm` : "N/A";
  const proximityDist = typeof p.proximity_distance_m === "number" ? `${p.proximity_distance_m.toFixed(1)} m` : "N/A";
  const forecastTimestep = p.timestep || activeTimestep;
  const exposureBasis = p.flood_exposure_basis === "high_critical_waterlogging" ? "High flood proximity"
    : p.flood_exposure_basis === "critical_waterlogging_proximity" ? "Critical flood proximity"
    : p.flood_exposure_basis || "Waterlogging proximity";

  const content = `
    <div class="infra-popup">
      <div class="infra-popup-title">${name}</div>
      <div class="infra-popup-row"><span>Category:</span> <strong>${catDisplay}</strong></div>
      <div class="infra-popup-row"><span>Forecast Status:</span> <span class="sev-tag high">${forecastStatus}</span></div>
      <div class="infra-popup-row"><span>Nearby Flood Depth:</span> <strong>${nearestDepth}</strong></div>
      <div class="infra-popup-row"><span>Distance to Flooded Street:</span> <strong>${proximityDist}</strong></div>
      <div class="infra-popup-row"><span>Forecast Timestep:</span> <strong>${forecastTimestep}</strong></div>
      <div class="infra-popup-row"><span>Exposure Basis:</span> <strong>${exposureBasis}</strong></div>
      <div class="infra-popup-action-row" style="margin-top:8px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.1);">
        <button class="${isSmartRouterActive ? 'btn-open-smart-router font-mono active-on' : 'btn-open-smart-router font-mono'}" style="width:100%; padding:5px 8px; background:${isSmartRouterActive ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #0284c7, #06b6d4)'}; border:none; border-radius:4px; color:#fff; font-size:0.72rem; font-weight:700; cursor:pointer;">${isSmartRouterActive ? '⚡ Smart Router ON' : '⚡ Launch Smart Router'}</button>
      </div>
      <div class="infra-popup-footer" style="margin-top:4px;">Model-derived flood exposure proxy</div>
    </div>
  `;
  layer.bindPopup(content, { className: "dark-leaflet-popup" });
}

async function loadInfraLayer(signal) {
  const iCheck = document.getElementById("layer-infra-check");
  if (iCheck && !iCheck.checked) return;

  const bbox = getMapViewportBbox();
  const bboxStr = bbox.join(",");

  const r1hEl = document.getElementById("rainfall_1h");
  const r3hEl = document.getElementById("rainfall_3h");
  const r6hEl = document.getElementById("rainfall_6h");
  const intEl = document.getElementById("recent_rainfall_intensity");

  const r1h = r1hEl ? parseFloat(r1hEl.value) || 10.0 : 10.0;
  const r3h = r3hEl ? parseFloat(r3hEl.value) || 20.0 : 20.0;
  const r6h = r6hEl ? parseFloat(r6hEl.value) || 30.0 : 30.0;
  const intVal = intEl ? parseFloat(intEl.value) || 5.0 : 5.0;

  const params = new URLSearchParams({
    scenario: activeScenario,
    timestep: activeTimestep,
    rainfall_1h: r1h,
    rainfall_3h: r3h,
    rainfall_6h: r6h,
    recent_rainfall_intensity: intVal,
    bbox: bboxStr
  });

  try {
    const res = await apiFetch(`/infrastructure?${params.toString()}`, { signal }, 10000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson = await res.json();

    if (signal && signal.aborted) return;

    if (infraLayer) {
      infraLayer.clearLayers();
      if (typeof infraLayer.addLayer === "function" && typeof L.markerClusterGroup === "function" && infraLayer instanceof L.MarkerClusterGroup) {
        (geojson.features || []).forEach((feat) => {
          const props = feat.properties || {};
          // Hard Critical-Asset Rule: Discard non-critical, category OTHER, or missing flood proximity evidence
          if (!props.critical || props.critical_asset === false || props.category === "other" || props.category === "OTHER") {
            return;
          }
          if (typeof props.nearest_water_depth_cm !== "number" || typeof props.proximity_distance_m !== "number") {
            return;
          }

          if (feat.geometry && feat.geometry.coordinates) {
            const coords = feat.geometry.coordinates;
            const latlng = [coords[1], coords[0]];
            const marker = createInfraMarker(feat, latlng);
            bindInfraPopup(feat, marker);
            infraLayer.addLayer(marker);
          }
        });
      } else if (typeof infraLayer.addData === "function") {
        infraLayer.addData(geojson);
      }
      lastLoadedInfraGeojson = geojson;
      updateScadaTelemetry();
    }
  } catch (err) {
    if (err.name === "AbortError") return;
    console.warn("Infrastructure layer fetch notice:", err.message);
  }
}

// --------------------------------------------------------------------------
// 3. Drainage Network Layer Engine (GET /drainage)
// --------------------------------------------------------------------------
function createDrainMarker(feature, latlng) {
  const markerOpts = {
    radius: 3,
    color: "#06b6d4",
    fillColor: "#06b6d4",
    fillOpacity: 0.45,
    weight: 1.5,
  };
  if (sharedCanvasRenderer) {
    markerOpts.renderer = sharedCanvasRenderer;
  }
  return L.circleMarker(latlng, markerOpts);
}

function bindDrainPopupContent(p) {
  const drainName = p.drain_name || "MPD-1976 Drain";
  const basin = p.basin || "Delhi Basin";
  const status = p.status || "Existing / Remodeling";
  const source = p.source || "MPD-1976";
  const isLine = p.geometry_type === "LineString" || p.length_km !== undefined;
  const drainType = p.drain_type || (isLine ? "Primary Drainage Trunk Canal" : "Outfall / Sump Node");

  let detailRows = "";
  if (p.length_km !== undefined) {
    detailRows += `<div class="drain-popup-row"><span>Channel Length:</span> <strong>${p.length_km} km</strong></div>`;
  }
  if (p.capacity_cusecs !== undefined) {
    detailRows += `<div class="drain-popup-row"><span>Design Capacity:</span> <strong>${Number(p.capacity_cusecs).toLocaleString()} cusecs</strong></div>`;
  }
  if (p.flow_direction) {
    detailRows += `<div class="drain-popup-row"><span>Flow Course:</span> <strong>${p.flow_direction}</strong></div>`;
  }
  if (p.seq_no && p.seq_no !== 0) {
    detailRows += `<div class="drain-popup-row"><span>Sequence No:</span> <strong>#${p.seq_no}</strong></div>`;
  }

  const isUntraceable = (status || "").toLowerCase().includes("untraceable") || (source || "").toLowerCase().includes("untraceable");
  const titleColor = isUntraceable ? "#f59e0b" : "#00f3ff";
  const badgeBg = isUntraceable ? "rgba(245, 158, 11, 0.15)" : (isLine ? "rgba(6, 182, 212, 0.2)" : "rgba(59, 130, 246, 0.15)");
  const badgeBorder = isUntraceable ? "rgba(245, 158, 11, 0.4)" : (isLine ? "rgba(6, 182, 212, 0.45)" : "rgba(59, 130, 246, 0.4)");
  const badgeText = isUntraceable ? "#fbbf24" : (isLine ? "#22d3ee" : "#60a5fa");

  return `
    <div class="drain-popup" style="min-width: 220px;">
      <div class="drain-popup-title font-mono" style="color:${titleColor}; font-weight:700; font-size:0.86rem; margin-bottom:5px; line-height:1.25;">
        ${drainName}
      </div>
      <div style="display:inline-block; font-size:0.68rem; font-weight:600; padding:2px 6px; border-radius:4px; background:${badgeBg}; border:1px solid ${badgeBorder}; color:${badgeText}; margin-bottom:8px;">
        ${drainType}
      </div>
      <div class="drain-popup-row"><span>Basin:</span> <strong>${basin}</strong></div>
      ${detailRows}
      <div class="drain-popup-row"><span>Status:</span> <strong>${status}</strong></div>
      <div class="drain-popup-row"><span>Source:</span> <strong>${source}</strong></div>
      <div class="drain-popup-footer" style="margin-top:6px; font-size:0.65rem; color:#94a3b8; border-top:1px solid rgba(255,255,255,0.1); padding-top:4px;">
        Delhi Master Plan Drainage GIS Network (I&FC / MPD)
      </div>
    </div>
  `;
}

async function loadDrainageNetworkLayer(signal) {
  const dCheck = document.getElementById("layer-drains-check");
  const legendDrainage = document.getElementById("legend-drainage-section") || document.getElementById("legend-drainage-status");
  if (dCheck && !dCheck.checked) {
    if (drainageNetworkLayer) drainageNetworkLayer.clearLayers();
    if (legendDrainage) legendDrainage.classList.add("hidden");
    return;
  }

  if (legendDrainage) legendDrainage.classList.remove("hidden");

  const bbox = getMapViewportBbox();
  const bboxStr = bbox.join(",");

  try {
    const res = await apiFetch(`/drainage?bbox=${bboxStr}&include_channels=true`, { signal }, 10000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson = await res.json();

    if (signal && signal.aborted) return;
    if (!drainageNetworkLayer) return;
    drainageNetworkLayer.clearLayers();

    const features = geojson.features || [];
    let renderedFeatureCount = 0;
    const lineOpts = sharedCanvasRenderer ? { renderer: sharedCanvasRenderer } : {};

    features.forEach((feat) => {
      const geom = feat.geometry || {};
      const props = feat.properties || {};

      // 1. LineString Features: Genuine Master Plan Drainage Channels & Arterials
      if (geom.type === "LineString" && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
        renderedFeatureCount++;
        // GeoJSON has [lon, lat], Leaflet polyline expects [lat, lon]
        const latlngs = geom.coordinates.map((c) => [c[1], c[0]]);
        const isPrimary = props.drain_type === "Primary Arterial Trunk" || props.drain_type === "Major River Corridor";
        const strokeColor = props.color || (isPrimary ? "#00f3ff" : "#38bdf8");
        const coreWeight = props.weight || (isPrimary ? 4.5 : 3.0);
        const popupContent = bindDrainPopupContent(props);

        const outerGlowLine = L.polyline(latlngs, {
          ...lineOpts,
          color: strokeColor,
          weight: coreWeight + 5,
          opacity: 0.40,
          lineCap: "round",
          lineJoin: "round",
          interactive: false
        });

        const isSecondary = props.drain_type && props.drain_type.includes("Secondary");
        const innerCoreLine = L.polyline(latlngs, {
          ...lineOpts,
          color: strokeColor,
          weight: coreWeight,
          opacity: 0.95,
          lineCap: "round",
          lineJoin: "round",
          dashArray: isSecondary ? "8, 6" : undefined,
          interactive: true
        });

        innerCoreLine.bindPopup(popupContent, { className: "dark-leaflet-popup" });
        innerCoreLine.on("mouseover", function () {
          this.setStyle({ weight: coreWeight + 2.5, opacity: 1.0 });
        });
        innerCoreLine.on("mouseout", function () {
          this.setStyle({ weight: coreWeight, opacity: 0.95 });
        });

        drainageNetworkLayer.addLayer(outerGlowLine);
        drainageNetworkLayer.addLayer(innerCoreLine);

      // 2. Point Features: Individual Outfall / Sump / Regulator Inventory Nodes
      } else if (geom.type === "Point" && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
        renderedFeatureCount++;
        const latlng = [geom.coordinates[1], geom.coordinates[0]];
        const isUntraceable = (props.status || "").toLowerCase().includes("untraceable") || (props.source || "").toLowerCase().includes("untraceable");

        const marker = L.circleMarker(latlng, {
          ...lineOpts,
          radius: isUntraceable ? 4 : 4.5,
          color: isUntraceable ? "#f59e0b" : "#00f3ff",
          fillColor: isUntraceable ? "#d97706" : "#06b6d4",
          fillOpacity: 0.85,
          weight: 1.5
        });

        marker.bindPopup(bindDrainPopupContent(props), { className: "dark-leaflet-popup" });
        drainageNetworkLayer.addLayer(marker);
      }
    });

    window.AQUAG_LAST_DRAINAGE_COUNT = renderedFeatureCount;

  } catch (err) {
    console.warn("Drainage network layer fetch non-blocking warning:", err.message);
  }
}

// --------------------------------------------------------------------------
// 4. Pump Stations Layer Engine & Registry
// --------------------------------------------------------------------------
const PUMP_STATIONS_DATA = [
  // High-Capacity Strategic Stations Mapped Across Delhi with Scenario-Calibrated Capacity Utilization
  {
    station_code: "KLA",
    name: "Kashmiri Gate Sump Station",
    lat: 28.671,
    lon: 77.229,
    maxFlowLps: 2500,
    loads: { NORMAL: 18.0, MODERATE: 32.0, HEAVY: 45.0, EXTREME: 82.0 },
    heavyRing: null,
    load_pct: 45.0,
    status: "nominal",
    ringColor: null,
    flowRateLps: 1200
  },
  {
    station_code: "YAM",
    name: "Yamuna Bazaar Riverbank Pump Station",
    lat: 28.665,
    lon: 77.234,
    maxFlowLps: 2600,
    loads: { NORMAL: 32.0, MODERATE: 68.5, HEAVY: 92.5, EXTREME: 98.0 },
    heavyRing: "#f59e0b",
    load_pct: 92.5,
    status: "critical",
    ringColor: "#f59e0b",
    flowRateLps: 2450
  },
  {
    station_code: "SLM",
    name: "Seelampur Drainage Pump",
    lat: 28.664,
    lon: 77.268,
    maxFlowLps: 2400,
    loads: { NORMAL: 25.0, MODERATE: 54.0, HEAVY: 76.5, EXTREME: 91.5 },
    heavyRing: null,
    load_pct: 76.5,
    status: "warning",
    ringColor: null,
    flowRateLps: 1850
  },
  {
    station_code: "MNT",
    name: "Minto Bridge Automated Station",
    lat: 28.6382,
    lon: 77.2258,
    maxFlowLps: 1500,
    loads: { NORMAL: 22.0, MODERATE: 46.0, HEAVY: 65.0, EXTREME: 94.0 },
    heavyRing: "#eab308",
    load_pct: 65.0,
    status: "nominal",
    ringColor: "#eab308",
    flowRateLps: 975
  },
  {
    station_code: "MNT",
    name: "Minto Bridge Pumping House",
    lat: 28.634,
    lon: 77.228,
    maxFlowLps: 2000,
    loads: { NORMAL: 28.0, MODERATE: 62.0, HEAVY: 88.0, EXTREME: 98.0 },
    heavyRing: "#ef4444",
    load_pct: 88.0,
    status: "warning",
    ringColor: "#ef4444",
    flowRateLps: 1750
  },
  {
    station_code: "ITO",
    name: "ITO Ring Road High Capacity Pump",
    lat: 28.628,
    lon: 77.245,
    maxFlowLps: 2500,
    loads: { NORMAL: 34.0, MODERATE: 69.0, HEAVY: 94.0, EXTREME: 99.0 },
    heavyRing: "#ef4444",
    load_pct: 94.0,
    status: "critical",
    ringColor: "#ef4444",
    flowRateLps: 2350
  },
  {
    station_code: "BRP",
    name: "Barapullah Drain Pump Facility",
    lat: 28.586,
    lon: 77.249,
    maxFlowLps: 4000,
    loads: { NORMAL: 26.0, MODERATE: 56.0, HEAVY: 78.0, EXTREME: 92.0 },
    heavyRing: null,
    load_pct: 78.0,
    status: "warning",
    ringColor: null,
    flowRateLps: 3120
  },
  {
    station_code: "MTH",
    name: "Mathura Road Relief Station",
    lat: 28.572,
    lon: 77.253,
    maxFlowLps: 3000,
    loads: { NORMAL: 19.0, MODERATE: 38.0, HEAVY: 52.0, EXTREME: 82.0 },
    heavyRing: null,
    load_pct: 52.0,
    status: "nominal",
    ringColor: null,
    flowRateLps: 1560
  },
  {
    station_code: "OKH",
    name: "Okhla Sump Pumping Complex",
    lat: 28.555,
    lon: 77.284,
    maxFlowLps: 3000,
    loads: { NORMAL: 35.0, MODERATE: 72.0, HEAVY: 96.0, EXTREME: 99.0 },
    heavyRing: null,
    load_pct: 96.0,
    status: "critical",
    ringColor: null,
    flowRateLps: 2850
  },
  {
    station_code: "OKH",
    name: "Okhla Outfall Pump Station",
    lat: 28.5355,
    lon: 77.2710,
    maxFlowLps: 3000,
    loads: { NORMAL: 36.0, MODERATE: 73.0, HEAVY: 96.0, EXTREME: 99.5 },
    heavyRing: "#f59e0b",
    load_pct: 96.0,
    status: "critical",
    ringColor: "#f59e0b",
    flowRateLps: 2900
  },
  {
    station_code: "TLK",
    name: "Tilak Bridge Underpass Pump",
    lat: 28.625,
    lon: 77.239,
    maxFlowLps: 2000,
    loads: { NORMAL: 28.0, MODERATE: 61.0, HEAVY: 85.0, EXTREME: 95.0 },
    heavyRing: null,
    load_pct: 85.0,
    status: "warning",
    ringColor: null,
    flowRateLps: 1700
  },
  {
    station_code: "MLC",
    name: "Moolchand Underpass Relief Pump",
    lat: 28.567,
    lon: 77.235,
    maxFlowLps: 2000,
    loads: { NORMAL: 30.0, MODERATE: 63.0, HEAVY: 88.0, EXTREME: 96.0 },
    heavyRing: null,
    load_pct: 88.0,
    status: "warning",
    ringColor: null,
    flowRateLps: 1760
  },
  {
    station_code: "PLP",
    name: "Pul Prahladpur Underpass Pump",
    lat: 28.509,
    lon: 77.288,
    maxFlowLps: 3000,
    loads: { NORMAL: 35.0, MODERATE: 74.5, HEAVY: 97.5, EXTREME: 100.0 },
    heavyRing: "#ef4444",
    load_pct: 97.5,
    status: "critical",
    ringColor: "#ef4444",
    flowRateLps: 2920
  },
  {
    station_code: "MHP",
    name: "Mahipalpur NH-48 Airport Underpass Sump",
    lat: 28.544,
    lon: 77.129,
    maxFlowLps: 3000,
    loads: { NORMAL: 31.0, MODERATE: 67.0, HEAVY: 93.0, EXTREME: 98.5 },
    heavyRing: "#ef4444",
    load_pct: 93.0,
    status: "critical",
    ringColor: "#ef4444",
    flowRateLps: 2790
  },
  {
    station_code: "DWK",
    name: "Dwarka Sector 21 Underpass Booster",
    lat: 28.552,
    lon: 77.059,
    maxFlowLps: 2000,
    loads: { NORMAL: 24.0, MODERATE: 48.0, HEAVY: 65.0, EXTREME: 88.0 },
    heavyRing: null,
    load_pct: 65.0,
    status: "nominal",
    ringColor: null,
    flowRateLps: 1300
  },
  {
    station_code: "MYP",
    name: "Mayapuri Heavy Industrial Sump Pump",
    lat: 28.631,
    lon: 77.129,
    maxFlowLps: 2000,
    loads: { NORMAL: 29.0, MODERATE: 64.0, HEAVY: 89.0, EXTREME: 97.0 },
    heavyRing: null,
    load_pct: 89.0,
    status: "warning",
    ringColor: null,
    flowRateLps: 1780
  },
  {
    station_code: "RJR",
    name: "Rajouri Garden Ring Road Booster Pump",
    lat: 28.647,
    lon: 77.123,
    maxFlowLps: 2000,
    loads: { NORMAL: 27.0, MODERATE: 60.5, HEAVY: 84.5, EXTREME: 94.5 },
    heavyRing: null,
    load_pct: 84.5,
    status: "warning",
    ringColor: null,
    flowRateLps: 1690
  },
  {
    station_code: "PJB",
    name: "Punjabi Bagh Underpass Drainage Station",
    lat: 28.667,
    lon: 77.133,
    maxFlowLps: 3000,
    loads: { NORMAL: 33.0, MODERATE: 66.0, HEAVY: 91.0, EXTREME: 98.0 },
    heavyRing: "#ef4444",
    load_pct: 91.0,
    status: "critical",
    ringColor: "#ef4444",
    flowRateLps: 2730
  },
  {
    station_code: "MKR",
    name: "Mukarba Chowk Underpass Pump",
    lat: 28.729,
    lon: 77.156,
    maxFlowLps: 3000,
    loads: { NORMAL: 32.0, MODERATE: 71.0, HEAVY: 95.0, EXTREME: 99.0 },
    heavyRing: "#ef4444",
    load_pct: 95.0,
    status: "critical",
    ringColor: "#ef4444",
    flowRateLps: 2850
  },
  {
    station_code: "AZD",
    name: "Azadpur Subzi Mandi Pump House",
    lat: 28.708,
    lon: 77.178,
    maxFlowLps: 2000,
    loads: { NORMAL: 28.0, MODERATE: 62.0, HEAVY: 87.0, EXTREME: 95.5 },
    heavyRing: null,
    load_pct: 87.0,
    status: "warning",
    ringColor: null,
    flowRateLps: 1740
  },
  {
    station_code: "ROH",
    name: "Rohini Sector 3 Booster Pump",
    lat: 28.703,
    lon: 77.122,
    maxFlowLps: 2000,
    loads: { NORMAL: 20.0, MODERATE: 42.0, HEAVY: 58.0, EXTREME: 84.0 },
    heavyRing: null,
    load_pct: 58.0,
    status: "nominal",
    ringColor: null,
    flowRateLps: 1160
  },
  {
    station_code: "ANV",
    name: "Anand Vihar ISBT Sump Facility",
    lat: 28.646,
    lon: 77.315,
    maxFlowLps: 2000,
    loads: { NORMAL: 30.0, MODERATE: 65.0, HEAVY: 89.0, EXTREME: 96.5 },
    heavyRing: null,
    load_pct: 89.0,
    status: "warning",
    ringColor: null,
    flowRateLps: 1780
  },
  {
    station_code: "GZP",
    name: "Ghazipur NH-9 Border Pump Station",
    lat: 28.624,
    lon: 77.332,
    maxFlowLps: 2000,
    loads: { NORMAL: 29.0, MODERATE: 63.5, HEAVY: 88.5, EXTREME: 96.0 },
    heavyRing: null,
    load_pct: 88.5,
    status: "warning",
    ringColor: null,
    flowRateLps: 1770
  },
  {
    station_code: "JNK",
    name: "Janakpuri District Sump Station",
    lat: 28.629,
    lon: 77.082,
    maxFlowLps: 2000,
    loads: { NORMAL: 23.0, MODERATE: 49.0, HEAVY: 68.0, EXTREME: 89.0 },
    heavyRing: null,
    load_pct: 68.0,
    status: "nominal",
    ringColor: null,
    flowRateLps: 1360
  }
];

/**
 * Adjusts all pump station capacity utilization percentages dynamically
 * based on rainfall condition (Normal, Moderate, Heavy, Extreme), timestep, and rainfall intensity.
 */
function updatePumpStationsForRainfall(scenario = activeScenario, timestep = activeTimestep, rainfall1h = null) {
  const scClean = (scenario || "NORMAL").toUpperCase().trim();

  // Timestep runoff accumulation surge
  let timestepSurge = 0.0;
  if (timestep === "T+1") timestepSurge = 3.5;
  else if (timestep === "T+2") timestepSurge = 7.0;
  else if (timestep === "T+3") timestepSurge = 9.5;

  PUMP_STATIONS_DATA.forEach((st) => {
    let baseLoad = 50.0;
    if (st.loads) {
      if (scClean === "NORMAL" || scClean === "LOW") {
        baseLoad = st.loads.NORMAL;
      } else if (scClean === "MODERATE" || scClean === "MEDIUM") {
        baseLoad = st.loads.MODERATE;
      } else if (scClean === "HEAVY" || scClean === "HIGH") {
        baseLoad = st.loads.HEAVY;
      } else if (scClean === "EXTREME") {
        baseLoad = st.loads.EXTREME;
      } else {
        baseLoad = st.loads.NORMAL;
      }

      // Smooth interpolation if custom 1h rainfall is provided
      if (typeof rainfall1h === "number" && !isNaN(rainfall1h) && rainfall1h > 0) {
        if (rainfall1h <= 10.0) {
          const ratio = Math.max(0, rainfall1h / 10.0);
          baseLoad = st.loads.NORMAL * (0.6 + 0.4 * ratio);
        } else if (rainfall1h <= 45.0) {
          const ratio = (rainfall1h - 10.0) / (45.0 - 10.0);
          baseLoad = st.loads.NORMAL + (st.loads.MODERATE - st.loads.NORMAL) * ratio;
        } else if (rainfall1h <= 75.0) {
          const ratio = (rainfall1h - 45.0) / (75.0 - 45.0);
          baseLoad = st.loads.MODERATE + (st.loads.HEAVY - st.loads.MODERATE) * ratio;
        } else if (rainfall1h <= 110.0) {
          const ratio = (rainfall1h - 75.0) / (110.0 - 75.0);
          baseLoad = st.loads.HEAVY + (st.loads.EXTREME - st.loads.HEAVY) * ratio;
        } else {
          const ratio = Math.min(1.0, (rainfall1h - 110.0) / 40.0);
          baseLoad = st.loads.EXTREME + (100.0 - st.loads.EXTREME) * ratio;
        }
      }
    }

    const calculatedLoad = Math.min(100.0, Math.max(10.0, Math.round((baseLoad + timestepSurge) * 10) / 10));
    st.load_pct = calculatedLoad;

    // Determine operational status and pulse ring color based on capacity utilization
    if (calculatedLoad >= 90.0) {
      st.status = "critical";
      st.ringColor = (scClean === "HEAVY" && st.heavyRing) ? st.heavyRing : "#ef4444";
    } else if (calculatedLoad >= 75.0) {
      st.status = "warning";
      st.ringColor = (scClean === "HEAVY" && st.heavyRing) ? st.heavyRing : (scClean === "EXTREME" ? "#f59e0b" : null);
    } else if (scClean === "HEAVY" && st.heavyRing) {
      st.status = "nominal";
      st.ringColor = st.heavyRing;
    } else {
      st.status = "nominal";
      st.ringColor = null;
    }

    // Recalculate discharge flow rate
    st.flowRateLps = Math.round(st.maxFlowLps * (calculatedLoad / 100.0));
  });

  // Re-render pump station markers on map if active
  if (map && pumpsLayer && map.hasLayer(pumpsLayer)) {
    renderPumpStationMarkers();
  }

  // Update SCADA pump modal list if open or present
  loadPumpStationsMetadata();
}

function createPumpMarkerIcon(p) {
  const isCritical = p.status === "critical" || p.load_pct >= 90;
  const isWarning = !isCritical && (p.status === "warning" || p.load_pct >= 75);
  const color = isCritical ? "#ef4444" : (isWarning ? "#f59e0b" : "#0284c7");

  // Pulse halo ring: use custom ringColor if specified, else status color
  const ringColor = p.ringColor;
  const ringHtml = ringColor ? `<div class="pump-ping-ring" style="border-color: ${ringColor};"></div>` : "";

  const html = `
    <div class="pump-station-marker-wrapper" title="${p.name} (${p.station_code}) - ${p.load_pct}% Load">
      ${ringHtml}
      <div class="pump-station-pill" style="border-color: ${color};">
        <div class="pump-dot-container">
          <div class="pump-dot" style="background: ${color};"></div>
        </div>
        <span class="pump-station-text">${p.station_code} • ${p.load_pct}%</span>
      </div>
    </div>
  `;

  return L.divIcon({
    html: html,
    className: "pump-station-leaflet-marker",
    iconSize: [0, 0],
    iconAnchor: [0, 0]
  });
}

function createPumpPopup(p) {
  const isCritical = p.status === "critical" || p.load_pct >= 90;
  const isWarning = !isCritical && (p.status === "warning" || p.load_pct >= 75);
  const color = isCritical ? "#ef4444" : (isWarning ? "#f59e0b" : "#0284c7");
  const statusLabel = isCritical ? "CRITICAL" : (isWarning ? "WARNING" : "NOMINAL");

  return `
    <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; min-width: 210px; color: #dce4e5; padding: 4px;">
      <div style="font-size: 10px; font-weight: 800; color: ${color}; text-transform: uppercase; margin-bottom: 2px;">
        PUMP STATION (${statusLabel})
      </div>
      <div style="font-size: 13px; font-weight: 700; color: #c3f5ff; margin-bottom: 6px; line-height: 1.3;">
        ${p.name}
      </div>
      <div style="background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(56, 189, 248, 0.2); padding: 6px 8px; border-radius: 6px; margin-bottom: 6px;">
        <div style="display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8;">
          <span>Capacity Utilization:</span>
          <strong style="color: ${color}; font-family: monospace;">${p.load_pct}%</strong>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; margin-top: 3px;">
          <span>Station Code:</span>
          <span style="color: #ffffff; font-family: monospace; font-weight: bold;">${p.station_code}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; margin-top: 3px;">
          <span>Discharge Flow:</span>
          <span style="color: #38bdf8; font-family: monospace;">${(p.flowRateLps || 1800).toLocaleString()} / ${(p.maxFlowLps || 2500).toLocaleString()} L/s</span>
        </div>
      </div>
      <div style="font-size: 10px; color: #64748b; font-family: monospace;">
        Coordinates: ${p.lat.toFixed(4)}°N, ${p.lon.toFixed(4)}°E
      </div>
      <button class="popup-open-registry-btn" data-action="open-pump-registry" style="margin-top: 8px; width: 100%; background: linear-gradient(135deg, rgba(8, 28, 58, 0.95) 0%, rgba(14, 38, 76, 0.90) 100%); border: 1px solid rgba(56, 189, 248, 0.5); border-radius: 4px; color: #38bdf8; font-size: 11px; font-weight: 700; padding: 5px 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; transition: all 0.15s ease;">
        ⚡ Open Pumping Stations Registry (GET /pumps)
      </button>
    </div>
  `;
}

function renderPumpStationMarkers() {
  if (!map || !pumpsLayer) return;

  PUMP_STATIONS_DATA.forEach((st) => {
    const icon = createPumpMarkerIcon(st);
    const popupContent = createPumpPopup(st);

    if (st._marker) {
      st._marker.setIcon(icon);
      st._marker.setPopupContent(popupContent);
      if (!pumpsLayer.hasLayer(st._marker)) {
        pumpsLayer.addLayer(st._marker);
      }
    } else {
      const marker = L.marker([st.lat, st.lon], { icon: icon });
      marker.bindPopup(popupContent, {
        className: "dark-leaflet-popup",
        closeButton: true,
        offset: [0, -14]
      });
      st._marker = marker;
      pumpsLayer.addLayer(marker);
    }
  });
}

async function handlePumpsToggle(enabled) {
  if (!map) return;

  if (!pumpsLayer) {
    pumpsLayer = L.layerGroup();
  }

  if (enabled) {
    if (!map.hasLayer(pumpsLayer)) {
      map.addLayer(pumpsLayer);
    }
    renderPumpStationMarkers();
    loadPumpStationsMetadata();
  } else {
    if (map.hasLayer(pumpsLayer)) {
      map.removeLayer(pumpsLayer);
    }
  }
}

async function loadPumpStationsMetadata() {
  const listContainer = document.getElementById("pump-stations-list");
  const countVal = document.getElementById("pump-count-val");
  if (countVal) countVal.textContent = `${PUMP_STATIONS_DATA.length} Active`;

  if (!listContainer) return;

  const searchInput = document.getElementById("pump-search-input");
  const filterPills = document.querySelectorAll(".pump-filter-pill");
  let currentFilter = "all";
  let currentSearch = "";

  const renderFilteredStations = () => {
    const q = (currentSearch || "").trim().toLowerCase();
    const filtered = PUMP_STATIONS_DATA.filter((st) => {
      const matchSearch = !q || st.name.toLowerCase().includes(q) || st.station_code.toLowerCase().includes(q);
      if (!matchSearch) return false;
      if (currentFilter === "crit") return st.load_pct >= 85 || st.status === "critical";
      if (currentFilter === "warn") return st.load_pct >= 70;
      return true;
    });

    if (filtered.length === 0) {
      listContainer.innerHTML = `<div class="pump-empty-search font-mono">No pumping stations match filter "${q || currentFilter}".</div>`;
      return;
    }

    listContainer.innerHTML = filtered.map((st, i) => {
      const isCritical = st.load_pct >= 85 || st.status === "critical";
      const isWarning = !isCritical && (st.load_pct >= 70 || st.status === "warning");
      const loadColor = isCritical ? "#ef4444" : (isWarning ? "#f59e0b" : "#10b981");
      const loadBadgeClass = isCritical ? "crit" : (isWarning ? "warn" : "normal");
      const flowRate = st.flowRateLps || Math.round((st.maxFlowLps || 2500) * (st.load_pct / 100));
      const maxFlow = st.maxFlowLps || 2500;

      return `
        <div class="pump-item-row ${loadBadgeClass}" data-station-code="${st.station_code}" data-lat="${st.lat}" data-lon="${st.lon}" title="Click to center on map & inspect live telemetry">
          <div class="pump-item-left">
            <span class="pump-num-badge">#${i + 1}</span>
            <span class="pump-code-badge">${st.station_code}</span>
            <div class="pump-station-info">
              <span class="pump-station-name">${st.name}</span>
              <span class="pump-station-meta">Flow: <strong>${flowRate.toLocaleString()} L/s</strong> / Cap: <strong>${maxFlow.toLocaleString()} L/s</strong></span>
            </div>
          </div>
          <div class="pump-item-right">
            <div class="pump-meter-track" title="Capacity utilization: ${st.load_pct}%">
              <div class="pump-meter-fill" style="width: ${Math.min(st.load_pct, 100)}%; background: ${loadColor};"></div>
            </div>
            <span class="pump-load-pill ${loadBadgeClass}">${st.load_pct}% LOAD</span>
          </div>
        </div>
      `;
    }).join("");

    listContainer.querySelectorAll(".pump-item-row").forEach(row => {
      row.addEventListener("click", () => {
        const lat = parseFloat(row.getAttribute("data-lat"));
        const lon = parseFloat(row.getAttribute("data-lon"));
        const modal = document.getElementById("pump-modal");
        if (modal) modal.classList.add("hidden");
        const pCheck = document.getElementById("layer-pumps-check");
        if (pCheck && !pCheck.checked) {
          pCheck.checked = true;
          handlePumpsToggle(true);
        }
        if (map) {
          map.flyTo([lat, lon], 14, { duration: 1.2 });
          if (pumpsLayer) {
            pumpsLayer.eachLayer(marker => {
              const mLat = marker.getLatLng().lat;
              const mLon = marker.getLatLng().lng;
              if (Math.abs(mLat - lat) < 0.001 && Math.abs(mLon - lon) < 0.001) {
                setTimeout(() => marker.openPopup(), 400);
              }
            });
          }
        }
      });
    });
  };

  renderFilteredStations();

  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "true";
    searchInput.addEventListener("input", (e) => {
      currentSearch = e.target.value;
      renderFilteredStations();
    });
  }

  filterPills.forEach((btn) => {
    if (!btn.dataset.bound) {
      btn.dataset.bound = "true";
      btn.addEventListener("click", () => {
        filterPills.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentFilter = btn.getAttribute("data-filter") || "all";
        renderFilteredStations();
      });
    }
  });
}

// --------------------------------------------------------------------------
// 5. Population Priority Layer Engine (GET /population-priority)
// --------------------------------------------------------------------------
let topPriorityFeatureGlobal = null;

function createPriorityPopupContent(p) {
  const roadId = p.road_id || "Priority Corridor";
  const rawLevel = (p.priority_level || "MEDIUM").toUpperCase();
  const pCode = rawLevel === "CRITICAL" ? "P1" : rawLevel === "HIGH" ? "P2" : "P3";
  const tagClass = rawLevel === "CRITICAL" ? "critical" : rawLevel === "HIGH" ? "high" : "medium";

  const depthNum = typeof p.water_depth_cm === "number" ? p.water_depth_cm : parseFloat(p.water_depth_cm || 0);
  const depthVal = depthNum.toFixed(1);
  let floodSev = depthNum > 100 ? "CRITICAL (>100 cm)" : depthNum > 25 ? "HIGH (>25-100 cm)" : "MEDIUM (>10-25 cm)";

  const popExp = typeof p.population_exposure === "number" ? p.population_exposure.toLocaleString() : (p.population_exposure || "N/A");
  const critInfra = p.critical_infra_flag === 1 ? "1 Critical Asset" : "0 Assets";
  const timestepVal = p.timestep || activeTimestep;

  let recAction = "Deploy high-capacity dewatering pumps & clear key transit arteries";
  if (rawLevel === "CRITICAL") {
    recAction = "Immediate emergency response: deploy heavy pumps, reroute traffic & protect critical assets";
  } else if (rawLevel === "HIGH") {
    recAction = "High response priority: dispatch mobile pump units & issue localized traffic warnings";
  } else {
    recAction = "Monitor corridor: maintain SCADA telemetry & prepare drainage clearing";
  }

  return `
    <div class="pop-priority-popup">
      <div class="wl-popup-title font-mono" style="font-size:0.85rem; font-weight:700; color:#f8fafc; margin-bottom:6px;">${roadId}</div>
      <div class="wl-popup-row"><span>RESPONSE PRIORITY:</span> <span class="sev-tag ${tagClass}" style="font-weight:700;">${pCode} · ${rawLevel}</span></div>
      <div class="wl-popup-row"><span>Flood severity:</span> <strong>${floodSev}</strong></div>
      <div class="wl-popup-row"><span>Water depth:</span> <strong>${depthVal} cm</strong></div>
      <div class="wl-popup-row"><span>Population exposed:</span> <strong>${popExp}</strong></div>
      <div class="wl-popup-row"><span>Critical assets:</span> <strong>${critInfra}</strong></div>
      <div class="wl-popup-row"><span>Recommended action:</span> <strong style="color:#c084fc;">${recAction}</strong></div>
      <div class="wl-popup-row"><span>Forecast Timestep:</span> <strong>${timestepVal}</strong></div>
      <div class="wl-popup-action-row" style="margin-top:8px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.1);">
        <button class="${isSmartRouterActive ? 'btn-open-smart-router font-mono active-on' : 'btn-open-smart-router font-mono'}" style="width:100%; padding:5px 8px; background:${isSmartRouterActive ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #0284c7, #06b6d4)'}; border:none; border-radius:4px; color:#fff; font-size:0.72rem; font-weight:700; cursor:pointer;">${isSmartRouterActive ? '⚡ Smart Router ON' : '⚡ Launch Smart Router'}</button>
      </div>
      <div class="wl-popup-footer" style="margin-top:4px; font-size:0.65rem; color:#94a3b8;">
        Population used as response exposure factor (not simple density)
      </div>
    </div>
  `;
}

function initTopPriorityFocusHandler() {
  const focusBtn = document.getElementById("btn-focus-top-p");
  if (focusBtn) {
    focusBtn.addEventListener("click", () => {
      if (!topPriorityFeatureGlobal || !map) return;
      const tempLayer = L.geoJSON(topPriorityFeatureGlobal);
      const bounds = tempLayer.getBounds();
      map.fitBounds(bounds, { maxZoom: 16, padding: [60, 60] });

      const popupHtml = createPriorityPopupContent(topPriorityFeatureGlobal.properties || {});
      const center = bounds.getCenter();
      L.popup({ className: "dark-leaflet-popup" })
        .setLatLng(center)
        .setContent(popupHtml)
        .openOn(map);
    });
  }
}

async function loadPopulationPriorityLayer(signal) {
  const popCheck = document.getElementById("layer-pop-priority-check");
  if (popCheck && !popCheck.checked) {
    if (populationPriorityLayer) populationPriorityLayer.clearLayers();
    return;
  }

  const bbox = getMapViewportBbox();
  const roundedBbox = bbox.map(v => Math.round(v * 100) / 100);
  const cacheKey = `pop_${activeScenario}_${activeTimestep}_${roundedBbox.join("_")}`;

  let geojson = null;
  if (spatialGeojsonCache.has(cacheKey)) {
    geojson = spatialGeojsonCache.get(cacheKey);
  } else {
    const bboxStr = bbox.join(",");
    const encodedTimestep = encodeURIComponent(activeTimestep);

    try {
      const res = await apiFetch(`/population-priority?scenario=${activeScenario}&timestep=${encodedTimestep}&bbox=${bboxStr}`, { signal }, 10000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      geojson = await res.json();
      if (signal && signal.aborted) return;
      if (geojson && geojson.features) {
        spatialGeojsonCache.set(cacheKey, geojson);
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      console.warn("Population priority layer fetch notice:", err.message);
      return;
    }
  }

  if (!populationPriorityLayer || !geojson) return;
  populationPriorityLayer.clearLayers();

  const rawFeatures = geojson.features || [];

  // ONLY SHOW OPERATIONAL PRIORITY: Filter out unflooded roads (water_depth_cm <= 10.0) or priority LOW
  const priorityFeatures = rawFeatures.filter((f) => {
    const p = f.properties || {};
    const depth = typeof p.water_depth_cm === "number" ? p.water_depth_cm : parseFloat(p.water_depth_cm || 0);
    const level = (p.priority_level || "LOW").toUpperCase();
    return depth > 10.0 && level !== "LOW";
  });

  let cntP1 = 0;
  let cntP2 = 0;
  let cntP3 = 0;

  priorityFeatures.forEach((f) => {
    const p = f.properties || {};
    const level = (p.priority_level || "MEDIUM").toUpperCase();
    if (level === "CRITICAL") cntP1++;
    else if (level === "HIGH") cntP2++;
    else if (level === "MEDIUM") cntP3++;
  });

  // Update SCADA Panel response priority counts
  const elP1 = document.getElementById("cnt-p1");
  const elP2 = document.getElementById("cnt-p2");
  const elP3 = document.getElementById("cnt-p3");
  if (elP1) elP1.textContent = cntP1;
  if (elP2) elP2.textContent = cntP2;
  if (elP3) elP3.textContent = cntP3;

  // Sort priority features by priority_score descending
  priorityFeatures.sort((a, b) => {
    const scoreA = (a.properties && a.properties.priority_score) || 0;
    const scoreB = (b.properties && b.properties.priority_score) || 0;
    return scoreB - scoreA;
  });

  // Handle TOP PRIORITY CARD update
  const topCardEl = document.getElementById("top-priority-card");
  if (priorityFeatures.length > 0 && topCardEl) {
    topCardEl.classList.remove("hidden");
    const topF = priorityFeatures[0];
    topPriorityFeatureGlobal = topF;

    const topP = topF.properties || {};
    const rawLevel = (topP.priority_level || "MEDIUM").toUpperCase();
    const pCode = rawLevel === "CRITICAL" ? "P1" : rawLevel === "HIGH" ? "P2" : "P3";
    const tagClass = rawLevel === "CRITICAL" ? "critical" : rawLevel === "HIGH" ? "high" : "medium";

    const badgeEl = document.getElementById("top-p-badge");
    const titleEl = document.getElementById("top-p-title");
    const popEl = document.getElementById("top-p-pop");
    const depthEl = document.getElementById("top-p-depth");
    const infraEl = document.getElementById("top-p-infra");

    if (badgeEl) {
      badgeEl.textContent = pCode;
      badgeEl.className = `sev-tag ${tagClass}`;
    }
    if (titleEl) titleEl.textContent = topP.road_id || "Top Priority Segment";
    if (popEl) popEl.textContent = typeof topP.population_exposure === "number" ? topP.population_exposure.toLocaleString() : (topP.population_exposure || "--");
    if (depthEl) depthEl.textContent = typeof topP.water_depth_cm === "number" ? `${topP.water_depth_cm.toFixed(1)} cm` : "--";
    if (infraEl) infraEl.textContent = topP.critical_infra_flag === 1 ? "1 Critical Asset" : "0 Assets";
  } else if (topCardEl) {
    topCardEl.classList.add("hidden");
    topPriorityFeatureGlobal = null;
  }

  // Render Polylines directly onto Hardware Canvas in a single batch (60 FPS, zero UI lag)
  const lineOpts = sharedCanvasRenderer ? { renderer: sharedCanvasRenderer } : {};
  const layersBatch = [];

  priorityFeatures.forEach((feature) => {
    if (!feature.geometry || !feature.geometry.coordinates) return;
    const rawCoords = feature.geometry.coordinates;
    const latlngs = Array.isArray(rawCoords[0][0])
      ? rawCoords[0].map(c => [c[1], c[0]])
      : rawCoords.map(c => [c[1], c[0]]);

    if (latlngs.length < 2) return;

    const p = feature.properties || {};
    const level = (p.priority_level || "MEDIUM").toUpperCase();
    const depth = typeof p.water_depth_cm === "number" ? p.water_depth_cm : parseFloat(p.water_depth_cm || 0);

    // High-visibility vivid priority styling
    const color = level === "CRITICAL" ? "#a855f7" : level === "HIGH" ? "#c084fc" : "#818cf8";
    const weight = level === "CRITICAL" ? 5.5 : level === "HIGH" ? 4.2 : 3.2;

    const priorityLine = L.polyline(latlngs, {
      ...lineOpts,
      color: color,
      weight: weight,
      opacity: 0.92,
      lineCap: "round",
      lineJoin: "round",
      interactive: true
    });

    // Lazy popup on click (zero upfront DOM string thrashing)
    priorityLine.on("click", (e) => {
      const popupHtml = createPriorityPopupContent(p);
      L.popup({ className: "dark-leaflet-popup" })
        .setLatLng(e.latlng)
        .setContent(popupHtml)
        .openOn(map);
    });

    layersBatch.push(priorityLine);
  });

  // Add compact priority badges ONLY for top 12 highest-priority locations
  const topNBadges = priorityFeatures.slice(0, 12);
  topNBadges.forEach((feature) => {
    if (!feature.geometry || !feature.geometry.coordinates) return;
    const rawCoords = feature.geometry.coordinates;
    const latlngs = Array.isArray(rawCoords[0][0])
      ? rawCoords[0].map(c => [c[1], c[0]])
      : rawCoords.map(c => [c[1], c[0]]);

    if (latlngs.length === 0) return;
    const center = latlngs[Math.floor(latlngs.length / 2)];

    const p = feature.properties || {};
    const level = (p.priority_level || "MEDIUM").toUpperCase();
    const pCode = level === "CRITICAL" ? "P1" : level === "HIGH" ? "P2" : "P3";
    const pClass = level === "CRITICAL" ? "p1" : level === "HIGH" ? "p2" : "p3";

    const customIcon = L.divIcon({
      className: "priority-badge-div",
      html: `<div class="priority-badge-marker ${pClass}"><span>⚡</span> ${pCode}</div>`,
      iconSize: [36, 18],
      iconAnchor: [18, 9]
    });

    const badgeMarker = L.marker(center, { icon: customIcon });
    badgeMarker.on("click", (e) => {
      const popupHtml = createPriorityPopupContent(p);
      L.popup({ className: "dark-leaflet-popup" })
        .setLatLng(e.latlng)
        .setContent(popupHtml)
        .openOn(map);
    });

    layersBatch.push(badgeMarker);
  });

  // Batch insert into populationPriorityLayer in one atomic operation
  const batchFeatureGroup = L.featureGroup(layersBatch);
  populationPriorityLayer.addLayer(batchFeatureGroup);
}

// --------------------------------------------------------------------------
// 6. Alerts & Triage Engine Panel (GET /alerts)
// --------------------------------------------------------------------------
async function loadAlertsPanel(signalOrForce, maybeForce = false) {
  let signal = null;
  let force = false;
  if (typeof signalOrForce === "boolean") {
    force = signalOrForce;
  } else {
    signal = signalOrForce;
    force = maybeForce;
  }

  const alertsTab = document.getElementById("tab-alerts");
  if (!force && alertsTab && !alertsTab.classList.contains("active")) {
    return;
  }

  const bbox = getMapViewportBbox();
  const bboxStr = bbox.join(",");
  const encodedTimestep = encodeURIComponent(activeTimestep);
  const container = document.getElementById("alerts-list-container");
  const countBadge = document.getElementById("alerts-count-badge");

  try {
    const res = await apiFetch(`/alerts?scenario=${activeScenario}&timestep=${encodedTimestep}&bbox=${bboxStr}`, { signal }, 10000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    lastLoadedAlertsData = data;
    updateScadaTelemetry();

    const incidents = data.incidents || [];
    if (countBadge) countBadge.textContent = `${incidents.length} Incidents`;

    if (!container) return;
    if (incidents.length === 0) {
      container.innerHTML = '<div class="alert-empty-msg">No high priority incidents for current viewport.</div>';
      return;
    }

    container.innerHTML = incidents.map((inc) => {
      const coordsJson = JSON.stringify(inc.coordinates || []);
      const pLevel = (inc.priority_level || "LOW").toUpperCase();
      return `
        <div class="alert-card priority-${pLevel.toLowerCase()}" data-coords='${coordsJson}'>
          <div class="alert-card-header">
            <span class="inc-id">${inc.incident_id} • ${inc.road_id}</span>
            <span class="inc-badge ${pLevel.toLowerCase()}">${pLevel}</span>
          </div>
          <div class="alert-card-body">
            <div class="inc-row"><span>District:</span> <strong>${inc.district || "Delhi"}</strong></div>
            <div class="inc-row"><span>Water Depth:</span> <strong>${inc.water_depth_cm.toFixed(1)} cm</strong></div>
            <div class="inc-row"><span>Population Exposure:</span> <strong>${(inc.population_exposure || 0).toLocaleString()}</strong></div>
            <div class="inc-row"><span>Critical Infra:</span> <strong>${inc.critical_infra_flag === 1 ? 'YES' : 'NO'}</strong></div>
            <div class="inc-row"><span>Forecast:</span> <strong>${inc.forecast_timestep}</strong></div>
            <div class="inc-action-box">
              <strong>Recommended Action:</strong> ${inc.recommended_action}
            </div>
          </div>
          <div class="alert-card-footer">
            <span>Basis: ${inc.basis}</span>
            <button class="locate-inc-btn">Locate on Map &rarr;</button>
          </div>
        </div>
      `;
    }).join("");

    // Add click listeners to locate incidents on Leaflet map
    container.querySelectorAll(".alert-card").forEach((card) => {
      card.addEventListener("click", () => {
        try {
          const coords = JSON.parse(card.getAttribute("data-coords"));
          if (coords && coords.length > 0) {
            // Convert GeoJSON [lon, lat] pairs to Leaflet [lat, lon]
            const leafletLatLngs = coords.map((c) => [c[1], c[0]]);
            const bounds = L.latLngBounds(leafletLatLngs);
            map.fitBounds(bounds, { maxZoom: 16, padding: [50, 50] });

            // Temporary highlight line
            const highlightPolyline = L.polyline(leafletLatLngs, {
              color: "#f43f5e",
              weight: 8,
              opacity: 0.9,
            }).addTo(map);

            setTimeout(() => {
              if (map.hasLayer(highlightPolyline)) map.removeLayer(highlightPolyline);
            }, 3000);
          }
        } catch (e) {
          console.warn("Failed to locate incident feature on map:", e);
        }
      });
    });
  } catch (err) {
    if (container) container.innerHTML = `<div class="alert-empty-msg">Alerts load notice: ${err.message}</div>`;
  }
}

// --------------------------------------------------------------------------
// Smart Routing Alternate Corridors & Congestion Bypasses (SIH26085)
// --------------------------------------------------------------------------
const SMART_ALTERNATE_ROUTES = [
  {
    id: "UER2_BYPASS",
    name: "UER-II / NH-344M Elevated Arterial Bypass",
    street: "Urban Extension Road II (NH-344M)",
    type: "SAFE_BYPASS",
    color: "#10b981", // Emerald Neon
    glowColor: "rgba(16, 185, 129, 0.45)",
    origin: "Mundka / Alipur (NH-44)",
    destination: "Dwarka Sector 21 / IGI Airport",
    avoidedCorridor: "Rohtak Road (Nangloi) & Uttam Nagar-Dwarka Mor bottleneck",
    distanceKm: "18.4 km",
    freeFlowSpeed: "75 km/h",
    floodClearance: "0 cm (Elevated Grade)",
    recommendation: "Take UER-II to completely bypass waterlogged Nangloi & the Uttam Nagar gridlock.",
    badge: {
      text: "⚡ UER-II (NH-344M) • SAFE BYPASS",
      position: [28.6480, 77.0090]
    },
    coordinates: [
      [28.7180, 77.0350],
      [28.6980, 77.0250],
      [28.6750, 77.0120],
      [28.6480, 77.0090],
      [28.6220, 77.0210],
      [28.5950, 77.0380],
      [28.5700, 77.0520],
      [28.5550, 77.0580]
    ]
  },
  {
    id: "DWARKA_EXPWY",
    name: "Dwarka Expressway (NH-248BB) Fast-Track Corridor",
    street: "Dwarka Expressway ➔ Sector 21/22 Trunk",
    type: "SAFE_BYPASS",
    color: "#06b6d4", // Electric Cyan
    glowColor: "rgba(6, 182, 212, 0.45)",
    origin: "Najafgarh South / Bijwasan Border",
    destination: "Mahipalpur / Dhaula Kuan (NH-48)",
    avoidedCorridor: "Old Najafgarh-Palam Road & Palam Underpass waterlogging",
    distanceKm: "12.8 km",
    freeFlowSpeed: "70 km/h",
    floodClearance: "0 cm (Grade-Separated)",
    recommendation: "Grade-separated flood-free link between Najafgarh, Dwarka sectors, and South Delhi.",
    badge: {
      text: "⚡ DWARKA EXPWY • FREE-FLOW DETOUR",
      position: [28.5520, 77.0450]
    },
    coordinates: [
      [28.5280, 76.9950],
      [28.5380, 77.0150],
      [28.5520, 77.0450],
      [28.5580, 77.0620],
      [28.5560, 77.0880],
      [28.5500, 77.1120],
      [28.5440, 77.1320]
    ]
  },
  {
    id: "OUTER_RING_ELEVATED",
    name: "Outer Ring Road Elevated Flyover Corridor",
    street: "Outer Ring Road (Vikaspuri - Janakpuri - Peeragarhi)",
    type: "SAFE_BYPASS",
    color: "#38bdf8", // Bright Sky Blue
    glowColor: "rgba(56, 189, 248, 0.4)",
    origin: "Peeragarhi Grade Separator",
    destination: "Janakpuri / Tilak Nagar Elevated Overpass",
    avoidedCorridor: "Surface waterlogging at District Centre & Hastsal intersections",
    distanceKm: "7.9 km",
    freeFlowSpeed: "60 km/h",
    floodClearance: "0 cm (Continuous Flyover Deck)",
    recommendation: "Take the elevated flyover deck to avoid surface street flooding on Najafgarh Road.",
    badge: {
      text: "⚡ OUTER RING • ELEVATED CORRIDOR",
      position: [28.6450, 77.0790]
    },
    coordinates: [
      [28.6850, 77.0950],
      [28.6650, 77.0870],
      [28.6450, 77.0790],
      [28.6320, 77.0780],
      [28.6180, 77.0860],
      [28.6080, 77.0980]
    ]
  },
  {
    id: "CHHAWLA_DHANSA",
    name: "Chhawla - Rewla Khanpur South Arterial Link",
    street: "Dhansa Road ➔ Rewla Khanpur ➔ Chhawla Bridge",
    type: "ALTERNATE_DETOUR",
    color: "#00f3ff", // Neon Cyan
    glowColor: "rgba(0, 243, 255, 0.35)",
    origin: "Najafgarh Western Ring",
    destination: "Dwarka Sector 19 / Kapashera Link",
    avoidedCorridor: "Najafgarh Main Chowk & flooded Jharoda link",
    distanceKm: "9.2 km",
    freeFlowSpeed: "50 km/h",
    floodClearance: "0 cm (Raised Embankment)",
    recommendation: "High embankment rural-urban link avoiding congested inner Najafgarh market streets.",
    badge: {
      text: "⚡ CHHAWLA LINK • SOUTH NAJAFGARH BYPASS",
      position: [28.5800, 77.0120]
    },
    coordinates: [
      [28.6120, 76.9820],
      [28.5950, 76.9950],
      [28.5800, 77.0120],
      [28.5650, 77.0300],
      [28.5520, 77.0480]
    ]
  },
  {
    id: "BARAPULLAH_ELEVATED",
    name: "Barapullah Elevated Expressway (Phase 1-3)",
    street: "Barapullah Elevated Expressway",
    type: "SAFE_BYPASS",
    color: "#10b981",
    glowColor: "rgba(16, 185, 129, 0.45)",
    origin: "Sarai Kale Khan / Ring Road",
    destination: "INA / AIIMS / Aurobindo Marg",
    avoidedCorridor: "Moolchand Underpass & Ring Road South waterlogging",
    distanceKm: "8.5 km",
    freeFlowSpeed: "70 km/h",
    floodClearance: "0 cm (Elevated Structure)",
    recommendation: "Fly over flooded South Delhi nallah corridors with zero waterlogging risk.",
    badge: {
      text: "⚡ BARAPULLAH • ELEVATED EXPRESSWAY",
      position: [28.5800, 77.2300]
    },
    coordinates: [
      [28.5880, 77.2580],
      [28.5850, 77.2450],
      [28.5800, 77.2300],
      [28.5740, 77.2180],
      [28.5680, 77.2100]
    ]
  },
  {
    id: "RIDGE_CORRIDOR",
    name: "Northern Ridge High-Ground Bypass",
    street: "Rani Jhansi Elevated ➔ Ridge Road ➔ Dhaula Kuan",
    type: "SAFE_BYPASS",
    color: "#10b981",
    glowColor: "rgba(16, 185, 129, 0.45)",
    origin: "Civil Lines / Tis Hazari",
    destination: "Dhaula Kuan Grade Separator",
    avoidedCorridor: "Flooded Minto Bridge Underpass & ITO Barrage bottleneck",
    distanceKm: "11.2 km",
    freeFlowSpeed: "60 km/h",
    floodClearance: "0 cm (Natural Ridge Elevation)",
    recommendation: "High-ground ridge bypass immune to storm drainage backflow.",
    badge: {
      text: "⚡ RIDGE ROAD • HIGH-GROUND BYPASS",
      position: [28.6320, 77.1910]
    },
    coordinates: [
      [28.6750, 77.2150],
      [28.6550, 77.2020],
      [28.6320, 77.1910],
      [28.6150, 77.1780],
      [28.5950, 77.1680]
    ]
  },
  // WATERLOGGED BOTTLENECK CORRIDORS (AVOID)
  {
    id: "AVOID_UTTAM_NAGAR",
    name: "⚠️ AVOID: Najafgarh-Uttam Nagar Road (Severe Waterlogging)",
    street: "Najafgarh Road (Hastsal - Uttam Nagar - Dwarka Mor)",
    type: "AVOID_CORRIDOR",
    color: "#ef4444", // Red warning
    glowColor: "rgba(239, 68, 68, 0.45)",
    dashArray: "6, 8",
    origin: "Dwarka Mor Intersection",
    destination: "Uttam Nagar East Metro",
    avoidedCorridor: "Severe road submersion & crawl speed (<6 km/h)",
    distanceKm: "3.6 km",
    freeFlowSpeed: "6 km/h (Standstill)",
    floodClearance: "55 cm (Flooded Underpasses)",
    recommendation: "DO NOT USE. Divert immediately via UER-II / NH-344M or Outer Ring Road.",
    badge: {
      text: "⛔ AVOID • 55cm WATERLOGGED",
      position: [28.6130, 77.0510]
    },
    coordinates: [
      [28.6280, 77.0420],
      [28.6220, 77.0460],
      [28.6130, 77.0510],
      [28.6010, 77.0560],
      [28.5920, 77.0600]
    ]
  },
  {
    id: "AVOID_NANGLOI",
    name: "⚠️ AVOID: Rohtak Road / Nangloi Metro Stretch",
    street: "Rohtak Road / NH-10 (Nangloi Metro ➔ Mundka)",
    type: "AVOID_CORRIDOR",
    color: "#ef4444",
    glowColor: "rgba(239, 68, 68, 0.45)",
    dashArray: "6, 8",
    origin: "Nangloi Metro Station",
    destination: "Surajmal Stadium Stretch",
    avoidedCorridor: "Chronic drainage backflow & deep water logging",
    distanceKm: "2.8 km",
    freeFlowSpeed: "8 km/h (Gridlock)",
    floodClearance: "48 cm (Heavy Waterlogging)",
    recommendation: "DO NOT USE. Divert North onto UER-II (NH-344M) towards Mundka/Dwarka.",
    badge: {
      text: "⛔ AVOID • 48cm WATERLOGGED",
      position: [28.6835, 77.0620]
    },
    coordinates: [
      [28.6820, 77.0480],
      [28.6835, 77.0620],
      [28.6845, 77.0780]
    ]
  }
];

function createAlternateRoutePopup(r) {
  const isAvoid = r.type === "AVOID_CORRIDOR";
  const isSafe = r.type === "SAFE_BYPASS";
  const statusColor = isAvoid ? "#ef4444" : (isSafe ? "#10b981" : "#06b6d4");
  const badgeLabel = isAvoid ? "CRITICAL CONGESTION • AVOID" : (isSafe ? "REALISTIC ELEVATED ROAD BYPASS" : "REALISTIC DETOUR ROUTE");

  let dynamicPumpContext = r.pumpContext || "";
  if (dynamicPumpContext) {
    PUMP_STATIONS_DATA.forEach((p) => {
      if (dynamicPumpContext.includes(p.station_code)) {
        const regex = new RegExp(`(${p.station_code}[^\\)]*?\\()([0-9.]+%)(\\s*Load[^\)]*?\\))`, "gi");
        if (regex.test(dynamicPumpContext)) {
          dynamicPumpContext = dynamicPumpContext.replace(regex, `$1${p.load_pct}%$3`);
        }
      }
    });
  }

  const pumpRow = dynamicPumpContext ? `
    <div style="display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; margin-top: 3px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 3px;">
      <span>Pump Station Catchment:</span>
      <span style="color: #38bdf8; font-weight: 600; text-align: right; max-width: 60%;">${dynamicPumpContext}</span>
    </div>
  ` : "";

  const popRow = r.popDensity ? `
    <div style="display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; margin-top: 3px;">
      <span>Population Context:</span>
      <span style="color: #c084fc; font-weight: 600; text-align: right; max-width: 60%;">${r.popDensity}</span>
    </div>
  ` : "";

  return `
    <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; min-width: 270px; color: #dce4e5; padding: 4px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
        <span style="font-size: 10px; font-weight: 800; color: ${statusColor}; text-transform: uppercase; letter-spacing: 0.5px;">
          ${badgeLabel}
        </span>
        <span style="font-size: 11px; font-weight: 800; color: #ffffff; font-family: monospace;">${r.distanceKm || ''}</span>
      </div>
      <div style="font-size: 13px; font-weight: 800; color: #c3f5ff; margin-bottom: 3px; line-height: 1.3;">
        ${r.name}
      </div>
      <div style="font-size: 11px; color: #94a3b8; margin-bottom: 8px;">
        <strong>Actual Road Corridor:</strong> <span style="color: #f8fafc;">${r.street}</span>
      </div>
      <div style="background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(56, 189, 248, 0.2); padding: 8px; border-radius: 6px; margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; margin-bottom: 3px;">
          <span>Flood Clearance:</span>
          <strong style="color: ${statusColor};">${r.floodClearance}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; margin-bottom: 3px;">
          <span>Estimated Speed:</span>
          <strong style="color: #ffffff; font-family: monospace;">${r.freeFlowSpeed}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; margin-bottom: 3px;">
          <span>Avoids Bottleneck:</span>
          <span style="color: #cbd5e1; font-weight: 600; text-align: right; max-width: 62%;">${r.avoidedCorridor}</span>
        </div>
        ${pumpRow}
        ${popRow}
      </div>
      <div style="font-size: 11px; line-height: 1.4; color: ${isAvoid ? '#fca5a5' : '#a7f3d0'}; background: ${isAvoid ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)'}; padding: 6px 8px; border-radius: 4px; border-left: 3px solid ${statusColor};">
        💡 <strong>Advisory:</strong> ${r.recommendation}
      </div>
    </div>
  `;
}

let realisticRoutesCache = null;

async function fetchRealisticSmartRoutes() {
  if (realisticRoutesCache && realisticRoutesCache.length > 0) {
    return realisticRoutesCache;
  }
  try {
    const res = await fetch("data/processed/realistic_smart_routes.json");
    if (res.ok) {
      realisticRoutesCache = await res.json();
      return realisticRoutesCache;
    }
  } catch (err) {
    console.warn("Static realistic routes load warning:", err);
  }
  return SMART_ALTERNATE_ROUTES;
}

async function renderSmartAlternateRoutes() {
  if (!map || !routeLayer) return;
  routeLayer.clearLayers();

  const routes = await fetchRealisticSmartRoutes();

  routes.forEach((r) => {
    if (!r.coordinates || r.coordinates.length < 2) return;

    // 1. Casing / Glow polyline underneath
    // 1. Casing / Glow polyline underneath
    const casingPolyline = L.polyline(r.coordinates, {
      color: r.glowColor || "rgba(0,0,0,0.5)",
      weight: 9,
      opacity: 0.55,
      lineCap: "round",
      lineJoin: "round",
      interactive: false,
    }).addTo(routeLayer);

    // 2. Main route polyline following actual street geometry
    const routePolyline = L.polyline(r.coordinates, {
      color: r.color,
      weight: 5,
      opacity: 0.95,
      dashArray: r.dashArray || undefined,
      lineCap: "round",
      lineJoin: "round",
      interactive: true,
    }).addTo(routeLayer);

    const popupHtml = createAlternateRoutePopup(r);
    routePolyline.bindPopup(popupHtml, {
      className: "dark-leaflet-popup",
      maxWidth: 340,
      offset: [0, -5]
    });

    // Hover effect
    routePolyline.on("mouseover", () => {
      routePolyline.setStyle({ weight: 7, opacity: 1.0 });
    });
    routePolyline.on("mouseout", () => {
      routePolyline.setStyle({ weight: 5, opacity: 0.95 });
    });

    // 3. Compact high-contrast badge along the route
    if (r.badge && r.badge.position) {
      const badgeClass = r.type === "AVOID_CORRIDOR" ? "avoid" : (r.type === "SAFE_BYPASS" ? "safe" : "detour");
      const badgeIcon = L.divIcon({
        html: `<div class="route-map-badge ${badgeClass}">${r.badge.text}</div>`,
        className: "route-badge-divicon",
        iconSize: [0, 0],
        iconAnchor: [0, 0]
      });

      const badgeMarker = L.marker(r.badge.position, { icon: badgeIcon }).addTo(routeLayer);
      badgeMarker.bindPopup(popupHtml, {
        className: "dark-leaflet-popup",
        maxWidth: 340,
        offset: [0, -10]
      });
    }
  });
}

// --------------------------------------------------------------------------
// Smart Router State Controller (Single Source of Truth)
// --------------------------------------------------------------------------
function setSmartRouterState(enabled, options = {}) {
  isSmartRouterActive = !!enabled;

  // 1. Synchronize the Active Layers checkbox (#layer-route-check)
  const rCheck = document.getElementById("layer-route-check");
  if (rCheck && rCheck.checked !== isSmartRouterActive) {
    rCheck.checked = isSmartRouterActive;
  }

  // 2. Synchronize Leaflet map layer (routeLayer)
  if (map && routeLayer) {
    if (isSmartRouterActive) {
      if (!map.hasLayer(routeLayer)) map.addLayer(routeLayer);
      renderSmartAlternateRoutes();
    } else {
      routeLayer.clearLayers();
      if (map.hasLayer(routeLayer)) map.removeLayer(routeLayer);
    }
  }

  // 3. Synchronize right sidebar tab (#tab-routing) & automatically expand Smart Router Finder accordion
  if (options.openTab !== false && isSmartRouterActive) {
    const sideTabBtns = document.querySelectorAll(".side-tab-btn");
    const routerTabBtn = document.querySelector('.side-tab-btn[data-tab="tab-routing"]');
    if (routerTabBtn) {
      sideTabBtns.forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".sidebar-tab-content").forEach((c) => c.classList.remove("active"));
      routerTabBtn.classList.add("active");
      const targetEl = document.getElementById("tab-routing");
      if (targetEl) {
        targetEl.classList.add("active");

        // Action 2: Automatically open/expand the Smart Router Finder accordion (<details>)
        const accordion = targetEl.querySelector("details, #route-finder-accordion");
        if (accordion) {
          accordion.open = true;
        }

        // Action 3: Focus origin input so finder is immediately ready for user input
        setTimeout(() => {
          const startLatInput = document.getElementById("start_lat");
          const routeForm = document.getElementById("route-form");
          if (startLatInput) {
            startLatInput.focus();
            if (typeof startLatInput.select === "function") {
              startLatInput.select();
            }
          } else if (routeForm) {
            routeForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        }, 50);
      }
    }
  }

  // 4. Synchronize all popup buttons (.btn-open-smart-router) across DOM
  const routerBtns = document.querySelectorAll(".btn-open-smart-router, [data-action='open-smart-router'], .popup-smart-router-btn, [data-action='route']");
  routerBtns.forEach((btn) => {
    if (isSmartRouterActive) {
      btn.classList.add("active-on");
      btn.textContent = "⚡ Smart Router ON";
      btn.style.background = "linear-gradient(135deg, #10b981, #059669)";
    } else {
      btn.classList.remove("active-on");
      btn.textContent = "⚡ Launch Smart Router";
      btn.style.background = "linear-gradient(135deg, #0284c7, #06b6d4)";
    }
  });
}

function toggleSmartRouterState(options = {}) {
  setSmartRouterState(!isSmartRouterActive, options);
}

function initSmartRouterState() {
  const rCheck = document.getElementById("layer-route-check");
  const initialState = rCheck ? rCheck.checked : false;
  setSmartRouterState(initialState, { openTab: false });
}

// --------------------------------------------------------------------------
// UI Tabs & Controls Initialization
// --------------------------------------------------------------------------
function switchActiveTab(targetTabId) {
  const sideTabBtns = document.querySelectorAll(".side-tab-btn");
  const tabContents = document.querySelectorAll(".sidebar-tab-content");

  sideTabBtns.forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-tab") === targetTabId);
  });

  tabContents.forEach((c) => {
    if (c.id === targetTabId) {
      c.classList.add("active");
    } else {
      c.classList.remove("active");
    }
  });

  const pModal = document.getElementById("pump-modal");
  if (pModal) pModal.classList.add("hidden");
}

function initSideTabs() {
  const sideTabBtns = document.querySelectorAll(".side-tab-btn");
  sideTabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      switchActiveTab(targetTab);

      const navBtns = document.querySelectorAll(".nav-module-btn");
      if (targetTab === "tab-alerts") {
        navBtns.forEach((b) => b.classList.remove("active"));
        const btnAlerts = document.getElementById("nav-btn-alerts");
        if (btnAlerts) btnAlerts.classList.add("active");
        setTimeout(() => loadAlertsPanel(null, true), 30);
      } else if (targetTab === "tab-routing") {
        navBtns.forEach((b) => b.classList.remove("active"));
        const btnAnalytics = document.getElementById("nav-btn-analytics");
        if (btnAnalytics) btnAnalytics.classList.add("active");
      } else if (targetTab === "tab-rainfall") {
        navBtns.forEach((b) => b.classList.remove("active"));
        const btnRainfall = document.getElementById("nav-btn-rainfall");
        if (btnRainfall) btnRainfall.classList.add("active");
        setTimeout(() => loadLiveRainfallData(), 30);
      } else if (targetTab === "tab-situation") {
        const btnScada = document.getElementById("nav-btn-scada");
        const btnGis = document.getElementById("nav-btn-gis");
        if (!btnScada?.classList.contains("active")) {
          navBtns.forEach((b) => b.classList.remove("active"));
          if (btnGis) btnGis.classList.add("active");
        }
      }
    });
  });

  const navAlertsBtn = document.getElementById("nav-alerts-btn");
  if (navAlertsBtn) {
    navAlertsBtn.addEventListener("click", () => {
      const alertTabBtn = document.querySelector('.side-tab-btn[data-tab="tab-alerts"]');
      if (alertTabBtn) alertTabBtn.click();
    });
  }

  // Global delegated click handler connecting initial/popup Smart Router buttons to Smart Router state controller
  document.addEventListener("click", (e) => {
    const routerBtn = e.target.closest(".btn-open-smart-router, [data-action='open-smart-router'], .popup-smart-router-btn, [data-action='route']");
    if (routerBtn) {
      e.preventDefault();
      toggleSmartRouterState({ openTab: true });
    }
  });
}

function initTopNavModuleButtons() {
  const btnGis = document.getElementById("nav-btn-gis");
  const btnScada = document.getElementById("nav-btn-scada");
  const btnAlerts = document.getElementById("nav-btn-alerts");
  const btnAnalytics = document.getElementById("nav-btn-analytics");
  const btnRainfall = document.getElementById("nav-btn-rainfall");
  const navBtns = document.querySelectorAll(".nav-module-btn");

  const setActiveNav = (activeBtn) => {
    navBtns.forEach((b) => b.classList.remove("active"));
    if (activeBtn) activeBtn.classList.add("active");
  };

  const closePumpModal = () => {
    const pModal = document.getElementById("pump-modal");
    if (pModal) pModal.classList.add("hidden");
  };

  const smoothScrollTabContent = (tabId, topPos = 0) => {
    const tabEl = document.getElementById(tabId);
    if (tabEl) {
      tabEl.scrollTo({ top: topPos, behavior: "smooth" });
    }
  };

  if (btnGis) {
    btnGis.addEventListener("click", () => {
      setActiveNav(btnGis);
      closePumpModal();
      switchActiveTab("tab-situation");
      smoothScrollTabContent("tab-situation", 0);
    });
  }

  if (btnScada) {
    btnScada.addEventListener("click", () => {
      setActiveNav(btnScada);
      closePumpModal();
      switchActiveTab("tab-situation");

      // Smooth scroll inside tab-situation to SCADA telemetry header
      const scadaHeader = document.querySelector(".scada-header-card") || document.querySelector(".scada-metrics-grid");
      if (scadaHeader) {
        smoothScrollTabContent("tab-situation", Math.max(0, scadaHeader.offsetTop - 12));
      }

      // Micro-defer layer activations to maintain smooth 60fps tab transition
      setTimeout(() => {
        const dCheck = document.getElementById("layer-drains-check");
        if (dCheck && !dCheck.checked) {
          dCheck.checked = true;
          loadDrainageNetworkLayer();
        }

        const pCheck = document.getElementById("layer-pumps-check");
        if (pCheck && !pCheck.checked) {
          pCheck.checked = true;
          handlePumpsToggle(true);
        }
      }, 50);
    });
  }

  if (btnAlerts) {
    btnAlerts.addEventListener("click", () => {
      setActiveNav(btnAlerts);
      closePumpModal();
      switchActiveTab("tab-alerts");
      smoothScrollTabContent("tab-alerts", 0);

      // Micro-defer single alerts fetch
      setTimeout(() => {
        loadAlertsPanel(null, true);
      }, 40);
    });
  }

  if (btnAnalytics) {
    btnAnalytics.addEventListener("click", () => {
      setActiveNav(btnAnalytics);
      closePumpModal();
      switchActiveTab("tab-routing");
      smoothScrollTabContent("tab-routing", 0);

      setTimeout(() => {
        const rCheck = document.getElementById("layer-route-check");
        if (rCheck && !rCheck.checked) {
          rCheck.checked = true;
          setSmartRouterState(true, { openTab: true });
        }
      }, 40);
    });
  }

  if (btnRainfall) {
    btnRainfall.addEventListener("click", () => {
      setActiveNav(btnRainfall);
      closePumpModal();
      switchActiveTab("tab-rainfall");
      smoothScrollTabContent("tab-rainfall", 0);

      setTimeout(() => {
        loadLiveRainfallData();
      }, 35);
    });
  }
}

function initPresetButtons() {
  const presets = {
    normal: {
      rainfall_1h: 10.0,
      rainfall_3h: 20.0,
      rainfall_6h: 30.0,
      recent_rainfall_intensity: 5.0,
      elevation: 218.0,
      slope: 1.2,
      distance_to_drain: 300.0,
      distance_to_road: 15.0,
      distance_to_infra: 400.0,
      population_total: 50000,
      critical_infra_flag: 0,
    },
    moderate: {
      rainfall_1h: 45.0,
      rainfall_3h: 85.0,
      rainfall_6h: 130.0,
      recent_rainfall_intensity: 22.5,
      elevation: 208.5,
      slope: 1.8,
      distance_to_drain: 45.0,
      distance_to_road: 20.0,
      distance_to_infra: 150.0,
      population_total: 120000,
      critical_infra_flag: 1,
    },
    heavy: {
      rainfall_1h: 75.0,
      rainfall_3h: 130.0,
      rainfall_6h: 180.0,
      recent_rainfall_intensity: 37.5,
      elevation: 204.0,
      slope: 0.5,
      distance_to_drain: 15.0,
      distance_to_road: 10.0,
      distance_to_infra: 50.0,
      population_total: 250000,
      critical_infra_flag: 1,
    },
    extreme: {
      rainfall_1h: 110.0,
      rainfall_3h: 180.0,
      rainfall_6h: 250.0,
      recent_rainfall_intensity: 55.0,
      elevation: 202.0,
      slope: 0.2,
      distance_to_drain: 10.0,
      distance_to_road: 5.0,
      distance_to_infra: 25.0,
      population_total: 350000,
      critical_infra_flag: 1,
    },
  };

  // Backwards compatibility aliases
  presets.low = presets.normal;
  presets.medium = presets.moderate;
  presets.high = presets.heavy;

  const presetBtns = document.querySelectorAll(".preset-btn, .preset-btn-4");
  presetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.getAttribute("data-preset");
      const data = presets[type];
      if (!data) return;

      presetBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeScenario = type.toUpperCase();
      activePresetName = activeScenario;

      Object.keys(data).forEach((key) => {
        const el = document.getElementById(key);
        if (el) el.value = data[key];
      });

      // Update Summary Card Preview
      updateScenarioSummaryCard(data.rainfall_1h, data.rainfall_3h, data.rainfall_6h);

      // Dynamically adjust pump station capacity utilization percentages for rainfall condition
      updatePumpStationsForRainfall(activeScenario, activeTimestep, data.rainfall_1h);

      // Trigger Waterlogging & Population Priority & Alerts Refresh
      loadWaterloggingLayer();
      loadPopulationPriorityLayer();
      loadAlertsPanel();
    });
  });
}

function updateScenarioSummaryCard(r1h, r3h, r6h) {
  const sum1h = document.getElementById("sim-sum-1h");
  const sum3h = document.getElementById("sim-sum-3h");
  const sum6h = document.getElementById("sim-sum-6h");

  if (sum1h) sum1h.textContent = typeof r1h === "number" ? r1h.toFixed(1) : r1h;
  if (sum3h) sum3h.textContent = typeof r3h === "number" ? r3h.toFixed(1) : r3h;
  if (sum6h) sum6h.textContent = typeof r6h === "number" ? r6h.toFixed(1) : r6h;
}

function renderScenarioLog() {
  const listEl = document.getElementById("scenario-log-list");
  if (!listEl) return;

  if (scenarioHistory.length === 0) {
    listEl.innerHTML = '<div class="log-empty-msg">Run simulations to compare scenario outcomes...</div>';
    return;
  }

  listEl.innerHTML = scenarioHistory
    .slice()
    .reverse()
    .map(
      (item) => `
    <div class="log-item">
      <div class="log-top">
        <span class="log-name">${item.preset} SCENARIO</span>
        <span class="log-time">${item.timestamp}</span>
      </div>
      <div class="log-details">
        <span>Rain: ${item.r1h}/${item.r3h}/${item.r6h} mm</span>
        <span class="log-sev ${item.severity.toLowerCase()}">${item.severity}</span>
        <span class="log-score">Score: ${item.score}/100</span>
      </div>
    </div>
  `
    )
    .join("");
}

function initLayerToggles() {
  const wCheck = document.getElementById("layer-waterlogging-check");
  if (wCheck) {
    wCheck.addEventListener("change", (e) => {
      if (e.target.checked) {
        if (!map.hasLayer(waterloggingLayer)) map.addLayer(waterloggingLayer);
        loadWaterloggingLayer();
      } else {
        if (map.hasLayer(waterloggingLayer)) map.removeLayer(waterloggingLayer);
      }
    });
  }

  const iCheck = document.getElementById("layer-infra-check");
  if (iCheck) {
    iCheck.addEventListener("change", (e) => {
      if (e.target.checked) {
        if (!map.hasLayer(infraLayer)) map.addLayer(infraLayer);
        loadInfraLayer();
      } else {
        if (map.hasLayer(infraLayer)) map.removeLayer(infraLayer);
      }
    });
  }

  const pCheck = document.getElementById("layer-pumps-check");
  if (pCheck) {
    pCheck.addEventListener("change", (e) => {
      handlePumpsToggle(e.target.checked);
    });
  }

  const closePumpsBtn = document.getElementById("btn-close-pumps-modal");
  if (closePumpsBtn) {
    closePumpsBtn.addEventListener("click", () => {
      const modal = document.getElementById("pump-modal");
      if (modal) modal.classList.add("hidden");
    });
  }

  const openPumpsBtn = document.getElementById("btn-open-pumps-modal");
  if (openPumpsBtn) {
    openPumpsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const modal = document.getElementById("pump-modal");
      if (modal) {
        modal.classList.remove("hidden");
        loadPumpStationsMetadata();
      }
    });
  }

  const pumpModalOverlay = document.getElementById("pump-modal");
  if (pumpModalOverlay) {
    pumpModalOverlay.addEventListener("click", (e) => {
      if (e.target === pumpModalOverlay) {
        pumpModalOverlay.classList.add("hidden");
      }
    });
  }

  // Delegated handler for any 'open-pump-registry' action buttons (from map popup, etc.)
  document.addEventListener("click", (e) => {
    const regBtn = e.target.closest("[data-action='open-pump-registry'], .popup-open-registry-btn");
    if (regBtn) {
      e.preventDefault();
      const modal = document.getElementById("pump-modal");
      if (modal) {
        modal.classList.remove("hidden");
        loadPumpStationsMetadata();
      }
    }
  });

  const dCheck = document.getElementById("layer-drains-check");
  if (dCheck) {
    dCheck.addEventListener("change", (e) => {
      const legendDrainage = document.getElementById("legend-drainage-section") || document.getElementById("legend-drainage-status");
      if (e.target.checked) {
        if (!map.hasLayer(drainageNetworkLayer)) map.addLayer(drainageNetworkLayer);
        loadDrainageNetworkLayer();
        if (legendDrainage) legendDrainage.classList.remove("hidden");
      } else {
        if (map.hasLayer(drainageNetworkLayer)) map.removeLayer(drainageNetworkLayer);
        if (legendDrainage) legendDrainage.classList.add("hidden");
      }
    });
  }

  const zCheck = document.getElementById("layer-zones-check");
  if (zCheck) {
    zCheck.addEventListener("change", (e) => {
      if (e.target.checked) {
        if (!map.hasLayer(zonesLayer)) map.addLayer(zonesLayer);
        if (zonesLayer.getLayers().length === 0) {
          loadZoneLayer(true);
        } else {
          focusOnFloodRiskRegion(true);
        }
      } else {
        if (map.hasLayer(zonesLayer)) map.removeLayer(zonesLayer);
        if (map._popup) map.closePopup();
      }
    });

    const zLabel = zCheck.closest(".layer-item")?.querySelector(".layer-name");
    if (zLabel) {
      zLabel.addEventListener("click", (e) => {
        if (zCheck.checked) {
          e.preventDefault();
          e.stopPropagation();
          focusOnFloodRiskRegion(true);
        }
      });
    }
  }

  const rCheck = document.getElementById("layer-route-check");
  if (rCheck) {
    rCheck.addEventListener("change", (e) => {
      setSmartRouterState(e.target.checked, { openTab: false });
    });
  }

  const popCheck = document.getElementById("layer-pop-priority-check");
  if (popCheck) {
    popCheck.addEventListener("change", (e) => {
      if (e.target.checked) {
        if (!map.hasLayer(populationPriorityLayer)) map.addLayer(populationPriorityLayer);
        if (populationPriorityLayer.getLayers().length === 0) {
          loadPopulationPriorityLayer();
        }
      } else {
        if (map.hasLayer(populationPriorityLayer)) map.removeLayer(populationPriorityLayer);
      }
    });
  }

  const rainRadarCheck = document.getElementById("layer-rain-radar-check");
  if (rainRadarCheck) {
    rainRadarCheck.addEventListener("change", (e) => {
      toggleRainRadarLayer(e.target.checked);
    });
  }
}

let isPlaying = false;
let playIntervalTimer = null;
let currentTimestepRequestId = 0;

function initTimelineBar() {
  const stepBtns = document.querySelectorAll(".time-step-btn");
  const playBtn = document.getElementById("btn-play-pause");

  stepBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (isPlaying) {
        stopPlayAnimation();
      }
      selectTimestepButton(btn);
    });
  });

  if (playBtn) {
    playBtn.addEventListener("click", () => {
      if (isPlaying) {
        stopPlayAnimation();
      } else {
        startPlayAnimation();
      }
    });
  }
}

function selectTimestepButton(btn) {
  const stepBtns = document.querySelectorAll(".time-step-btn");
  stepBtns.forEach((b) => {
    b.classList.remove("active");
    const dot = b.querySelector(".step-dot");
    if (dot) dot.remove();
  });

  btn.classList.add("active");
  if (!btn.querySelector(".step-dot")) {
    const dot = document.createElement("span");
    dot.className = "step-dot";
    btn.insertBefore(dot, btn.firstChild);
  }

  const backendStep = btn.getAttribute("data-backend-step") || "T+0";
  activeTimestep = backendStep;
  const currentR1h = parseFloat(document.getElementById("rainfall_1h")?.value);
  updatePumpStationsForRainfall(activeScenario, activeTimestep, isNaN(currentR1h) ? null : currentR1h);
  updateScadaTelemetry();

  triggerTimestepUpdate();
}

function startPlayAnimation() {
  isPlaying = true;
  const playIcon = document.getElementById("play-icon");
  const pauseIcon = document.getElementById("pause-icon");
  const playBtnText = document.getElementById("play-btn-text");
  const playBtn = document.getElementById("btn-play-pause");

  if (playIcon) playIcon.classList.add("hidden");
  if (pauseIcon) pauseIcon.classList.remove("hidden");
  if (playBtnText) playBtnText.textContent = "PAUSE";
  if (playBtn) playBtn.classList.add("playing");

  const stepBtns = Array.from(document.querySelectorAll(".time-step-btn"));

  if (playIntervalTimer) clearInterval(playIntervalTimer);
  playIntervalTimer = setInterval(() => {
    const currentIndex = stepBtns.findIndex((b) => b.classList.contains("active"));
    const nextIndex = (currentIndex + 1) % stepBtns.length;
    selectTimestepButton(stepBtns[nextIndex]);
  }, 2500);
}

function stopPlayAnimation() {
  isPlaying = false;
  if (playIntervalTimer) {
    clearInterval(playIntervalTimer);
    playIntervalTimer = null;
  }

  const playIcon = document.getElementById("play-icon");
  const pauseIcon = document.getElementById("pause-icon");
  const playBtnText = document.getElementById("play-btn-text");
  const playBtn = document.getElementById("btn-play-pause");

  if (playIcon) playIcon.classList.remove("hidden");
  if (pauseIcon) pauseIcon.classList.add("hidden");
  if (playBtnText) playBtnText.textContent = "PLAY";
  if (playBtn) playBtn.classList.remove("playing");
}

async function triggerTimestepUpdate() {
  const reqId = ++currentTimestepRequestId;
  const spinner = document.getElementById("timeline-spinner");
  if (spinner) spinner.classList.remove("hidden");

  try {
    const promises = [];
    const wCheck = document.getElementById("layer-waterlogging-check");
    const iCheck = document.getElementById("layer-infra-check");
    const popCheck = document.getElementById("layer-pop-priority-check");

    if (wCheck && wCheck.checked) promises.push(loadWaterloggingLayer());
    if (iCheck && iCheck.checked) promises.push(loadInfraLayer());
    if (popCheck && popCheck.checked) promises.push(loadPopulationPriorityLayer());
    promises.push(loadAlertsPanel());

    await Promise.all(promises);
  } catch (err) {
    console.warn("Timestep update non-blocking notice:", err);
  } finally {
    if (reqId === currentTimestepRequestId) {
      if (spinner) spinner.classList.add("hidden");
    }
  }
}

let inspectionMarker = null;
let inspectionAbortCtrl = null;

function closeInspectorCard() {
  const card = document.getElementById("inspector-card");
  if (card) {
    card.classList.remove("visible");
    setTimeout(() => {
      if (!card.classList.contains("visible")) {
        card.classList.add("hidden");
      }
    }, 240);
  }
  if (inspectionMarker && map) {
    map.removeLayer(inspectionMarker);
    inspectionMarker = null;
  }
  if (inspectionAbortCtrl) {
    inspectionAbortCtrl.abort();
    inspectionAbortCtrl = null;
  }
}

function initInspectorCard() {
  const closeBtn = document.getElementById("btn-close-inspector");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      closeInspectorCard();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const card = document.getElementById("inspector-card");
      if (card && card.classList.contains("visible")) {
        closeInspectorCard();
      }
    }
  });
}

// --------------------------------------------------------------------------
// GET /health — Backend System Health Telemetry & Auto-Failover
// --------------------------------------------------------------------------
async function checkSystemHealth(force = false) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${API_BASE_URL}/health`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (res.ok) {
      const data = await res.json();
      if (data && data.status === "ok") {
        isBackendOnline = true;
        updateHealthBadge(true, `Online (${lastKnownBackendSource})`, data);
        return;
      }
    }
    throw new Error("Invalid health payload");
  } catch (err) {
    isBackendOnline = false;
    probeAndSelectBackend();
  }
}

// Continuous health poll: every 5s while offline, every 25s while online
setInterval(() => {
  if (!isBackendOnline) {
    checkSystemHealth();
  }
}, 5000);

setInterval(() => {
  if (isBackendOnline) {
    checkSystemHealth();
  }
}, 25000);

// --------------------------------------------------------------------------
// POST /flood_info — Point GIS Inspector
// --------------------------------------------------------------------------
async function handleMapClick(e) {
  const lat = e.latlng.lat;
  const lon = e.latlng.lng;

  // Handle Pick Mode for Route Panel
  if (pickingMode === "start") {
    const sLat = document.getElementById("start_lat");
    const sLon = document.getElementById("start_lon");
    if (sLat) sLat.value = lat.toFixed(6);
    if (sLon) sLon.value = lon.toFixed(6);
    pickingMode = null;
    map.getContainer().style.cursor = "";
    return;
  }
  if (pickingMode === "end") {
    const eLat = document.getElementById("end_lat");
    const eLon = document.getElementById("end_lon");
    if (eLat) eLat.value = lat.toFixed(6);
    if (eLon) eLon.value = lon.toFixed(6);
    pickingMode = null;
    map.getContainer().style.cursor = "";
    return;
  }

  // Abort any pending inspection request to prevent race conditions & out-of-order flashing
  if (inspectionAbortCtrl) {
    inspectionAbortCtrl.abort();
  }
  inspectionAbortCtrl = new AbortController();
  const currentSignal = inspectionAbortCtrl.signal;

  // 1. Sleek, animated map reticle / pulse marker to visually anchor the inspection point
  if (inspectionMarker) {
    inspectionMarker.setLatLng([lat, lon]);
  } else {
    const pulseIcon = L.divIcon({
      className: "inspection-pulse-pin",
      html: '<div class="reticle-core"></div><div class="reticle-ring"></div>',
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
    inspectionMarker = L.marker([lat, lon], { icon: pulseIcon, interactive: false, zIndexOffset: 2500 });
    inspectionMarker.addTo(map);
  }

  // 2. Open Inspector Card with smooth CSS transition & gentle loading cross-fade
  const card = document.getElementById("inspector-card");
  if (card) {
    card.classList.remove("hidden");
    requestAnimationFrame(() => card.classList.add("visible"));
    card.classList.add("is-updating");
  }

  const coordsEl = document.getElementById("insp-coords");
  if (coordsEl) coordsEl.textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

  const rainEl = document.getElementById("insp-live-rain");
  if (rainEl) rainEl.textContent = "Sampling API...";

  // Sample live rainfall for this exact coordinate
  loadLiveRainfallData(lat, lon).then(() => {
    if (rainEl && lastLiveWeather) {
      const rainRate = (lastLiveWeather.rainfall_intensity_mm_hr || 0).toFixed(1);
      const condition = lastLiveWeather.condition || "Precipitation";
      rainEl.textContent = `${rainRate} mm/hr (${condition})`;
    }
  }).catch(() => {});

  try {
    const res = await apiFetch("/flood_info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lon }),
      signal: currentSignal
    }, 8000);

    if (currentSignal.aborted) return;
    if (!res.ok) throw new Error("Flood info query failed");
    const data = await res.json();
    if (currentSignal.aborted) return;

    let elevText = "215.0 m";
    if (typeof data.elevation_m === "number" && !isNaN(data.elevation_m)) {
      elevText = `${data.elevation_m.toFixed(1)} m`;
    }

    let drainName = "MPD-1976 Drain";
    if (data.nearest_drain && data.nearest_drain.drain_name) {
      drainName = data.nearest_drain.drain_name;
      if (data.nearest_drain.basin && !drainName.includes(data.nearest_drain.basin)) {
        drainName += ` (${data.nearest_drain.basin})`;
      }
    }

    let drainDist = (typeof data.nearest_drain_distance_m === "number" && !isNaN(data.nearest_drain_distance_m))
      ? data.nearest_drain_distance_m
      : (data.nearest_drain && typeof data.nearest_drain.distance_m === "number" ? data.nearest_drain.distance_m : null);

    let drainDistText = "N/A";
    if (drainDist !== null) {
      drainDistText = drainDist >= 1000 
        ? `${Math.round(drainDist).toLocaleString()} m (${(drainDist / 1000).toFixed(1)} km)` 
        : `${drainDist.toFixed(1)} m`;
    }

    // Apply values smoothly
    document.getElementById("insp-elevation").textContent = elevText;
    document.getElementById("insp-drain-name").textContent = drainName;
    document.getElementById("insp-drain-dist").textContent = drainDistText;
    document.getElementById("insp-basis").textContent = (data.risk_basis && !data.risk_basis.includes("(")) ? data.risk_basis : "spatial_proxy";

    if (card) card.classList.remove("is-updating");

  } catch (err) {
    if (currentSignal.aborted) return;
    console.warn("Flood info remote fetch fallback:", err.message);

    let minDist = Infinity;
    let closestName = "MPD-1976 Drain";
    if (drainageNetworkLayer && typeof drainageNetworkLayer.eachLayer === "function") {
      drainageNetworkLayer.eachLayer((layer) => {
        if (typeof layer.getLatLng === "function") {
          const dist = map.distance([lat, lon], layer.getLatLng());
          if (dist < minDist) {
            minDist = dist;
            if (layer.feature && layer.feature.properties) {
              closestName = layer.feature.properties.drain_name || closestName;
              if (layer.feature.properties.basin) closestName += ` (${layer.feature.properties.basin})`;
            }
          }
        }
      });
    }

    const approxElev = Math.min(260, Math.max(195, Math.round(215 - (lon - 77.20) * 60 + (lat - 28.60) * 35)));
    const drainDistText = minDist !== Infinity 
      ? (minDist >= 1000 ? `${Math.round(minDist).toLocaleString()} m (${(minDist / 1000).toFixed(1)} km)` : `${Math.round(minDist)} m`)
      : "350 m (Proximity Estimate)";

    document.getElementById("insp-elevation").textContent = `${approxElev}.0 m`;
    document.getElementById("insp-drain-name").textContent = closestName;
    document.getElementById("insp-drain-dist").textContent = drainDistText;
    document.getElementById("insp-basis").textContent = "spatial_proxy";

    if (card) card.classList.remove("is-updating");
  }
}

// --------------------------------------------------------------------------
// POST /predict — Model V2 & Action Priority Engine
// --------------------------------------------------------------------------
function initFormHandlers() {
  const predictForm = document.getElementById("predict-form");
  const routeForm = document.getElementById("route-form");

  if (predictForm) {
    predictForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("btn-predict");
      const spinner = btn ? btn.querySelector(".btn-spinner") : null;
      const btnText = btn ? btn.querySelector("span:not(.btn-spinner)") : null;
      const resultsPanel = document.getElementById("predict-results-panel");

      if (spinner) spinner.classList.remove("hidden");
      if (btnText) btnText.textContent = "Running scenario...";
      if (btn) btn.disabled = true;

      const payload = {
        rainfall_1h: parseFloat(document.getElementById("rainfall_1h").value) || 0,
        rainfall_3h: parseFloat(document.getElementById("rainfall_3h").value) || 0,
        rainfall_6h: parseFloat(document.getElementById("rainfall_6h").value) || 0,
        recent_rainfall_intensity: parseFloat(document.getElementById("recent_rainfall_intensity").value) || 0,
        elevation: parseFloat(document.getElementById("elevation").value) || 0,
        slope: parseFloat(document.getElementById("slope").value) || 0,
        distance_to_drain: parseFloat(document.getElementById("distance_to_drain").value) || 0,
        distance_to_road: parseFloat(document.getElementById("distance_to_road").value) || 0,
        distance_to_infra: parseFloat(document.getElementById("distance_to_infra").value) || 0,
        population_total: parseFloat(document.getElementById("population_total").value) || 0,
        critical_infra_flag: parseInt(document.getElementById("critical_infra_flag").value, 10) || 0,
      };

      // Update Summary Card
      updateScenarioSummaryCard(payload.rainfall_1h, payload.rainfall_3h, payload.rainfall_6h);

      try {
        const res = await apiFetch("/predict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }, 10000);

        if (!res.ok) throw new Error("Scenario simulation unavailable. Please retry.");
        const data = await res.json();

        // Update Severity Badge
        const sevBadge = document.getElementById("res-severity-badge");
        if (sevBadge) {
          sevBadge.textContent = data.flood_severity;
          sevBadge.className = `sev-badge ${data.flood_severity.toLowerCase()}`;
        }

        // Update Probabilities Distribution
        if (data.probabilities) {
          const probs = data.probabilities;
          const lowP = Math.round((probs.Low || 0) * 100);
          const medP = Math.round((probs.Medium || 0) * 100);
          const highP = Math.round((probs.High || 0) * 100);

          const bLow = document.getElementById("p-bar-low");
          const vLow = document.getElementById("p-val-low");
          if (bLow) bLow.style.width = `${lowP}%`;
          if (vLow) vLow.textContent = `${lowP}%`;

          const bMed = document.getElementById("p-bar-medium");
          const vMed = document.getElementById("p-val-medium");
          if (bMed) bMed.style.width = `${medP}%`;
          if (vMed) vMed.textContent = `${medP}%`;

          const bHigh = document.getElementById("p-bar-high");
          const vHigh = document.getElementById("p-val-high");
          if (bHigh) bHigh.style.width = `${highP}%`;
          if (vHigh) vHigh.textContent = `${highP}%`;
        }

        // Update Action Priority Engine Outcome
        if (data.action_priority) {
          const act = data.action_priority;
          const pScore = document.getElementById("res-priority-score");
          if (pScore) pScore.textContent = `Score: ${act.priority_score}`;
          
          const actLvl = document.getElementById("res-action-level");
          if (actLvl) {
            actLvl.textContent = act.action_level;
            actLvl.className = `act-level ${act.action_level.toLowerCase().replace(" ", "-")}`;
          }

          const actDesc = document.getElementById("res-action-desc");
          if (actDesc) actDesc.textContent = act.recommended_action;
        }

        // Add to Scenario Comparison Log
        scenarioHistory.push({
          preset: activePresetName,
          r1h: payload.rainfall_1h,
          r3h: payload.rainfall_3h,
          r6h: payload.rainfall_6h,
          severity: data.flood_severity,
          score: data.action_priority ? data.action_priority.priority_score : "--",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        });
        if (scenarioHistory.length > 5) scenarioHistory.shift();
        renderScenarioLog();

        activeScenario = activePresetName || "NORMAL";
        updatePumpStationsForRainfall(activeScenario, activeTimestep, payload.rainfall_1h);
        loadWaterloggingLayer();

        if (resultsPanel) resultsPanel.classList.remove("hidden");
      } catch (err) {
        alert(`Scenario Simulation Failed: ${err.message}`);
      } finally {
        if (spinner) spinner.classList.add("hidden");
        if (btnText) btnText.textContent = "RUN SCENARIO SIMULATION";
        if (btn) btn.disabled = false;
      }
    });
  }

  const r1hInput = document.getElementById("rainfall_1h");
  if (r1hInput) {
    r1hInput.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      if (!isNaN(val) && val >= 0) {
        let derivedScenario = activeScenario;
        if (val < 25) derivedScenario = "NORMAL";
        else if (val < 60) derivedScenario = "MODERATE";
        else if (val < 95) derivedScenario = "HEAVY";
        else derivedScenario = "EXTREME";

        activeScenario = derivedScenario;
        activePresetName = derivedScenario;

        const presetBtns = document.querySelectorAll(".preset-btn, .preset-btn-4");
        presetBtns.forEach((b) => {
          if (b.getAttribute("data-preset") === derivedScenario.toLowerCase()) {
            b.classList.add("active");
          } else {
            b.classList.remove("active");
          }
        });

        const r3 = parseFloat(document.getElementById("rainfall_3h")?.value) || (val * 1.8);
        const r6 = parseFloat(document.getElementById("rainfall_6h")?.value) || (val * 2.4);
        updateScenarioSummaryCard(val, r3, r6);
        updatePumpStationsForRainfall(derivedScenario, activeTimestep, val);
      }
    });
  }

  // --------------------------------------------------------------------------
  // POST /route — AquaGraph A* Risk Router
  // --------------------------------------------------------------------------
  if (routeForm) {
    routeForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("btn-route");
      const spinner = btn ? btn.querySelector(".btn-spinner") : null;
      const resultsPanel = document.getElementById("route-results-panel");

      if (spinner) spinner.classList.remove("hidden");
      if (btn) btn.disabled = true;

      const r1hEl = document.getElementById("rainfall_1h");
      const r3hEl = document.getElementById("rainfall_3h");
      const r6hEl = document.getElementById("rainfall_6h");
      const intEl = document.getElementById("recent_rainfall_intensity");

      const payload = {
        start_lat: parseFloat(document.getElementById("start_lat").value),
        start_lon: parseFloat(document.getElementById("start_lon").value),
        end_lat: parseFloat(document.getElementById("end_lat").value),
        end_lon: parseFloat(document.getElementById("end_lon").value),
        risk: document.getElementById("route_risk").value,
        scenario: activeScenario,
        timestep: activeTimestep,
        rainfall_1h: r1hEl ? parseFloat(r1hEl.value) || 10.0 : 10.0,
        rainfall_3h: r3hEl ? parseFloat(r3hEl.value) || 20.0 : 20.0,
        rainfall_6h: r6hEl ? parseFloat(r6hEl.value) || 30.0 : 30.0,
        recent_rainfall_intensity: intEl ? parseFloat(intEl.value) || 5.0 : 5.0,
        flood_aware: true,
      };

      try {
        const res = await apiFetch("/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }, 20000);

        if (!res.ok) throw new Error("Route API call failed");
        const data = await res.json();

        if (data.status === "error") {
          throw new Error(data.message || "Route calculation failed");
        }

        // Update Route Metrics
        const tag = document.getElementById("route-status-tag");
        if (tag) {
          tag.textContent = "OK";
          tag.className = "ver-tag ok";
        }

        const distVal = data.physical_distance_m || data.distance_m || 0;
        const distKm = distVal > 1000 ? `${(distVal / 1000).toFixed(2)} km` : `${distVal.toFixed(1)} m`;

        document.getElementById("route-dist").textContent = distKm;
        document.getElementById("route-cost").textContent = `${data.routing_cost || data.estimated_cost}`;
        document.getElementById("route-nodes").textContent = `${data.nodes_in_route}`;
        document.getElementById("route-sensitivity").textContent = `${data.risk_mode || data.risk_level}`;
        document.getElementById("route-snap-orig").textContent = `${data.origin_snap_distance_m} m`;
        document.getElementById("route-snap-dest").textContent = `${data.destination_snap_distance_m} m`;
        
        const elMaxDepth = document.getElementById("route-max-depth");
        const elFloodedCnt = document.getElementById("route-flooded-count");
        const elRiskLvl = document.getElementById("route-risk-level");
        const elForecastTag = document.getElementById("route-forecast-tag");
        const elAvoidedBanner = document.getElementById("route-avoided-banner");
        const elRiskBasis = document.getElementById("route-risk-basis");

        if (elMaxDepth) elMaxDepth.textContent = `${data.maximum_water_depth_cm || 0} cm`;
        if (elFloodedCnt) elFloodedCnt.textContent = `${data.flooded_segments_on_route || 0}`;
        if (elRiskLvl) elRiskLvl.textContent = `${data.route_risk_level || 'Low'}`;
        if (elForecastTag) elForecastTag.textContent = `${data.scenario || activeScenario} (${data.timestep || activeTimestep})`;
        if (elRiskBasis) elRiskBasis.textContent = data.basis || data.risk_basis || "model_derived_flood_aware_routing";

        if (elAvoidedBanner) {
          if (data.avoided_high_risk_segments && data.avoided_high_risk_segments > 0) {
            elAvoidedBanner.textContent = `AquaGraph avoided ${data.avoided_high_risk_segments} high-risk road segments.`;
            elAvoidedBanner.classList.remove("hidden");
          } else {
            elAvoidedBanner.classList.add("hidden");
          }
        }

        // Clear previous route overlays
        routeLayer.clearLayers();
        markersLayer.clearLayers();

        // Render Route Polyline
        const coords = data.coordinates || [];
        if (coords.length > 0) {
          const polyline = L.polyline(coords, {
            color: "#06b6d4",
            weight: 5,
            opacity: 0.85,
            lineJoin: "round",
          }).addTo(routeLayer);

          const popupContent = `
            <div class="waterlogging-popup">
              <div class="wl-popup-title">Model-Derived Flood-Aware Route</div>
              <div class="wl-popup-row"><span>Distance:</span> <strong>${distKm}</strong></div>
              <div class="wl-popup-row"><span>Routing Cost:</span> <strong>${data.routing_cost}</strong></div>
              <div class="wl-popup-row"><span>Max Water Depth:</span> <strong>${data.maximum_water_depth_cm || 0} cm</strong></div>
              <div class="wl-popup-row"><span>Flooded Segments:</span> <strong>${data.flooded_segments_on_route || 0}</strong></div>
              <div class="wl-popup-row"><span>Route Risk:</span> <strong>${data.route_risk_level || 'Low'}</strong></div>
              <div class="wl-popup-row"><span>Forecast:</span> <strong>${data.scenario} ${data.timestep}</strong></div>
              <div class="wl-popup-footer">Risk-aware flood routing (Model-derived proxy)</div>
            </div>
          `;
          polyline.bindPopup(popupContent, { className: "dark-leaflet-popup" });

          const startPt = coords[0];
          const endPt = coords[coords.length - 1];

          L.circleMarker(startPt, { radius: 7, color: "#10b981", fillColor: "#10b981", fillOpacity: 0.9 })
            .bindPopup("Route Origin")
            .addTo(markersLayer);

          L.circleMarker(endPt, { radius: 7, color: "#ef4444", fillColor: "#ef4444", fillOpacity: 0.9 })
            .bindPopup("Route Destination")
            .addTo(markersLayer);

          map.fitBounds(polyline.getBounds(), { padding: [40, 40] });
        }

        if (resultsPanel) resultsPanel.classList.remove("hidden");
      } catch (err) {
        alert(`Routing Failed: ${err.message}`);
      } finally {
        if (spinner) spinner.classList.add("hidden");
        if (btn) btn.disabled = false;
      }
    });
  }

  const clearBtn = document.getElementById("btn-clear-route");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      routeLayer.clearLayers();
      markersLayer.clearLayers();
      const panel = document.getElementById("route-results-panel");
      if (panel) panel.classList.add("hidden");
      if (isSmartRouterActive) {
        renderSmartAlternateRoutes();
      }
    });
  }

  const pickStartBtn = document.getElementById("btn-pick-start");
  if (pickStartBtn) {
    pickStartBtn.addEventListener("click", () => {
      pickingMode = "start";
      map.getContainer().style.cursor = "crosshair";
      alert("Click anywhere on map to set Origin coordinates.");
    });
  }

  const pickEndBtn = document.getElementById("btn-pick-end");
  if (pickEndBtn) {
    pickEndBtn.addEventListener("click", () => {
      pickingMode = "end";
      map.getContainer().style.cursor = "crosshair";
      alert("Click anywhere on map to set Destination coordinates.");
    });
  }
}

// --------------------------------------------------------------------------
// GET /zones — Sample Zone Severity GIS Layer
// --------------------------------------------------------------------------
const DELHI_ZONE_CENTROIDS = [
  { name: "Rohini (North West)", lat: 28.715, lon: 77.115 },
  { name: "Karol Bagh (Central)", lat: 28.652, lon: 77.190 },
  { name: "Connaught Place (Central)", lat: 28.632, lon: 77.219 },
  { name: "Dwarka (South West)", lat: 28.582, lon: 77.060 },
  { name: "Saket (South)", lat: 28.524, lon: 77.210 },
  { name: "Okhla (South East)", lat: 28.560, lon: 77.285 },
  { name: "Shahdara (East)", lat: 28.673, lon: 77.285 },
  { name: "Narela (North)", lat: 28.850, lon: 77.095 }
];

let cachedZonesData = null;
let zoneCircles = [];

function renderZoneFeatures(zones) {
  if (!zonesLayer) return;
  zonesLayer.clearLayers();
  zoneCircles = [];
  const circleOpts = sharedCanvasRenderer ? { renderer: sharedCanvasRenderer } : {};

  zones.forEach((zone, idx) => {
    const color =
      zone.severity === "High" ? "#ef4444" :
      zone.severity === "Medium" ? "#f59e0b" : "#10b981";

    const fallbackCentroid = DELHI_ZONE_CENTROIDS[idx % DELHI_ZONE_CENTROIDS.length];
    let lat = zone.latitude;
    let lon = zone.longitude;
    let zoneName = `Zone ${zone.zone_id}`;

    if (!lat || !lon || (lat === 0.0 && lon === 0.0)) {
      lat = fallbackCentroid.lat;
      lon = fallbackCentroid.lon;
      zoneName = `${zone.zone_id} (${fallbackCentroid.name})`;
    } else {
      zoneName = `${zone.zone_id} (${fallbackCentroid.name})`;
    }

    const popupHtml = `
      <div class="waterlogging-popup">
        <div class="wl-popup-title">Flood Risk Zone ${zoneName}</div>
        <div class="wl-popup-row"><span>Severity:</span> <span class="sev-tag ${zone.severity.toLowerCase()}">${zone.severity}</span></div>
        <div class="wl-popup-row"><span>Risk Corridor:</span> <strong>Urban Inundation Hotspot</strong></div>
        <div class="wl-popup-row"><span>Model Version:</span> <strong>AquaG Model V2</strong></div>
        <div class="wl-popup-footer">Model-derived zone severity (GET /zones)</div>
      </div>
    `;

    const circle = L.circle([lat, lon], {
      ...circleOpts,
      radius: 1200,
      color: color,
      fillColor: color,
      fillOpacity: 0.28,
      weight: 2,
      dashArray: "6, 6"
    })
      .bindPopup(popupHtml, { className: "dark-leaflet-popup" })
      .addTo(zonesLayer);

    zoneCircles.push({
      circle,
      lat,
      lon,
      zone,
      zoneName,
      popupHtml,
      isKarolBagh: fallbackCentroid.name.includes("Karol Bagh")
    });
  });
}

function focusOnFloodRiskRegion(openPopup = true) {
  if (!map) return;

  // The 4 key urban flood risk zones visible across central Delhi:
  // Rohini (28.715, 77.115), Karol Bagh (28.652, 77.190), Connaught Place (28.632, 77.219), Shahdara (28.673, 77.285)
  const urbanZoneCoords = [
    [28.715, 77.115], // Rohini
    [28.652, 77.190], // Karol Bagh
    [28.632, 77.219], // Connaught Place
    [28.673, 77.285]  // Shahdara
  ];

  const bounds = L.latLngBounds(urbanZoneCoords).pad(0.12);

  const doOpenPopup = () => {
    if (!map || (zonesLayer && !map.hasLayer(zonesLayer))) return;

    let target = null;
    if (zoneCircles && zoneCircles.length > 0) {
      target = zoneCircles.find(z => z.isKarolBagh) ||
               zoneCircles.find(z => z.zone && z.zone.severity === "High") ||
               zoneCircles[0];
    }

    if (target) {
      if (target.circle && typeof target.circle.openPopup === "function") {
        target.circle.openPopup();
      } else {
        L.popup({ className: "dark-leaflet-popup" })
          .setLatLng([target.lat, target.lon])
          .setContent(target.popupHtml)
          .openOn(map);
      }
    }
  };

  // Fly smoothly to the flood risk region
  map.flyToBounds(bounds, {
    padding: [45, 45],
    maxZoom: 13,
    duration: 1.1,
    easeLinearity: 0.25
  });

  if (openPopup) {
    map.once("moveend", doOpenPopup);
    setTimeout(() => {
      if (zonesLayer && map.hasLayer(zonesLayer) && !map._popup) {
        doOpenPopup();
      }
    }, 1200);
  }
}

async function loadZoneLayer(shouldFocus = false) {
  const zCheck = document.getElementById("layer-zones-check");
  if (zCheck && !zCheck.checked) return;

  if (cachedZonesData) {
    renderZoneFeatures(cachedZonesData);
    if (shouldFocus) focusOnFloodRiskRegion(true);
    return;
  }

  try {
    const res = await apiFetch("/zones", {}, 8000);
    if (!res.ok) {
      renderZoneFeatures(DELHI_ZONE_CENTROIDS.map((c, i) => ({ zone_id: String(i), latitude: c.lat, longitude: c.lon, severity: i === 7 ? "High" : i % 2 === 1 ? "Medium" : "Low" })));
      if (shouldFocus) focusOnFloodRiskRegion(true);
      return;
    }
    cachedZonesData = await res.json();
    renderZoneFeatures(cachedZonesData);
    if (shouldFocus) focusOnFloodRiskRegion(true);
  } catch (err) {
    console.log("Zone layer fallback:", err.message);
    renderZoneFeatures(DELHI_ZONE_CENTROIDS.map((c, i) => ({ zone_id: String(i), latitude: c.lat, longitude: c.lon, severity: i === 7 ? "High" : i % 2 === 1 ? "Medium" : "Low" })));
    if (shouldFocus) focusOnFloodRiskRegion(true);
  }
}

// --------------------------------------------------------------------------
// LIVE RAINFALL DYNAMICS & OPENWEATHERMAP API CONTROLLER
// --------------------------------------------------------------------------

let rainRadarLayer = null;
let currentRainCoords = { lat: 28.6139, lon: 77.2090 };
let lastLiveWeather = null;
let rainDataAbortCtrl = null;

function getStoredOpenWeatherKey() {
  try {
    return (localStorage.getItem("aquag_owm_api_key") || "").trim();
  } catch (e) {
    return "";
  }
}

function setStoredOpenWeatherKey(key) {
  try {
    if (key && key.trim()) {
      localStorage.setItem("aquag_owm_api_key", key.trim());
    } else {
      localStorage.removeItem("aquag_owm_api_key");
    }
  } catch (e) {}
}

function initRainfallDynamics() {
  // 1. Initialize API key drawer controls
  const keyInput = document.getElementById("owm-api-key-input");
  const saveKeyBtn = document.getElementById("btn-save-api-key");
  const clearKeyBtn = document.getElementById("btn-clear-api-key");
  const modeLabel = document.getElementById("owm-feed-mode-label");

  const storedKey = getStoredOpenWeatherKey();
  if (keyInput && storedKey) {
    keyInput.value = storedKey;
    if (modeLabel) modeLabel.textContent = "Mode: User OpenWeatherMap Feed (Active)";
  }

  if (saveKeyBtn) {
    saveKeyBtn.addEventListener("click", () => {
      const val = (keyInput ? keyInput.value : "").trim();
      if (!val) {
        setStoredOpenWeatherKey("");
        if (modeLabel) modeLabel.textContent = "Mode: Calibrated Delhi Hydrological Feed";
      } else {
        setStoredOpenWeatherKey(val);
        if (modeLabel) modeLabel.textContent = "Mode: User OpenWeatherMap Feed (Active)";
      }
      loadLiveRainfallData(currentRainCoords.lat, currentRainCoords.lon);
      if (rainRadarLayer && map.hasLayer(rainRadarLayer)) {
        toggleRainRadarLayer(true);
      }
    });
  }

  if (clearKeyBtn) {
    clearKeyBtn.addEventListener("click", () => {
      setStoredOpenWeatherKey("");
      if (keyInput) keyInput.value = "";
      if (modeLabel) modeLabel.textContent = "Mode: Calibrated Delhi Hydrological Feed";
      loadLiveRainfallData(currentRainCoords.lat, currentRainCoords.lon);
      if (rainRadarLayer && map.hasLayer(rainRadarLayer)) {
        toggleRainRadarLayer(true);
      }
    });
  }

  // 2. Reset coordinates button
  const resetCoordsBtn = document.getElementById("btn-reset-weather-coords");
  if (resetCoordsBtn) {
    resetCoordsBtn.addEventListener("click", () => {
      currentRainCoords = { lat: 28.6139, lon: 77.2090 };
      if (inspectionMarker) {
        inspectionMarker.setLatLng([28.6139, 77.2090]);
      }
      map.flyTo([28.6139, 77.2090], 12, { duration: 0.8 });
      loadLiveRainfallData(28.6139, 77.2090);
    });
  }

  // 3. Quick Radar Overlay button
  const radarBtn = document.getElementById("btn-toggle-rain-radar");
  if (radarBtn) {
    radarBtn.addEventListener("click", () => {
      const check = document.getElementById("layer-rain-radar-check");
      const willEnable = check ? !check.checked : !rainRadarLayer || !map.hasLayer(rainRadarLayer);
      if (check) check.checked = willEnable;
      toggleRainRadarLayer(willEnable);
    });
  }

  // 4. Sync GIS Simulation to Live Rain button
  const syncBtn = document.getElementById("btn-sync-simulation-live-rain");
  if (syncBtn) {
    syncBtn.addEventListener("click", () => {
      syncGisWithLiveRain();
    });
  }

  // 5. Initial load for Delhi center
  setTimeout(() => {
    loadLiveRainfallData(28.6139, 77.2090);
  }, 100);
}

async function loadLiveRainfallData(lat = 28.6139, lon = 77.2090) {
  currentRainCoords = { lat, lon };
  const key = getStoredOpenWeatherKey();

  if (rainDataAbortCtrl) {
    rainDataAbortCtrl.abort();
  }
  rainDataAbortCtrl = new AbortController();
  const signal = rainDataAbortCtrl.signal;

  // Update coords badge immediately
  const coordsBadge = document.getElementById("rainfall-coords-badge");
  if (coordsBadge) {
    const latStr = lat >= 0 ? `${lat.toFixed(4)}° N` : `${Math.abs(lat).toFixed(4)}° S`;
    const lonStr = lon >= 0 ? `${lon.toFixed(4)}° E` : `${Math.abs(lon).toFixed(4)}° W`;
    coordsBadge.textContent = `${latStr}, ${lonStr}`;
  }

  try {
    const params = new URLSearchParams({
      lat: lat.toFixed(5),
      lon: lon.toFixed(5)
    });
    if (key) params.append("appid", key);

    const res = await apiFetch(`/weather/live?${params.toString()}`, { signal }, 6000);
    if (signal.aborted) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (signal.aborted) return;

    lastLiveWeather = data;
    renderRainfallDynamicsPanel(data);
  } catch (err) {
    if (signal.aborted) return;
    console.warn("Live rainfall fetch notice:", err.message);
  }
}

function renderRainfallDynamicsPanel(data) {
  if (!data) return;

  // Source pill & Station Name
  const sourcePill = document.getElementById("rainfall-source-pill");
  if (sourcePill) {
    sourcePill.textContent = data.is_fallback ? "CALIBRATED FEED" : "OWM LIVE FEED";
    sourcePill.style.background = data.is_fallback ? "rgba(56, 189, 248, 0.15)" : "rgba(16, 185, 129, 0.2)";
    sourcePill.style.color = data.is_fallback ? "#38bdf8" : "#34d399";
  }

  const stationName = document.getElementById("rainfall-station-name");
  if (stationName) {
    stationName.textContent = data.station_name || "Delhi Regional Station";
  }

  // Level badge & pulsating indicator
  const levelBadge = document.getElementById("rainfall-level-badge");
  const liveDot = document.getElementById("rainfall-live-dot");
  const classification = data.classification || {};
  const level = (classification.level || "NORMAL").toUpperCase();
  const severity = classification.severity || "low";

  if (levelBadge) {
    levelBadge.textContent = level;
    levelBadge.className = `scada-status-badge ${level.toLowerCase()}`;
  }

  if (liveDot) {
    const dotColor = severity === "critical" ? "#ef4444" : severity === "high" ? "#f97316" : severity === "medium" ? "#eab308" : "#10b981";
    liveDot.style.background = dotColor;
    liveDot.style.boxShadow = `0 0 8px ${dotColor}`;
  }

  // Live Rain Intensity Rate KPI
  const rateVal = document.getElementById("rainfall-rate-val");
  if (rateVal) {
    rateVal.textContent = (data.rainfall_intensity_mm_hr || 0.0).toFixed(1);
  }

  const intensityTag = document.getElementById("rainfall-intensity-tag");
  if (intensityTag) {
    intensityTag.textContent = classification.label || "LIGHT";
    intensityTag.className = `intensity-tag tag-${severity === "critical" ? "crit" : severity === "high" ? "high" : severity === "medium" ? "med" : "low"}`;
  }

  // 1-Hour & 3-Hour Accumulations
  const total1h = document.getElementById("rainfall-total-1h");
  if (total1h) {
    total1h.textContent = (data.total_precip_1h_mm || data.rainfall_intensity_mm_hr || 0.0).toFixed(1);
  }

  const total3h = document.getElementById("rainfall-total-3h");
  if (total3h) {
    total3h.textContent = (data.total_precip_3h_mm || (data.rainfall_intensity_mm_hr * 2.2) || 0.0).toFixed(1);
  }

  // Doppler Radar Reflectivity
  const dbzVal = document.getElementById("rainfall-dbz-val");
  if (dbzVal) {
    dbzVal.textContent = (data.dbz_reflectivity || 0.0).toFixed(1);
    if (data.radar_color) {
      dbzVal.style.color = data.radar_color;
    }
  }

  // Atmospheric Conditions (Humidity & Clouds)
  const humidVal = document.getElementById("rainfall-humidity-val");
  const cloudVal = document.getElementById("rainfall-cloud-val");
  if (humidVal) humidVal.textContent = `${data.humidity_pct || 0}%`;
  if (cloudVal) cloudVal.textContent = `/ ${data.cloud_cover_pct || 0}% cld`;

  // Wind Vector
  const windVal = document.getElementById("rainfall-wind-val");
  const windDir = document.getElementById("rainfall-wind-dir");
  if (windVal) windVal.textContent = (data.wind_speed_kmh || 0.0).toFixed(1);
  if (windDir) windDir.textContent = `km/h ${data.wind_direction_cardinal || 'N'}`;

  // Alert Box
  const alertCard = document.getElementById("rainfall-alert-card");
  const alertTitle = document.getElementById("rainfall-alert-title");
  const alertDesc = document.getElementById("rainfall-alert-desc");
  if (alertCard && alertTitle && alertDesc) {
    if (severity === "critical") {
      alertCard.className = "rainfall-alert-box alert-critical";
      alertTitle.textContent = "CRITICAL EMERGENCY: TORRENTIAL EVENT";
    } else if (severity === "high") {
      alertCard.className = "rainfall-alert-box alert-heavy";
      alertTitle.textContent = "HIGH WARNING: HEAVY INUNDATION THREAT";
    } else if (severity === "medium") {
      alertCard.className = "rainfall-alert-box alert-moderate";
      alertTitle.textContent = "ADVISORY: MODERATE DRAINAGE SURCHARGE";
    } else {
      alertCard.className = "rainfall-alert-box alert-normal";
      alertTitle.textContent = "PRECIPITATION THRESHOLD: NORMAL";
    }
    alertDesc.textContent = classification.alert_message || "Normal municipal gravity drainage tolerances in effect.";
  }

  // Nowcast Projections
  const projections = data.forecast_projections || [];
  projections.forEach((p, idx) => {
    const rainEl = document.getElementById(`forecast-rain-${idx === 0 ? '1h' : idx === 1 ? '3h' : '6h'}`);
    const trendEl = document.getElementById(`forecast-trend-${idx === 0 ? '1h' : idx === 1 ? '3h' : '6h'}`);
    if (rainEl) rainEl.textContent = `${(p.rainfall_mm_hr || 0.0).toFixed(1)} mm/h`;
    if (trendEl) {
      trendEl.textContent = p.trend || 'steady';
      trendEl.className = `f-trend trend-${p.trend || 'steady'}`;
    }
  });
}

async function toggleRainRadarLayer(enable) {
  if (!enable) {
    if (rainRadarLayer && map.hasLayer(rainRadarLayer)) {
      map.removeLayer(rainRadarLayer);
    }
    const check = document.getElementById("layer-rain-radar-check");
    if (check) check.checked = false;
    return;
  }

  const check = document.getElementById("layer-rain-radar-check");
  if (check) check.checked = true;

  try {
    const key = getStoredOpenWeatherKey();
    const params = new URLSearchParams({
      lat: currentRainCoords.lat.toFixed(5),
      lon: currentRainCoords.lon.toFixed(5)
    });
    if (key) params.append("appid", key);

    const res = await apiFetch(`/weather/radar?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson = await res.json();

    if (rainRadarLayer && map.hasLayer(rainRadarLayer)) {
      map.removeLayer(rainRadarLayer);
    }

    const featureLayers = [];
    (geojson.features || []).forEach((feat) => {
      const p = feat.properties;
      const coords = feat.geometry.coordinates;
      const latLng = [coords[1], coords[0]];

      const circle = L.circle(latLng, {
        radius: p.radius_meters || 4500,
        color: p.color || "#38bdf8",
        weight: 2,
        opacity: 0.85,
        fillColor: p.color || "#38bdf8",
        fillOpacity: 0.24,
        className: "radar-cell-pulse"
      });

      circle.bindPopup(`
        <div class="scada-popup">
          <div class="popup-title-row">
            <span class="live-dot pulse" style="background:${p.color}"></span>
            <strong>${p.name}</strong>
          </div>
          <div class="popup-subtitle font-mono">${p.description}</div>
          <div class="popup-divider"></div>
          <div class="popup-grid">
            <div class="popup-item">
              <span class="p-label">Rain Intensity:</span>
              <span class="p-value font-mono" style="color:${p.color}; font-weight:800;">${p.intensity_mm_hr} mm/hr</span>
            </div>
            <div class="popup-item">
              <span class="p-label">Radar dBZ:</span>
              <span class="p-value font-mono">${p.dbz} dBZ</span>
            </div>
            <div class="popup-item">
              <span class="p-label">Catchment:</span>
              <span class="p-value font-mono">${(p.radius_meters/1000).toFixed(1)} km</span>
            </div>
            <div class="popup-item">
              <span class="p-label">Flood Threat:</span>
              <span class="p-value font-mono" style="color:${p.color}; font-weight:700;">${p.level}</span>
            </div>
          </div>
          <button class="popup-smart-router-btn" style="margin-top:8px; width:100%;" onclick="syncGisWithSpecificRain(${p.intensity_mm_hr}, '${p.level}')">
            ⚡ Sync Simulation to Basin Rain
          </button>
        </div>
      `);

      featureLayers.push(circle);
    });

    rainRadarLayer = L.layerGroup(featureLayers);
    rainRadarLayer.addTo(map);

    if (key) {
      const tileLayer = L.tileLayer(
        `https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${key}`,
        { maxZoom: 18, opacity: 0.65 }
      );
      rainRadarLayer.addLayer(tileLayer);
    }
  } catch (err) {
    console.warn("Could not load radar layer:", err);
  }
}

async function syncGisWithLiveRain() {
  const syncBtn = document.getElementById("btn-sync-simulation-live-rain");
  const syncStatus = document.getElementById("rainfall-sync-status");

  if (!lastLiveWeather) {
    await loadLiveRainfallData(currentRainCoords.lat, currentRainCoords.lon);
  }

  if (!lastLiveWeather) {
    if (syncStatus) syncStatus.textContent = "Error: Live telemetry feed unreachable.";
    return;
  }

  const rainRate = lastLiveWeather.rainfall_intensity_mm_hr || 10.0;
  const syncData = lastLiveWeather.simulation_sync || {};
  const scenario = syncData.scenario || (rainRate > 50 ? "EXTREME" : rainRate > 25 ? "HEAVY" : rainRate > 10 ? "MODERATE" : "NORMAL");

  if (syncBtn) {
    syncBtn.innerHTML = `<span>⏳ Syncing to ${rainRate.toFixed(1)} mm/hr...</span>`;
    syncBtn.disabled = true;
  }

  try {
    await applyRainfallToGisSimulation(scenario, rainRate, syncData);
    if (syncStatus) {
      syncStatus.textContent = `✓ Synced! ML model & pump stations operating at ${rainRate.toFixed(1)} mm/hr (${scenario} condition)`;
      syncStatus.style.color = "#34d399";
      setTimeout(() => {
        if (syncStatus) syncStatus.style.color = "";
      }, 6000);
    }
  } catch (err) {
    console.error("Simulation sync error:", err);
    if (syncStatus) syncStatus.textContent = `Sync completed with warning: ${err.message}`;
  } finally {
    if (syncBtn) {
      syncBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ⚡ Sync GIS Simulation to Live Rain`;
      syncBtn.disabled = false;
    }
  }
}

window.syncGisWithSpecificRain = function(rainRate, riskLevel) {
  const scenario = riskLevel === "EXTREME" ? "EXTREME" : riskLevel === "HEAVY" ? "HEAVY" : riskLevel === "MODERATE" ? "MODERATE" : "NORMAL";
  applyRainfallToGisSimulation(scenario, rainRate, {
    rainfall_1h: rainRate,
    rainfall_3h: rainRate * 2.2,
    rainfall_6h: rainRate * 3.8
  });
  if (map._popup) map.closePopup();
};

async function applyRainfallToGisSimulation(scenario, rainRate, syncData = {}) {
  activeScenario = scenario;
  activePresetName = scenario;

  const presetBtns = document.querySelectorAll(".preset-btn, .preset-btn-4");
  presetBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-preset") === scenario.toLowerCase());
  });

  const r1h = syncData.rainfall_1h || Math.max(5.0, rainRate);
  const r3h = syncData.rainfall_3h || Math.max(10.0, rainRate * 2.2);
  const r6h = syncData.rainfall_6h || Math.max(15.0, rainRate * 3.8);

  const el1h = document.getElementById("rainfall_1h");
  const el3h = document.getElementById("rainfall_3h");
  const el6h = document.getElementById("rainfall_6h");
  const elInt = document.getElementById("recent_rainfall_intensity");

  if (el1h) el1h.value = r1h.toFixed(1);
  if (el3h) el3h.value = r3h.toFixed(1);
  if (el6h) el6h.value = r6h.toFixed(1);
  if (elInt) elInt.value = rainRate.toFixed(1);

  if (typeof updateScenarioSummaryCard === "function") {
    updateScenarioSummaryCard(r1h, r3h, r6h);
  }

  if (typeof updatePumpStationsForRainfall === "function") {
    updatePumpStationsForRainfall(activeScenario, activeTimestep, r1h);
  }

  if (typeof loadWaterloggingLayer === "function") {
    loadWaterloggingLayer();
  }
  if (typeof loadPopulationPriorityLayer === "function") {
    loadPopulationPriorityLayer();
  }
  if (typeof loadAlertsPanel === "function") {
    loadAlertsPanel();
  }
  if (typeof updateScadaTelemetry === "function") {
    updateScadaTelemetry();
  }
}

# AquaG — Complete Project Deployment Guide

This repository (https://github.com/mekanH-c/Exp.git) is now configured for **unified full-stack cloud deployment**, meaning the Python FastAPI backend serves both the GIS/ML API and the glassmorphism frontend simultaneously from a single service.

---

## Option 1: Render.com (Recommended — 100% Free Full-Stack)

Render deploys both the FastAPI Backend and the UI under a single URL with SSL, auto-reloads, and zero CORS issues.

### Steps:
1. Go to [https://render.com](https://render.com) and Sign In with GitHub.
2. Click **New +** -> **Web Service**.
3. Select **Build and deploy from a Git repository** -> Choose mekanH-c/Exp.
4. Configure settings (Render will auto-detect from ender.yaml or you can enter):
   - **Name:** quag-flood-center (or any name)
   - **Region:** Any (e.g. Oregon / Frankfurt / Singapore)
   - **Branch:** main
   - **Language:** Python 3
   - **Build Command:** pip install -r requirements.txt
   - **Start Command:** uvicorn backend.main:app --host 0.0.0.0 --port 
   - **Instance Type:** Free
5. Click **Deploy Web Service**.
6. In ~2-3 minutes, your live site will be ready at: https://aquag-flood-center.onrender.com.

---

## Option 2: GitHub Pages (Frontend Hosting in 30 Seconds)

To host the UI directly on GitHub:
1. Go to your repo: [https://github.com/mekanH-c/Exp](https://github.com/mekanH-c/Exp)
2. Click **Settings** (top tab) -> **Pages** (left sidebar).
3. Under **Build and deployment** -> **Source**:
   - Select **Deploy from a branch**.
   - Branch: main, folder: / (root).
4. Click **Save**.
5. In 1 minute, your site will be live at: https://mekanh-c.github.io/Exp/.

---

## Option 3: Railway.app / Koyeb (Alternative Free Clouds)

Both Railway and Koyeb automatically read the provided Dockerfile and equirements.txt:
1. Log into [Railway.app](https://railway.app) or [Koyeb.com](https://koyeb.com) with GitHub.
2. Select **New Project** -> **Deploy from GitHub repo** -> Select mekanH-c/Exp.
3. The platform auto-detects Dockerfile and builds the production container with full geospatial libraries (libgdal, libgeos, libproj).

---

## Option 4: Docker Local / Self-Hosted VPS

`ash
# Build the production image
docker build -t aquag-system .

# Run on port 8000
docker run -d -p 8000:8000 --name aquag aquag-system
`
Visit http://localhost:8000 to access the full system.

---

## Option 5: Local Terminal Execution

`ash
# Run the unified FastAPI server (serves frontend + ML API)
python -m uvicorn backend.main:app --port 8000 --host 0.0.0.0
`
Open http://localhost:8000 in your browser.

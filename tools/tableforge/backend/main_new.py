"""TableForge Backend - Main entry point with modular routes."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pathlib import Path

# Import all route routers
from routes import (
    upload_router, tabulate_router, metrics_router, dataset_router,
    export_router, projects_router, stats_router, compare_router,
    ai_router, fg_router,
)

# Import shared state and utils
from state import (
    datasets, custom_metrics, custom_bins, audit_logs,
    annotations, column_type_overrides,
    PROJECTS_DIR, EXPORTS_DIR, CACHE_DIR, METRICS_DIR, LIBRARY_DIR,
)

BASE_DIR = Path(__file__).resolve().parent.parent

# Create directories
for d in [PROJECTS_DIR, EXPORTS_DIR, CACHE_DIR, METRICS_DIR, LIBRARY_DIR]:
    d.mkdir(exist_ok=True)

# FastAPI app
app = FastAPI(title="TableForge", version="2.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include all routers
app.include_router(upload_router, prefix="/api")
app.include_router(tabulate_router, prefix="/api")
app.include_router(metrics_router, prefix="/api")
app.include_router(dataset_router, prefix="/api")
app.include_router(export_router, prefix="/api")
app.include_router(projects_router, prefix="/api")
app.include_router(stats_router, prefix="/api")
app.include_router(compare_router, prefix="/api")
app.include_router(ai_router, prefix="/api")
app.include_router(fg_router, prefix="/api")

# Serve frontend static files (production)
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(exist_ok=True)
app.mount("/assets", StaticFiles(directory=str(STATIC_DIR)), name="assets")

# Health check endpoint
@app.get("/health")
def health_check():
    return {"status": "ok"}

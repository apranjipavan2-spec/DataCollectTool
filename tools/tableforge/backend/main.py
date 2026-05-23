"""TableForge Backend — FastAPI app entry point.

All endpoint logic lives in routers/. Shared state and utilities live in shared.py.
This file only creates the app, registers routers, and serves the frontend.
"""

from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .shared import BASE_DIR

from .routers import (
    upload,
    tabulate,
    metrics,
    bins,
    columns,
    quality,
    library,
    projects,
    export,
    compare,
    stats,
    ai,
    fieldgovern,
    files,
    metadata,
    inferential,
    likert,
    multi_response,
    observer,
    auto_analyze,
    survey_suggest,
    survey_quality,
    balance,
    geo,
    driver,
    cluster,
    verbatim,
    clean,
)

app = FastAPI(title="TableForge", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register all routers
app.include_router(upload.router)
app.include_router(tabulate.router)
app.include_router(metrics.router)
app.include_router(bins.router)
app.include_router(columns.router)
app.include_router(quality.router)
app.include_router(library.router)
app.include_router(projects.router)
app.include_router(export.router)
app.include_router(compare.router)
app.include_router(stats.router)
app.include_router(ai.router)
app.include_router(fieldgovern.router)
app.include_router(files.router)
app.include_router(metadata.router)
app.include_router(inferential.router)
app.include_router(likert.router)
app.include_router(multi_response.router)
app.include_router(observer.router)
app.include_router(auto_analyze.router)
app.include_router(survey_suggest.router)
app.include_router(survey_quality.router)
app.include_router(balance.router)
app.include_router(geo.router)
app.include_router(driver.router)
app.include_router(cluster.router)
app.include_router(verbatim.router)
app.include_router(clean.router)

# Serve frontend static files (production)
STATIC_DIR = BASE_DIR / "static"
if STATIC_DIR.exists() and (STATIC_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        file_path = STATIC_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(STATIC_DIR / "index.html")

# Health check endpoint
@app.get("/health")
def health_check():
    return {"status": "ok"}

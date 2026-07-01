"""TableForge Backend — FastAPI app entry point.

All endpoint logic lives in routers/. Shared state and utilities live in shared.py.
This file only creates the app, registers routers, and serves the frontend.
"""

import asyncio
import contextlib
from pathlib import Path
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .shared import BASE_DIR, require_identity, evict_stale_datasets

_EVICTION_INTERVAL = 30 * 60  # sweep every 30 minutes


async def _dataset_eviction_loop():
    while True:
        await asyncio.sleep(_EVICTION_INTERVAL)
        try:
            evict_stale_datasets()
        except Exception:
            pass


@contextlib.asynccontextmanager
async def _lifespan(app: FastAPI):
    task = asyncio.create_task(_dataset_eviction_loop())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

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
    triangulate,
    causal,
    power,
    codebook,
    play_mode,
)

app = FastAPI(title="TableForge", version="2.0", lifespan=_lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth gate applied to every data/compute router below. Requires a verified
# FieldGovern token (see shared.require_identity) so the analyzer can't be used
# anonymously. The exceptions are registered without it:
#   - fieldgovern: self-authenticates via the token carried in each request body
#   - clean: server-to-server cleaner handoff, keyed by its own handoff token
#   - projects: enforces ownership per-endpoint via current_identity already
_AUTH = [Depends(require_identity)]

# Public / self-authenticating routers
app.include_router(fieldgovern.router)
app.include_router(clean.router)
app.include_router(projects.router)

# Protected routers — require a logged-in FieldGovern user
for _r in (
    upload, tabulate, metrics, bins, columns, quality, library, export,
    compare, stats, ai, files, metadata, inferential, likert, multi_response,
    observer, auto_analyze, survey_suggest, survey_quality, balance, geo,
    driver, cluster, verbatim, triangulate, causal, power, codebook, play_mode,
):
    app.include_router(_r.router, dependencies=_AUTH)

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

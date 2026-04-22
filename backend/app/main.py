from pathlib import Path
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from app.api.router import router
from app.core.config import settings
from app.core.rate_limit import limiter
from app.core.scheduler import start_scheduler, stop_scheduler
import app.models  # noqa: F401 — ensures all FK relationships are registered

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)


# ── Lifespan (startup / shutdown) ─────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="FieldGovern API", version="0.1.0", lifespan=lifespan)

# ── Rate limiting (in-memory, no Redis needed) ───────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# Serve uploaded media files (photos/audio)
uploads_dir = Path(settings.MEDIA_DIR)
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(uploads_dir)), name="media")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")


@app.get("/health")
def health():
    return {"status": "ok"}


# Serve React frontend — SPA fallback (must be last)
static_dir = Path(__file__).parent.parent / "static"
if static_dir.exists():
    assets_dir = static_dir / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        file_path = static_dir / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        index = static_dir / "index.html"
        return FileResponse(str(index)) if index.exists() else {"detail": "Not Found"}

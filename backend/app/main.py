from pathlib import Path
import logging
from contextlib import asynccontextmanager
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
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

# ── Sentry ────────────────────────────────────────────────────────────────────
if settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        integrations=[FastApiIntegration(), SqlalchemyIntegration()],
        traces_sample_rate=0.2,
        send_default_pii=False,
    )

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


# Serve React frontend + marketing website (must be last)
static_dir = Path(__file__).parent.parent / "static"
website_dir = Path(__file__).parent.parent / "website"

if static_dir.exists() or website_dir.exists():
    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        # Check React build first
        if static_dir.exists():
            file_path = static_dir / full_path
            if file_path.is_file():
                return FileResponse(str(file_path))
        # Check marketing website files
        if website_dir.exists():
            website_path = website_dir / full_path
            if website_path.is_file():
                return FileResponse(str(website_path))
            # Serve website index at root
            if full_path in ("", "/"):
                website_index = website_dir / "index.html"
                if website_index.exists():
                    return FileResponse(str(website_index))
        # Fall back to React SPA
        index = static_dir / "index.html"
        return FileResponse(str(index)) if index.exists() else {"detail": "Not Found"}

from pathlib import Path
import json
import logging
import time
import uuid as _uuid_mod
from contextlib import asynccontextmanager
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from app.api.router import router
from app.core.config import settings
from app.core.database import get_db
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
def _seed_deepseek_key():
    """Auto-seed DEEPSEEK_API_KEY env var into system_settings on first startup."""
    import os
    key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not key:
        return
    try:
        from app.core.database import SessionLocal
        from app.models.system_setting import SystemSetting
        from sqlalchemy.orm.attributes import flag_modified
        with SessionLocal() as db:
            row = db.query(SystemSetting).filter(SystemSetting.key == "ai_config").first()
            cfg = dict(row.value or {}) if row else {}
            if "keys" not in cfg:
                cfg = {"keys": {}, "active_provider": cfg.get("provider", "")}
            if not cfg["keys"].get("deepseek", {}).get("api_key"):
                cfg["keys"].setdefault("deepseek", {})
                cfg["keys"]["deepseek"]["api_key"] = key
                cfg["keys"]["deepseek"]["model"] = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash")
                if not cfg.get("active_provider"):
                    cfg["active_provider"] = "deepseek"
                if row:
                    row.value = cfg
                    flag_modified(row, "value")
                else:
                    db.add(SystemSetting(key="ai_config", value=cfg))
                db.commit()
                logging.info("DeepSeek API key seeded from environment.")
    except Exception as e:
        logging.warning(f"DeepSeek seed failed (non-fatal): {e}")


def _assert_production_secrets():
    unsafe = {
        "change-me-in-production",
        "your-super-secret-key-change-in-production-12345",
        "CHANGE_ME_USE_A_LONG_RANDOM_STRING",
    }
    if settings.JWT_SECRET in unsafe or len(settings.JWT_SECRET) < 32:
        import sys
        logging.critical(
            "FATAL: JWT_SECRET is insecure. "
            "Generate one with: python -c \"import secrets; print(secrets.token_hex(48))\""
        )
        sys.exit(1)

    warnings = []
    if not settings.SMTP_HOST:
        warnings.append("SMTP_HOST not set — 2FA OTP emails and password reset will not be delivered.")
    if not settings.GOOGLE_CLIENT_ID:
        warnings.append("GOOGLE_CLIENT_ID not set — Google Sign-In will be disabled.")
    if not settings.APP_URL or settings.APP_URL == "http://localhost:5173":
        warnings.append("APP_URL is localhost — email links will point to localhost in production.")
    for w in warnings:
        logging.warning("[startup] %s", w)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _assert_production_secrets()
    _seed_deepseek_key()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(
    title="FieldGovern API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)


def _custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    from fastapi.openapi.utils import get_openapi
    schema = get_openapi(
        title="FieldGovern API",
        version="0.1.0",
        description=(
            "Multi-tenant field data collection API. "
            "All endpoints except `/auth/*` and `/public/*` require a Bearer JWT. "
            "Obtain a token via `POST /api/v1/auth/login` or `POST /api/v1/auth/google`."
        ),
        routes=app.routes,
    )
    schema.setdefault("components", {})
    schema["components"]["securitySchemes"] = {
        "BearerAuth": {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}
    }
    schema["security"] = [{"BearerAuth": []}]
    app.openapi_schema = schema
    return schema


app.openapi = _custom_openapi


# ── Security headers ──────────────────────────────────────────────────────────
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response as StarletteResponse

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        response: StarletteResponse = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(self)"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        # Allow the SPA to function; restrict everything else
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            # 'wasm-unsafe-eval' lets the OPFS/wa-sqlite WebAssembly module compile
            # (needed by the offline Collect storage layer). It permits WASM only —
            # NOT general JS eval() — so it is far narrower than 'unsafe-eval'.
            "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://us-assets.i.posthog.com; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob: https://*.tile.openstreetmap.org; "
            "connect-src 'self' https://api.deepseek.com https://us.i.posthog.com https://us-assets.i.posthog.com; "
            "media-src 'self' blob:; "
            "worker-src 'self' blob:; "
            "frame-ancestors 'none';"
        )
        return response

app.add_middleware(SecurityHeadersMiddleware)


# ── Structured request logging ────────────────────────────────────────────────
_req_logger = logging.getLogger("fieldgovern.request")

class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        req_id = request.headers.get("X-Request-ID") or str(_uuid_mod.uuid4())[:8]
        start = time.monotonic()

        # Extract user_id from JWT without failing if absent/invalid
        user_id: str | None = None
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            try:
                from jose import jwt as _jwt, JWTError
                payload = _jwt.decode(auth[7:], settings.JWT_SECRET, algorithms=["HS256"])
                user_id = payload.get("sub")
            except Exception:
                pass

        response: StarletteResponse = await call_next(request)
        duration_ms = round((time.monotonic() - start) * 1000)
        response.headers["X-Request-ID"] = req_id

        # Skip logging for static assets to avoid noise
        path = request.url.path
        if not path.startswith("/media/") and not path.startswith("/static/"):
            _req_logger.info(json.dumps({
                "req_id": req_id,
                "method": request.method,
                "path": path,
                "status": response.status_code,
                "duration_ms": duration_ms,
                "user_id": user_id,
            }))

        return response

app.add_middleware(RequestLoggingMiddleware)

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
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        raise HTTPException(status_code=503, detail="Database unavailable")
    return {"status": "ok", "db": "ok"}


# Serve React SPA — catch-all must be last
static_dir = Path(__file__).parent.parent / "static"

if static_dir.exists():
    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        # Serve exact static asset if it exists (JS, CSS, images)
        file_path = static_dir / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        # All other routes → React SPA index.html
        return FileResponse(str(static_dir / "index.html"))

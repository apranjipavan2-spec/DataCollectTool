from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.core.config import settings, normalize_db_url
import logging

logger = logging.getLogger(__name__)

_db_url = normalize_db_url(settings.DATABASE_URL)
# Log the effective DB URL (mask password) for debugging
_masked = _db_url.split("@")[0].rsplit(":", 1)[0] + ":***@" + _db_url.split("@", 1)[1] if "@" in _db_url else _db_url
logger.info("Connecting to database: %s", _masked)

engine = create_engine(
    _db_url,
    normalize_db_url(settings.DATABASE_URL),
    pool_pre_ping=True,     # test connections before use — prevents stale-connection 500s
    pool_size=10,            # connection pool size
    max_overflow=20,         # extra connections when pool is full
    pool_recycle=1800,       # recycle connections every 30 min to avoid idle timeouts
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def set_tenant_context(db, tenant_id: str):
    """Set RLS tenant context for the current DB session.

    Uses PostgreSQL GUC variable `app.current_tenant`.
    All RLS policies reference this via current_setting('app.current_tenant', true).
    """
    try:
        db.execute(text("SET app.current_tenant = :tid"), {"tid": str(tenant_id)})
    except Exception as e:
        logger.error("Failed to set tenant context for %s: %s", tenant_id, e)
        raise

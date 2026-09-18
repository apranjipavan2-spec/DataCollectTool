"""
Test fixtures — uses a separate PostgreSQL test database.

Prerequisites:
  createdb fieldgovern_test   (or set TEST_DATABASE_URL env var)

Run:
  cd backend && pytest tests/ -v
"""
import os
import uuid
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

# ── Database setup ─────────────────────────────────────────────────────────────

TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql://fieldgovern:password@localhost:5432/fieldgovern_test",
)


def _check_db_available(url: str) -> bool:
    try:
        engine = create_engine(url, pool_pre_ping=True)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        engine.dispose()
        return True
    except Exception:
        return False


db_available = _check_db_available(TEST_DB_URL)
skip_no_db = pytest.mark.skipif(not db_available, reason="Test database not available — run: createdb fieldgovern_test")


@pytest.fixture(scope="session")
def test_engine():
    if not db_available:
        pytest.skip("Test database not available")
    engine = create_engine(TEST_DB_URL, pool_pre_ping=True)
    # Import all models so SQLAlchemy knows the schema
    import app.models  # noqa: F401
    from app.core.database import Base
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture
def db_session(test_engine):
    """Per-test session that rolls back after each test — no residual data."""
    connection = test_engine.connect()
    transaction = connection.begin()
    TestingSession = sessionmaker(bind=connection)
    session = TestingSession()
    yield session
    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture
def client(db_session):
    """FastAPI TestClient with database dependency overridden."""
    from app.main import app
    from app.core.database import get_db

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    app.dependency_overrides.clear()


# ── Seed helpers ───────────────────────────────────────────────────────────────

def make_tenant(db_session, name="Test Org") -> "Tenant":  # type: ignore[name-defined]
    from app.models.tenant import Tenant
    t = Tenant(id=uuid.uuid4(), name=name, plan_tier="professional")
    db_session.add(t)
    db_session.flush()
    return t


def make_user(db_session, tenant_id, role="org_admin", phone="+919999000001", password="Test@1234"):
    from app.models.user import User
    from app.core.security import hash_password
    u = User(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        role=role,
        phone=phone,
        password_hash=hash_password(password),
        name="Test User",
        is_active=True,
    )
    db_session.add(u)
    db_session.flush()
    return u


def make_form(db_session, tenant_id, title="Test Form"):
    from app.models.form import Form
    f = Form(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        title=title,
        status="active",
        json_schema={"sections": [], "version": 1},
        version=1,
    )
    db_session.add(f)
    db_session.flush()
    return f


def make_submission(db_session, tenant_id, form_id, enumerator_id, data=None):
    from app.models.submission import Submission
    s = Submission(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        form_id=form_id,
        enumerator_id=enumerator_id,
        data_json=data or {"q1": "answer"},
        status="synced",
    )
    db_session.add(s)
    db_session.flush()
    return s


def auth_token(user_id: str, tenant_id: str, role: str) -> str:
    """Generate a JWT directly without hitting the login endpoint."""
    from app.core.security import create_access_token
    return create_access_token({"sub": str(user_id), "tenant_id": str(tenant_id), "role": role, "name": "Test"})


def auth_headers(user_id: str, tenant_id: str, role: str) -> dict:
    return {"Authorization": f"Bearer {auth_token(user_id, tenant_id, role)}"}

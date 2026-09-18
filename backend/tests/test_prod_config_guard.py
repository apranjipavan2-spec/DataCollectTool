"""Startup guard: the app must refuse to start with a guessable JWT secret or
an open/unset CORS policy when APP_URL looks like a real deployment (not
localhost). Must NOT fire for local dev with zero .env configured — that
would break `docker compose up` for every contributor. Runs main.py's guard
logic directly (the same snippet used at import time) via subprocess, since
importing app.main here would also hit DB/Redis/scheduler startup.
Run directly: python tests/test_prod_config_guard.py"""
import subprocess
import sys
import os

GUARD_SNIPPET = '''
import sys
sys.path.insert(0, ".")
from app.core.config import Settings
settings = Settings()
_looks_like_prod = not settings.APP_URL.startswith(("http://localhost", "http://127."))
if _looks_like_prod:
    if settings.JWT_SECRET == "change-me-in-production":
        raise RuntimeError("JWT_SECRET is still the placeholder default.")
    _cors = settings.cors_origins
    if not _cors or "*" in _cors:
        raise RuntimeError("CORS_ORIGINS is unset or wildcard.")
print("GUARD_PASSED")
'''


def _run(env_overrides: dict) -> subprocess.CompletedProcess:
    # pydantic-settings treats an env var set to "" differently from an env
    # var that's absent (absent -> class default; "" -> literal empty value)
    # — so simulating "unset" means deleting the key, never setting it to "".
    env = {k: v for k, v in os.environ.items() if k not in ("APP_URL", "JWT_SECRET", "CORS_ORIGINS")}
    env.update(env_overrides)
    return subprocess.run(
        [sys.executable, "-c", GUARD_SNIPPET],
        cwd=os.path.join(os.path.dirname(__file__), ".."),
        env=env, capture_output=True, text=True, timeout=15,
    )


def demo():
    # 1. Local dev, nothing set at all -> must pass (never blocks `docker compose up`).
    r = _run({})
    assert "GUARD_PASSED" in r.stdout, r.stdout + r.stderr

    # 2. Prod-looking APP_URL + still-default JWT_SECRET -> must block.
    r = _run({"APP_URL": "https://app.fieldgovern.com", "JWT_SECRET": "change-me-in-production",
              "CORS_ORIGINS": "https://app.fieldgovern.com"})
    assert r.returncode != 0 and "JWT_SECRET" in r.stderr, r.stdout + r.stderr

    # 3. Prod-looking APP_URL + real secret + wildcard CORS -> must block.
    r = _run({"APP_URL": "https://app.fieldgovern.com", "JWT_SECRET": "a-real-random-secret",
              "CORS_ORIGINS": "*"})
    assert r.returncode != 0 and "CORS_ORIGINS" in r.stderr, r.stdout + r.stderr

    # 4. Prod-looking APP_URL, everything real -> must pass.
    r = _run({"APP_URL": "https://app.fieldgovern.com", "JWT_SECRET": "a-real-random-secret",
              "CORS_ORIGINS": "https://app.fieldgovern.com,https://www.fieldgovern.com"})
    assert "GUARD_PASSED" in r.stdout, r.stdout + r.stderr

    print("prod_config_guard self-check: OK")


if __name__ == "__main__":
    demo()

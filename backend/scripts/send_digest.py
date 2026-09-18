"""CLI script — send daily digest emails to all tenants.

Run this from the backend/ directory:

    python -m scripts.send_digest

Schedule it as a cron job:
    0 7 * * *  cd /app && python -m scripts.send_digest

Or add to Procfile:
    clock: python -m scripts.send_digest
"""
import sys
import os

# Allow running as  python scripts/send_digest.py  from repo root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import logging
from app.core.database import SessionLocal
from app.services.digest import send_digest_all_tenants

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


def main():
    logger.info("[Digest] Starting daily digest run")
    db = SessionLocal()
    try:
        results = send_digest_all_tenants(db)
        total_sent = sum(r["sent"] for r in results)
        total_skipped = sum(r["skipped"] for r in results)
        logger.info(
            "[Digest] Done. Tenants=%d  emails_sent=%d  skipped=%d",
            len(results), total_sent, total_skipped,
        )
        for r in results:
            logger.info("  %-30s  sent=%d  skipped=%d", r["tenant"], r["sent"], r["skipped"])
    finally:
        db.close()


if __name__ == "__main__":
    main()

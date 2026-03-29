FROM node:20-slim AS frontend-builder

WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM python:3.13-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./requirements.txt

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY backend /app

# Copy built frontend into backend's static dir
COPY --from=frontend-builder /frontend/dist /app/static

RUN mkdir -p /app/uploads

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONPATH=/app

EXPOSE ${PORT:-8000}

CMD ["sh", "-c", "echo '=== FieldPulse Startup ===' && echo \"DB URL set: $(test -n \"$DATABASE_URL\" && echo YES || echo EMPTY)\" && cd /app && python -c \"from app.core.config import settings, normalize_db_url; print('Effective URL prefix:', normalize_db_url(settings.DATABASE_URL)[:40])\" && alembic upgrade head && echo '=== Migrations done ===' && python scripts/seed_dev.py && echo '=== Seed done ===' && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

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
    libpq-dev \
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

CMD ["sh", "-c", "cd /app && (alembic upgrade head || echo 'Alembic failed, using create_all fallback') && (python scripts/seed_dev.py || true) && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

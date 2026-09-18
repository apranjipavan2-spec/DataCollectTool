FROM node:20-slim AS frontend-builder

WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
ARG VITE_SENTRY_DSN=""
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
ARG VITE_POSTHOG_KEY=""
ENV VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY
RUN npm run build

FROM python:3.11-slim

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

COPY backend/start.sh /app/start.sh
RUN sed -i 's/\r//' /app/start.sh && chmod +x /app/start.sh

CMD ["/app/start.sh"]

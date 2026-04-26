FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
# Build with /analyzer/ as the base path for production deployment
RUN VITE_BASE_PATH=/analyzer/ npm run build

FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends build-essential gcc && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./backend
COPY --from=frontend-builder /app/static ./static
RUN mkdir -p cache exports logs parquet_cache projects metrics library
ENV PYTHONUNBUFFERED=1
EXPOSE 8001
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8001"]

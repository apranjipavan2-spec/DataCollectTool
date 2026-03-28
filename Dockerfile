FROM python:3.13-slim

WORKDIR /app

# Install system dependencies (needed for pandas, numpy, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy backend requirements
COPY backend/requirements.txt ./requirements.txt

# Install Python dependencies with optimizations
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend /app

# Create uploads directory
RUN mkdir -p /app/uploads

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONPATH=/app

# Expose port
EXPOSE ${PORT:-8000}

# Run migrations and start the app
# Note: Migrations can be run manually via: railway run alembic upgrade head
CMD ["sh", "-c", "cd /app && alembic upgrade head 2>/dev/null || true && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

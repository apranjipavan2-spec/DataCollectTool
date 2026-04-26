FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends build-essential gcc && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN mkdir -p working_copies
ENV PYTHONUNBUFFERED=1
ENV PORT=8002
EXPOSE 8002
CMD ["python", "data_cleaner.py"]

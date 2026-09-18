#!/bin/bash
# TableForge Launcher - auto-finds free ports

echo "============================================"
echo "  TableForge - Starting servers..."
echo "============================================"

BACKEND_PORT=8001
FRONTEND_PORT=5173

# Find free backend port
for port in 8001 8002 8003 8004; do
  if ! netstat -aon 2>/dev/null | grep ":$port " | grep -q "LISTENING"; then
    BACKEND_PORT=$port
    break
  fi
  echo "Port $port is busy, trying next..."
done

# Find free frontend port
for port in 5173 5174 5175 5176; do
  if ! netstat -aon 2>/dev/null | grep ":$port " | grep -q "LISTENING"; then
    FRONTEND_PORT=$port
    break
  fi
  echo "Port $port is busy, trying next..."
done

echo ""
echo "Backend: http://localhost:$BACKEND_PORT"
echo "Frontend: http://localhost:$FRONTEND_PORT"
echo ""

# Start backend
cd "C:/DCT/tableforge"
python -m uvicorn backend.main:app --host 0.0.0.0 --port $BACKEND_PORT --reload &
BACKEND_PID=$!

sleep 3

# Start frontend with correct backend port
cd "C:/DCT/tableforge/frontend"
BACKEND_PORT=$BACKEND_PORT node node_modules/vite/bin/vite.js --host 0.0.0.0 --port $FRONTEND_PORT &
FRONTEND_PID=$!

echo ""
echo "============================================"
echo "  TableForge is running!"
echo "  Open: http://localhost:$FRONTEND_PORT"
echo "============================================"
echo "Press Ctrl+C to stop both servers."

# Trap Ctrl+C to kill both
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait

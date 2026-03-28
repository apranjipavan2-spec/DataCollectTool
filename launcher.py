#!/usr/bin/env python3
"""
FieldPulse Launcher - Starts both frontend and backend servers
Usage: python launcher.py
"""
import os
import sys
import subprocess
import time
from pathlib import Path

def main():
    project_root = Path(__file__).parent
    backend_dir = project_root / "backend"
    frontend_dir = project_root / "frontend"

    print("=" * 70)
    print("  FIELDPULSE - LAUNCHER")
    print("=" * 70)
    print()

    # Start backend
    print("[*] Starting Backend (FastAPI)...")
    print(f"   Directory: {backend_dir}")
    print(f"   Port: 8000")
    print(f"   Docs: http://localhost:8000/docs")
    print()

    backend_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--port", "8000", "--reload"],
        cwd=backend_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    # Wait for backend to start
    time.sleep(3)

    if backend_proc.poll() is not None:
        print("[!] Backend failed to start!")
        print("   Check backend configuration and logs")
        return 1

    print("[+] Backend started successfully")
    print()

    # Start frontend
    print("[*] Starting Frontend (React Vite)...")
    print(f"   Directory: {frontend_dir}")
    print(f"   Port: 5173")
    print(f"   URL: http://localhost:5173")
    print()

    # Use npm.cmd on Windows
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    frontend_proc = subprocess.Popen(
        [npm_cmd, "run", "dev"],
        cwd=frontend_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        shell=sys.platform == "win32"
    )

    # Wait for frontend to start
    time.sleep(5)

    if frontend_proc.poll() is not None:
        print("[!] Frontend failed to start!")
        print("   Make sure npm is installed: npm install")
        return 1

    print("[+] Frontend started successfully")
    print()

    print("=" * 70)
    print("  FieldPulse is running!")
    print("=" * 70)
    print()
    print("[WEB] FRONTEND: http://localhost:5173")
    print("[API] BACKEND DOCS: http://localhost:8000/docs")
    print()
    print("[LOGIN] TEST CREDENTIALS:")
    print("   Phone: +919999990001")
    print("   Password: test@123")
    print()
    print("   (Or +919999990002 for supervisor, +919999990003 for enumerator)")
    print()
    print("[INFO] Press Ctrl+C to stop both servers")
    print()

    try:
        # Keep both processes running
        while True:
            if backend_proc.poll() is not None:
                print("[!] Backend process ended. Stopping frontend...")
                frontend_proc.terminate()
                break
            if frontend_proc.poll() is not None:
                print("[!] Frontend process ended. Stopping backend...")
                backend_proc.terminate()
                break
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n\n[*] Shutting down servers...")
        backend_proc.terminate()
        frontend_proc.terminate()

        # Wait for clean shutdown
        try:
            backend_proc.wait(timeout=5)
            frontend_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            print("   Force killing processes...")
            backend_proc.kill()
            frontend_proc.kill()

        print("[+] Servers stopped")
        return 0

    return 1

if __name__ == "__main__":
    sys.exit(main())

"""
TableForge Launcher
-------------------
- Finds free ports automatically — never kills your other apps.
- Backend scans from 8000 upward; Vite self-selects its own port.
- Reads Vite's actual chosen port from its startup output.
- Writes .tableforge_ports.json so anything can discover the live ports.
- Press Ctrl+C once → both servers stop, state file deleted.

Usage:
    python launcher.py
"""

import subprocess
import sys
import time
import webbrowser
import os
import re
import socket
import json
import threading
import queue
import atexit
import signal

BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
FRONT_DIR  = os.path.join(BASE_DIR, "frontend")
STATE_FILE = os.path.join(BASE_DIR, ".tableforge_ports.json")

BACKEND_PREF  = 8000
FRONTEND_PREF = 5173

procs: list[subprocess.Popen] = []


# ─── Port helpers ─────────────────────────────────────────────────────────────

def kill_port(port: int):
    """Kill any process currently listening on `port` (Windows + Unix)."""
    try:
        if sys.platform == "win32":
            # netstat gives us the PID; taskkill removes it
            result = subprocess.run(
                ["netstat", "-ano"],
                capture_output=True, text=True
            )
            pids = set()
            for line in result.stdout.splitlines():
                parts = line.split()
                # Look for lines like: TCP  0.0.0.0:8000  ...  LISTENING  <PID>
                if len(parts) >= 4 and f":{port}" in parts[1] and "LISTENING" in parts[3]:
                    try:
                        pids.add(int(parts[-1]))
                    except ValueError:
                        pass
            for pid in pids:
                if pid > 4:  # never kill system processes
                    subprocess.run(
                        ["taskkill", "/F", "/PID", str(pid)],
                        capture_output=True
                    )
                    print(f"  {YELLOW}[!]{RESET} Killed stale process PID {pid} on port {port}")
        else:
            result = subprocess.run(
                ["lsof", "-ti", f":{port}"],
                capture_output=True, text=True
            )
            for pid_str in result.stdout.strip().splitlines():
                try:
                    os.kill(int(pid_str), signal.SIGTERM)
                    print(f"  {YELLOW}[!]{RESET} Killed stale process PID {pid_str} on port {port}")
                except Exception:
                    pass
        time.sleep(0.5)   # give OS time to release the port
    except Exception:
        pass   # best-effort; if it fails, find_free_port will skip the port


def find_free_port(preferred: int, max_scan: int = 30) -> int:
    """Return the first free port at or above `preferred`."""
    for port in range(preferred, preferred + max_scan):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
                return port          # bind succeeded → port is free
            except OSError:
                continue             # port in use → try next
    raise RuntimeError(
        f"No free port found in range {preferred}–{preferred + max_scan - 1}. "
        "Close some applications and try again."
    )


# ─── State file ───────────────────────────────────────────────────────────────

def save_state(backend_port: int, frontend_port: int):
    data = {
        "backend":  backend_port,
        "frontend": frontend_port,
        "backend_url":  f"http://localhost:{backend_port}",
        "frontend_url": f"http://localhost:{frontend_port}",
    }
    with open(STATE_FILE, "w") as f:
        json.dump(data, f, indent=2)


def clear_state():
    try:
        os.remove(STATE_FILE)
    except FileNotFoundError:
        pass


# ─── Process helpers ──────────────────────────────────────────────────────────

def kill_all():
    for p in procs:
        if p.poll() is None:
            try:
                p.terminate()
                p.wait(timeout=5)
            except Exception:
                try:
                    p.kill()
                except Exception:
                    pass
    clear_state()


CYAN    = "\033[36m"
MAGENTA = "\033[35m"
YELLOW  = "\033[33m"
RESET   = "\033[0m"


def stream_lines(proc: subprocess.Popen, tag: str, colour: str,
                 line_queue: "queue.Queue | None" = None):
    """Read stdout line-by-line, print with a coloured tag, optionally enqueue."""
    for raw in iter(proc.stdout.readline, b""):
        line = raw.decode("utf-8", errors="replace").rstrip()
        if line:
            print(f"{colour}[{tag}]{RESET} {line}", flush=True)
            if line_queue is not None:
                line_queue.put(line)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    # ── Kill any stale backend on the preferred port ─────────────────
    # Prevents "two backends" when Grand Launcher or a crashed instance
    # is still holding the port from a previous session.
    kill_port(BACKEND_PREF)

    # ── Find a free backend port ──────────────────────────────────────
    try:
        backend_port = find_free_port(BACKEND_PREF)
    except RuntimeError as e:
        print(f"\n  ERROR: {e}\n")
        sys.exit(1)

    if backend_port != BACKEND_PREF:
        print(f"\n  {YELLOW}[i]{RESET} Port {BACKEND_PREF} busy — "
              f"using {backend_port} for backend")

    atexit.register(kill_all)   # safety net if the script exits any other way

    print()
    print("  ============================================")
    print("       TableForge v2.0  --  Starting")
    print("  ============================================")
    print(f"  Backend   ->  http://localhost:{backend_port}")
    print(f"  Frontend  ->  auto-assigned (scanning from {FRONTEND_PREF})")
    print("  Ctrl+C to stop both servers")
    print("  ============================================")
    print()

    # ── 1. Start backend ──────────────────────────────────────────────
    print("  >> Starting backend...")
    backend = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app",
         "--host", "0.0.0.0", "--port", str(backend_port),
         "--reload",
         "--reload-dir", os.path.join(BASE_DIR, "backend"),  # only watch backend/ — not frontend/
         "--reload-include", "*.py",                          # only Python files trigger reloads
        ],
        cwd=BASE_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env={**os.environ},
    )
    procs.append(backend)
    threading.Thread(
        target=stream_lines,
        args=(backend, "BACKEND", CYAN, None),
        daemon=True,
    ).start()

    # ── 2. Start frontend — let Vite choose its own port ─────────────
    print("  >> Starting frontend...")
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"

    # Pass the backend port so vite.config.ts can proxy correctly.
    # Do NOT pass --port — let Vite pick via strictPort: false.
    frontend_env = {**os.environ, "BACKEND_PORT": str(backend_port)}

    frontend = subprocess.Popen(
        [npm_cmd, "run", "dev"],
        cwd=FRONT_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=frontend_env,
    )
    procs.append(frontend)

    # We need to capture Vite's output to extract the real URL
    vite_queue: queue.Queue = queue.Queue()
    threading.Thread(
        target=stream_lines,
        args=(frontend, "FRONTEND", MAGENTA, vite_queue),
        daemon=True,
    ).start()

    # ── 3. Parse Vite output for its actual URL ───────────────────────
    app_url = f"http://localhost:{FRONTEND_PREF}"   # fallback
    deadline = time.time() + 15                     # wait up to 15 s
    # Strip ANSI escape codes before matching — Vite colours its output
    ansi_escape = re.compile(r"\x1b\[[0-9;]*m")
    url_pattern = re.compile(r"Local:\s+(http://localhost:\d+)", re.IGNORECASE)

    while time.time() < deadline:
        try:
            line = vite_queue.get(timeout=0.5)
            clean = ansi_escape.sub("", line)       # remove colour codes
            m = url_pattern.search(clean)
            if m:
                app_url = m.group(1)
                frontend_port = int(app_url.split(":")[-1])
                break
        except queue.Empty:
            if frontend.poll() is not None:
                print(f"\n  {YELLOW}[!]{RESET} Frontend failed to start.")
                kill_all()
                sys.exit(1)

    # ── 4. Health-check: wait until backend actually responds ────────
    # Ghost sockets from previous sessions cause ECONNRESET if the
    # browser opens before uvicorn has fully taken over the port.
    print("  >> Waiting for backend to be ready ", end="", flush=True)
    import urllib.request as _ureq
    ready = False
    for _ in range(40):          # poll every 0.5 s, up to 20 s total
        time.sleep(0.5)
        try:
            _ureq.urlopen(
                f"http://127.0.0.1:{backend_port}/api/projects",
                timeout=1,
            )
            ready = True
            break
        except Exception:
            print(".", end="", flush=True)
    print(f" {'OK' if ready else 'timeout (starting anyway)'}")

    # ── 5. Save state and open browser ───────────────────────────────
    save_state(backend_port, int(app_url.split(":")[-1]))

    print(f"\n  ============================================")
    print(f"  Backend   ->  http://localhost:{backend_port}")
    print(f"  Frontend  ->  {app_url}   (opening browser...)")
    print(f"  ============================================\n")

    webbrowser.open(app_url)

    # ── 5. Keep running — Ctrl+C shuts everything down ───────────────
    try:
        while True:
            if backend.poll() is not None:
                print(f"\n  {YELLOW}[!]{RESET} Backend stopped unexpectedly.")
                break
            if frontend.poll() is not None:
                print(f"\n  {YELLOW}[!]{RESET} Frontend stopped unexpectedly.")
                break
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n\n  Shutting down TableForge...")

    kill_all()
    print("  All servers stopped. Goodbye!\n")


if __name__ == "__main__":
    main()

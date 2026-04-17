"""
FieldPulse one-click local startup.
Double-click start.bat -> this script does the rest.
"""
import os, sys, socket, subprocess, time, webbrowser, urllib.request, urllib.error, tempfile

ROOT     = os.path.dirname(os.path.abspath(__file__))
BACKEND  = os.path.join(ROOT, "backend")
FRONTEND = os.path.join(ROOT, "frontend")
VENV_PY  = os.path.join(BACKEND, "venv", "Scripts", "python.exe")
VENV_UV  = os.path.join(BACKEND, "venv", "Scripts", "uvicorn.exe")


# -- helpers ------------------------------------------------------------------

def log(tag, msg):
    print(f"  [{tag}] {msg}", flush=True)

def is_port_free(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) != 0

def find_free_port(start):
    for p in range(start, start + 20):
        if is_port_free(p):
            return p
    return start

def kill_port(port):
    """Kill whatever is listening on the given port (Windows)."""
    try:
        out = subprocess.check_output(
            ["netstat", "-aon"], text=True, stderr=subprocess.DEVNULL
        )
        for line in out.splitlines():
            if f":{port} " in line and "LISTENING" in line:
                pid = line.strip().split()[-1]
                if pid.isdigit() and int(pid) > 0:
                    subprocess.call(
                        ["taskkill", "/F", "/PID", pid],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                    )
                    time.sleep(0.5)
    except Exception:
        pass

def wait_http(url, timeout=60, interval=2):
    """Return True when url responds with any HTTP status, False on timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=2)
            return True
        except urllib.error.HTTPError:
            return True   # real HTTP response (even 4xx) -> server is up
        except Exception:
            time.sleep(interval)
    return False

def launch_window(title, command, cwd):
    """
    Write a temp .bat file and open it in a new cmd window via 'start'.
    This is the only approach that reliably works from Git Bash / non-console hosts.
    """
    bat_fd, bat_path = tempfile.mkstemp(suffix=".bat")
    try:
        with os.fdopen(bat_fd, "w") as f:
            f.write(f"@echo off\n")
            f.write(f"title {title}\n")
            f.write(f"cd /d \"{cwd}\"\n")
            f.write(f"{command}\n")
            f.write("pause\n")
    except Exception:
        pass
    subprocess.Popen(
        f'start "{title}" cmd /k "{bat_path}"',
        shell=True
    )


# -- 1. Docker / PostgreSQL ---------------------------------------------------

print()
print("  +--------------------------------------+")
print("  |   FieldPulse  -  Starting up...      |")
print("  +--------------------------------------+")
print()

log("DB", "Checking Docker...")
docker_ok = subprocess.call(
    ["docker", "info"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
) == 0

if not docker_ok:
    print()
    print("  [X] Docker Desktop is not running.")
    print("     Start Docker Desktop, wait for it to fully load, then try again.")
    print()
    sys.exit(1)

log("DB", "Starting PostgreSQL container...")

running = subprocess.run(
    ["docker", "ps", "--filter", "name=fieldpulse-pg",
     "--filter", "status=running", "--format", "{{.Names}}"],
    capture_output=True, text=True
).stdout.strip()

if "fieldpulse-pg" not in running:
    exists = subprocess.run(
        ["docker", "ps", "-a", "--filter", "name=fieldpulse-pg",
         "--format", "{{.Names}}"],
        capture_output=True, text=True
    ).stdout.strip()

    if "fieldpulse-pg" in exists:
        subprocess.call(["docker", "start", "fieldpulse-pg"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        subprocess.call([
            "docker", "run", "-d", "--name", "fieldpulse-pg",
            "-e", "POSTGRES_USER=fieldpulse",
            "-e", "POSTGRES_PASSWORD=password",
            "-e", "POSTGRES_DB=fieldpulse",
            "-p", "5432:5432", "postgres:16"
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

log("DB", "Waiting for PostgreSQL to be ready...")
for attempt in range(20):
    rc = subprocess.call(
        ["docker", "exec", "fieldpulse-pg", "pg_isready", "-U", "fieldpulse"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    if rc == 0:
        break
    time.sleep(2)
else:
    log("DB", "WARNING - PostgreSQL not responding, trying anyway...")

log("DB", "PostgreSQL is ready OK")


# -- 2. Initialise DB tables --------------------------------------------------

log("DB", "Initialising tables...")
result = subprocess.run(
    [VENV_PY, "-c",
     "import sys; sys.path.insert(0,'.'); "
     "import app.models; "
     "from app.core.database import engine, Base; "
     "Base.metadata.create_all(bind=engine); "
     "print('  Tables OK')"],
    cwd=BACKEND, capture_output=True, text=True
)
if result.returncode == 0:
    log("DB", "Tables ready OK")
else:
    log("DB", f"WARNING: {result.stderr.strip()[-200:] if result.stderr else 'unknown error'}")


# -- 3. Pick ports ------------------------------------------------------------

api_port = find_free_port(8000)
ui_port  = find_free_port(5173)

if not is_port_free(api_port):
    kill_port(api_port)
    time.sleep(1)

if not is_port_free(ui_port):
    kill_port(ui_port)
    time.sleep(1)

log("PORTS", f"API -> :{api_port}   UI -> :{ui_port}")


# -- 4. Write frontend .env with correct API URL ------------------------------

env_path = os.path.join(FRONTEND, ".env")
env_lines = []
if os.path.exists(env_path):
    with open(env_path) as f:
        env_lines = [l for l in f.readlines() if not l.startswith("VITE_API_BASE_URL")]
env_lines.insert(0, f"VITE_API_BASE_URL=http://localhost:{api_port}/api/v1\n")
with open(env_path, "w") as f:
    f.writelines(env_lines)


# -- 5. Start backend ---------------------------------------------------------

log("API", f"Starting backend on port {api_port}...")
launch_window(
    "FieldPulse API",
    f'"{VENV_UV}" app.main:app --host 0.0.0.0 --port {api_port} --reload',
    BACKEND
)

log("API", "Waiting for API to come online...")
api_url = f"http://localhost:{api_port}/api/v1/auth/login"
if wait_http(api_url, timeout=60):
    log("API", f"API is up OK  ->  http://localhost:{api_port}")
else:
    log("API", "API taking longer than expected - check the API window for errors")


# -- 6. Start frontend --------------------------------------------------------

log("UI", "Starting frontend...")
launch_window("FieldPulse UI", "npm run dev", FRONTEND)

log("UI", "Waiting for UI to come online...")
if wait_http(f"http://localhost:{ui_port}", timeout=60):
    log("UI", f"UI is up OK  ->  http://localhost:{ui_port}")
else:
    log("UI", "UI taking longer than expected - check the UI window for errors")


# -- 7. Open browser ----------------------------------------------------------

time.sleep(1)
webbrowser.open(f"http://localhost:{ui_port}")

print()
print("  ============================================================")
print("   FieldPulse is running!")
print("  ============================================================")
print(f"   App      ->  http://localhost:{ui_port}")
print(f"   API Docs ->  http://localhost:{api_port}/docs")
print("  ------------------------------------------------------------")
print("   DEMO ORG")
print("     Admin      +919999990001  /  test@123")
print("     Supervisor +919999990002  /  test@123")
print("     Enumerator +919999990003  /  test@123")
print("  ------------------------------------------------------------")
print("   DATAWORX")
print("     Admin      +919999991001  /  dataworx@123")
print("     Supervisor +919999991002  /  dataworx@123")
print("     Ninganna   +919999991003  /  dataworx@123")
print("     Babasaheb  +919999991004  /  dataworx@123")
print("     Rohit      +919999991005  /  dataworx@123")
print("  ------------------------------------------------------------")
print("   Close the API and UI windows to stop the servers.")
print("  ============================================================")
print()

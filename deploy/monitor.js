/**
 * FieldGovern Deploy Monitor — local Node.js server (no npm dependencies)
 * Run:  node deploy/monitor.js
 * Then: http://localhost:4747
 */
const http  = require('http');
const https = require('https');
const { exec, execFile } = require('child_process');
const fs   = require('fs');
const path = require('path');
const urlMod = require('url');
const { URL: NodeURL } = require('url');

// ── Config ────────────────────────────────────────────────────────────────────
const CFG_PATH = path.join(__dirname, 'monitor-config.json');
const DEFAULTS = {
  vps_host:    '',
  vps_user:    'fieldgovern',
  vps_key:     '',
  app_dir:     '/opt/fieldgovern',
  github_repo: 'apranjipavan2-spec/DataCollectTool',
  github_token:'',
  app_url:     'https://app.fieldgovern.com',
  port:        4747
};
let cfg = { ...DEFAULTS };
if (fs.existsSync(CFG_PATH)) {
  try { Object.assign(cfg, JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'))); }
  catch(e) { console.error('Config parse error:', e.message); }
} else {
  fs.writeFileSync(CFG_PATH, JSON.stringify(DEFAULTS, null, 2));
  console.log('\n  Created monitor-config.json — fill in vps_host then restart.\n');
}

const DASHBOARD_PATH = path.join(__dirname, 'dashboard.html');

// ── SSH helper — uses execFile to avoid Windows cmd.exe shell interpretation ──
function ssh(cmd) {
  return new Promise((resolve, reject) => {
    const args = [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=10',
      '-o', 'BatchMode=yes',
    ];
    if (cfg.vps_key) args.push('-i', cfg.vps_key);
    args.push(cfg.vps_user + '@' + cfg.vps_host, cmd);
    execFile('ssh', args, { timeout: 30000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(stderr || err.message);
      else resolve(stdout);
    });
  });
}

// ── GitHub API ────────────────────────────────────────────────────────────────
function ghApi(endpoint) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path: endpoint,
      headers: {
        'User-Agent': 'FieldGovern-Monitor/1.0',
        Accept: 'application/vnd.github.v3+json',
        ...(cfg.github_token ? { Authorization: 'token ' + cfg.github_token } : {})
      }
    };
    https.get(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    }).on('error', reject);
  });
}

// ── Health check ──────────────────────────────────────────────────────────────
function checkHealth(endpoint) {
  endpoint = endpoint || '/health';
  return new Promise(resolve => {
    const target = new URL(cfg.app_url + endpoint);
    const mod  = target.protocol === 'https:' ? https : http;
    const t0   = Date.now();
    const req  = mod.get({ hostname: target.hostname, path: endpoint, timeout: 10000 }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, ms: Date.now() - t0, body: body }));
    });
    req.on('error', e => resolve({ ok: false, error: e.message, ms: Date.now() - t0 }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout', ms: Date.now() - t0 }); });
  });
}

function readBody(req) {
  return new Promise((res, rej) => {
    let b = '';
    req.on('data', d => b += d);
    req.on('end', () => res(b));
    req.on('error', rej);
  });
}

// ── API handlers ──────────────────────────────────────────────────────────────
async function handleApi(method, pathname, req) {
  const q = Object.fromEntries(new NodeURL(req.url, 'http://localhost').searchParams);

  if (method === 'GET' && pathname === '/api/config') {
    return { vps_host: cfg.vps_host, vps_user: cfg.vps_user, app_dir: cfg.app_dir,
             github_repo: cfg.github_repo, app_url: cfg.app_url,
             has_token: !!cfg.github_token, configured: !!cfg.vps_host };
  }

  if (method === 'POST' && pathname === '/api/config') {
    const patch = JSON.parse(await readBody(req));
    Object.assign(cfg, patch);
    fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2));
    return { ok: true };
  }

  if (method === 'GET' && pathname === '/api/health') {
    return checkHealth('/health');
  }

  if (method === 'GET' && pathname === '/api/vps/status') {
    if (!cfg.vps_host) return { error: 'vps_host not set — open Settings' };
    try {
      const [ps, diskRaw, memRaw, uptimeRaw, images] = await Promise.all([
        ssh('docker ps --format "{{.Names}}|{{.Status}}|{{.RunningFor}}|{{.Image}}" 2>&1'),
        ssh('df -h / 2>&1 | tail -1'),
        ssh('free -h 2>&1 | grep Mem'),
        ssh('uptime 2>&1'),
        ssh('docker images --format "{{.Repository}}:{{.Tag}}|{{.Size}}|{{.CreatedSince}}" 2>&1 | head -6'),
      ]);
      const containers = ps.trim().split('\n').filter(Boolean).map(l => {
        const parts = l.split('|');
        return { name: parts[0], status: parts[1], running: parts[2], image: parts[3] };
      });
      const dp = diskRaw.trim().split(/\s+/);
      const mp = memRaw.trim().split(/\s+/);
      return {
        containers,
        disk:   { size: dp[1], used: dp[2], avail: dp[3], pct: dp[4] },
        memory: { total: mp[1], used: mp[2], free: mp[3] },
        uptime: uptimeRaw.trim(),
        images: images.trim().split('\n').filter(Boolean).map(l => {
          const p = l.split('|');
          return { name: p[0], size: p[1], age: p[2] };
        }),
        timestamp: new Date().toISOString()
      };
    } catch(e) { return { error: e.toString() }; }
  }

  if (method === 'GET' && pathname === '/api/vps/logs') {
    if (!cfg.vps_host) return { error: 'vps_host not set' };
    const lines = parseInt(q.lines || '300');
    const svc   = q.service || '';
    const since = q.since   || '';
    const sinceArg = since ? '--since ' + since : '';
    try {
      const logs = await ssh(
        'cd ' + cfg.app_dir + ' && docker compose logs ' + sinceArg + ' --tail=' + lines + ' --no-color --timestamps ' + svc + ' 2>&1'
      );
      return { logs: logs, lines: lines, timestamp: new Date().toISOString() };
    } catch(e) { return { error: e.toString() }; }
  }

  if (method === 'POST' && pathname === '/api/vps/restart') {
    if (!cfg.vps_host) return { error: 'vps_host not set' };
    try {
      const out = await ssh('cd ' + cfg.app_dir + ' && docker compose restart app 2>&1');
      return { output: out, timestamp: new Date().toISOString() };
    } catch(e) { return { error: e.toString() }; }
  }

  if (method === 'POST' && pathname === '/api/vps/deploy') {
    if (!cfg.vps_host) return { error: 'vps_host not set' };
    try {
      const out = await ssh('cd ' + cfg.app_dir + ' && docker compose pull app 2>&1 && docker compose up -d --force-recreate app 2>&1');
      return { output: out, timestamp: new Date().toISOString() };
    } catch(e) { return { error: e.toString() }; }
  }

  if (method === 'POST' && pathname === '/api/vps/prune') {
    if (!cfg.vps_host) return { error: 'vps_host not set' };
    try {
      const out = await ssh('docker system prune -f 2>&1 && docker image prune -f 2>&1');
      return { output: out, timestamp: new Date().toISOString() };
    } catch(e) { return { error: e.toString() }; }
  }

  if (method === 'GET' && pathname === '/api/github/runs') {
    const [runs, commits] = await Promise.all([
      ghApi('/repos/' + cfg.github_repo + '/actions/runs?per_page=8'),
      ghApi('/repos/' + cfg.github_repo + '/commits?per_page=6'),
    ]);
    return { runs: runs.data, commits: commits.data, timestamp: new Date().toISOString() };
  }

  if (method === 'GET' && pathname === '/api/github/jobs') {
    const runId = q.run_id;
    if (!runId) return { error: 'run_id required' };
    const r = await ghApi('/repos/' + cfg.github_repo + '/actions/runs/' + runId + '/jobs');
    return r.data;
  }

  return null;
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed   = new NodeURL(req.url, 'http://localhost');
  const pathname = parsed.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    try {
      const result = await handleApi(req.method, pathname, req);
      if (result === null) { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return; }
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch(e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname === '/' || pathname === '/dashboard') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(200);
    try { res.end(fs.readFileSync(DASHBOARD_PATH)); }
    catch { res.end('<h1>dashboard.html not found</h1>'); }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(cfg.port, '127.0.0.1', () => {
  console.log('\n  FieldGovern Deploy Monitor');
  console.log('  -> http://localhost:' + cfg.port + '\n');
  console.log('  VPS:  ' + (cfg.vps_host || '(not configured — open Settings in the dashboard)'));
  console.log('  Repo: ' + cfg.github_repo + '\n');
  const open = process.platform === 'win32' ? 'start http://localhost:' + cfg.port
             : process.platform === 'darwin' ? 'open http://localhost:' + cfg.port
             : 'xdg-open http://localhost:' + cfg.port;
  exec(open);
});

# FieldGovern VPS Hosting Guide

## Choose Your Provider

| Provider | Region | Cost | RAM | CPU | Best For |
|----------|--------|------|-----|-----|----------|
| **Oracle Cloud Free** | Mumbai | **$0/month** | 24GB | 4 ARM | Zero cost, India latency |
| **Hetzner Cloud** | Singapore | €3.79/month | 4GB | 2 AMD | Cheapest paid, reliable |
| **DigitalOcean** | Bangalore | $12/month | 2GB | 2 AMD | Best docs, easy UI |

All three use the same setup — the Docker image supports both AMD64 and ARM64.

---

## Option A — Oracle Cloud Free (Recommended for cost)

1. Sign up at cloud.oracle.com (credit card required for verification, not charged)
2. Create a VM: **Compute → Instances → Create Instance**
   - Shape: `VM.Standard.A1.Flex` → 4 OCPU, 24GB RAM
   - Image: Ubuntu 22.04 or 24.04
   - Region: **ap-mumbai-1** (Mumbai)
   - Add your SSH public key
3. Open ports in Security List: `80`, `443`, `22`
4. SSH in: `ssh ubuntu@<your-ip>`
5. Run bootstrap: `curl -sL https://raw.githubusercontent.com/apranjipavan2-spec/DataCollectTool/main/deploy/server-setup.sh | sudo bash`

---

## Option B — Hetzner Cloud (Recommended for value)

1. Sign up at hetzner.com/cloud
2. Create server:
   - Location: **Singapore** (closest to India)
   - Image: Ubuntu 24.04
   - Type: **CX22** (€3.79/month — 2 vCPU, 4GB RAM)
   - Add your SSH public key
3. SSH in: `ssh root@<your-ip>`
4. Run bootstrap: `curl -sL https://raw.githubusercontent.com/apranjipavan2-spec/DataCollectTool/main/deploy/server-setup.sh | bash`

---

## Option C — DigitalOcean (Best documentation)

1. Sign up at digitalocean.com
2. Create Droplet:
   - Region: **Bangalore (BLR1)**
   - Image: Ubuntu 24.04 LTS
   - Size: **Basic $12/month** (2 vCPU, 2GB RAM)
   - Add your SSH public key
3. SSH in: `ssh root@<your-ip>`
4. Run bootstrap: `curl -sL https://raw.githubusercontent.com/apranjipavan2-spec/DataCollectTool/main/deploy/server-setup.sh | bash`

---

## After Bootstrap — GitHub Actions Secrets

Add these in GitHub → your repo → Settings → Secrets → Actions:

| Secret | Value |
|--------|-------|
| `VPS_HOST` | Your server IP address |
| `VPS_USER` | `ubuntu` (Oracle) or `root` (Hetzner/DO) |
| `VPS_SSH_KEY` | Your private SSH key (the whole file content) |
| `GHCR_PAT` | GitHub Personal Access Token with `read:packages` scope |

Once secrets are set, every push to `main` auto-deploys.

---

## DNS

Point your domain to the server IP:
```
app.fieldgovern.com  A  <your-server-ip>
```

Wait for DNS propagation (~5 min), then the bootstrap SSL step will work.

---

## Manual first deploy (after bootstrap)

```bash
cd /opt/fieldgovern
nano .env          # fill in all values
docker compose pull
docker compose up -d
docker compose logs -f app   # watch startup
```

---

## Useful commands

```bash
# View logs
docker compose -f /opt/fieldgovern/docker-compose.yml logs -f app

# Restart app
docker compose -f /opt/fieldgovern/docker-compose.yml restart app

# Run manual backup
/opt/fieldgovern/backup-db.sh

# Restore from backup
gunzip -c /opt/fieldgovern/backups/fieldgovern_YYYY-MM-DD_HH-MM-SS.sql.gz \
  | docker compose -f /opt/fieldgovern/docker-compose.yml exec -T postgres \
    psql -U fieldgovern fieldgovern
```

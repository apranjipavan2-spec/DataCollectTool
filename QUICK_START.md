# FieldGovern - Quick Start Guide

## 🚀 Start in 3 Steps

### Step 1: Start Services (Docker)
```bash
cd C:\Life\DataCollectTool
docker compose up -d
```

Wait 10 seconds for PostgreSQL to start.

### Step 2: Start Backend
```bash
cd backend
python -m alembic upgrade head           # Run migrations
python scripts/seed_dev.py                # Create test users
python -m uvicorn app.main:app --port 8000
```

Open: **http://localhost:8000/docs** (interactive API)

### Step 3: Start Frontend
```bash
cd ../frontend
npm run dev
```

Open: **http://localhost:5173** (PWA with hot reload)

---

## 🔑 Test Logins

| Role | Phone | Password |
|------|-------|----------|
| Admin | +919999990001 | test@123 |
| Supervisor | +919999990002 | test@123 |
| Enumerator | +919999990003 | test@123 |

---

## 📖 Full Guides

- **DEPLOYMENT_GUIDE.html** — Setup, deployment, operations, offline usage (complete guide)
- **FIELDGOVERN_GUIDE.html** — Features, API reference, roadmap
- **TEST_CREDENTIALS.csv** — All test user credentials

---

## 🎯 Next Steps

1. **Login** → Use any test credentials above
2. **Try Admin Panel** → `/admin` (master admin only)
3. **Try Org Admin** → `/admin/org` (supervisors can access)
4. **Collect Data** → `/collect` tab (enumerators)
5. **View Dashboard** → `/` (supervisors can see submissions)

---

## ⚡ Key Features Ready

✅ Offline form collection
✅ Auto photo compression (5MB→200KB)
✅ Background sync (Service Worker)
✅ Multi-tenant isolation
✅ API key authentication
✅ Org admin dashboard
✅ Form versioning & white-labeling
✅ Real-time dashboard
✅ CSV/Stata export

---

## 🔧 Common Commands

```bash
# Stop services
docker compose down

# View backend logs
docker logs datacollecttool-postgres-1
docker logs datacollecttool-redis-1

# Reset database
cd backend
python scripts/seed_dev.py

# Test API
curl -X GET http://localhost:8000/health

# Build frontend for production
cd frontend
npm run build
```

---

## 📱 How Offline Works

1. **Online**: User downloads form to phone
2. **Offline**: Can still fill & submit (saved locally)
3. **Data**: Stored in phone's local storage (OPFS/IndexedDB)
4. **Reconnect**: Auto-syncs all pending submissions
5. **Photos**: Auto-compressed before upload (saves 96% bandwidth)

---

## 💡 Tips

- Forms auto-save every 300ms as you type
- Photos automatically compressed to 200KB
- Audio recorded at low bitrate (24kbps) = ~100KB per 30s
- Sync happens automatically when online
- Supervisor can flag submissions for clarification
- All data encrypted at rest & in transit

---

## 📞 Support

- **API Docs**: http://localhost:8000/docs
- **Full Guide**: Open `DEPLOYMENT_GUIDE.html` in browser
- **Tests**: Credentials in `TEST_CREDENTIALS.csv`

---

**Ready?** Open http://localhost:5173 and login! 🎉

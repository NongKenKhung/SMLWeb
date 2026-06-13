# SMLWeb Deployment Runbook

Operational recipes for common scenarios. Each section is self-contained — copy the commands as-is.

> **Current state:** the AI services (`asr` / `ollama`) are **disabled** — their blocks are
> commented out in `docker-compose.yml` and `ASR_URL` is empty, so sections 3, 7, 8 apply only
> after you re-enable them. The app image runs cross-OS as the non-root `app` user via `gosu`
> (the entrypoint fixes bind-mount ownership first — see §1).

---

## 1. First-time setup

```bash
# 1) Clone + cd
git clone <repo> SMLWeb && cd SMLWeb

# 2) Create .env from template (REQUIRED)
cp .env.example .env
# Edit .env — at minimum set:
#   POSTGRES_PASSWORD=<strong password>
#   PGADMIN_DEFAULT_PASSWORD=<strong password>
#   DATABASE_URL=postgres://smluser:<same password>@localhost:5432/smartcitylab
#   SMTP_*  (optional — for meeting invitations)

# 3) Boot the full stack
docker compose up -d

# 4) Verify (should all show "Up" + "healthy")
docker compose ps

# 5) Tail app logs to confirm DB connect + schema migration
docker compose logs -f app
```

App → `http://localhost:3000` · /dev → `http://localhost:3000/dev.html`

> **First boot auto-seeds members.** On a fresh DB, `docker-entrypoint.sh` runs
> `backend/seed.js` (idempotent — skips when members already exist), creating the seed
> members with default PIN `1234`. Log in as a seeded admin, then change PINs. The
> container starts as **root**, `chown`s the mounts (`/app/uploads`, `/data`) to the `app`
> user, then drops privileges via `gosu` before starting the server — identical behaviour
> on Linux, macOS and Windows. (If you restore a backup instead, see §5 — restore BEFORE the
> app first touches the DB so the seed/schema don't collide.)

---

## 2. Update code without losing data

```bash
# Pull new code
git pull

# Restart only services whose code changed (volumes preserve DB + uploads)
docker compose up -d --no-deps app   # backend or frontend changes
docker compose up -d --no-deps asr   # asr-service Python changes (needs rebuild if Dockerfile changed)

# If frontend-only change (no backend), faster path — copy then no restart needed:
docker cp frontend/public/app.js sml_app:/app/frontend/public/app.js
# (SW will cache new version after user reloads once)
```

---

## 3. Rebuild ASR image (after Dockerfile or requirements.txt change)

```bash
# ~5-10 min on first build (pulls pytorch base ~5 GB, installs whisperx)
docker compose build asr

# Then recreate the container with the new image
docker compose up -d --no-deps asr

# Verify GPU passthrough (should print "CUDA: True · NVIDIA ...")
docker exec sml_asr python -c "import torch; print('CUDA:', torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')"
```

---

## 4. Restart a single service

```bash
docker compose restart app           # node backend
docker compose restart asr           # WhisperX
docker compose restart ollama        # LLM
docker compose restart postgres      # DB (don't do this lightly — drops all live connections)
```

---

## 5. Backup / export / restore (database + volumes)

Named volumes are prefixed with the Compose **project name** (defaults to the lower-cased
project folder: `SMLWeb` → `smlweb_…`, `SML` → `sml_…`). **Always confirm with `docker volume ls`**
before using a volume name below.

| Volume             | Holds                                   | Export method |
|--------------------|-----------------------------------------|---------------|
| `…_pg_data`        | PostgreSQL data (the real data)         | `pg_dump`     |
| `…_app_state`      | `/data` → `.tokens.json` (auth tokens)  | `tar`         |
| `…_pgadmin_data`   | pgAdmin's own config (disposable)       | `tar`         |
| `./uploads` (bind) | user-uploaded files — already on host   | copy folder   |

### 5.1 Database — backup (logical, portable)
```bash
# gzip INSIDE the container so the binary stream isn't mangled, then copy out
docker exec -e PGPASSWORD='<POSTGRES_PASSWORD>' sml_postgres \
  sh -c "pg_dump -U smluser -d smartcitylab | gzip -c > /tmp/db.sql.gz"
docker cp sml_postgres:/tmp/db.sql.gz ./smartcitylab-$(date +%F).sql.gz
```

### 5.2 Database — restore  ⚠️ overwrites data
Restore into an **EMPTY** `smartcitylab`. The app's `initSchema` + first-boot auto-seed
create the schema + members, so restoring over a live DB throws `relation already exists` /
duplicate-key errors. Restore *before* the app first touches the DB:
```bash
docker cp smartcitylab-2026-06-09.sql.gz sml_postgres:/tmp/r.sql.gz
docker exec sml_postgres sh -c "gunzip -c /tmp/r.sql.gz | psql -U smluser -d smartcitylab"
```
If the DB already has data, drop + recreate it first (stop the app so there are no connections):
```bash
docker compose stop app
docker exec sml_postgres psql -U smluser -d postgres \
  -c "DROP DATABASE smartcitylab;" -c "CREATE DATABASE smartcitylab OWNER smluser;"
# …then run the restore above, then:  docker compose up -d app
```

### 5.3 Export ALL volumes (full backup)
```bash
mkdir -p backups; TS=$(date +%Y%m%d-%H%M%S)
# DB → pg_dump
docker exec -e PGPASSWORD='<POSTGRES_PASSWORD>' sml_postgres \
  sh -c "pg_dump -U smluser -d smartcitylab | gzip -c > /tmp/db.sql.gz"
docker cp sml_postgres:/tmp/db.sql.gz "backups/smartcitylab-$TS.sql.gz"
# app_state + pgadmin_data → tar (one throwaway container; use YOUR volume names from `docker volume ls`)
docker run --rm -v smlweb_app_state:/a:ro -v smlweb_pgadmin_data:/p:ro -v "$(pwd)/backups:/b" alpine \
  sh -c "tar czf /b/app_state-$TS.tar.gz -C /a . && tar czf /b/pgadmin_data-$TS.tar.gz -C /p ."
# uploads is a host bind-mount → just copy the folder:  cp -r ./uploads backups/uploads-$TS
```

### 5.4 Move the whole stack to another machine (e.g. a Raspberry Pi)
```bash
# ── On the SOURCE host ──  run §5.3 to produce backups/*.sql.gz + *.tar.gz

# ── On the TARGET host ──
# 1) Put the repo + .env + the backups/ files there (git clone, then scp / NAS copy).
#    .env MUST keep the SAME POSTGRES_PASSWORD as the source (or the app can't connect).
# 2) Start postgres ONLY → an empty `smartcitylab` is created from POSTGRES_DB:
docker compose up -d postgres
docker volume ls                         # ← confirm the REAL volume names on this host!
# 3) Restore the DB into the empty database:
docker cp backups/smartcitylab-<TS>.sql.gz sml_postgres:/tmp/r.sql.gz
docker exec sml_postgres sh -c "gunzip -c /tmp/r.sql.gz | psql -U smluser -d smartcitylab"
# 4) (optional) restore app_state so existing login tokens keep working — replace <project>:
docker run --rm -v <project>_app_state:/v -v "$(pwd)/backups:/b" alpine \
  tar xzf /b/app_state-<TS>.tar.gz -C /v
# 5) Bring up the rest — init is idempotent and auto-seed skips (members already restored):
docker compose up -d
```
> **Gotcha:** container/volume names are derived from the project-folder name, so they can
> differ between hosts (`smlweb_…` vs `sml_…`). `No such container: sml_postgres` almost always
> means the stack isn't up yet on that host — run `docker compose up -d postgres` first, and
> check `docker ps -a` / `docker volume ls` for the actual names.

### 5.5 Binary dump alternative (faster/smaller for large DBs; supports `--clean`)
```bash
docker exec -e PGPASSWORD='<POSTGRES_PASSWORD>' sml_postgres \
  pg_dump -U smluser -Fc smartcitylab > backup-$(date +%F).dump
docker exec -i sml_postgres pg_restore -U smluser -d smartcitylab --clean < backup-2026-06-09.dump
```

---

## 6. Recover from a corrupted whiteboard `canvas_json`

```sql
-- 1) Connect to DB
docker exec -it sml_postgres psql -U smluser smartcitylab

-- 2) Find the broken board (will throw if JSON parse fails on render)
SELECT id, name, length(canvas_json) FROM whiteboards;

-- 3) Reset to empty canvas (DESTROYS that board's content)
UPDATE whiteboards SET canvas_json = '{"version":"5.3.1","objects":[]}' WHERE id = '<board_id>';

-- 4) Or restore from yesterday's pg_dump (cherry-pick)
-- Extract only that row from the dump → psql replay it
```

---

## 7. ASR/Ollama recording status meanings

| `transcript_status` / `summary_status` | Meaning | Who fixes it |
|---|---|---|
| `pending`   | Queued, waiting for ASR/Ollama to pick up | Wait — worker scans every 5 min |
| `processing`| ASR/Ollama is running on it now | Wait — no action needed |
| `done`      | Success, content saved | — |
| `error`     | Failed. `*_error` column has message | **Auto-retry queue** picks this up every 5 min (1m → 5m → 30m backoff, max 4 attempts). User can also click 🔄 in `/dev → 🎙` |
| `skipped`   | Ollama not configured (or transcript empty) | Set `OLLAMA_URL` in .env + restart `asr` if you want summaries |

---

## 8. ASR errors

### `CUDA failed with error unknown error`
vRAM OOM (ctranslate2 doesn't report "OOM" specifically). Fix in `.env`:
```
WHISPER_BATCH_SIZE=4          # ลดจาก 8
WHISPER_COMPUTE_TYPE=int8_float16   # ครึ่ง vRAM
WHISPER_ALIGN=0                # ปิด wav2vec2 alignment (-1.5 GB vRAM)
```
Then `docker compose up -d --no-deps asr`.

### Ollama timeout (5 min)
Ollama running on CPU is slow. Ensure GPU passthrough:
```bash
docker exec sml_ollama nvidia-smi | head
docker exec sml_ollama ollama ps   # should show "100% GPU" not "100% CPU"
```
If CPU — check `docker-compose.yml` has the `deploy.resources.reservations.devices` block uncommented for the `ollama` service.

---

## 9. Migrate `uploads/` to NAS (live, no downtime)

```bash
# 1) Sync existing data to the NAS volume FIRST (while bind-mount is still active)
docker run --rm \
  -v "$(pwd)/uploads:/from:ro" \
  -v sml_uploads:/to \
  alpine sh -c "cp -r /from/. /to/"

# 2) Verify same size on both sides
docker run --rm -v sml_uploads:/u alpine du -sh /u
du -sh ./uploads

# 3) Swap the bind-mount → named volume in docker-compose.yml:
#    Comment out: - ./uploads:/app/uploads
#    Uncomment:   - sml_uploads:/app/uploads
#    Do the same for the `asr` service.

# 4) Recreate containers (one at a time to minimize disruption)
docker compose up -d --no-deps app
docker compose up -d --no-deps asr
```

---

## 10. Rotate POSTGRES_PASSWORD

```bash
# 1) Change password in DB
docker exec sml_postgres psql -U smluser smartcitylab \
  -c "ALTER USER smluser WITH PASSWORD '<new password>';"

# 2) Update .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=<new password>/" .env
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgres://smluser:<new password>@localhost:5432/smartcitylab|" .env

# 3) Restart app (so it reconnects with new creds)
docker compose up -d --no-deps app
```

---

## 11. Audit log query

```bash
# Recent destructive actions (admin only via API)
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/audit?limit=50"

# Filter by action
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/audit?action=member.delete"

# Filter by actor
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/audit?actor_id=<member_id>"
```

Or via DB:
```sql
SELECT created_at, actor_name, action, target_id, payload
FROM audit_events ORDER BY created_at DESC LIMIT 20;
```

---

## 12. Clear browser cache / force SW update

When you ship a new SW version (`sw.js`'s `CACHE_VERSION`), users get the new code on next page load. To force an immediate update:

1. User clicks 🔄 in browser
2. **OR** open DevTools → Application → Service Workers → "Update" + "Skip waiting"
3. **OR** add `?cache_bust=$(date +%s)` to URL

On iOS PWA installed to home screen:
- Close all tabs
- Reopen from home screen
- New SW activates on first network request

---

## 13. Health check

```bash
# Overall
docker compose ps

# Each service deep-check
curl http://localhost:3000/                                 # main app  → 200
curl http://localhost:3000/dev.html                         # /dev      → 200
docker exec sml_postgres pg_isready -U smluser              # postgres  → accepting connections
docker exec sml_asr curl -s http://localhost:8000/health    # asr       → {"ok":true, ...}
docker exec sml_ollama curl -s http://localhost:11434/api/tags  # ollama → model list
```

---

## 14. Common log greps

```bash
# Errors only
docker compose logs --tail 200 app | grep -iE "error|fail|abort"

# ASR pipeline timing
docker compose logs --tail 500 asr | grep -E "transcribe|align|main model ready"

# Login failures (after #19 lockout was added)
docker compose logs --tail 500 app | grep "invalid credentials"

# Audit log (file-based copy)
docker exec sml_app cat /data/.tokens.json | jq 'keys | length'
```

---

## 15. Public dashboard (`/dashboard`) + stuck Service Worker

Passcode-gated **read-only** dashboard for stakeholders (no member account). An admin
sets the passcode in the app: **Profile → 📊 Dashboard สาธารณะ** (stored hashed in
`app_settings`; blank = disabled), then shares `<host>/dashboard`. It shows "this
period" (≈ 14 days): tasks due, meetings, leaves/reminders — no points/budget/PINs.

```bash
# Is a dashboard passcode set? (read-only check)
docker exec sml_app node -e "require('/app/backend/db').getSetting('dashboard_passcode_hash','').then(h=>console.log('enabled:',!!h)).then(()=>process.exit(0))"
```

**Realtime** uses SSE at `/api/dashboard/events`. `sw.js` **must** bypass this path and
never cache `text/event-stream` — otherwise it caches the endless stream, holds the
connection open, and exhausts the browser's per-origin pool until the whole site stops
loading ("เข้าเว็บไม่ได้ทุกครั้งที่ deploy"). Fixed in SW `v221`+.

**Recover a browser stuck on an old/bad SW:**
1. Close **all** tabs of the origin → reopen. The new `sw.js` activates
   (`skipWaiting` + `clients.claim`) and evicts old caches.
2. Still stuck → DevTools → **Application → Service Workers → Unregister**, then
   **Storage → Clear site data**, reload.
3. Confirm the server itself is healthy from an **Incognito** window (no SW).

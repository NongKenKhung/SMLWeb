# Smart City Lab (SML) — Team workspace

Web app for managing members, task groups, tasks, points, files, calendar, and
real-time whiteboards in a small lab/team. Includes an admin **/dev** sandbox
with experimental tools — visual layout editor, 3D room designer, audio
recorder with **Thai speech-to-text**, point-ledger audit, and more.

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Browser  ──HTTP──►  Node/Express  ──pg──►  PostgreSQL                     │
│                            │                                                │
│                            │ ──SSE──►  open clients (live updates)          │
│                            │ ──WS──►   whiteboard rooms                     │
│                            │ ──HTTP──► PyThaiASR (transcribe audio clips)   │
│                            │                                                │
│                       /uploads/  (group files · audio · avatars)            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start — full stack via Docker

The repo ships with a `docker-compose.yml` that runs everything: postgres,
pgadmin, the Node app, and the PyThaiASR microservice.

```bash
docker compose up -d                    # boot all services
docker compose logs -f app              # tail the main app
```

| Service | URL                   | Purpose                              |
|---------|-----------------------|--------------------------------------|
| app     | http://localhost:3000 | Main SPA                             |
| /dev    | http://localhost:3000/dev | Admin sandbox (admin login required) |
| pgadmin | http://localhost:5050 | DB admin UI (`admin@example.com` / `admin`) |
| asr     | (internal only)       | Thai speech-to-text microservice     |

> First boot: postgres initialises, the app creates the schema, then the entrypoint
> **auto-seeds members** (idempotent — skips if any exist; default PIN `1234`) so you can
> log in immediately. The container runs cross-OS as the non-root `app` user via `gosu`.
> ASR (if re-enabled) builds a ~9 GB image on first build (PyTorch + ffmpeg) — be patient.

### Default logins (PIN: `1234`)

The seed script (`seed.js`) creates a mix of **admin / group-leader / member**
accounts for local development — open `seed.js` or `SELECT name, role FROM members`
in pgAdmin to see the full list. The login screen no longer advertises specific
demo names; type any seeded username plus PIN `1234` to sign in.

### Quick Start — without Docker

```bash
# Postgres must be running locally
DATABASE_URL=postgres://user:pass@localhost:5432/sml \
TOKEN_FILE=./.tokens.json \
npm install && npm run seed && npm start    # http://localhost:3000
```

The DB layer auto-creates tables on first run (`init()` in `db.js`).

---

## Main app features

- **Tasks**: multi-assignee, role per assignee (member/leader/supreme), point
  shares, deadline + extensions, status (pending/in_progress/done/on_hold).
- **Calendar**: month view + per-day list, meeting kind, leaves overlay,
  inline create. Meetings take a start time **and** an explicit end time
  (defaults to start + 1 hour). Past meetings show their time range only —
  no "overdue" chip, since the meeting either happened or didn't.
- **Groups**: leader + members, CSV export, color palette.
- **Submissions**: drag-and-drop files **or** URL submissions (Drive, Notion,
  GitHub …). In-app preview for images, PDFs, text, audio, video, plus
  Office formats: **.docx** rendered via **docx-preview** (preserves original
  page layout, fonts, colours, headers, inline images); **.xlsx/.xls**
  rendered as a tabbed spreadsheet via SheetJS — custom table builder that
  keeps column widths, merged cells, number/date formatting from the
  workbook, with row/column headers and a single sticky scrollbar like Excel.
  Libraries lazy-loaded from cdnjs on first preview. **.pptx** still falls
  back to a download prompt — render quality of available browser libraries
  isn't there yet. The
  submission sheet stages files first so you can pick a **different document
  type (proposal / ปร4 / ใบเสนอราคา / รายงาน / …) per file** via a scrollable
  bottom-sheet picker (full Thai labels), then send all at once — the client
  groups by doc-type and fires one POST per type. On-disk filenames follow
  `YYYYMMDD_<docType>_<taskTitle>.<ext>` (body is the **task name**, not the
  user's local filename — files stay self-documenting in the file browser).
  The original filename is preserved in `task_files.original_name` for
  reference; multiple files of the same doc_type for one task get a 4-hex
  collision suffix.
- **Connections**: contact directory with kind (personal/department/external)
  and topic tags.
- **Members**: profile, avatar, leave management, password change, point
  history (in scoreboard).
- **Real-time**: Server-Sent Events broadcast every state change so all open
  clients re-fetch and re-render.
- **Whiteboard**: real-time multi-user drawing with Fabric.js + WebSocket
  rooms, sticky notes, image upload. 📥 **Inject panel** with 5 tabs:
  📋 Task / 📁 Group / 📅 Meeting (with search + "+ สร้างใหม่"),
  🎙 Recording (embedded mini-recorder — record → upload → card on canvas →
  SSE updates with transcript when ready), and ⭐ Points (list pending point
  requests; ✅/❌ inline or click card on canvas for full prompt). **Double-
  click** any card on the canvas to open its full edit form (task / group /
  meeting) or the approve/reject prompt (point request). Cards auto-refresh
  via `wbSyncCardsToState()` when SSE fires from edits elsewhere. **Removed
  from desktop top nav** — page still rendered, reachable only by hash
  deep-link `/#whiteboard` or via the mobile bottom tabbar.
- **Layout customisation**: every page is a 12-col CSS-grid masonry — admin
  reorders / resizes / hides widgets via `/dev → 🎛️ Site Layout`. Mobile
  collapses to a single column.
- **Mobile / iPad / Apple Pencil**: every UI surface — including the
  whiteboard — must work on phone + iPad + Apple Pencil. Inputs are 16 px
  (gates iOS auto-zoom-on-focus) and ≥ 44 × 44 px tap targets (Apple HIG).
  Fabric canvases set `enableRetinaScaling: true` + `allowTouchScrolling:
  false`, filter `pointerType` to drop `touch` events within 800 ms of a
  `pen` event (palm rejection), and use `touch-action: none` so native
  scroll/zoom can't hijack a stroke. Whiteboard toolbars switch to
  horizontal scroll under 640 px so no button can hide.

---

## /dev admin sandbox

`/dev` is a single-page admin tool (separate from the main SPA, served at
`/dev`). Hidden by default; the entry point is on the **Profile** page when
logged in as admin (`🛠️ Dev & Test Tools`).

### Sidebar — Main
| Panel | What it does |
|---|---|
| 📡 **API Playground** | Hit any endpoint with custom method/body/headers, replay history. |
| 🗃️ **Data Explorer** | Browse every table; row counts; quick filters. |
| ⚙️ **System Info** | Env vars, SMTP info, DB stats, session list. |

### Sidebar — Lab (experimental, sandboxed)
| Panel | What it does |
|---|---|
| 🎨 **Whiteboard** | Real-time canvas (Fabric.js + WebSocket). Sub-tab below ↓ |
| 🎙️ **Audio Recorder** | Record → upload → server stores blob + DB row → **Thai transcription via WhisperX** (word-level timestamps) + **AI summary via Ollama** (Typhoon 2). Mobile-friendly with HTTPS hint, mic selector, live waveform, wake-lock. **📁 Import** button accepts any audio file extension ffmpeg can decode (mp3/wav/flac/m4a/aac/ogg/opus/webm/wma/aiff/amr/…), up to 500 MB per file. |
| 🔬 **Component Lab** | Live HTML/CSS/JS playground. |
| 📐 **Room Designer** | 2D + 3D floor-plan editor. 12-col snap grid, drag-resize-rotate items, collision detection, layered items (laptop on desk), structures (column/wall) block layers, custom catalog, **Three.js 3D view** with select / drag / orbit / pan. Multi-room storage in localStorage. |
| 📖 **About Editor** | Block-based CMS (h1/h2/h3, paragraph, image, list, quote, callout, link, code, video, columns) → preview rendered HTML, multi-page, JSON export/import, persisted in localStorage. |
| 💰 **Point Ledger** | Read-only audit of every point share: who / which task / which group / what role / what phase / when. Filter, search, sort, CSV export. |
| 📜 **Activity Log** | Live SSE event stream tail. |
| 📝 **Dev Notes** | Per-browser note pad. |

### Sidebar — Admin
| Panel | What it does |
|---|---|
| 🎛️ **Site Layout** | Edit the live UI: drag widgets, resize columns + rows, toggle visibility per widget — for every page. **✏️ Edit on Preview** mode embeds the real app in an iframe with on-widget handles; changes round-trip via `postMessage` and apply instantly without saving. |
| 🔧 **Settings** | System settings (admin toggles, SMTP enable, etc). |
| 👥 **Members** | Member CRUD UI (CRUD + role change). |

---

## Architecture

### Services (docker-compose)

```
postgres ←── app (Node, SSE, WS, REST) ──→ asr (Python Flask + PyThaiASR)
                  │                              ▲
                  ▼                              │
              uploads/  ←── shared volume ──────┘
```

- **postgres**: Postgres 16 (volume `pg_data`).
- **pgadmin**: pgAdmin 4 on `:5050`.
- **app**: Node 20 (Express + `pg` + `ws` + `multer`). Reaches `asr` via the
  compose network DNS.
- **asr**: PyTorch 2.5.1 (CUDA 12.1 + cuDNN 9) + Flask + ffmpeg + WhisperX.
  Wraps [m-bain/whisperX](https://github.com/m-bain/whisperX) (faster-whisper
  + word-level alignment via wav2vec2). **Runs on NVIDIA GPU** —
  docker-compose reserves a GPU on the `asr` service via
  `deploy.resources.reservations.devices`. Default model **`large-v3`**
  (~3 GB cached in volume `asr_cache`), `float16` compute. Override per
  environment via `WHISPER_MODEL` / `WHISPER_DEVICE` / `WHISPER_COMPUTE_TYPE`
  in `.env`. To fall back to CPU: switch base image in `asr-service/Dockerfile`
  back to `python:3.11-slim` with CPU torch wheels + comment out the GPU
  reservation in compose + set `WHISPER_DEVICE=cpu WHISPER_COMPUTE_TYPE=int8`.
- **ollama**: local LLM server for **transcript organisation** (formerly
  summarisation). Reads the transcript and emits a Markdown outline
  (`## หัวข้อ` + `- bullets`) grouped by topic without paraphrasing, plus a
  separate `action_items` array of explicit TODOs / decisions. Stored back
  in the `recordings.summary` (Markdown string) + `recordings.action_items`
  (JSON array) columns — same schema as before. Default model
  **`scb10x/llama3.2-typhoon2-3b-instruct`** — a Thai-tuned 3B model from
  SCB10X (built on Llama 3.2). ~2 GB on first pull, cached in volume
  `ollama_models`. Override via `OLLAMA_MODEL` env. Skip starting this
  service to disable AI organisation cleanly — `asr` will mark
  `summary_status='skipped'`.

Set `ASR_URL=` empty in `app.environment` to disable transcription cleanly —
clips stay in `transcript_status='pending'` and the UI shows a 🔄 retry
button.

### Real-time
- **SSE** (`/api/events?token=...`): every successful mutating request fans out
  a `change` event so clients re-fetch.
- **WebSocket** (`/ws/whiteboard?...`): per-board rooms, debounced full-canvas
  broadcast every 1.5 s.
- **postMessage** (iframe): `/dev` Site-Layout → main app (in iframe, `?edit=1`)
  for in-place layout editing.

### Storage
- **DB**: Postgres. Schema is auto-created/migrated on app startup
  (`CREATE TABLE IF NOT EXISTS …` + `ALTER TABLE … ADD COLUMN IF NOT EXISTS`).
- **Files**:
  - Group attachments: `uploads/<group_id>/`
  - Avatars: `uploads/_avatars/`
  - Audio clips: `uploads/_audio/`
- **Tokens / UI config**: `${TOKEN_FILE}` parent dir (defaults to `/data/` in
  container) — `/data/.tokens.json`, `/data/ui-config.json`.
- **Browser-only state** (per browser): `localStorage` keys:
  - `sml_token`, `sml_dev_notes`
  - `sml_dev_rooms_v1`, `sml_dev_room_custom_v1` (Room Designer)
  - `sml_dev_about_v1` (About Editor)

### NAS storage (prepared, not active)

`docker-compose.yml` ships with a pre-wired `sml_uploads` named volume that
mounts a network share (NFS) instead of the local `./uploads/` directory —
ready to flip on once the NAS is racked and configured. Tested target:
**UGREEN NASync DH4300 Plus** over NFSv4.

Currently inactive: the `app` and `asr` services still bind-mount `./uploads`.
Defining the NFS volume in the compose file is harmless until a service
actually references it — Docker resolves the mount lazily at container start.

To activate:
1. Set up the share on the NAS (UGOS Pro → Shared Folder `sml-uploads` →
   File Services → enable NFSv4 → NFS Permissions: host IP, R/W, squash root)
2. In `docker-compose.yml` swap the bind mounts on `app` and `asr` to
   `sml_uploads:/app/uploads` (and `:ro` for asr), and edit `sml_uploads`
   `driver_opts` (real NAS IP + export path)
3. Migrate existing files: `rsync -aHAX ./uploads/ /mnt/<nas-mounted>/`
4. `docker compose down && docker compose up -d`

Do **not** put `pg_data`, `asr_cache`, or `ollama_models` on the NAS —
Postgres needs low-latency `fsync` and the model caches are read-mostly hot
files. Only the `uploads/` tree benefits from NAS-backed storage (snapshots,
RAID, off-host backup).

---

## Project structure

```
.
├── backend/                  ─ Node server code (kept self-contained)
│   ├── server.js             — Express app + REST + SSE + WS bridge
│   ├── db.js                 — pg pool + schema init + every CRUD helper
│   ├── auth.js               — token store (file-backed, hot-reloaded)
│   ├── mailer.js             — SMTP (invitations, deadline reminders)
│   ├── seed.js               — sample data for fresh DBs
│   ├── mock_files.js         — sample-file generator (dev only)
│   ├── test_api.js           — smoke-test script for the REST API
│   └── ecosystem.config.js   — PM2 config (bare-metal alt to Docker)
├── frontend/
│   └── public/               — Static SPA assets served by Express
│       ├── index.html        — main SPA shell
│       ├── app.js            — main SPA logic (~6k lines)
│       ├── style.css         — Tailwind + iOS-flavoured custom CSS
│       ├── dev.html          — /dev admin sandbox (~5k lines)
│       ├── sw.js             — service worker (PWA cache strategy)
│       ├── manifest.webmanifest
│       └── icon.svg
├── asr-service/              ─ WhisperX speech-to-text microservice
│   ├── Dockerfile            — pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime + ffmpeg (GPU build)
│   ├── requirements.txt      — whisperx 3.8.5
│   ├── app.py                — Flask /health · /transcribe · /summarise
│   └── README.md             — service-specific notes
├── uploads/                  — file storage (host-mounted, gitignored)
├── pgadmin/servers.json      — pre-configured pgadmin connection
├── docker-compose.yml        — postgres + pgadmin + app + asr + ollama
├── Dockerfile                — Node 20 image; COPYs backend/ + frontend/
├── package.json              — Node deps (lives at root, scripts use backend/)
├── package-lock.json
├── README.md, llms.txt       — this file + machine-readable summary
└── .env, .gitignore, .dockerignore
```

The container preserves the same `/app/backend/` + `/app/frontend/public/`
split as the host so `__dirname/..` resolves identically in Docker and on a
developer's laptop. `UPLOAD_DIR` can be overridden via env (defaults to
`<repo-root>/uploads/`) — point it at a NAS mount without code changes.

---

## Configuration (`.env`)

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | **Required.** `postgres://user:pass@host:port/db` |
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | `development` | `production` enables short asset cache |
| `TRUST_PROXY` | unset | Set to `1` (or hop count / CIDR) when behind nginx/Caddy |
| `TOKEN_FILE` | `./.tokens.json` | Path to the token store (place on a volume) |
| `TOKEN_TTL_DAYS` | `30` | Token expiry |
| `UI_CONFIG_FILE` | next to `TOKEN_FILE` | Where the layout config JSON lives |
| `ASR_URL` | unset | e.g. `http://asr:8000`. Empty = transcription disabled |
| `SMTP_HOST` / `_PORT` / `_USER` / `_PASS` / `_FROM` / `_SECURE` | unset | SMTP for invitations |
| `LOGIN_RATE_LIMIT` | `10` | Failed logins per IP per 15 min |

---

## Common commands

```bash
# DB
npm run seed                    # idempotent seed of demo data
npm run reset                   # ⚠ TRUNCATE everything + re-seed
npm run mock-files              # delete ~half the tasks, attach 5 sample files

# Containers
docker compose up -d            # all services
docker compose up -d app        # recreate app only (after env change)
docker compose restart app      # restart without re-reading env
docker compose logs -f app asr  # tail logs

# ASR (optional)
docker compose build asr        # rebuild after editing requirements.txt
docker compose logs -f asr      # watch model download on first call
```

---

## Storing uploads on a NAS

By default `./uploads/` is bind-mounted into the `app` container at `/app/uploads`
and the ASR container at `/uploads:ro`. To put it on a NAS instead, mount the
NAS share at the host's `./uploads` path (or change the bind path in
`docker-compose.yml`). Three common options:

### Option A — SMB / CIFS (Synology, TrueNAS, Windows share)

Mount on the Linux host first, then point compose at the mount.

```bash
# On the Docker host
sudo apt install cifs-utils
sudo mkdir -p /mnt/sml-uploads

# /etc/fstab line — auto-mount on boot:
//nas.local/sml-uploads  /mnt/sml-uploads  cifs  \
  username=YOUR_USER,password=YOUR_PASS,uid=1000,gid=1000,iocharset=utf8,vers=3.0,_netdev  0  0

sudo mount -a
```

Then in `docker-compose.yml` swap the bind:

```yaml
services:
  app:
    volumes:
      - app_state:/data
      - /mnt/sml-uploads:/app/uploads      # was: ./uploads
  asr:
    volumes:
      - /mnt/sml-uploads:/uploads:ro       # same path, read-only
```

### Option B — NFS

```bash
# On host
sudo apt install nfs-common
sudo mkdir -p /mnt/sml-uploads
sudo mount -t nfs nas.local:/volume1/sml-uploads /mnt/sml-uploads

# /etc/fstab
nas.local:/volume1/sml-uploads  /mnt/sml-uploads  nfs  defaults,_netdev  0  0
```

Compose changes are identical to SMB above.

### Option C — S3 / MinIO (object storage)

For S3-compatible storage, mount with [s3fs](https://github.com/s3fs-fuse/s3fs-fuse)
or [rclone mount](https://rclone.org/commands/rclone_mount/) and point compose at
the FUSE mount — same pattern as A/B. (Or, longer term, swap multer's disk
storage for an S3 SDK; that's a code change, not a config change.)

### Backup tip

The two paths to back up are:
- Postgres — gzip **inside** the container so the binary stream isn't mangled (matters on Windows):
  `docker exec sml_postgres sh -c "pg_dump -U smluser smartcitylab | gzip -c > /tmp/db.sql.gz"` → `docker cp sml_postgres:/tmp/db.sql.gz .`
- Files: rsync `./uploads/` (or your NAS path) — already on the NAS here, so its snapshot/replication handles it.

> Full backup of **every** volume (pg_data + app_state + pgadmin_data) and moving the whole
> stack to another machine (e.g. a Raspberry Pi): see **`docs/runbook.md` §5**.

---

## Deploying behind HTTPS

The app speaks plain HTTP on `:3000`. Front it with nginx/Caddy/Cloudflare for
TLS — the included compose `helmet` config disables `upgrade-insecure-requests`
so HTTP works on LAN IPs. **Mobile audio recording requires HTTPS or
localhost** (browser security): use `ngrok http 3000` or a real cert when
testing the recorder on a phone.

`TRUST_PROXY=1` makes Express respect `X-Forwarded-For` / `X-Forwarded-Proto`
from your reverse proxy (matters for rate limiting + secure cookies).

---

## Notes on data

- Schema migrations are forward-only and idempotent — safe to redeploy.
- The DB layer is the **only** place that writes data; UI config and
  per-browser state live outside the DB so resetting `data.db` is clean.
- Audio recordings hold metadata in `recordings` table; blobs live on disk
  under `uploads/_audio/<random_hex>.<ext>`. `DELETE /api/recordings/:id`
  removes both.

---

## License

Internal Smart City Lab project.

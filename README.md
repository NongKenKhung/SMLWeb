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

> First boot: postgres seeds itself, app initialises the schema. ASR builds a
> ~9 GB image on first build (PyTorch + ffmpeg) — be patient.

### Default logins (PIN: `1234`)

| Name | Role |
|---|---|
| ดร. สมชาย ใจดี | admin |
| ผศ. วิภาวี งามสง่า | admin |
| ภาคิน ก้องเกียรติ | group leader (IoT, Lab Infra) |
| นภาพร เอี่ยมศรี | group leader (Workshop) |
| ปรีดา ทองคำ | member |

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
  inline create.
- **Groups**: leader + members, CSV export, color palette.
- **Submissions**: drag-and-drop files **or** URL submissions (Drive, Notion,
  GitHub …). In-app preview for images, PDFs, text, audio, video.
- **Connections**: contact directory with kind (personal/department/external)
  and topic tags.
- **Members**: profile, avatar, leave management, password change, point
  history (in scoreboard).
- **Real-time**: Server-Sent Events broadcast every state change so all open
  clients re-fetch and re-render.
- **Whiteboard** (currently hidden behind the *Site Layout* feature flag —
  promote via /dev → 🎛️ Site Layout): real-time multi-user drawing with
  Fabric.js + WebSocket rooms, sticky notes, image upload, inject task data.
- **Layout customisation**: every page is a 12-col CSS-grid masonry — admin
  reorders / resizes / hides widgets via `/dev → 🎛️ Site Layout`. Mobile
  collapses to a single column.

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
| 🎙️ **Audio Recorder** | Record → upload → server stores blob + DB row → **Thai transcription via PyThaiASR**. Mobile-friendly with HTTPS hint, mic selector, live waveform, wake-lock. |
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
- **asr**: Python 3.11 + Flask + ffmpeg + PyThaiASR. Wraps
  [PyThaiNLP/pythaiasr](https://github.com/PyThaiNLP/pythaiasr) (wav2vec2 Thai
  model, ~1.2 GB cached in volume `asr_cache`).

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

---

## Project structure

```
.
├── server.js                 — Express app + REST + SSE + WS bridge
├── db.js                     — pg pool + schema init + every CRUD helper
├── auth.js                   — token store (file-backed, hot-reloaded)
├── mailer.js                 — SMTP (invitations, deadline reminders)
├── seed.js                   — sample data for fresh DBs
├── docker-compose.yml        — postgres + pgadmin + app + asr
├── Dockerfile                — Node 20 image for `app`
├── public/
│   ├── index.html            — main SPA shell
│   ├── app.js                — main SPA logic (~6k lines)
│   ├── style.css             — Tailwind + iOS-flavoured custom CSS
│   └── dev.html              — /dev admin sandbox (~5k lines)
├── asr-service/
│   ├── Dockerfile            — Python 3.11 + ffmpeg + torch
│   ├── requirements.txt      — pythaiasr 1.1.1, transformers 4.41.2, torch 2.2
│   ├── app.py                — Flask /health · /transcribe
│   └── README.md             — service-specific notes
├── uploads/                  — file storage (host-mounted)
└── pgadmin/servers.json      — pre-configured pgadmin connection
```

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

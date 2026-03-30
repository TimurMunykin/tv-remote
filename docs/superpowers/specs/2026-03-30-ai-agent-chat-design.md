# AI Agent Chat — Design Spec
**Date:** 2026-03-30

## Overview

Add an AI agent (GPT-4.5-preview) that controls the TV via natural language chat. The agent sees the TV screen via ADB screenshots and navigates using the existing Philips API + ADB tools. Frontend is fully redesigned as a React SPA with two tabs: Remote and AI Agent.

---

## Architecture

```
tv-remote/
├── backend/
│   ├── app.py        # Flask API (existing + chat endpoints)
│   └── db.py         # Postgres: chat history persistence
├── frontend/         # React + Vite
│   └── src/
│       ├── App.tsx
│       ├── tabs/Remote.tsx
│       └── tabs/Agent.tsx
├── nginx/
│   └── nginx.conf    # Serve frontend static + proxy /api/ to Flask
├── docker-compose.yml
├── .env              # All secrets (gitignored)
├── .env.example
└── rebuild.sh
```

**Docker services:**
- `backend` — Flask/Gunicorn (gthread workers for SSE)
- `frontend` — Nginx serving React build + proxying /api/ to backend
- `postgres` — Postgres 16

---

## Backend

### New endpoints

**`POST /api/chat`** — SSE stream
- Body: `{"message": "..."}`
- Starts agentic loop, streams events:
  - `{"type": "action", "tool": "press_key", "args": {...}, "text": "Нажимаю CursorDown"}`
  - `{"type": "screenshot", "data": "<base64 PNG>"}`
  - `{"type": "message", "text": "..."}` — assistant reply or question
  - `{"type": "error", "text": "..."}`
  - `{"type": "done"}`
- Saves user message + final assistant reply to Postgres

**`GET /api/chat/history`** — returns full conversation history from Postgres

**`POST /api/chat/clear`** — clears conversation history in Postgres

### Agent tools (OpenAI function calling)

| Tool | Description |
|------|-------------|
| `take_screenshot` | ADB screencap → base64 PNG passed to GPT as vision |
| `press_key` | Philips API input/key, supports `times` param |
| `launch_app` | Philips API activities/launch |
| `get_apps` | Philips API applications list |
| `type_text` | ADB `input text` for search fields |

### Agentic loop

1. Load history from Postgres
2. Build messages: system prompt + history + new user message
3. Call GPT-4.5-preview with tools
4. If tool_calls → execute → stream events → loop
5. If text response → save to DB → stream `message` + `done`
6. Max 20 iterations to prevent infinite loops

Screenshots are passed as `image_url` content in tool result messages for GPT vision.

### db.py

Single table:
```sql
CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    role VARCHAR(20) NOT NULL,  -- 'user' | 'assistant'
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Environment variables (`.env`)

```
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4
TV_IP=192.168.31.194
TV_AUTH_USER=claude01
TV_AUTH_KEY=2ace7b0ad9884c8dce777c6e7f5dcfd6ddfcb6bb10223037b9d56c8f8402564d
DATABASE_URL=postgresql://tvremote:tvremote@postgres:5432/tvremote
```

---

## Frontend (React + Vite)

### Tabs

**Remote tab** — current remote control UI, rebuilt as React components. Same dark theme, same functionality.

**AI Agent tab** — two-column layout:
- **Left: Chat panel** — scrollable message history (user bubbles right, assistant left), text input + Send at bottom. Same input used for replies to agent questions.
- **Right: Log panel** — real-time stream of agent actions with autoscroll. Shows action pills (`⌨️ Нажимаю CursorDown`), inline screenshots (clickable lightbox). Cleared at start of each new user message.

### Design

- Dark theme consistent with existing UI
- Built with `frontend-design` skill
- Vite build output → served by Nginx

### Build & Deploy

- `docker-compose.yml` has a `frontend` build stage (multi-stage Dockerfile: node build → nginx serve)
- `rebuild.sh` updated: if only `frontend/src/` changed → rebuild frontend image only

---

## Secrets management

- `.env` file at project root, loaded by docker-compose via `env_file`
- `.env` is gitignored
- `.env.example` committed with all keys, no values
- All hardcoded credentials removed from `app.py`

---

## Out of scope

- Auth/login for the web UI
- Multi-user support
- Voice input

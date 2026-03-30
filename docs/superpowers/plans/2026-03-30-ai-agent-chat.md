# AI Agent Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GPT-5.4 AI agent that controls the TV via natural language chat, with React frontend (tabs: Remote / AI Agent), Postgres for history, and .env for all secrets.

**Architecture:** Flask backend adds SSE `/api/chat` endpoint running an OpenAI tool-calling loop with TV control tools (screenshot, keypresses, app launch). React+Vite frontend served by nginx which also proxies `/api/` to Flask. Postgres stores chat history.

**Tech Stack:** Python/Flask, OpenAI Python SDK, psycopg2, React 18 + Vite + TypeScript, nginx, Postgres 16, Docker Compose.

---

## File Map

**New files:**
- `db.py` — Postgres connection, message storage
- `agent.py` — OpenAI agentic loop (generator yielding SSE events)
- `frontend/` — full React app (see Task 7+)
- `frontend/Dockerfile` — multi-stage: node build → nginx
- `frontend/nginx.conf` — serve static + proxy /api/
- `.env` — secrets (gitignored)
- `.env.example` — template

**Modified files:**
- `app.py` — read config from env, add `/api/chat`, `/api/chat/history`, `/api/chat/clear`
- `requirements.txt` — add openai, psycopg2-binary
- `Dockerfile` — switch to gthread worker
- `docker-compose.yml` — add postgres + frontend services, use env_file
- `.gitignore` — add .env
- `rebuild.sh` — smarter detection

---

## Task 1: .env setup

**Files:**
- Create: `.env`
- Create: `.env.example`
- Modify: `.gitignore`

- [ ] **Create `.env.example`**

```
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4
TV_IP=192.168.31.194
TV_AUTH_USER=claude01
TV_AUTH_KEY=
DATABASE_URL=postgresql://tvremote:tvremote@postgres:5432/tvremote
```

- [ ] **Create `.env` with real values**

```
OPENAI_API_KEY=<your key here>
OPENAI_MODEL=gpt-5.4
TV_IP=192.168.31.194
TV_AUTH_USER=claude01
TV_AUTH_KEY=2ace7b0ad9884c8dce777c6e7f5dcfd6ddfcb6bb10223037b9d56c8f8402564d
DATABASE_URL=postgresql://tvremote:tvremote@postgres:5432/tvremote
```

- [ ] **Add `.env` to `.gitignore`**

```
adb-keys/
__pycache__/
*.pyc
.env
```

- [ ] **Commit**

```bash
git add .env.example .gitignore
git commit -m "feat: add .env.example and gitignore .env"
```

---

## Task 2: Update app.py to read config from env

**Files:**
- Modify: `app.py`

- [ ] **Replace hardcoded credentials at top of `app.py`**

Replace:
```python
TV_IP = "192.168.31.194"
TV_API = f"https://{TV_IP}:1926/6"
AUTH = HTTPDigestAuth("claude01", "2ace7b0ad9884c8dce777c6e7f5dcfd6ddfcb6bb10223037b9d56c8f8402564d")
TIMEOUT = 5
```

With:
```python
import os

TV_IP = os.environ.get("TV_IP", "192.168.31.194")
TV_API = f"https://{TV_IP}:1926/6"
AUTH = HTTPDigestAuth(
    os.environ.get("TV_AUTH_USER", "claude01"),
    os.environ.get("TV_AUTH_KEY", "")
)
TIMEOUT = 5
```

- [ ] **Verify app still starts**

```bash
TV_IP=192.168.31.194 TV_AUTH_USER=claude01 TV_AUTH_KEY=test python3 -c "import app; print('ok')"
```

Expected: `ok`

- [ ] **Commit**

```bash
git add app.py
git commit -m "feat: read TV credentials from environment variables"
```

---

## Task 3: db.py — Postgres integration

**Files:**
- Create: `db.py`
- Modify: `requirements.txt`

- [ ] **Add psycopg2 to requirements.txt**

```
flask==3.1.1
requests==2.32.3
urllib3==2.4.0
gunicorn==23.0.0
openai==1.75.0
psycopg2-binary==2.9.10
```

- [ ] **Create `db.py`**

```python
import os
import psycopg2
from psycopg2.extras import RealDictCursor


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def init_db():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id SERIAL PRIMARY KEY,
                    role VARCHAR(20) NOT NULL,
                    content TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """)
        conn.commit()


def save_message(role: str, content: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO messages (role, content) VALUES (%s, %s)",
                (role, content)
            )
        conn.commit()


def get_history() -> list[dict]:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT role, content FROM messages ORDER BY created_at")
            return [dict(r) for r in cur.fetchall()]


def clear_history():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM messages")
        conn.commit()
```

- [ ] **Commit**

```bash
git add db.py requirements.txt
git commit -m "feat: add Postgres message storage (db.py)"
```

---

## Task 4: agent.py — OpenAI agentic loop

**Files:**
- Create: `agent.py`

- [ ] **Create `agent.py`**

```python
import os
import json
import base64
import subprocess
import tempfile
import time
from typing import Generator

import requests as http_requests
from requests.auth import HTTPDigestAuth
from openai import OpenAI


SYSTEM_PROMPT = """You are an AI assistant that controls a Philips 55OLED706 Android TV.

The TV runs Android TV. Use the tools to navigate and control it.

Navigation keys: CursorUp, CursorDown, CursorLeft, CursorRight, Confirm (OK/Enter), Back, Home
Media keys: Play, Pause, Stop, Rewind, FastForward
Other: VolumeUp, VolumeDown, Mute, Standby

Strategy:
- Always take a screenshot first to understand the current state
- Navigate step by step, confirm each action with a screenshot
- If you need clarification from the user, ask them directly in your response
- When looking for an app, use get_apps first to find the exact package name
- Be efficient — don't take unnecessary screenshots
"""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "take_screenshot",
            "description": "Take a screenshot of the TV screen to see what is currently displayed. Always do this before navigating.",
            "parameters": {"type": "object", "properties": {}, "required": []}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "press_key",
            "description": "Press a remote control button on the TV.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {
                        "type": "string",
                        "description": "Key name: CursorUp, CursorDown, CursorLeft, CursorRight, Confirm, Back, Home, VolumeUp, VolumeDown, Play, Pause, Stop, Rewind, FastForward, Mute, Standby"
                    },
                    "times": {
                        "type": "integer",
                        "description": "Number of times to press the key. Defaults to 1.",
                        "default": 1
                    }
                },
                "required": ["key"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "launch_app",
            "description": "Launch an app on the TV by Android package name and class name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "package_name": {"type": "string", "description": "Android package name"},
                    "class_name": {"type": "string", "description": "Android activity class name"}
                },
                "required": ["package_name", "class_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_apps",
            "description": "Get the list of all installed apps on the TV with their package names.",
            "parameters": {"type": "object", "properties": {}, "required": []}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "type_text",
            "description": "Type text on the TV using ADB input (for search fields).",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Text to type"}
                },
                "required": ["text"]
            }
        }
    }
]


def _tv_post(path: str, data: dict) -> dict:
    tv_ip = os.environ.get("TV_IP", "192.168.31.194")
    auth = HTTPDigestAuth(
        os.environ.get("TV_AUTH_USER", "claude01"),
        os.environ.get("TV_AUTH_KEY", "")
    )
    try:
        r = http_requests.post(
            f"https://{tv_ip}:1926/6/{path}",
            json=data, auth=auth, verify=False, timeout=5
        )
        return {"ok": True, "status": r.status_code}
    except Exception as e:
        return {"error": str(e)}


def _tv_get(path: str) -> dict:
    tv_ip = os.environ.get("TV_IP", "192.168.31.194")
    auth = HTTPDigestAuth(
        os.environ.get("TV_AUTH_USER", "claude01"),
        os.environ.get("TV_AUTH_KEY", "")
    )
    try:
        r = http_requests.get(
            f"https://{tv_ip}:1926/6/{path}",
            auth=auth, verify=False, timeout=5
        )
        return r.json() if r.text else {}
    except Exception as e:
        return {"error": str(e)}


def _take_screenshot() -> str:
    """Returns base64-encoded PNG string."""
    tv_ip = os.environ.get("TV_IP", "192.168.31.194")
    subprocess.run(["adb", "connect", f"{tv_ip}:5555"], capture_output=True, timeout=5)
    subprocess.run(
        ["adb", "-s", f"{tv_ip}:5555", "shell", "screencap", "-p", "/sdcard/screen.png"],
        capture_output=True, timeout=10
    )
    tmp = tempfile.mktemp(suffix=".png")
    subprocess.run(
        ["adb", "-s", f"{tv_ip}:5555", "pull", "/sdcard/screen.png", tmp],
        capture_output=True, timeout=10
    )
    with open(tmp, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    os.unlink(tmp)
    return data


def run_agent_loop(user_message: str) -> Generator[dict, None, None]:
    """Generator that yields SSE event dicts."""
    from db import save_message, get_history

    save_message("user", user_message)
    history = get_history()

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for msg in history:
        messages.append({"role": msg["role"], "content": msg["content"]})

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    model = os.environ.get("OPENAI_MODEL", "gpt-5.4")
    tv_ip = os.environ.get("TV_IP", "192.168.31.194")

    for _ in range(20):
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
            max_tokens=2000
        )

        msg = response.choices[0].message

        if not msg.tool_calls:
            text = msg.content or ""
            save_message("assistant", text)
            yield {"type": "message", "text": text}
            yield {"type": "done"}
            return

        messages.append(msg)
        tool_results = []

        for tc in msg.tool_calls:
            name = tc.function.name
            args = json.loads(tc.function.arguments)

            yield {"type": "action", "tool": name, "args": args}

            if name == "take_screenshot":
                img_b64 = _take_screenshot()
                yield {"type": "screenshot", "data": img_b64}
                tool_results.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": [
                        {"type": "text", "text": "Screenshot taken:"},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}}
                    ]
                })

            elif name == "press_key":
                key = args["key"]
                times = args.get("times", 1)
                for _ in range(times):
                    _tv_post("input/key", {"key": key})
                    time.sleep(0.3)
                tool_results.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps({"ok": True, "key": key, "times": times})
                })

            elif name == "launch_app":
                _tv_post("activities/launch", {
                    "intent": {
                        "component": {
                            "packageName": args["package_name"],
                            "className": args["class_name"]
                        },
                        "action": "android.intent.action.MAIN"
                    }
                })
                tool_results.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": '{"ok": true}'
                })

            elif name == "get_apps":
                data = _tv_get("applications")
                apps = data.get("applications", [])
                summary = [
                    {
                        "label": a.get("label", ""),
                        "package": a.get("intent", {}).get("component", {}).get("packageName", ""),
                        "class": a.get("intent", {}).get("component", {}).get("className", "")
                    }
                    for a in apps
                ]
                tool_results.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps({"applications": summary})
                })

            elif name == "type_text":
                text = args["text"].replace(" ", "%s")
                subprocess.run(
                    ["adb", "-s", f"{tv_ip}:5555", "shell", "input", "text", text],
                    capture_output=True, timeout=10
                )
                tool_results.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": '{"ok": true}'
                })

        messages.extend(tool_results)

    yield {"type": "error", "text": "Превышен лимит итераций (20)"}
    yield {"type": "done"}
```

- [ ] **Commit**

```bash
git add agent.py
git commit -m "feat: add OpenAI agentic loop (agent.py)"
```

---

## Task 5: app.py — add chat endpoints

**Files:**
- Modify: `app.py`

- [ ] **Add imports at top of `app.py`**

```python
import json
from flask import Flask, jsonify, request, send_file, Response, stream_with_context
from db import init_db, get_history, clear_history
```

- [ ] **Add `init_db()` call after app creation**

```python
app = Flask(__name__)

# Initialize DB on startup (only when DATABASE_URL is set)
if os.environ.get("DATABASE_URL"):
    try:
        init_db()
    except Exception as e:
        print(f"DB init skipped: {e}")
```

- [ ] **Add three chat endpoints at the bottom of `app.py` (before `if __name__`)**

```python
@app.route("/api/chat", methods=["POST"])
def chat():
    message = (request.json or {}).get("message", "").strip()
    if not message:
        return jsonify({"error": "empty message"}), 400

    from agent import run_agent_loop

    def generate():
        try:
            for event in run_agent_loop(message):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'text': str(e)})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


@app.route("/api/chat/history")
def chat_history():
    if not os.environ.get("DATABASE_URL"):
        return jsonify([])
    return jsonify(get_history())


@app.route("/api/chat/clear", methods=["POST"])
def chat_clear():
    if os.environ.get("DATABASE_URL"):
        clear_history()
    return jsonify({"ok": True})
```

- [ ] **Smoke test (run locally with env vars)**

```bash
DATABASE_URL='' OPENAI_API_KEY='' TV_IP=192.168.31.194 TV_AUTH_USER=claude01 TV_AUTH_KEY=test python3 -c "
from app import app
with app.test_client() as c:
    r = c.post('/api/chat', json={'message': ''})
    assert r.status_code == 400
    r = c.get('/api/chat/history')
    assert r.status_code == 200
    print('endpoints ok')
"
```

Expected: `endpoints ok`

- [ ] **Commit**

```bash
git add app.py
git commit -m "feat: add /api/chat SSE endpoint and history endpoints"
```

---

## Task 6: Update Dockerfile and requirements.txt for backend

**Files:**
- Modify: `Dockerfile`
- Modify: `requirements.txt`

- [ ] **Update `requirements.txt`** (already done in Task 3 — verify it contains openai and psycopg2-binary)

```
flask==3.1.1
requests==2.32.3
urllib3==2.4.0
gunicorn==23.0.0
openai==1.75.0
psycopg2-binary==2.9.10
```

- [ ] **Update `Dockerfile` to use gthread worker (required for SSE)**

```dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y adb --no-install-recommends && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8080
CMD ["gunicorn", "-b", "0.0.0.0:8080", "-w", "2", "--worker-class", "gthread", "--threads", "4", "--access-logfile", "-", "app:app"]
```

- [ ] **Commit**

```bash
git add Dockerfile requirements.txt
git commit -m "feat: switch to gthread worker for SSE, add openai+psycopg2 deps"
```

---

## Task 7: Frontend — Vite + React project setup

**Files:**
- Create: `frontend/` (new directory)
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/index.html`

- [ ] **Initialize React + Vite project**

```bash
cd /path/to/tv-remote
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
```

- [ ] **Verify dev server starts**

```bash
cd frontend && npm run dev
```

Expected: server on http://localhost:5173

- [ ] **Commit initial Vite scaffold**

```bash
git add frontend/
git commit -m "feat: scaffold React+Vite frontend"
```

---

## Task 8: Frontend — App shell with tabs + Remote tab

**Files:**
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/api.ts`
- Create: `frontend/src/tabs/Remote.tsx`
- Delete: `frontend/src/App.css`, `frontend/src/assets/` (Vite defaults, unused)

> **Use the `frontend-design` skill** when implementing the visual design of these components.

- [ ] **Create `frontend/src/api.ts`** — typed wrappers for all backend endpoints

```typescript
const BASE = '/api'

export async function getStatus() {
  const r = await fetch(`${BASE}/status`)
  return r.json()
}

export async function sendKey(key: string) {
  await fetch(`${BASE}/key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key })
  })
}

export async function setVolume(volume: number) {
  await fetch(`${BASE}/volume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volume })
  })
}

export async function setPower(state: 'On' | 'Standby') {
  await fetch(`${BASE}/power`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state })
  })
}

export async function getApps() {
  const r = await fetch(`${BASE}/apps`)
  return r.json()
}

export async function launchApp(packageName: string, className: string) {
  await fetch(`${BASE}/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: { component: { packageName, className }, action: 'android.intent.action.MAIN' }
    })
  })
}

export async function getChatHistory(): Promise<Array<{ role: string; content: string }>> {
  const r = await fetch(`${BASE}/chat/history`)
  return r.json()
}

export async function clearChat() {
  await fetch(`${BASE}/chat/clear`, { method: 'POST' })
}

export function streamChat(message: string, onEvent: (event: Record<string, unknown>) => void): () => void {
  const controller = new AbortController()

  fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal: controller.signal
  }).then(async (res) => {
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            onEvent(JSON.parse(line.slice(6)))
          } catch {}
        }
      }
    }
  }).catch(() => {})

  return () => controller.abort()
}
```

- [ ] **Invoke `frontend-design` skill and implement `App.tsx` with dark-theme tab navigation + `Remote.tsx` tab** (port current remote UI: power, d-pad, volume, media buttons, app launcher, screenshot gallery)

- [ ] **Verify in browser** — `npm run dev` (dev proxy will fail for /api/ but components should render)

- [ ] **Commit**

```bash
git add frontend/src/
git commit -m "feat: React Remote tab with full remote control UI"
```

---

## Task 9: Frontend — AI Agent tab

**Files:**
- Create: `frontend/src/tabs/Agent.tsx`

> **Use the `frontend-design` skill** for the visual design of chat and log panels.

- [ ] **Implement `Agent.tsx`** with:
  - Left panel: `ChatPanel` — message bubbles (user right/blue, assistant left/gray), input + Send button at bottom, loads history on mount via `getChatHistory()`, calls `streamChat()` on submit
  - Right panel: `LogPanel` — real-time stream of action pills and inline screenshots, autoscrolls, clears on each new message

  Key state in `Agent.tsx`:
  ```typescript
  const [messages, setMessages] = useState<{role: string; content: string}[]>([])
  const [logItems, setLogItems] = useState<LogItem[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  ```

  On send:
  ```typescript
  function handleSend() {
    if (!input.trim() || busy) return
    const msg = input.trim()
    setInput('')
    setBusy(true)
    setLogItems([])
    setMessages(prev => [...prev, { role: 'user', content: msg }])

    const cancel = streamChat(msg, (event) => {
      if (event.type === 'action') {
        setLogItems(prev => [...prev, { type: 'action', tool: event.tool as string, args: event.args as Record<string,unknown> }])
      } else if (event.type === 'screenshot') {
        setLogItems(prev => [...prev, { type: 'screenshot', data: event.data as string }])
      } else if (event.type === 'message') {
        setMessages(prev => [...prev, { role: 'assistant', content: event.text as string }])
      } else if (event.type === 'error') {
        setLogItems(prev => [...prev, { type: 'error', text: event.text as string }])
      } else if (event.type === 'done') {
        setBusy(false)
      }
    })
  }
  ```

- [ ] **Add Agent tab to `App.tsx`**

- [ ] **Commit**

```bash
git add frontend/src/tabs/Agent.tsx frontend/src/App.tsx
git commit -m "feat: AI Agent tab with chat + live log panels"
```

---

## Task 10: Frontend Dockerfile + nginx.conf

**Files:**
- Create: `frontend/Dockerfile`
- Create: `frontend/nginx.conf`

- [ ] **Create `frontend/nginx.conf`**

```nginx
server {
    listen 80;

    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://backend:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # SSE support
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        chunked_transfer_encoding on;
    }
}
```

- [ ] **Create `frontend/Dockerfile`**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

- [ ] **Commit**

```bash
git add frontend/Dockerfile frontend/nginx.conf
git commit -m "feat: frontend multi-stage Dockerfile with nginx SSE proxy"
```

---

## Task 11: Update docker-compose.yml

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Replace `docker-compose.yml` entirely**

```yaml
services:
  backend:
    build: .
    container_name: tv-remote-backend
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./adb-keys:/root/.android:ro
    depends_on:
      postgres:
        condition: service_healthy

  frontend:
    build: ./frontend
    container_name: tv-remote-frontend
    restart: unless-stopped
    ports:
      - "8099:80"
    depends_on:
      - backend

  postgres:
    image: postgres:16-alpine
    container_name: tv-remote-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: tvremote
      POSTGRES_USER: tvremote
      POSTGRES_PASSWORD: tvremote
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tvremote"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

- [ ] **Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add postgres + frontend services to docker-compose"
```

---

## Task 12: Update rebuild.sh

**Files:**
- Modify: `rebuild.sh`

- [ ] **Replace `rebuild.sh`**

```bash
#!/bin/bash
set -e

SERVER="192.168.31.36"
REMOTE_DIR="~/tv-remote"
SCRIPT_DIR="$(dirname "$0")"

echo "→ Синхронизирую файлы..."
rsync -av --exclude='.git' --exclude='frontend/node_modules' --exclude='frontend/dist' \
  "$SCRIPT_DIR/" "$SERVER:$REMOTE_DIR/"

echo "→ Пересобираю контейнеры..."
ssh "$SERVER" "cd $REMOTE_DIR && docker compose up -d --build"

echo "✓ Готово: http://$SERVER:8099"
```

- [ ] **Make executable**

```bash
chmod +x rebuild.sh
git add rebuild.sh
git commit -m "feat: update rebuild.sh for new multi-service setup"
```

---

## Task 13: Deploy and E2E test

- [ ] **Copy .env to server (not via git — manual step)**

```bash
scp .env 192.168.31.36:~/tv-remote/.env
```

- [ ] **Run rebuild.sh**

```bash
./rebuild.sh
```

Expected: all 3 containers start (backend, frontend, postgres)

- [ ] **Test backend health**

```bash
curl http://192.168.31.36:8099/api/status
```

Expected: JSON with power, volume, activity

- [ ] **Test chat history endpoint**

```bash
curl http://192.168.31.36:8099/api/chat/history
```

Expected: `[]` (empty array)

- [ ] **Test chat in browser** — open http://192.168.31.36:8099, go to AI Agent tab, type "включи YouTube" and verify:
  - Log panel shows agent actions in real-time
  - Screenshots appear in log
  - Chat panel shows final response

- [ ] **Final commit**

```bash
git add -A
git commit -m "feat: complete AI agent chat integration"
git push
```

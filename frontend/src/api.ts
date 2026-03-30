const BASE = '/api'

export async function getStatus() {
  const r = await fetch(`${BASE}/status`)
  return r.json()
}

export async function sendKey(key: string) {
  await fetch(`${BASE}/key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  })
}

export async function setVolume(volume: number) {
  await fetch(`${BASE}/volume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volume }),
  })
}

export async function setMuted(muted: boolean) {
  await fetch(`${BASE}/volume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ muted }),
  })
}

export async function setPower(state: 'On' | 'Standby') {
  await fetch(`${BASE}/power`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
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
      intent: {
        component: { packageName, className },
        action: 'android.intent.action.MAIN',
      },
    }),
  })
}

export async function getChatHistory(): Promise<Array<{ role: string; content: string }>> {
  const r = await fetch(`${BASE}/chat/history`)
  return r.json()
}

export async function clearChat() {
  await fetch(`${BASE}/chat/clear`, { method: 'POST' })
}

export function streamChat(
  message: string,
  onEvent: (event: Record<string, unknown>) => void,
): () => void {
  const controller = new AbortController()

  fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal: controller.signal,
  })
    .then(async (res) => {
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
    })
    .catch(() => {})

  return () => controller.abort()
}

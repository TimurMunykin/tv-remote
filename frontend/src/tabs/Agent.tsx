import { useState, useEffect, useRef, useCallback } from 'react'
import { getChatHistory, clearChat, streamChat } from '../api'

type ChatMessage = { role: 'user' | 'assistant'; content: string }

type LogItem =
  | { type: 'action'; tool: string; args: Record<string, unknown> }
  | { type: 'screenshot'; data: string }
  | { type: 'error'; text: string }

function toolLabel(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'take_screenshot': return '📷 Taking screenshot'
    case 'press_key': return `⌨ Press ${args.key}${args.times && (args.times as number) > 1 ? ` ×${args.times}` : ''}`
    case 'launch_app': return `▶ Launch ${args.package_name ?? ''}`
    case 'get_apps': return '📋 Getting app list'
    case 'type_text': return `✍ Type "${args.text}"`
    default: return `⚡ ${tool}`
  }
}

export default function Agent() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [logItems, setLogItems] = useState<LogItem[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)

  const chatEndRef = useRef<HTMLDivElement>(null)
  const logEndRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<(() => void) | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    getChatHistory().then(history => {
      setMessages(history as ChatMessage[])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logItems])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleSend = useCallback(() => {
    const msg = input.trim()
    if (!msg || busy) return

    setInput('')
    setBusy(true)
    setLogItems([])
    setMessages(prev => [...prev, { role: 'user', content: msg }])

    cancelRef.current = streamChat(msg, (event) => {
      if (event.type === 'action') {
        setLogItems(prev => [...prev, {
          type: 'action',
          tool: event.tool as string,
          args: (event.args ?? {}) as Record<string, unknown>,
        }])
      } else if (event.type === 'screenshot') {
        setLogItems(prev => [...prev, {
          type: 'screenshot',
          data: event.data as string,
        }])
      } else if (event.type === 'message') {
        setMessages(prev => [...prev, { role: 'assistant', content: event.text as string }])
      } else if (event.type === 'error') {
        setLogItems(prev => [...prev, { type: 'error', text: event.text as string }])
        setBusy(false)
      } else if (event.type === 'done') {
        setBusy(false)
      }
    })
  }, [input, busy])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  async function handleClear() {
    await clearChat()
    setMessages([])
    setLogItems([])
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      overflow: 'hidden',
      height: '100%',
      gap: 0,
    }}>
      {/* LEFT: Chat panel */}
      <div style={{
        flex: '0 0 420px',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--border)',
        overflow: 'hidden',
      }}>
        {/* Chat header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <span style={{
            fontFamily: 'var(--mono)',
            fontSize: 10,
            color: 'var(--accent)',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
          }}>
            ◈ AI Agent Chat
          </span>
          <button
            onClick={handleClear}
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 9,
              letterSpacing: '0.1em',
              color: 'var(--text-dim)',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '4px 10px',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--danger)'
              e.currentTarget.style.color = 'var(--danger)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border)'
              e.currentTarget.style.color = 'var(--text-dim)'
            }}
          >
            CLEAR
          </button>
        </div>

        {/* Messages */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          {messages.length === 0 && (
            <div style={{
              textAlign: 'center',
              color: 'var(--text-dim)',
              fontFamily: 'var(--mono)',
              fontSize: 11,
              letterSpacing: '0.06em',
              marginTop: 40,
              lineHeight: 1.8,
            }}>
              <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.3 }}>◈</div>
              Напиши что сделать с телевизором
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                gap: 3,
              }}
            >
              <div style={{
                fontFamily: 'var(--mono)',
                fontSize: 9,
                letterSpacing: '0.1em',
                color: 'var(--text-dim)',
                textTransform: 'uppercase',
                paddingInline: 4,
              }}>
                {msg.role === 'user' ? 'YOU' : 'AGENT'}
              </div>
              <div style={{
                maxWidth: '85%',
                padding: '10px 14px',
                borderRadius: msg.role === 'user'
                  ? '12px 12px 2px 12px'
                  : '12px 12px 12px 2px',
                background: msg.role === 'user'
                  ? 'rgba(0,255,157,0.1)'
                  : 'var(--bg2)',
                border: '1px solid',
                borderColor: msg.role === 'user'
                  ? 'rgba(0,255,157,0.3)'
                  : 'var(--border)',
                color: msg.role === 'user' ? 'var(--accent)' : 'var(--text)',
                fontSize: 13,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {msg.content}
              </div>
            </div>
          ))}

          {busy && (
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              flexDirection: 'column',
              gap: 3,
            }}>
              <div style={{
                fontFamily: 'var(--mono)',
                fontSize: 9,
                letterSpacing: '0.1em',
                color: 'var(--text-dim)',
                textTransform: 'uppercase',
                paddingInline: 4,
              }}>
                AGENT
              </div>
              <div style={{
                padding: '10px 14px',
                background: 'var(--bg2)',
                border: '1px solid var(--border)',
                borderRadius: '12px 12px 12px 2px',
                display: 'flex',
                gap: 4,
                alignItems: 'center',
              }}>
                {[0, 1, 2].map(j => (
                  <span key={j} style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    animation: 'pulse 1.2s ease-in-out infinite',
                    animationDelay: `${j * 0.2}s`,
                    opacity: 0.6,
                  }} />
                ))}
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-end',
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Напиши что сделать... (Enter для отправки)"
              rows={2}
              disabled={busy}
              style={{
                flex: 1,
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                color: 'var(--text)',
                fontFamily: 'var(--sans)',
                fontSize: 13,
                padding: '10px 12px',
                resize: 'none',
                lineHeight: 1.5,
                outline: 'none',
                transition: 'border-color 0.15s',
                opacity: busy ? 0.6 : 1,
              }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
            <button
              onClick={handleSend}
              disabled={busy || !input.trim()}
              style={{
                padding: '10px 16px',
                background: busy || !input.trim() ? 'transparent' : 'var(--accent-dim)',
                border: '1px solid',
                borderColor: busy || !input.trim() ? 'var(--border)' : 'var(--accent)',
                borderRadius: 'var(--radius)',
                color: busy || !input.trim() ? 'var(--text-dim)' : 'var(--accent)',
                fontFamily: 'var(--mono)',
                fontSize: 11,
                letterSpacing: '0.08em',
                cursor: busy || !input.trim() ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
                alignSelf: 'flex-end',
                height: 42,
                whiteSpace: 'nowrap',
              }}
            >
              {busy ? '◌' : '→ Send'}
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT: Log panel */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--bg)',
      }}>
        {/* Log header */}
        <div style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{
            fontFamily: 'var(--mono)',
            fontSize: 10,
            color: 'var(--blue)',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
          }}>
            ▸ Action Log
          </span>
          {busy && (
            <span style={{
              fontFamily: 'var(--mono)',
              fontSize: 9,
              color: 'var(--accent)',
              letterSpacing: '0.1em',
              animation: 'blink 1s step-start infinite',
            }}>
              ● RUNNING
            </span>
          )}
        </div>

        {/* Log items */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          {logItems.length === 0 && !busy && (
            <div style={{
              textAlign: 'center',
              color: 'var(--text-dim)',
              fontFamily: 'var(--mono)',
              fontSize: 10,
              letterSpacing: '0.06em',
              marginTop: 40,
              lineHeight: 2,
              opacity: 0.5,
            }}>
              Здесь будут действия агента
            </div>
          )}

          {logItems.map((item, i) => {
            if (item.type === 'action') {
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 12px',
                    background: 'var(--bg2)',
                    border: '1px solid var(--border)',
                    borderLeft: '3px solid var(--blue)',
                    borderRadius: 'var(--radius)',
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    color: 'var(--text)',
                    letterSpacing: '0.04em',
                  }}
                >
                  <span style={{ color: 'var(--blue)', opacity: 0.6, fontSize: 9 }}>▸</span>
                  {toolLabel(item.tool, item.args)}
                </div>
              )
            }

            if (item.type === 'screenshot') {
              return (
                <div key={i} style={{ position: 'relative' }}>
                  <div style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 9,
                    color: 'var(--text-dim)',
                    letterSpacing: '0.1em',
                    marginBottom: 5,
                    textTransform: 'uppercase',
                  }}>
                    ▸ Screenshot
                  </div>
                  <img
                    src={`data:image/png;base64,${item.data}`}
                    alt="Screenshot"
                    onClick={() => setLightbox(`data:image/png;base64,${item.data}`)}
                    style={{
                      width: '100%',
                      maxWidth: 400,
                      borderRadius: 'var(--radius)',
                      border: '1px solid var(--border)',
                      cursor: 'zoom-in',
                      display: 'block',
                      transition: 'border-color 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--blue)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                  />
                </div>
              )
            }

            if (item.type === 'error') {
              return (
                <div
                  key={i}
                  style={{
                    padding: '8px 12px',
                    background: 'var(--danger-dim)',
                    border: '1px solid var(--danger)',
                    borderRadius: 'var(--radius)',
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    color: 'var(--danger)',
                    letterSpacing: '0.04em',
                  }}
                >
                  ✕ {item.text}
                </div>
              )
            }

            return null
          })}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.92)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'zoom-out',
          }}
        >
          <img
            src={lightbox}
            alt="Screenshot"
            style={{
              maxWidth: '95vw',
              maxHeight: '95vh',
              borderRadius: 8,
              border: '1px solid var(--border-bright)',
              boxShadow: '0 0 60px rgba(0,0,0,0.8)',
            }}
          />
          <button
            onClick={() => setLightbox(null)}
            style={{
              position: 'absolute',
              top: 16,
              right: 20,
              background: 'var(--bg2)',
              border: '1px solid var(--border-bright)',
              color: 'var(--text)',
              borderRadius: 'var(--radius)',
              padding: '6px 12px',
              fontFamily: 'var(--mono)',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            ✕ Закрыть
          </button>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}

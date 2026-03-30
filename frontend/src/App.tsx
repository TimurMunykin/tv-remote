import { useState } from 'react'
import Remote from './tabs/Remote'
import Agent from './tabs/Agent'
import './index.css'

type Tab = 'remote' | 'agent'

export default function App() {
  const [tab, setTab] = useState<Tab>('remote')

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: '100vh',
    }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 20px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
        flexShrink: 0,
        gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontFamily: 'var(--mono)',
            fontSize: 11,
            color: 'var(--accent)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            opacity: 0.7,
          }}>
            SYS //
          </span>
          <span style={{
            fontFamily: 'var(--mono)',
            fontSize: 13,
            color: 'var(--text-bright)',
            letterSpacing: '0.06em',
          }}>
            Philips 55OLED706
          </span>
        </div>

        {/* Tab nav */}
        <nav style={{ display: 'flex', gap: 2, background: 'var(--bg2)', borderRadius: 'var(--radius)', padding: 3, border: '1px solid var(--border)' }}>
          {(['remote', 'agent'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '6px 16px',
                borderRadius: 'calc(var(--radius) - 2px)',
                fontFamily: 'var(--mono)',
                fontSize: 11,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: tab === t ? 'var(--bg)' : 'var(--text-dim)',
                background: tab === t ? 'var(--accent)' : 'transparent',
                transition: 'all 0.15s ease',
                fontWeight: tab === t ? 600 : 400,
              }}
            >
              {t === 'remote' ? '⚡ Remote' : '◈ AI Agent'}
            </button>
          ))}
        </nav>

        <div style={{
          fontFamily: 'var(--mono)',
          fontSize: 10,
          color: 'var(--text-dim)',
          letterSpacing: '0.08em',
        }}>
          192.168.31.194
        </div>
      </header>

      {/* Content */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {tab === 'remote' ? <Remote /> : <Agent />}
      </main>
    </div>
  )
}

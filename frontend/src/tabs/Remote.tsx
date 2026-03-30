import { useState, useEffect, useCallback } from 'react'
import { getStatus, sendKey, setVolume, setMuted, setPower, getApps, launchApp } from '../api'

const APPS_DEFAULT = [
  { label: 'YouTube', packageName: 'com.google.android.youtube.tv', className: 'com.google.android.apps.youtube.tv.activity.ShellActivity' },
  { label: 'Netflix', packageName: 'com.netflix.ninja', className: 'com.netflix.ninja.MainActivity' },
  { label: 'KinoGo', packageName: 'org.AV.KinoGo.BETA', className: 'org.AV.KinoGo.BETA.MainActivity' },
]

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '14px 16px',
    }}>
      <div style={{
        fontFamily: 'var(--mono)',
        fontSize: 9,
        color: 'var(--text-dim)',
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        marginBottom: 12,
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function RcBtn({
  children,
  onClick,
  variant = 'default',
  style: extraStyle = {},
}: {
  children: React.ReactNode
  onClick: () => void
  variant?: 'default' | 'accent' | 'danger' | 'ghost'
  style?: React.CSSProperties
}) {
  const [pressed, setPressed] = useState(false)

  const base: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid',
    borderRadius: 'var(--radius)',
    fontSize: 14,
    transition: 'all 0.1s ease',
    userSelect: 'none',
    transform: pressed ? 'scale(0.93)' : 'scale(1)',
  }

  const variants: Record<string, React.CSSProperties> = {
    default: {
      background: pressed ? 'var(--bg3)' : 'var(--bg2)',
      borderColor: pressed ? 'var(--border-bright)' : 'var(--border)',
      color: 'var(--text)',
      boxShadow: pressed ? 'none' : '0 2px 0 rgba(0,0,0,0.4)',
    },
    accent: {
      background: pressed ? 'rgba(0,255,157,0.25)' : 'var(--accent-dim)',
      borderColor: 'var(--accent)',
      color: 'var(--accent)',
      boxShadow: pressed ? 'none' : `0 0 8px var(--accent-glow)`,
    },
    danger: {
      background: pressed ? 'rgba(255,74,96,0.25)' : 'var(--danger-dim)',
      borderColor: 'var(--danger)',
      color: 'var(--danger)',
    },
    ghost: {
      background: 'transparent',
      borderColor: 'var(--border)',
      color: 'var(--text-dim)',
    },
  }

  return (
    <button
      style={{ ...base, ...variants[variant], ...extraStyle }}
      onPointerDown={() => { setPressed(true); onClick() }}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
    >
      {children}
    </button>
  )
}

// Toast
let toastTimer: ReturnType<typeof setTimeout> | null = null

export default function Remote() {
  const [power, setPowerState] = useState<string>('...')
  const [vol, setVol] = useState(0)
  const [muted, setMutedState] = useState(false)
  const [toast, setToast] = useState('')
  const [toastVisible, setToastVisible] = useState(false)
  const [apps, setApps] = useState(APPS_DEFAULT)
  const [appsLoaded, setAppsLoaded] = useState(false)
  const [screenshots, setScreenshots] = useState<string[]>([])
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [shootLoading, setShootLoading] = useState(false)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setToastVisible(true)
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => setToastVisible(false), 1400)
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const data = await getStatus()
      if (data.power?.powerstate) setPowerState(data.power.powerstate)
      if (data.volume?.current !== undefined) setVol(data.volume.current)
      if (data.volume?.muted !== undefined) setMutedState(data.volume.muted)
    } catch {}
  }, [])

  useEffect(() => {
    refreshStatus()
    const id = setInterval(refreshStatus, 10000)
    return () => clearInterval(id)
  }, [refreshStatus])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  async function handleKey(key: string) {
    showToast(key)
    await sendKey(key)
  }

  async function handlePower(state: 'On' | 'Standby') {
    showToast('Power ' + state)
    await setPower(state)
    setTimeout(refreshStatus, 2000)
  }

  async function changeVol(delta: number) {
    const next = Math.max(0, Math.min(60, vol + delta))
    setVol(next)
    await setVolume(next)
  }

  async function toggleMute() {
    const next = !muted
    setMutedState(next)
    await setMuted(next)
  }

  async function handleLoadApps() {
    showToast('Загрузка...')
    const data = await getApps()
    if (data?.applications) {
      const sorted = [...data.applications].sort((a: { label: string }, b: { label: string }) =>
        a.label.localeCompare(b.label)
      )
      setApps(sorted.map((a: { label: string; intent: { component: { packageName: string; className: string } } }) => ({
        label: a.label,
        packageName: a.intent.component.packageName,
        className: a.intent.component.className,
      })))
      setAppsLoaded(true)
    }
  }

  async function handleLaunch(pkg: string, cls: string) {
    showToast('Запуск...')
    await launchApp(pkg, cls)
  }

  async function takeScreenshot() {
    setShootLoading(true)
    showToast('Снимаю...')
    const src = `/api/screenshot?t=${Date.now()}`
    // Preload
    const img = new Image()
    img.onload = () => {
      setScreenshots(prev => [src, ...prev].slice(0, 12))
      setShootLoading(false)
      showToast('Готово!')
    }
    img.onerror = () => {
      setShootLoading(false)
      showToast('Ошибка')
    }
    img.src = src
  }

  const isOn = power === 'On'

  return (
    <div style={{
      overflowY: 'auto',
      flex: 1,
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 12,
    }}>
      {/* Status */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontFamily: 'var(--mono)',
        fontSize: 11,
        color: 'var(--text-dim)',
        letterSpacing: '0.08em',
      }}>
        <span style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: isOn ? 'var(--accent)' : '#333',
          boxShadow: isOn ? '0 0 6px var(--accent)' : 'none',
          transition: 'all 0.3s',
        }} />
        <span style={{ color: isOn ? 'var(--accent)' : 'var(--text-dim)' }}>
          {power === '...' ? 'LOADING' : power.toUpperCase()}
        </span>
        <span style={{ color: 'var(--border-bright)' }}>|</span>
        <span>VOL {vol}</span>
        {muted && <span style={{ color: 'var(--danger)', fontSize: 10 }}>MUTED</span>}
      </div>

      <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Power */}
        <Card title="Power">
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <RcBtn
              variant="accent"
              onClick={() => handlePower('On')}
              style={{ width: 72, height: 48, fontSize: 18, borderRadius: '24px' }}
            >
              ⏻
            </RcBtn>
            <RcBtn
              variant="ghost"
              onClick={() => handlePower('Standby')}
              style={{ width: 72, height: 48, fontSize: 18, borderRadius: '24px' }}
            >
              ⏻
            </RcBtn>
          </div>
        </Card>

        {/* Navigation D-pad */}
        <Card title="Navigation">
          <div style={{
            display: 'grid',
            gridTemplateColumns: '52px 52px 52px',
            gridTemplateRows: '52px 52px 52px',
            gap: 5,
            justifyContent: 'center',
          }}>
            <div />
            <RcBtn onClick={() => handleKey('CursorUp')} style={{ height: '100%', fontSize: 16 }}>▲</RcBtn>
            <div />
            <RcBtn onClick={() => handleKey('CursorLeft')} style={{ height: '100%', fontSize: 16 }}>◀</RcBtn>
            <RcBtn
              variant="accent"
              onClick={() => handleKey('Confirm')}
              style={{
                height: '100%',
                borderRadius: '50%',
                fontFamily: 'var(--mono)',
                fontWeight: 700,
                fontSize: 11,
                letterSpacing: '0.08em',
              }}
            >
              OK
            </RcBtn>
            <RcBtn onClick={() => handleKey('CursorRight')} style={{ height: '100%', fontSize: 16 }}>▶</RcBtn>
            <div />
            <RcBtn onClick={() => handleKey('CursorDown')} style={{ height: '100%', fontSize: 16 }}>▼</RcBtn>
            <div />
          </div>
        </Card>

        {/* Volume */}
        <Card title="Volume">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
            <RcBtn onClick={() => changeVol(-3)} style={{ width: 48, height: 48, fontSize: 20, borderRadius: '50%' }}>−</RcBtn>
            <div style={{
              fontFamily: 'var(--mono)',
              fontSize: 22,
              color: 'var(--text-bright)',
              minWidth: 44,
              textAlign: 'center',
              letterSpacing: '0.04em',
            }}>
              {vol}
            </div>
            <RcBtn onClick={() => changeVol(3)} style={{ width: 48, height: 48, fontSize: 20, borderRadius: '50%' }}>+</RcBtn>
            <RcBtn
              variant={muted ? 'danger' : 'ghost'}
              onClick={toggleMute}
              style={{ width: 48, height: 48, fontSize: 16, borderRadius: '50%', marginLeft: 4 }}
            >
              {muted ? '🔇' : '🔊'}
            </RcBtn>
          </div>
        </Card>

        {/* Media */}
        <Card title="Media">
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
            {[
              { key: 'Rewind', icon: '⏪' },
              { key: 'Play', icon: '▶' },
              { key: 'Pause', icon: '⏸' },
              { key: 'Stop', icon: '⏹' },
              { key: 'FastForward', icon: '⏩' },
            ].map(({ key, icon }) => (
              <RcBtn key={key} onClick={() => handleKey(key)} style={{ width: 52, height: 44, fontSize: 15 }}>
                {icon}
              </RcBtn>
            ))}
          </div>
        </Card>

        {/* Extra keys */}
        <Card title="Controls">
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
            {[
              { key: 'Back', label: '← Back' },
              { key: 'Home', label: '⌂ Home' },
              { key: 'Options', label: '☰ Menu' },
              { key: 'Find', label: '⌕ Search' },
            ].map(({ key, label }) => (
              <RcBtn key={key} onClick={() => handleKey(key)} style={{ padding: '10px 14px', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.06em' }}>
                {label}
              </RcBtn>
            ))}
          </div>
        </Card>

        {/* Screenshot */}
        <Card title="Screenshot">
          <div style={{ textAlign: 'center', marginBottom: screenshots.length > 0 ? 10 : 0 }}>
            <RcBtn
              variant="accent"
              onClick={takeScreenshot}
              style={{ padding: '10px 24px', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.08em', opacity: shootLoading ? 0.6 : 1 }}
            >
              {shootLoading ? '◌ Снимаю...' : '📷 Сделать скриншот'}
            </RcBtn>
          </div>
          {screenshots.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 10 }}>
              {screenshots.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt=""
                  onClick={() => setLightbox(src)}
                  style={{
                    width: '100%',
                    aspectRatio: '16/9',
                    objectFit: 'cover',
                    borderRadius: 'var(--radius)',
                    cursor: 'zoom-in',
                    border: '1px solid var(--border)',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                />
              ))}
            </div>
          )}
        </Card>

        {/* Apps */}
        <Card title="Apps">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7, marginBottom: appsLoaded ? 0 : 8 }}>
            {apps.map((app, i) => (
              <button
                key={i}
                onClick={() => handleLaunch(app.packageName, app.className)}
                style={{
                  padding: '10px 6px',
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  color: 'var(--text)',
                  fontSize: 11,
                  fontFamily: 'var(--sans)',
                  cursor: 'pointer',
                  textAlign: 'center',
                  lineHeight: 1.3,
                  transition: 'all 0.15s',
                  wordBreak: 'break-word',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--border-bright)'
                  e.currentTarget.style.color = 'var(--text-bright)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--border)'
                  e.currentTarget.style.color = 'var(--text)'
                }}
                onPointerDown={e => e.currentTarget.style.background = 'var(--bg3)'}
                onPointerUp={e => e.currentTarget.style.background = 'var(--bg)'}
              >
                {app.label}
              </button>
            ))}
          </div>
          {!appsLoaded && (
            <RcBtn
              onClick={handleLoadApps}
              style={{ width: '100%', padding: '9px', fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em', marginTop: 4 }}
            >
              ⊕ Загрузить все приложения
            </RcBtn>
          )}
        </Card>

      </div>

      {/* Toast */}
      <div style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--bg3)',
        border: '1px solid var(--border-bright)',
        color: 'var(--text)',
        padding: '7px 20px',
        borderRadius: '20px',
        fontFamily: 'var(--mono)',
        fontSize: 11,
        letterSpacing: '0.06em',
        opacity: toastVisible ? 1 : 0,
        transition: 'opacity 0.25s ease',
        pointerEvents: 'none',
        zIndex: 100,
        whiteSpace: 'nowrap',
      }}>
        {toast}
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
    </div>
  )
}

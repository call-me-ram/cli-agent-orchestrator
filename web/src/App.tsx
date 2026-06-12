import { useEffect, useState, Suspense } from 'react'
import { useStore } from './store'
import { ErrorBoundary } from './components/ErrorBoundary'
import { DashboardHome } from './components/DashboardHome'
import { AgentPanel } from './components/AgentPanel'
import { FlowsPanel } from './components/FlowsPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { Bot, Home, Clock, Settings, CheckCircle, XCircle, Info, Play, Terminal as TermIcon } from 'lucide-react'
import { RunBoard } from './components/RunBoard'

type TabKey = 'runs' | 'home' | 'agents' | 'flows' | 'settings'

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  // "Runs" is the non-technical front door; the rest is the advanced surface.
  { key: 'runs', label: 'Runs', icon: <Play size={16} /> },
  { key: 'home', label: 'Home', icon: <Home size={16} /> },
  { key: 'agents', label: 'Agents', icon: <Bot size={16} /> },
  { key: 'flows', label: 'Flows', icon: <Clock size={16} /> },
  { key: 'settings', label: 'Settings', icon: <Settings size={16} /> },
]

function Snackbar() {
  const { snackbar, hideSnackbar } = useStore()

  useEffect(() => {
    if (snackbar) {
      const timer = setTimeout(hideSnackbar, 3000)
      return () => clearTimeout(timer)
    }
  }, [snackbar, hideSnackbar])

  if (!snackbar) return null

  const colors = {
    success: 'bg-emerald-600 border-emerald-500',
    error: 'bg-red-600 border-red-500',
    info: 'bg-blue-600 border-blue-500',
  }
  const icons = {
    success: <CheckCircle size={18} />,
    error: <XCircle size={18} />,
    info: <Info size={18} />,
  }

  return (
    <div role="alert" className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg border shadow-lg flex items-center gap-2 text-white ${colors[snackbar.type]}`}>
      {icons[snackbar.type]}
      <span className="text-sm">{snackbar.message}</span>
    </div>
  )
}

export default function App() {
  const [tab, setTab] = useState<TabKey>('runs')
  const { sessions, connected, fetchSessions, connectStatusStream } = useStore()

  useEffect(() => {
    fetchSessions()
    const interval = setInterval(fetchSessions, 10000)
    // Live terminal-status push over SSE (replaces per-terminal polling).
    const es = connectStatusStream()
    return () => {
      clearInterval(interval)
      es.close()
    }
  }, [])

  // Keyboard shortcuts: Alt+1-4
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key >= '1' && e.key <= String(TABS.length)) {
        e.preventDefault()
        setTab(TABS[parseInt(e.key) - 1].key)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="min-h-screen bg-[#0f0f14] text-gray-200">
      {/* App shell (§1.6): 56px nav — brand mark + tabs + LIVE indicator */}
      <header className="sticky top-0 z-40" style={{ background: 'var(--card)', borderBottom: '1px solid var(--border)', height: 56 }}>
        <div className="max-w-7xl mx-auto px-6 h-full flex items-center gap-6">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="flex items-center justify-center rounded-lg" style={{ width: 28, height: 28, background: 'var(--brand-deep)' }}>
              <TermIcon size={15} className="text-white" />
            </div>
            <span className="font-mono font-bold" style={{ fontSize: 15, color: 'var(--t1)' }}>cao</span>
          </div>
          <nav className="flex gap-1 flex-1" role="tablist">
            {TABS.map((t, i) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className="px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                style={tab === t.key
                  ? { background: 'var(--hover)', color: 'var(--t1)' }
                  : { color: 'var(--t3)' }}
                title={`Alt+${i + 1}`}
              >
                {t.icon}
                {t.label}
                {t.key === 'agents' && sessions.length > 0 && (
                  <span className="px-1.5 py-0.5 text-xs rounded-full" style={{ background: 'var(--hover)', color: 'var(--t2)' }}>
                    {sessions.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-1.5 shrink-0" title={connected ? 'Live updates connected' : 'Disconnected'}>
            <span className={`rounded-full ${connected ? 'pulse-dot' : ''}`}
              style={{ width: 7, height: 7, background: connected ? 'var(--brand)' : '#f87171' }} />
            <span className="microlabel" style={{ color: connected ? 'var(--brand)' : '#f87171' }}>
              {connected ? 'Live' : 'Offline'}
            </span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto" style={{ padding: '28px 26px' }}>
        <ErrorBoundary>
          <Suspense fallback={<div className="text-gray-500 text-sm py-12 text-center">Loading...</div>}>
            {tab === 'runs' && <RunBoard />}
            {tab === 'home' && <DashboardHome onNavigate={(t) => setTab(t as TabKey)} />}
            {tab === 'agents' && <AgentPanel />}
            {tab === 'flows' && <FlowsPanel />}
            {tab === 'settings' && <SettingsPanel />}
          </Suspense>
        </ErrorBoundary>
      </main>

      <Snackbar />
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { api, AgentProfileInfo, ProviderInfo } from '../api'
import { Bot, Play, Trash2, ChevronRight, Terminal as TermIcon, Monitor, Package, FolderOpen, Search, Mail, Plus, LogOut, Send, FileText, X } from 'lucide-react'
import { TerminalView } from './TerminalView'
import { ConfirmModal } from './ConfirmModal'
import { InboxPanel } from './InboxPanel'
import { CustomSelect, SelectOption } from './CustomSelect'
import { TerminalMeta } from '../api'
import { StatusBadge, statusStyle } from './StatusBadge'
import { SessionName } from './SessionName'
import { OutputViewer } from './OutputViewer'

export const FALLBACK_PROVIDERS = ['kiro_cli', 'claude_code', 'q_cli', 'codex', 'gemini_cli', 'hermes', 'kimi_cli', 'copilot_cli', 'opencode_cli']

const SOURCE_LABELS: Record<string, string> = {
  'built-in': 'Built-in',
  'local': 'Local',
  'kiro': 'Kiro',
  'q_cli': 'Q CLI',
  'opencode_cli': 'OpenCode',
}

export function AgentPanel() {
  const { sessions, fetchSessions, activeSession, activeSessionDetail, selectSession, createSession, deleteSession, terminalStatuses, setTerminalStatus } = useStore()
  const [provider, setProvider] = useState('kiro_cli')
  const [profile, setProfile] = useState('')
  const [creating, setCreating] = useState(false)
  const [liveTerminal, setLiveTerminal] = useState<{ id: string; provider?: string; agentProfile?: string | null; model?: string | null } | null>(null)
  const [profiles, setProfiles] = useState<AgentProfileInfo[]>([])
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [providers, setProviders] = useState<ProviderInfo[]>([])

  useEffect(() => {
    api.listProviders()
      .then(p => {
        setProviders(p)
        // Default to first installed provider
        const firstInstalled = p.find(prov => prov.installed)
        if (firstInstalled) setProvider(firstInstalled.name)
      })
      .catch(() => {})
  }, [])
  const [pendingClose, setPendingClose] = useState<TerminalMeta | null>(null)
  const [closingTerminal, setClosingTerminal] = useState<string | null>(null)
  const [sessionSearch, setSessionSearch] = useState('')
  const [inboxTerminalId, setInboxTerminalId] = useState<string | null>(null)
  const [workingDirectory, setWorkingDirectory] = useState('')
  const [terminalWorkDirs, setTerminalWorkDirs] = useState<Record<string, string | null>>({})
  const [showAddAgent, setShowAddAgent] = useState(false)
  const [addProvider, setAddProvider] = useState('kiro_cli')
  const [addProfile, setAddProfile] = useState('')
  const [addWorkDir, setAddWorkDir] = useState('')
  const [addingAgent, setAddingAgent] = useState(false)
  const [pendingExit, setPendingExit] = useState<TerminalMeta | null>(null)
  const [exitingTerminal, setExitingTerminal] = useState<string | null>(null)
  const [sendInputOpen, setSendInputOpen] = useState<Record<string, boolean>>({})
  const [sendInputValues, setSendInputValues] = useState<Record<string, string>>({})
  const [sendingInput, setSendingInput] = useState<string | null>(null)
  const { showSnackbar } = useStore()
  const [outputTerminalId, setOutputTerminalId] = useState<string | null>(null)
  const [showSpawnModal, setShowSpawnModal] = useState(false)
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null)

  // Default the terminal tab to the first terminal whenever the session
  // (or its roster) changes; keep the selection if it still exists.
  useEffect(() => {
    const ids = activeSessionDetail?.terminals.map(t => t.id) || []
    if (!ids.length) { setSelectedTerminalId(null); return }
    if (!selectedTerminalId || !ids.includes(selectedTerminalId)) setSelectedTerminalId(ids[0])
  }, [activeSessionDetail?.terminals.map(t => t.id).join(',')])

  const handleDeleteTerminal = async () => {
    if (!pendingClose) return
    const id = pendingClose.id
    setClosingTerminal(id)
    try {
      await api.deleteTerminal(id)
      if (liveTerminal?.id === id) setLiveTerminal(null)
      if (activeSession) await selectSession(activeSession)
      showSnackbar({ type: 'success', message: `Terminal ${id} closed — tmux window killed` })
    } catch {
      showSnackbar({ type: 'error', message: `Failed to close terminal ${id}` })
    }
    setClosingTerminal(null)
    setPendingClose(null)
  }

  const handleExitTerminal = async () => {
    if (!pendingExit) return
    const id = pendingExit.id
    setExitingTerminal(id)
    try {
      await api.exitTerminal(id)
      if (activeSession) await selectSession(activeSession)
      showSnackbar({ type: 'success', message: `Graceful exit sent to terminal ${id}` })
    } catch {
      showSnackbar({ type: 'error', message: `Failed to send exit to terminal ${id}` })
    }
    setExitingTerminal(null)
    setPendingExit(null)
  }

  const handleSendInput = async (terminalId: string) => {
    const message = (sendInputValues[terminalId] || '').trim()
    if (!message) return
    setSendingInput(terminalId)
    try {
      await api.sendInput(terminalId, message)
      setSendInputValues(prev => ({ ...prev, [terminalId]: '' }))
      showSnackbar({ type: 'success', message: `Message sent to terminal ${terminalId}` })
    } catch {
      showSnackbar({ type: 'error', message: `Failed to send message to terminal ${terminalId}` })
    }
    setSendingInput(null)
  }

  useEffect(() => {
    api.listProfiles()
      .then(p => { setProfiles(p); setLoadingProfiles(false) })
      .catch(() => setLoadingProfiles(false))
  }, [])

  useEffect(() => {
    if (activeSession) {
      selectSession(activeSession)
      const interval = setInterval(() => selectSession(activeSession), 5000)
      return () => clearInterval(interval)
    }
  }, [activeSession])

  // One-shot status snapshot for visible terminals; live updates arrive via
  // the SSE status stream (store.connectStatusStream), so no polling here.
  useEffect(() => {
    if (!activeSessionDetail?.terminals.length) return
    activeSessionDetail.terminals.forEach(t => {
      api.getTerminalStatus(t.id)
        .then(status => { if (status) setTerminalStatus(t.id, status) })
        .catch(() => {})
    })
  }, [activeSessionDetail?.terminals.map(t => t.id).join(',')])

  const handleCreate = async () => {
    if (!profile.trim()) return
    setCreating(true)
    await createSession(provider, profile.trim(), workingDirectory.trim() || undefined)
    setCreating(false)
    setShowSpawnModal(false)
    setProfile('')
    setWorkingDirectory('')
  }

  const openTerminal = (terminalId: string, provider?: string, agentProfile?: string | null, model?: string | null) => {
    setLiveTerminal({ id: terminalId, provider, agentProfile, model })
  }

  // Fetch working directories for terminals in session detail
  useEffect(() => {
    if (!activeSessionDetail?.terminals.length) return
    activeSessionDetail.terminals.forEach(t => {
      if (terminalWorkDirs[t.id] === undefined) {
        api.getWorkingDirectory(t.id)
          .then(res => setTerminalWorkDirs(prev => ({ ...prev, [t.id]: res.working_directory })))
          .catch(() => setTerminalWorkDirs(prev => ({ ...prev, [t.id]: null })))
      }
    })
  }, [activeSessionDetail?.terminals.map(t => t.id).join(',')])

  const handleAddAgent = async () => {
    if (!addProfile.trim() || !activeSession) return
    setAddingAgent(true)
    try {
      await api.addTerminalToSession(activeSession, addProvider, addProfile.trim(), addWorkDir.trim() || undefined)
      showSnackbar({ type: 'success', message: 'Agent added to session' })
      setShowAddAgent(false)
      setAddProfile('')
      setAddWorkDir('')
      if (activeSession) await selectSession(activeSession)
    } catch (e: any) {
      showSnackbar({ type: 'error', message: e.message || 'Failed to add agent' })
    }
    setAddingAgent(false)
  }

  // Group profiles by source
  const profilesBySource = profiles.reduce<Record<string, AgentProfileInfo[]>>((acc, p) => {
    const key = p.source || 'unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(p)
    return acc
  }, {})

  return (
    <div className="space-y-5">
      {/* Page header (§1.6): one primary action */}
      <div className="flex items-center justify-between">
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--t1)' }}>Agents</h1>
          <p style={{ fontSize: 13, color: 'var(--t3)' }}>
            Sessions are workspaces where agents collaborate over messages.
          </p>
        </div>
        <button
          onClick={() => setShowSpawnModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-white font-medium"
          style={{ background: 'var(--brand-deep)', fontSize: 13.5 }}
        >
          <Plus size={14} /> Spawn Agent
        </button>
      </div>

      {/* Master-detail (§4): session rail + terminal detail */}
      <div className="grid gap-4" style={{ gridTemplateColumns: '248px 1fr' }}>
        {/* rail */}
        <div className="rounded-xl self-start" style={{ background: 'var(--card)', border: '1px solid var(--border)', padding: 8 }}>
          <div className="microlabel" style={{ padding: '6px 10px' }}>Sessions</div>
          {sessions.length > 3 && (
            <div className="relative px-1.5 pb-1.5">
              <Search size={12} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--t4)' }} />
              <input
                type="text"
                value={sessionSearch}
                onChange={e => setSessionSearch(e.target.value)}
                placeholder="Filter…"
                className="w-full rounded-lg pl-7 pr-2 py-1.5 outline-none"
                style={{ background: 'var(--page)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--t1)' }}
              />
            </div>
          )}
          {sessions.length === 0 && (
            <p style={{ fontSize: 12.5, color: 'var(--t4)', padding: '6px 10px 10px' }}>
              No sessions. Spawn an agent to create one.
            </p>
          )}
          {sessions
            .filter(s => !sessionSearch || s.id.includes(sessionSearch) || (s.label || '').toLowerCase().includes(sessionSearch.toLowerCase()))
            .map(s => {
              const isActive = activeSession === s.id
              const count = isActive ? activeSessionDetail?.terminals.length : undefined
              return (
                <div
                  key={s.id}
                  onClick={() => selectSession(isActive ? null : s.id)}
                  className="flex items-center gap-2 rounded-lg cursor-pointer transition-colors"
                  style={{ padding: '8px 10px', background: isActive ? 'var(--hover)' : 'transparent' }}
                >
                  <span className="rounded-full shrink-0" style={{ width: 7, height: 7, background: isActive ? 'var(--emerald, #34d399)' : 'var(--t4)' }} />
                  <SessionName name={s.id} label={s.label} className="font-mono flex-1" />
                  {count !== undefined && <span style={{ fontSize: 11, color: 'var(--t4)' }}>{count}t</span>}
                  <ChevronRight size={13} className={isActive ? 'rotate-90' : ''} style={{ color: 'var(--t4)', transition: 'transform .15s' }} />
                </div>
              )
            })}
        </div>

        {/* detail */}
        {activeSessionDetail ? (
          <div className="rounded-xl min-w-0" style={{ background: 'var(--card)', border: '1px solid var(--border)', padding: 16 }}>
            {/* header */}
            <div className="flex items-center gap-3 flex-wrap mb-3">
              <SessionName name={activeSession || ''} label={sessions.find(s => s.id === activeSession)?.label} className="font-mono font-semibold text-sm" />
              <span style={{ fontSize: 12, color: 'var(--t3)' }}>
                {activeSessionDetail.terminals.length} terminal{activeSessionDetail.terminals.length !== 1 ? 's' : ''}
              </span>
              <span className="flex-1" />
              <button
                onClick={() => setShowAddAgent(!showAddAgent)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors"
                style={{ border: '1px dashed var(--border)', fontSize: 12, color: 'var(--t2)' }}
                title="Add another agent to this session"
              >
                <Plus size={13} /> Add Agent
              </button>
              <button
                onClick={() => activeSession && deleteSession(activeSession)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                style={{ background: 'rgba(248,113,113,.08)', fontSize: 12, color: '#f87171' }}
                title="End this session (kills every terminal in it)"
              >
                <Trash2 size={13} /> End Session
              </button>
            </div>

            {/* add-agent inline form (unchanged behavior) */}
            {showAddAgent && (
              <div className="mb-4 p-4 rounded-lg space-y-3" style={{ background: 'var(--page)', border: '1px solid var(--border)' }}>
                <p style={{ fontSize: 12, color: 'var(--t3)' }}>
                  Agents in the same session can message each other; a supervisor can delegate to agents you add here.
                </p>
                <div className="flex gap-3 items-end flex-wrap">
                  <div className="min-w-[160px]">
                    <label className="microlabel block mb-1">Provider</label>
                    <CustomSelect
                      value={addProvider}
                      onChange={setAddProvider}
                      placeholder="Select provider..."
                      options={(providers.length > 0 ? providers : FALLBACK_PROVIDERS.map(n => ({ name: n, binary: '', installed: true }))).map(p => ({
                        value: p.name,
                        label: p.name.replace(/_/g, ' '),
                        sublabel: !p.installed ? 'Not installed' : undefined,
                        disabled: !p.installed,
                      }))}
                    />
                  </div>
                  <div className="flex-1 min-w-[180px]">
                    <label className="microlabel block mb-1">Agent Profile</label>
                    {profiles.length > 0 ? (
                      <CustomSelect
                        value={addProfile}
                        onChange={setAddProfile}
                        placeholder="Select a profile..."
                        options={profiles.map(p => ({
                          value: p.name,
                          label: p.name,
                          sublabel: p.description || undefined,
                          group: SOURCE_LABELS[p.source] || p.source,
                        }))}
                      />
                    ) : (
                      <input
                        type="text"
                        value={addProfile}
                        onChange={e => setAddProfile(e.target.value)}
                        placeholder="e.g. developer, reviewer"
                        className="w-full rounded-lg px-3 py-2.5 outline-none"
                        style={{ background: 'var(--card)', border: '1px solid var(--border)', fontSize: 13, color: 'var(--t1)' }}
                      />
                    )}
                  </div>
                  <button
                    onClick={handleAddAgent}
                    disabled={!addProfile.trim() || addingAgent}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-white font-medium disabled:opacity-40"
                    style={{ background: 'var(--brand-deep)', fontSize: 12 }}
                  >
                    <Plus size={14} /> {addingAgent ? 'Adding...' : 'Add'}
                  </button>
                </div>
                <div>
                  <label className="microlabel block mb-1">Working Directory</label>
                  <div className="relative">
                    <FolderOpen size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--t4)' }} />
                    <input
                      type="text"
                      value={addWorkDir}
                      onChange={e => setAddWorkDir(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddAgent()}
                      placeholder="/path/to/project (optional)"
                      className="w-full font-mono rounded-lg pl-9 pr-3 py-2 outline-none"
                      style={{ background: 'var(--card)', border: '1px solid var(--border)', fontSize: 13, color: 'var(--t1)' }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* terminal tab strip (§4.2) */}
            <div className="flex gap-1.5 flex-wrap mb-3">
              {activeSessionDetail.terminals.map(t => {
                const cfg = statusStyle(terminalStatuses[t.id] || null)
                const isSel = selectedTerminalId === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTerminalId(t.id)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono"
                    style={{
                      fontSize: 12,
                      color: isSel ? 'var(--t1)' : 'var(--t3)',
                      background: isSel ? 'var(--hover)' : 'transparent',
                      border: `1px solid ${isSel ? 'var(--border)' : 'transparent'}`,
                    }}
                  >
                    <span className={`rounded-full ${cfg.pulse ? 'pulse-dot' : ''}`} style={{ width: 6, height: 6, background: cfg.hex }} />
                    {t.id}
                  </button>
                )
              })}
            </div>

            {/* live terminal preview pane (§4.2) */}
            {selectedTerminalId && (
              <div style={{ height: 420 }} className="mb-3">
                <TerminalView
                  key={selectedTerminalId}
                  inline
                  terminalId={selectedTerminalId}
                  provider={activeSessionDetail.terminals.find(t => t.id === selectedTerminalId)?.provider}
                  agentProfile={activeSessionDetail.terminals.find(t => t.id === selectedTerminalId)?.agent_profile}
                  model={activeSessionDetail.terminals.find(t => t.id === selectedTerminalId)?.model}
                  onClose={() => openTerminal(
                    selectedTerminalId,
                    activeSessionDetail.terminals.find(t => t.id === selectedTerminalId)?.provider,
                    activeSessionDetail.terminals.find(t => t.id === selectedTerminalId)?.agent_profile,
                    activeSessionDetail.terminals.find(t => t.id === selectedTerminalId)?.model,
                  )}
                />
              </div>
            )}

            {/* footer row for the selected terminal (§4.2) */}
            {selectedTerminalId && (() => {
              const t = activeSessionDetail.terminals.find(x => x.id === selectedTerminalId)
              if (!t) return null
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ background: 'var(--hover)', fontSize: 11.5, color: 'var(--t2)' }}>
                      <Bot size={12} /> {t.agent_profile || 'agent'}
                    </span>
                    <StatusBadge status={terminalStatuses[t.id] || null} technical />
                    <span style={{ fontSize: 11.5, color: 'var(--t3)' }}>{t.provider}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--t4)' }}>{t.model || 'default model'}</span>
                    {terminalWorkDirs[t.id] && (
                      <span className="flex items-center gap-1 font-mono truncate max-w-[320px]" style={{ fontSize: 11, color: 'var(--t4)' }} title={terminalWorkDirs[t.id]!}>
                        <FolderOpen size={11} /> {terminalWorkDirs[t.id]}
                      </span>
                    )}
                    <span className="flex-1" />
                    <button onClick={() => setOutputTerminalId(t.id)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{ fontSize: 12, color: 'var(--t2)', border: '1px solid var(--border)' }}>
                      <FileText size={12} /> Output
                    </button>
                    <button onClick={() => setInboxTerminalId(t.id)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{ fontSize: 12, color: 'var(--t2)', border: '1px solid var(--border)' }}>
                      <Mail size={12} /> Inbox
                    </button>
                    <button onClick={() => setPendingExit(t as TerminalMeta)} disabled={exitingTerminal === t.id}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg disabled:opacity-40" style={{ fontSize: 12, color: '#f87171', background: 'rgba(248,113,113,.08)' }}>
                      <LogOut size={12} /> {exitingTerminal === t.id ? 'Exiting…' : 'Graceful Exit'}
                    </button>
                    <button onClick={() => setPendingClose(t as TerminalMeta)} disabled={closingTerminal === t.id}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg disabled:opacity-40" style={{ fontSize: 12, color: '#f87171', background: 'rgba(248,113,113,.08)' }}>
                      <Trash2 size={12} /> {closingTerminal === t.id ? 'Closing…' : 'Close'}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={sendInputValues[t.id] || ''}
                      onChange={e => setSendInputValues(prev => ({ ...prev, [t.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') handleSendInput(t.id) }}
                      placeholder="Message this agent…"
                      className="flex-1 font-mono rounded-lg px-3 py-1.5 outline-none"
                      style={{ background: 'var(--page)', border: '1px solid var(--border)', fontSize: 13, color: 'var(--t1)' }}
                    />
                    <button
                      onClick={() => handleSendInput(t.id)}
                      disabled={sendingInput === t.id || !(sendInputValues[t.id] || '').trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white disabled:opacity-40"
                      style={{ background: 'var(--brand-deep)', fontSize: 12 }}
                    >
                      <Send size={12} /> {sendingInput === t.id ? 'Sending…' : 'Send'}
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        ) : (
          <div className="rounded-xl flex items-center justify-center" style={{ border: '1px dashed var(--border)', minHeight: 220 }}>
            <p style={{ fontSize: 13, color: 'var(--t4)' }}>Select a session to see its terminals.</p>
          </div>
        )}
      </div>

      {/* Inbox Panel */}
      {inboxTerminalId && (
        <InboxPanel terminalId={inboxTerminalId} onClose={() => setInboxTerminalId(null)} />
      )}

      {/* Live Terminal */}
      {liveTerminal && (
        <TerminalView
          terminalId={liveTerminal.id}
          provider={liveTerminal.provider}
          agentProfile={liveTerminal.agentProfile}
          model={liveTerminal.model}
          onClose={() => setLiveTerminal(null)}
        />
      )}

      {/* Output Viewer Modal */}
      {outputTerminalId && (
        <OutputViewer
          terminalId={outputTerminalId}
          onClose={() => setOutputTerminalId(null)}
        />
      )}

      {/* Close Confirmation Modal */}
      <ConfirmModal
        open={!!pendingClose}
        title="Close Terminal"
        message="This will kill the tmux window and terminate the agent process. This action cannot be undone."
        details={pendingClose ? [
          { label: 'Terminal ID', value: pendingClose.id },
          { label: 'Provider', value: pendingClose.provider },
          { label: 'Profile', value: pendingClose.agent_profile || 'none' },
          { label: 'Session', value: pendingClose.tmux_session },
        ] : []}
        confirmLabel="Close Terminal"
        variant="danger"
        loading={!!closingTerminal}
        onConfirm={handleDeleteTerminal}
        onCancel={() => setPendingClose(null)}
      />

      {/* Graceful Exit Confirmation Modal */}
      <ConfirmModal
        open={!!pendingExit}
        title="Graceful Exit"
        message="This will send the provider-specific exit command (e.g., /exit). The agent will shut down gracefully."
        details={pendingExit ? [
          { label: 'Terminal ID', value: pendingExit.id },
          { label: 'Provider', value: pendingExit.provider },
          { label: 'Profile', value: pendingExit.agent_profile || 'none' },
          { label: 'Session', value: pendingExit.tmux_session },
        ] : []}
        confirmLabel="Send Exit"
        variant="warning"
        loading={!!exitingTerminal}
        onConfirm={handleExitTerminal}
        onCancel={() => setPendingExit(null)}
      />

      {/* Spawn Agent Modal */}
      {showSpawnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowSpawnModal(false)} />
          <div className="relative bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl shadow-black/50 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            {/* Modal header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-700/50">
              <div>
                <h3 className="text-base font-semibold text-gray-200">Spawn Agent</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Launch a new AI agent in its own isolated tmux session.
                </p>
              </div>
              <button
                onClick={() => setShowSpawnModal(false)}
                className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors rounded-lg hover:bg-gray-700/50"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Provider</label>
                <CustomSelect
                  value={provider}
                  onChange={setProvider}
                  placeholder="Select provider..."
                  options={(providers.length > 0 ? providers : FALLBACK_PROVIDERS.map(n => ({ name: n, binary: '', installed: true }))).map(p => ({
                    value: p.name,
                    label: p.name.replace(/_/g, ' '),
                    sublabel: !p.installed ? 'Not installed' : undefined,
                    disabled: !p.installed,
                  }))}
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Agent Profile</label>
                {loadingProfiles ? (
                  <div className="bg-gray-900 border border-gray-700 text-gray-500 text-sm rounded-lg px-3 py-2.5">Loading profiles...</div>
                ) : profiles.length > 0 ? (
                  <CustomSelect
                    value={profile}
                    onChange={setProfile}
                    placeholder="Select a profile..."
                    options={profiles.map(p => ({
                      value: p.name,
                      label: p.name,
                      sublabel: p.description || undefined,
                      group: SOURCE_LABELS[p.source] || p.source,
                    }))}
                  />
                ) : (
                  <input
                    type="text"
                    value={profile}
                    onChange={e => setProfile(e.target.value)}
                    placeholder="e.g. developer, reviewer"
                    className="w-full bg-gray-900 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2.5 focus:border-emerald-500 focus:outline-none"
                  />
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Working Directory <span className="text-gray-600">(optional)</span></label>
                <div className="relative">
                  <FolderOpen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    value={workingDirectory}
                    onChange={e => setWorkingDirectory(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreate()}
                    placeholder="/path/to/project (defaults to home)"
                    className="w-full bg-gray-900 border border-gray-700 text-gray-200 text-sm font-mono rounded-lg pl-9 pr-3 py-2.5 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Quick-pick profiles */}
              {profiles.length > 0 && (
                <div>
                  <label className="block text-xs text-gray-500 mb-2">Quick pick</label>
                  <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
                    {profiles.slice(0, 12).map(p => (
                      <button
                        key={`${p.source}-${p.name}`}
                        onClick={() => setProfile(p.name)}
                        className={`text-left px-2.5 py-2 rounded-lg border text-xs transition-all ${
                          profile === p.name
                            ? 'bg-emerald-900/30 border-emerald-700/50 text-emerald-300'
                            : 'bg-gray-900/50 border-gray-700/30 hover:bg-gray-800/80 text-gray-300'
                        }`}
                      >
                        <span className="font-medium">{p.name}</span>
                        <span className="text-[10px] text-gray-600 ml-1.5">{SOURCE_LABELS[p.source] || p.source}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-700/50">
              <button
                onClick={() => setShowSpawnModal(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!profile.trim() || creating}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
              >
                <Play size={14} />
                {creating ? 'Spawning...' : 'Spawn Agent'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { api, Flow, AgentProfileInfo, ProviderInfo } from '../api'
import { useStore } from '../store'
import { ConfirmModal } from './ConfirmModal'
import { Clock, Play, Trash2, Plus, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react'
import { CustomSelect } from './CustomSelect'

const SCHEDULE_PRESETS = [
  { label: 'Every 5 minutes', cron: '*/5 * * * *' },
  { label: 'Every 15 minutes', cron: '*/15 * * * *' },
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Daily at 9 AM', cron: '0 9 * * *' },
  { label: 'Weekdays at 9 AM', cron: '0 9 * * 1-5' },
  { label: 'Weekly (Monday 9 AM)', cron: '0 9 * * 1' },
  { label: 'Monthly (1st at midnight)', cron: '0 0 1 * *' },
]

const CUSTOM_CRON_VALUE = '__custom__'

function relUntil(iso: string): string {
  const t = new Date(iso).getTime()
  if (isNaN(t)) return '—'
  const mins = Math.round((t - Date.now()) / 60_000)
  if (mins <= 0) return 'due now'
  if (mins < 60) return `in ${mins} m`
  const h = Math.floor(mins / 60)
  return h < 48 ? `in ${h} h ${mins % 60} m` : `in ${Math.floor(h / 24)} d`
}

function cronToLabel(cron: string): string {
  return SCHEDULE_PRESETS.find(p => p.cron === cron)?.label || cron
}

export function FlowsPanel() {
  const { showSnackbar } = useStore()

  // Flow list state
  const [flows, setFlows] = useState<Flow[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [togglingFlow, setTogglingFlow] = useState<string | null>(null)
  const [runningFlow, setRunningFlow] = useState<string | null>(null)

  // Delete confirmation state
  const [pendingDelete, setPendingDelete] = useState<Flow | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState('')
  const [scheduleMode, setScheduleMode] = useState<'preset' | 'custom'>('preset')
  const [agentProfile, setAgentProfile] = useState('')
  const [provider, setProvider] = useState('')
  const [promptTemplate, setPromptTemplate] = useState('')
  const [creating, setCreating] = useState(false)

  // Profiles & providers for dropdowns
  const [profiles, setProfiles] = useState<AgentProfileInfo[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])

  const fetchFlows = async () => {
    try {
      const data = await api.listFlows()
      setFlows(data)
    } catch {
      setFlows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchFlows()
    api.listProfiles()
      .then(p => setProfiles(p))
      .catch(() => {})
    api.listProviders()
      .then(p => {
        setProviders(p)
        const firstInstalled = p.find(prov => prov.installed)
        if (firstInstalled) setProvider(firstInstalled.name)
      })
      .catch(() => {})
  }, [])

  const resetForm = () => {
    setName('')
    setSchedule('')
    setScheduleMode('preset')
    setAgentProfile('')
    setPromptTemplate('')
  }

  const handleCreate = async () => {
    if (!name.trim() || !schedule.trim() || !agentProfile.trim() || !promptTemplate.trim()) return
    setCreating(true)
    try {
      await api.createFlow({
        name: name.trim(),
        schedule: schedule.trim(),
        agent_profile: agentProfile.trim(),
        provider: provider || undefined,
        prompt_template: promptTemplate,
      })
      showSnackbar({ type: 'success', message: `Flow "${name.trim()}" created` })
      resetForm()
      setShowCreateModal(false)
      await fetchFlows()
    } catch (e: any) {
      showSnackbar({ type: 'error', message: e.message || 'Failed to create flow' })
    } finally {
      setCreating(false)
    }
  }

  const handleToggle = async (flow: Flow) => {
    setTogglingFlow(flow.name)
    try {
      if (flow.enabled) {
        await api.disableFlow(flow.name)
        showSnackbar({ type: 'success', message: `Flow "${flow.name}" disabled` })
      } else {
        await api.enableFlow(flow.name)
        showSnackbar({ type: 'success', message: `Flow "${flow.name}" enabled` })
      }
      await fetchFlows()
    } catch (e: any) {
      showSnackbar({ type: 'error', message: e.message || `Failed to toggle flow` })
    } finally {
      setTogglingFlow(null)
    }
  }

  const handleRun = async (flow: Flow) => {
    setRunningFlow(flow.name)
    try {
      await api.runFlow(flow.name)
      showSnackbar({ type: 'success', message: `Flow "${flow.name}" executed` })
      await fetchFlows()
    } catch (e: any) {
      showSnackbar({ type: 'error', message: e.message || `Failed to run flow` })
    } finally {
      setRunningFlow(null)
    }
  }

  const handleDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await api.deleteFlow(pendingDelete.name)
      showSnackbar({ type: 'success', message: `Flow "${pendingDelete.name}" deleted` })
      await fetchFlows()
    } catch (e: any) {
      showSnackbar({ type: 'error', message: e.message || 'Failed to delete flow' })
    } finally {
      setDeleting(false)
      setPendingDelete(null)
    }
  }

  if (loading) {
    return <div className="text-gray-500 text-sm py-8 text-center">Loading flows...</div>
  }

  const scheduleSelectOptions = [
    ...SCHEDULE_PRESETS.map(p => ({
      value: p.cron,
      label: p.label,
      sublabel: p.cron,
    })),
    { value: CUSTOM_CRON_VALUE, label: 'Custom cron expression', sublabel: 'Type your own schedule' },
  ]

  return (
    <div className="space-y-6">
      {/* Page header (§5.2) */}
      <div className="flex items-center justify-between">
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--t1)' }}>Flows</h1>
          <p style={{ fontSize: 13, color: 'var(--t3)' }}>
            {flows.length} scheduled run{flows.length !== 1 ? 's' : ''} · {flows.filter(f => f.enabled).length} enabled
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowCreateModal(true) }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-white font-medium"
          style={{ background: 'var(--brand-deep)', fontSize: 13.5 }}
        >
          <Plus size={14} /> New Flow
        </button>
      </div>

      <div>

        {flows.length === 0 ? (
          <div className="text-center py-8">
            <Clock size={32} className="mx-auto text-gray-600 mb-3" />
            <p className="text-gray-500 text-sm">No flows configured.</p>
            <p className="text-gray-600 text-xs mt-1">
              Click "Create Flow" above or use the CLI: <code className="text-emerald-400">cao flow add &lt;file.md&gt;</code>
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {flows.map(f => (
              <div key={f.name} className="rounded-xl"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', opacity: f.enabled ? 1 : 0.6 }}>
                {/* F1 card row (§5.1): toggle · identity · schedule · next · last · actions */}
                <div
                  className="flex items-center gap-4 cursor-pointer flex-wrap"
                  style={{ padding: '16px 20px' }}
                  onClick={() => setExpanded(expanded === f.name ? null : f.name)}
                >
                  {/* 1. enable toggle */}
                  <button
                    onClick={e => { e.stopPropagation(); handleToggle(f) }}
                    disabled={togglingFlow === f.name}
                    className="relative inline-flex items-center rounded-full transition-colors shrink-0"
                    style={{ height: 19, width: 34, background: f.enabled ? 'var(--brand-deep)' : '#4b5563' }}
                    title={f.enabled ? 'Disable flow' : 'Enable flow'}
                  >
                    {togglingFlow === f.name ? (
                      <Loader2 size={11} className="absolute left-1/2 -translate-x-1/2 animate-spin text-white" />
                    ) : (
                      <span className="inline-block rounded-full bg-white shadow transition-transform"
                        style={{ height: 13, width: 13, transform: f.enabled ? 'translateX(18px)' : 'translateX(3px)' }} />
                    )}
                  </button>

                  {/* 2. identity */}
                  <div className="min-w-[200px] flex-1">
                    <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--t1)' }}>{f.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--t3)' }}>
                      {f.agent_profile}{f.provider ? ` · ${f.provider}` : ''}
                    </div>
                  </div>

                  {/* 3. schedule */}
                  <div className="shrink-0">
                    <div className="microlabel">Schedule</div>
                    <div className="font-mono" style={{ fontSize: 12, color: 'var(--t2)' }} title={cronToLabel(f.schedule)}>{f.schedule}</div>
                  </div>

                  {/* 4. next run */}
                  <div className="shrink-0 min-w-[110px]">
                    <div className="microlabel">Next run</div>
                    <div className="flex items-center gap-1" style={{ fontSize: 12, color: 'var(--t2)' }}>
                      <Clock size={11} style={{ color: 'var(--t4)' }} />
                      {!f.enabled ? 'paused' : f.next_run ? relUntil(f.next_run) : '—'}
                    </div>
                  </div>

                  {/* 5. last run */}
                  <div className="shrink-0 min-w-[120px]">
                    <div className="microlabel">Last run</div>
                    <div style={{ fontSize: 12, color: 'var(--t4)' }}>
                      {f.last_run ? new Date(f.last_run).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'never'}
                    </div>
                  </div>

                  {/* 6. actions */}
                  <div className="flex items-center gap-2 shrink-0 ml-auto">
                    <button
                      onClick={e => { e.stopPropagation(); handleRun(f) }}
                      disabled={runningFlow === f.name}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg disabled:opacity-40 transition-colors"
                      style={{ fontSize: 12, color: 'var(--t2)', border: '1px solid var(--border)' }}
                      title="Run flow now"
                    >
                      {runningFlow === f.name ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                      {runningFlow === f.name ? 'Running…' : 'Run now'}
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); setPendingDelete(f) }}
                      className="p-1.5 rounded transition-colors"
                      style={{ color: 'var(--t4)' }}
                      title="Delete flow"
                    >
                      <Trash2 size={14} />
                    </button>
                    {expanded === f.name
                      ? <ChevronDown size={14} style={{ color: 'var(--t4)' }} />
                      : <ChevronRight size={14} style={{ color: 'var(--t4)' }} />}
                  </div>
                </div>

                {/* Expanded details */}
                {expanded === f.name && (
                  <div className="px-3 pb-3 text-xs text-gray-400 space-y-3 border-t border-gray-700/30 pt-3">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                      <div>Schedule: <span className="text-gray-300 font-mono">{f.schedule}</span></div>
                      <div>Provider: <span className="text-gray-300">{f.provider || 'default'}</span></div>
                      <div>Profile: <span className="text-gray-300">{f.agent_profile}</span></div>
                      <div>Last Run: <span className="text-gray-300">{f.last_run ? new Date(f.last_run).toLocaleString() : 'never'}</span></div>
                      <div>Next Run: <span className="text-gray-300">{f.next_run ? new Date(f.next_run).toLocaleString() : 'n/a'}</span></div>
                      {f.file_path && (
                        <div className="col-span-2">File: <span className="text-gray-300 font-mono">{f.file_path}</span></div>
                      )}
                    </div>
                    {f.prompt_template && (
                      <div>
                        <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">Prompt</div>
                        <div className="bg-gray-950/60 border border-gray-700/30 rounded-lg p-3 text-sm text-gray-300 font-mono whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                          {f.prompt_template}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Flow Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowCreateModal(false)} />
          <div className="relative bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl shadow-black/50 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            {/* Modal header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-700/50">
              <div>
                <h3 className="text-base font-semibold text-gray-200">Create Flow</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Schedule an agent to run automatically on a recurring basis.
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors rounded-lg hover:bg-gray-700/50"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="my-daily-review"
                  className="w-full bg-gray-900 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2.5 focus:border-emerald-500 focus:outline-none"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Schedule</label>
                <CustomSelect
                  value={scheduleMode === 'custom' ? CUSTOM_CRON_VALUE : schedule}
                  onChange={val => {
                    if (val === CUSTOM_CRON_VALUE) {
                      setScheduleMode('custom')
                      setSchedule('')
                    } else {
                      setScheduleMode('preset')
                      setSchedule(val)
                    }
                  }}
                  placeholder="Pick a schedule..."
                  options={scheduleSelectOptions}
                />
                {scheduleMode === 'custom' && (
                  <input
                    type="text"
                    value={schedule}
                    onChange={e => setSchedule(e.target.value)}
                    placeholder="*/30 * * * *"
                    className="w-full mt-2 bg-gray-900 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2.5 font-mono focus:border-emerald-500 focus:outline-none"
                    autoFocus
                  />
                )}
                {schedule && (
                  <p className="text-[11px] text-emerald-500/70 mt-1.5">
                    {cronToLabel(schedule)}{scheduleMode === 'custom' && schedule ? ` — ${schedule}` : ''}
                  </p>
                )}
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Agent Profile</label>
                  {profiles.length > 0 ? (
                    <CustomSelect
                      value={agentProfile}
                      onChange={setAgentProfile}
                      placeholder="Select a profile..."
                      options={profiles.map(p => ({
                        value: p.name,
                        label: p.name,
                        sublabel: p.description || undefined,
                      }))}
                    />
                  ) : (
                    <input
                      type="text"
                      value={agentProfile}
                      onChange={e => setAgentProfile(e.target.value)}
                      placeholder="e.g. developer"
                      className="w-full bg-gray-900 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2.5 focus:border-emerald-500 focus:outline-none"
                    />
                  )}
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Provider</label>
                  <CustomSelect
                    value={provider}
                    onChange={setProvider}
                    placeholder="Default"
                    options={providers.map(p => ({
                      value: p.name,
                      label: p.name.replace(/_/g, ' '),
                      sublabel: !p.installed ? 'Not installed' : undefined,
                      disabled: !p.installed,
                    }))}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Prompt</label>
                <textarea
                  value={promptTemplate}
                  onChange={e => setPromptTemplate(e.target.value)}
                  placeholder="Describe what this flow should do..."
                  rows={5}
                  className="w-full bg-gray-900 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2.5 font-mono focus:border-emerald-500 focus:outline-none resize-y"
                />
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-700/50">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!name.trim() || !schedule.trim() || !agentProfile.trim() || !promptTemplate.trim() || creating}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {creating ? 'Creating...' : 'Create Flow'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        open={!!pendingDelete}
        title="Delete Flow"
        message="This will permanently remove the flow and its schedule. This action cannot be undone."
        details={pendingDelete ? [
          { label: 'Name', value: pendingDelete.name },
          { label: 'Schedule', value: pendingDelete.schedule },
          { label: 'Profile', value: pendingDelete.agent_profile },
          { label: 'Provider', value: pendingDelete.provider || 'default' },
        ] : []}
        confirmLabel="Delete Flow"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

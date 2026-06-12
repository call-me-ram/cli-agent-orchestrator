import { useState, useEffect } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { FolderBrowser } from './FolderBrowser'
import { FolderOpen, Save, Plus, X, RefreshCw, CheckCircle, RotateCcw, FolderSearch } from 'lucide-react'

export function SettingsPanel() {
  const [loaded, setLoaded] = useState(false)
  // Defaults are built-in per-provider directories: removable, but removal is
  // a persisted "disable" (GH #281 — they used to silently reappear).
  const [defaults, setDefaults] = useState<string[]>([])
  const [disabledDefaults, setDisabledDefaults] = useState<string[]>([])
  const [extras, setExtras] = useState<string[]>([])
  const [newDir, setNewDir] = useState('')
  const [browsing, setBrowsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [profileCount, setProfileCount] = useState<number | null>(null)
  const { showSnackbar } = useStore()

  const applySettings = (s: { agent_dirs: Record<string, string>; extra_dirs: string[]; disabled_dirs?: string[] }) => {
    const activeDefaults = [...new Set(Object.values(s.agent_dirs))].filter(Boolean)
    const disabled = s.disabled_dirs || []
    setDefaults(activeDefaults)
    setDisabledDefaults(disabled)
    // True extras only: legacy saves duplicated defaults into extra_dirs.
    setExtras((s.extra_dirs || []).filter(d => !activeDefaults.includes(d) && !disabled.includes(d)))
  }

  const load = async () => {
    try {
      applySettings(await api.getAgentDirs())
      setLoaded(true)
    } catch {
      showSnackbar({ type: 'error', message: 'Failed to load settings' })
    }
  }

  const refreshProfiles = async () => {
    try {
      const profiles = await api.listProfiles()
      setProfileCount(profiles.length)
    } catch {}
  }

  useEffect(() => {
    load()
    refreshProfiles()
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const result = await api.setAgentDirs({ extra_dirs: extras, disabled_dirs: disabledDefaults })
      // Render the EFFECTIVE state the server returns — never our own
      // optimistic copy (that's how the misleading "saved" arose).
      applySettings(result)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      showSnackbar({ type: 'success', message: 'Settings saved' })
      refreshProfiles()
    } catch (e: any) {
      showSnackbar({ type: 'error', message: e.message || 'Failed to save' })
    } finally {
      setSaving(false)
    }
  }

  const addDir = (dir?: string) => {
    const trimmed = (dir ?? newDir).trim()
    if (!trimmed) return
    if (extras.includes(trimmed) || defaults.includes(trimmed)) {
      showSnackbar({ type: 'info', message: 'That folder is already in the list' })
      return
    }
    setExtras([...extras, trimmed])
    setNewDir('')
  }

  if (!loaded) {
    return <div className="text-gray-500 text-sm py-8 text-center">Loading settings...</div>
  }

  const dirRow = (dir: string, tag: string | null, onRemove: () => void) => (
    <div key={dir} className="flex items-center gap-2 bg-gray-900/50 border border-gray-700/30 rounded-lg px-3 py-2.5">
      <FolderOpen size={14} className="text-emerald-500 shrink-0" />
      <span className="text-sm text-gray-300 font-mono flex-1 truncate" title={dir}>{dir}</span>
      {tag && <span className="text-[10px] uppercase tracking-wide text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded shrink-0">{tag}</span>}
      <button onClick={onRemove} className="text-gray-500 hover:text-red-400 transition-colors shrink-0" title="Remove directory">
        <X size={14} />
      </button>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Agent Profile Directories */}
      <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
            Agent Profile Directories
          </h3>
          {profileCount !== null && (
            <span className="text-xs text-gray-500">{profileCount} profiles discovered</span>
          )}
        </div>
        <p className="text-xs text-gray-500 mb-2">
          Add directories where your agent profile <code className="text-gray-400">.md</code> files are stored.
          CAO scans all directories and makes profiles available to every provider.
        </p>
        <p className="text-xs text-emerald-400/70 mb-5">
          Install built-in profiles with: <code className="bg-gray-900 px-1.5 py-0.5 rounded text-emerald-300">cao install developer</code>
        </p>

        <div className="space-y-2 mb-4">
          {defaults.map(dir =>
            dirRow(dir, 'default', () => {
              setDefaults(defaults.filter(d => d !== dir))
              setDisabledDefaults([...disabledDefaults, dir])
            })
          )}
          {extras.map(dir => dirRow(dir, null, () => setExtras(extras.filter(d => d !== dir))))}
        </div>

        {defaults.length === 0 && extras.length === 0 && (
          <div className="text-center py-6 mb-4 bg-gray-900/30 border border-dashed border-gray-700 rounded-lg">
            <FolderOpen size={24} className="mx-auto text-gray-600 mb-2" />
            <p className="text-gray-500 text-sm">No directories configured.</p>
            <p className="text-gray-600 text-xs mt-1">Add a directory below to start discovering agent profiles.</p>
          </div>
        )}

        {disabledDefaults.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-gray-600 mb-1.5">Removed defaults (click to restore):</p>
            <div className="space-y-1.5">
              {disabledDefaults.map(dir => (
                <div key={dir} className="flex items-center gap-2 bg-gray-900/30 border border-gray-800 rounded-lg px-3 py-2 opacity-60">
                  <FolderOpen size={13} className="text-gray-600 shrink-0" />
                  <span className="text-xs text-gray-500 font-mono flex-1 truncate line-through" title={dir}>{dir}</span>
                  <button
                    onClick={() => {
                      setDisabledDefaults(disabledDefaults.filter(d => d !== dir))
                      setDefaults([...defaults, dir])
                    }}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-emerald-400 shrink-0"
                    title="Restore this default directory"
                  >
                    <RotateCcw size={12} /> Restore
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={newDir}
            onChange={e => setNewDir(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addDir()}
            placeholder="/path/to/agent-profiles"
            className="flex-1 bg-gray-900 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2.5 font-mono focus:border-emerald-500 focus:outline-none"
          />
          <button
            onClick={() => setBrowsing(true)}
            className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm px-4 py-2.5 rounded-lg transition-colors"
            title="Browse the server's folders"
            data-testid="browse-dir"
          >
            <FolderSearch size={14} /> Browse…
          </button>
          <button
            onClick={() => addDir()}
            disabled={!newDir.trim()}
            className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white text-sm px-4 py-2.5 rounded-lg transition-colors"
          >
            <Plus size={14} /> Add
          </button>
        </div>
        <p className="text-[11px] text-gray-600 mt-2">
          Changes apply when you click <span className="text-gray-400">Save Settings</span>.
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
        >
          {saved ? <CheckCircle size={16} /> : <Save size={16} />}
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save Settings'}
        </button>
        <button
          onClick={() => { refreshProfiles(); showSnackbar({ type: 'info', message: 'Refreshing profiles...' }) }}
          className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white text-sm px-4 py-2.5 rounded-lg transition-colors"
        >
          <RefreshCw size={14} /> Refresh Profiles
        </button>
      </div>

      {browsing && (
        <FolderBrowser
          title="Add a profile directory"
          onSelect={dir => addDir(dir)}
          onClose={() => setBrowsing(false)}
        />
      )}
    </div>
  )
}

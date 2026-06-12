import { useEffect, useRef, useState } from 'react'
import { api, TerminalMeta } from '../api'
import { useStore } from '../store'
import { deriveRun, narrate, PHASE_COPY, Run, RunMember } from '../orchestration'
import { StartRunWizard } from './StartRunWizard'
import { OutputViewer } from './OutputViewer'
import { ConfirmModal } from './ConfirmModal'
import { Play, Trash2, MessageSquare, Eye, Send } from 'lucide-react'

interface SessionTerminals {
  name: string
  terminals: TerminalMeta[]
}

function MemberRow({ member, onAnswer, onShow }: {
  member: RunMember
  onAnswer: (m: RunMember) => void
  onShow: (m: RunMember) => void
}) {
  const tone =
    member.status === 'PROCESSING' ? 'text-blue-300'
    : member.status === 'WAITING_USER_ANSWER' ? 'text-amber-300'
    : member.status === 'ERROR' ? 'text-red-300'
    : 'text-gray-300'
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${
          member.status === 'PROCESSING' ? 'bg-blue-400 animate-pulse'
          : member.status === 'WAITING_USER_ANSWER' ? 'bg-amber-400 animate-pulse'
          : member.status === 'ERROR' ? 'bg-red-400'
          : member.status === 'COMPLETED' ? 'bg-purple-400'
          : member.status === 'IDLE' ? 'bg-emerald-400'
          : 'bg-gray-500'
        }`} />
        <span className={`text-sm truncate ${tone}`}>{narrate(member)}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {member.status === 'WAITING_USER_ANSWER' && (
          <button
            onClick={() => onAnswer(member)}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
            data-testid={`answer-${member.terminalId}`}
          >
            <MessageSquare size={12} /> Answer
          </button>
        )}
        <button
          onClick={() => onShow(member)}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded text-gray-500 hover:text-gray-300"
          title="Show what this agent said"
          data-testid={`show-${member.terminalId}`}
        >
          <Eye size={12} />
        </button>
      </div>
    </div>
  )
}

function RunCard({ run, onDelete, onAnswer, onShow, onInstruct }: {
  run: Run
  onDelete: (runId: string) => void
  onAnswer: (m: RunMember) => void
  onShow: (m: RunMember) => void
  onInstruct: (run: Run) => void
}) {
  const phase = PHASE_COPY[run.phase]
  return (
    <div className="bg-[#16161e] border border-gray-800 rounded-xl p-4" data-testid={`run-${run.runId}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-gray-200 truncate">{run.runId}</span>
          <span className={`text-xs font-medium ${phase.tone}`} data-testid={`phase-${run.runId}`}>
            ● {phase.label}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {run.planner && (
            <button
              onClick={() => onInstruct(run)}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded text-gray-400 hover:text-gray-200"
              title="Tell the planner something"
            >
              <Send size={12} /> Instruct
            </button>
          )}
          <button
            onClick={() => onDelete(run.runId)}
            className="text-gray-600 hover:text-red-400 p-1"
            title="End this run"
            data-testid={`delete-${run.runId}`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="divide-y divide-gray-800/60">
        {run.planner && <MemberRow member={run.planner} onAnswer={onAnswer} onShow={onShow} />}
        {run.workers.map(w => (
          <MemberRow key={w.terminalId} member={w} onAnswer={onAnswer} onShow={onShow} />
        ))}
        {!run.planner && run.workers.length === 0 && (
          <p className="text-sm text-gray-500 py-2">Starting up…</p>
        )}
      </div>
    </div>
  )
}

/**
 * The non-technical "what's happening" board: every CAO session shown as a
 * run with plain-language narration. Status updates arrive live over SSE;
 * session/terminal membership reconciles on a slow fetch.
 */
export function RunBoard() {
  const { sessions, terminalStatuses, deleteSession, showSnackbar, setTerminalStatus } = useStore()
  const [details, setDetails] = useState<SessionTerminals[]>([])
  const [wizardOpen, setWizardOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [viewing, setViewing] = useState<RunMember | null>(null)
  const [answering, setAnswering] = useState<RunMember | null>(null)
  const [answerText, setAnswerText] = useState('')
  const [prompt, setPrompt] = useState<string>('')
  const fetchingRef = useRef(false)
  const seededRef = useRef<Set<string>>(new Set())

  // Membership reconcile: terminals come and go as the planner spawns
  // workers. Statuses themselves arrive via SSE — this is only the roster.
  useEffect(() => {
    const fetchAll = async () => {
      if (fetchingRef.current) return
      fetchingRef.current = true
      try {
        const all = await Promise.all(
          sessions.map(async s => {
            try {
              const detail = await api.getSession(s.name)
              return { name: s.name, terminals: detail.terminals || [] }
            } catch {
              return { name: s.name, terminals: [] }
            }
          })
        )
        setDetails(all)
        // Seed each terminal's status exactly ONCE (new arrivals only);
        // every later change arrives over SSE. Re-seeding each reconcile
        // would just be polling with extra steps.
        all.flatMap(d => d.terminals).forEach(t => {
          if (seededRef.current.has(t.id)) return
          seededRef.current.add(t.id)
          api.getTerminalStatus(t.id)
            .then(status => { if (status) setTerminalStatus(t.id, status) })
            .catch(() => {})
        })
      } finally {
        fetchingRef.current = false
      }
    }
    fetchAll()
    const interval = setInterval(fetchAll, 10000)
    return () => clearInterval(interval)
  }, [sessions.map(s => s.name).join(',')])

  // When opening the answer dialog, show the agent's actual question.
  useEffect(() => {
    if (!answering) return
    setPrompt('')
    api.getTerminalOutput(answering.terminalId, 'last')
      .then(r => setPrompt(r.output || ''))
      .catch(() => {})
  }, [answering?.terminalId])

  const runs = details.map(d => deriveRun(d, terminalStatuses))
  const active = runs.filter(r => r.phase !== 'done')
  const finished = runs.filter(r => r.phase === 'done')

  const sendAnswer = async () => {
    if (!answering || !answerText.trim()) return
    try {
      await api.sendInput(answering.terminalId, answerText.trim())
      showSnackbar({ type: 'success', message: 'Answer sent' })
      setAnswering(null)
      setAnswerText('')
    } catch (e: any) {
      showSnackbar({ type: 'error', message: e.message || 'Could not send the answer' })
    }
  }

  const instruct = async (run: Run) => {
    const text = window.prompt(`Tell the planner of "${run.runId}" what to do next:`)
    if (!text?.trim() || !run.planner) return
    try {
      await api.sendInput(run.planner.terminalId, text.trim())
      showSnackbar({ type: 'success', message: 'Instruction sent to the planner' })
    } catch (e: any) {
      showSnackbar({ type: 'error', message: e.message || 'Could not send the instruction' })
    }
  }

  return (
    <div className="space-y-6" data-testid="run-board">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-100">Runs</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Each run is a team of AI agents working on one goal. Watch them live.
          </p>
        </div>
        <button
          onClick={() => setWizardOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg"
          data-testid="start-run"
        >
          <Play size={14} /> Start a run
        </button>
      </div>

      {active.length === 0 && finished.length === 0 && (
        <div className="text-center py-16 border border-dashed border-gray-800 rounded-xl">
          <p className="text-gray-400">No runs yet.</p>
          <p className="text-sm text-gray-600 mt-1">
            Click <span className="text-gray-300">Start a run</span>, describe what you want done,
            and a planner agent will organize the work.
          </p>
        </div>
      )}

      {active.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {active.map(run => (
            <RunCard
              key={run.runId}
              run={run}
              onDelete={id => setConfirmDelete(id)}
              onAnswer={setAnswering}
              onShow={setViewing}
              onInstruct={instruct}
            />
          ))}
        </div>
      )}

      {finished.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-gray-400 mb-2">Finished</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {finished.map(run => (
              <RunCard
                key={run.runId}
                run={run}
                onDelete={id => setConfirmDelete(id)}
                onAnswer={setAnswering}
                onShow={setViewing}
                onInstruct={instruct}
              />
            ))}
          </div>
        </div>
      )}

      {wizardOpen && <StartRunWizard onClose={() => setWizardOpen(false)} />}

      <ConfirmModal
        open={confirmDelete !== null}
        title="End this run?"
        message={`This stops every agent in "${confirmDelete ?? ''}" and closes the run. Finished work on disk is kept.`}
        confirmLabel="End run"
        onConfirm={async () => {
          if (confirmDelete) await deleteSession(confirmDelete)
          setConfirmDelete(null)
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      {viewing && (
        <OutputViewer terminalId={viewing.terminalId} onClose={() => setViewing(null)} />
      )}

      {answering && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#16161e] border border-gray-800 rounded-xl w-full max-w-lg p-5">
            <h3 className="text-base font-medium text-gray-100 mb-2">
              {answering.isPlanner ? 'The planner' : `Worker ${answering.profile}`} asked:
            </h3>
            <pre className="bg-[#0f0f14] border border-gray-800 rounded-lg p-3 text-xs text-gray-300 max-h-48 overflow-auto whitespace-pre-wrap mb-3">
              {prompt || 'Loading the question…'}
            </pre>
            <textarea
              autoFocus
              value={answerText}
              onChange={e => setAnswerText(e.target.value)}
              placeholder="Type your answer…"
              className="w-full h-20 bg-[#0f0f14] border border-gray-700 rounded-lg p-2.5 text-sm text-gray-200 focus:border-amber-500 outline-none resize-none"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => { setAnswering(null); setAnswerText('') }}
                className="px-3 py-2 text-sm text-gray-400 hover:text-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={sendAnswer}
                disabled={!answerText.trim()}
                className="px-4 py-2 text-sm bg-amber-600 hover:bg-amber-500 text-white rounded-lg disabled:opacity-40"
              >
                Send answer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

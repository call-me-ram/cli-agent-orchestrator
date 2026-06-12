import { useCallback, useEffect, useRef, useState } from 'react'
import { api, TerminalMeta } from '../api'
import { useStore } from '../store'
import { deriveRun, narrate, PHASE_COPY, Run, RunMember } from '../orchestration'
import { FlowPulse } from '../store'
import { SessionName } from './SessionName'
import { StartRunWizard } from './StartRunWizard'
import { OutputViewer } from './OutputViewer'
import { ConfirmModal } from './ConfirmModal'
import { Play, Trash2, MessageSquare, Eye, Send } from 'lucide-react'

interface SessionTerminals {
  name: string
  terminals: TerminalMeta[]
}

const NODE_COLOR: Record<string, string> = {
  PROCESSING: '#60a5fa',
  WAITING_USER_ANSWER: '#fbbf24',
  ERROR: '#f87171',
  COMPLETED: '#c084fc',
  IDLE: '#34d399',
  UNKNOWN: '#6b7280',
}

const PULSE_COLOR: Record<string, string> = {
  message: '#34d399', // worker reporting back
  handoff: '#fbbf24', // planner delegating (blocking)
  assign: '#fbbf24',  // planner delegating (parallel)
  task: '#60a5fa',    // generic task delivery
}

/**
 * The node-flow view: planner on the left, workers on the right, and an
 * animated pulse traveling sender → receiver for every live message
 * (handoff/assign out, send_message replies back). Pure SVG + SMIL — no
 * graph library.
 */
function FlowGraph({ run, pulses, onShow }: {
  run: Run
  pulses: FlowPulse[]
  onShow: (m: RunMember) => void
}) {
  const [, forceRender] = useState(0)
  const planner = run.planner
  const workers = run.workers
  // Render even for a lone planner: the graph should be visible from the
  // first second of a run, with worker nodes popping in as they spawn.
  if (!planner) return null

  const W = 480
  const ROW = 56
  const H = Math.max(workers.length * ROW, ROW) + 20
  const plannerPos = { x: 86, y: H / 2 }
  const workerPos = (i: number) => ({ x: W - 110, y: 10 + ROW / 2 + i * ROW })
  const posOf = (tid: string) => {
    if (tid === planner.terminalId) return plannerPos
    const i = workers.findIndex(w => w.terminalId === tid)
    return i >= 0 ? workerPos(i) : null
  }

  const FRESH_MS = 5000
  const fresh = pulses.filter(p => Date.now() - p.ts < FRESH_MS && posOf(p.sender) && posOf(p.receiver))
  // Re-render once the youngest pulse expires so frozen dots disappear.
  useEffect(() => {
    if (!fresh.length) return
    const youngest = Math.max(...fresh.map(p => p.ts))
    const timer = setTimeout(() => forceRender(x => x + 1), youngest + FRESH_MS + 100 - Date.now())
    return () => clearTimeout(timer)
  }, [fresh.map(p => p.id).join(',')])

  const node = (m: RunMember, pos: { x: number; y: number }) => {
    const busy = m.status === 'PROCESSING' || m.status === 'WAITING_USER_ANSWER'
    return (
      <g key={m.terminalId} onClick={() => onShow(m)} className="cursor-pointer" data-testid={`flow-node-${m.terminalId}`}>
        <circle cx={pos.x} cy={pos.y} r={13} fill="#16161e" stroke={NODE_COLOR[m.status] || NODE_COLOR.UNKNOWN} strokeWidth={2.5}>
          {busy && (
            <animate attributeName="stroke-opacity" values="1;0.35;1" dur="1.6s" repeatCount="indefinite" />
          )}
        </circle>
        <circle cx={pos.x} cy={pos.y} r={4.5} fill={NODE_COLOR[m.status] || NODE_COLOR.UNKNOWN} />
        <text x={pos.x} y={pos.y + 28} textAnchor="middle" className="fill-gray-400" fontSize={10}>
          {(m.isPlanner ? 'planner · ' : '') + m.profile.slice(0, 18)}
        </text>
      </g>
    )
  }

  return (
    <div className="mb-2 overflow-hidden" data-testid={`flow-graph-${run.runId}`}>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full" style={{ maxHeight: 200 }}>
        {workers.map((w, i) => {
          const wp = workerPos(i)
          return (
            <line
              key={w.terminalId}
              x1={plannerPos.x + 16} y1={plannerPos.y}
              x2={wp.x - 16} y2={wp.y}
              stroke="#2a2a36" strokeWidth={1.5}
            />
          )
        })}
        {node(planner, plannerPos)}
        {workers.map((w, i) => node(w, workerPos(i)))}
        {fresh.map(p => {
          const from = posOf(p.sender)!
          const to = posOf(p.receiver)!
          const color = PULSE_COLOR[p.kind] || PULSE_COLOR.task
          return (
            <g key={p.id}>
              <circle r={5} fill={color}>
                <animateMotion
                  dur="1.4s"
                  fill="freeze"
                  path={`M ${from.x} ${from.y} L ${to.x} ${to.y}`}
                />
                <animate attributeName="opacity" from="1" to="0" begin="1.2s" dur="0.4s" fill="freeze" />
              </circle>
              <circle r={9} fill="none" stroke={color} strokeOpacity={0.4}>
                <animateMotion
                  dur="1.4s"
                  fill="freeze"
                  path={`M ${from.x} ${from.y} L ${to.x} ${to.y}`}
                />
                <animate attributeName="opacity" from="0.6" to="0" begin="1.1s" dur="0.4s" fill="freeze" />
              </circle>
            </g>
          )
        })}
      </svg>
    </div>
  )
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
        <span className="text-xs text-gray-600 shrink-0" title="Provider and LLM model">
          {member.provider} · {member.model || 'default model'}
        </span>
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

function RunCard({ run, label, pulses, onDelete, onAnswer, onShow, onInstruct }: {
  run: Run
  label?: string | null
  pulses: FlowPulse[]
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
          <SessionName name={run.runId} label={label} className="text-sm font-medium text-gray-200" />
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
      <FlowGraph run={run} pulses={pulses} onShow={onShow} />
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
  const { sessions, terminalStatuses, deleteSession, showSnackbar, setTerminalStatus, flowPulses } = useStore()
  const [details, setDetails] = useState<SessionTerminals[]>([])
  const [wizardOpen, setWizardOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [viewing, setViewing] = useState<RunMember | null>(null)
  const [answering, setAnswering] = useState<RunMember | null>(null)
  const [answerText, setAnswerText] = useState('')
  const [instructing, setInstructing] = useState<Run | null>(null)
  const [instructText, setInstructText] = useState('')
  const [prompt, setPrompt] = useState<string>('')
  const fetchingRef = useRef(false)
  const seededRef = useRef<Set<string>>(new Set())

  // Membership reconcile: terminals come and go as the planner spawns
  // workers. Statuses themselves arrive via SSE — this is only the roster.
  const fetchAll = useCallback(async () => {
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
  }, [sessions.map(s => s.name).join(',')])

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 10000)
    return () => clearInterval(interval)
  }, [fetchAll])

  // A flow event means a worker was just added to an EXISTING session (which
  // doesn't change the session list), so refresh rosters NOW — otherwise the
  // new worker node, and its incoming pulse, wouldn't appear for up to 10s.
  useEffect(() => {
    if (flowPulses.length) fetchAll()
  }, [flowPulses.length])

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

  const sendInstruction = async () => {
    if (!instructing?.planner || !instructText.trim()) return
    try {
      await api.sendInput(instructing.planner.terminalId, instructText.trim())
      showSnackbar({ type: 'success', message: 'Instruction sent to the planner' })
      setInstructing(null)
      setInstructText('')
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
              label={sessions.find(s => s.name === run.runId)?.label}
              pulses={flowPulses}
              onDelete={id => setConfirmDelete(id)}
              onAnswer={setAnswering}
              onShow={setViewing}
              onInstruct={setInstructing}
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
                label={sessions.find(s => s.name === run.runId)?.label}
                pulses={flowPulses}
                onDelete={id => setConfirmDelete(id)}
                onAnswer={setAnswering}
                onShow={setViewing}
                onInstruct={setInstructing}
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

      {instructing && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#16161e] border border-gray-800 rounded-xl w-full max-w-lg p-5">
            <h3 className="text-base font-medium text-gray-100 mb-1">
              Tell the planner what to do next
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              Run {instructing.runId} — your instruction goes straight to the planner agent, which
              will organize any follow-up work.
            </p>
            <textarea
              autoFocus
              value={instructText}
              onChange={e => setInstructText(e.target.value)}
              placeholder="e.g. Also add a dark-mode toggle, then have it reviewed"
              className="w-full h-24 bg-[#0f0f14] border border-gray-700 rounded-lg p-2.5 text-sm text-gray-200 focus:border-blue-500 outline-none resize-none"
              data-testid="instruct-text"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => { setInstructing(null); setInstructText('') }}
                className="px-3 py-2 text-sm text-gray-400 hover:text-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={sendInstruction}
                disabled={!instructText.trim()}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-40"
                data-testid="instruct-send"
              >
                <Send size={13} /> Send instruction
              </button>
            </div>
          </div>
        </div>
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

# CAO Web UI — Design Guide (read this before designing or building any UI)

This document is the design brief for the CAO dashboard. Give it to any AI (or
human) before they touch the UI so the result is consistent with what exists,
not a fresh visual language bolted on. It captures the product intent, the two
audiences, the visual system already in the code, the component vocabulary, and
the rules that keep it coherent.

---

## 1. What this product is (so the UI serves it)

CAO orchestrates **teams of AI coding agents**. A *supervisor/planner* agent
delegates work to *worker* agents (developer, reviewer), each a real CLI running
in its own tmux terminal; they message each other and a human can watch and
steer. The UI's job is to make an inherently invisible, asynchronous,
multi-process system **legible at a glance**.

Two audiences, served by two surfaces — **design for both, never collapse them**:

| Audience | Surface | Mental model | Language |
|---|---|---|---|
| Non-technical operator | **Runs** tab (default) | "a team working on my goal" | plain English, no jargon |
| Technical operator | **Agents / Home / Flows / Settings** | sessions, terminals, providers, MCP | precise, technical |

> **Rule 1 — Altitude.** Every new surface picks an altitude. The Runs board
> never says "tmux", "terminal", or "PID". The Agents tab never dumbs down
> "session" into "run". A control that belongs to one audience does not leak
> into the other's view.

---

## 2. Core UX principles (the non-negotiables)

1. **Live, not polled.** Status and flow arrive over the `/events` SSE stream and
   render instantly. Never reintroduce `setInterval` status polling — a Playwright
   test enforces zero status GETs during quiet windows. One-shot fetch on
   mount/roster-change is fine; loops are not.
2. **Truth over optimism.** Render the state the server returns, never an
   optimistic local copy (this is why "Settings saved" used to lie and why
   timestamps use the `X-Server-Time` skew correction). If you can't confirm it,
   don't assert it in the UI.
3. **Glanceability.** A user scanning the page in 2 seconds must know: how many
   runs, which are working / waiting on me / done / broken, and where their
   attention is needed. Color + one plain-language line per agent does this.
4. **Make the invisible visible.** Agent-to-agent messages are the heart of the
   system and were once unseeable — hence the flow graph with animated pulses.
   When you add a feature, ask "what's happening that the user currently can't
   see?" and surface it.
5. **Every destructive or hard-to-reverse action confirms** (ConfirmModal), and
   **every error shows the server's human message**, never a raw status code.
6. **No browser-native dialogs.** `window.prompt`/`alert`/`confirm` are banned —
   they break the visual language. Use the styled modal pattern.

---

## 3. Visual system (already established — match it exactly)

Built with **React 18 + TypeScript + Vite + Tailwind + zustand + lucide-react
icons**. xterm.js for live terminals. No component library — Tailwind utility
classes, dark theme only.

### Palette (dark)
- **Surfaces:** page `#0f0f14`, cards/panels `#16161e`, inset/inputs `#0f0f14`
  on `border-gray-800`, hover `bg-gray-800/60`.
- **Text:** primary `text-gray-200`, secondary `text-gray-400`, muted
  `text-gray-500/600`.
- **Brand accent:** emerald (`emerald-500/600`) — primary actions, "live",
  the logo. Use sparingly for the *one* primary action per view.
- **Status colors (consistent everywhere — see `StatusBadge.tsx`):**
  - PROCESSING → blue (`blue-400`), **pulsing**
  - IDLE / ready → emerald (`emerald-400`)
  - WAITING_USER_ANSWER → amber (`amber-400`), **pulsing** (needs the human)
  - COMPLETED / done → purple (`purple-400`)
  - ERROR → red (`red-400`)
  - UNKNOWN / starting → gray (`gray-500`)
- **Flow pulses:** amber = planner delegating (handoff/assign), emerald = worker
  reporting back.

> **Rule 2 — Status color is sacred.** Those six color↔status mappings are used
> on badges, dots, nodes, and pulses. Never repurpose them. A blue dot always
> means "working", an amber pulse always means "needs you / delegation".

### Shape & spacing
- Cards: `rounded-xl border border-gray-800 p-4/5`. Inputs/buttons: `rounded-lg`.
  Pills/badges: `rounded-full px-2 py-0.5 text-xs`.
- Generous breathing room (`space-y-6` between major blocks, `gap-2/3` within).
- Layout max width ~`max-w-7xl` centered; content in stacked cards, not dense
  tables. Tables only for genuinely tabular facts.

### Typography
- Default sans for prose; **monospace** (`font-mono`) for identifiers (session
  names, terminal IDs, paths). Sizes: headings `text-lg/xl`, body `text-sm`,
  meta `text-xs`, micro-labels `text-[10px/11px] uppercase tracking-wide`.

### Motion
- Reserve animation for *meaning*: `animate-pulse` on a dot/ring = that agent
  needs attention or is working; SVG/SMIL pulses = a live message traveling.
  No decorative motion. Keep durations short (1.2–1.6s).

---

## 4. Component vocabulary (reuse before inventing)

| Need | Use | File |
|---|---|---|
| Status chip | `StatusBadge` / `STATUS_CONFIG` | `components/StatusBadge.tsx` |
| Confirm a destructive action | `ConfirmModal` (`open` prop) | `components/ConfirmModal.tsx` |
| Show an agent's output/transcript | `OutputViewer` | `components/OutputViewer.tsx` |
| Live terminal (xterm) | `TerminalView` (lazy) | `components/TerminalView.tsx` |
| Dropdown select | `CustomSelect` | `components/CustomSelect.tsx` |
| Session name + inline rename | `SessionName` | `components/SessionName.tsx` |
| Toasts | `showSnackbar()` from the store | `store.ts` |
| Modal shell | the inline pattern: `fixed inset-0 bg-black/60 flex items-center justify-center z-50` → `bg-[#16161e] border border-gray-800 rounded-xl w-full max-w-lg p-5/6` | (see StartRunWizard) |

State lives in the zustand store (`store.ts`): `sessions`, `terminalStatuses`,
`flowPulses`, `connected`, plus actions. New live data follows the same shape:
seed once via REST, update via SSE.

---

## 5. Information architecture

- **Runs** (default): the run board — each session as a run card with the flow
  graph, plain-language member rows, and Answer/Instruct/End/Show controls.
  Start-a-run wizard. This is the showcase; keep it calm and confident.
- **Home**: technical dashboard — stat cards, all sessions with status filters.
- **Agents**: session list + per-session terminal management (raw controls:
  Open Terminal, Output, Inbox, Graceful Exit, Close, Add Agent).
- **Flows**: scheduled runs.
- **Settings**: agent-profile directories (with Browse), memory toggle.

> **Rule 3 — One primary action per view, emerald.** The page should make the
> single most likely next action obvious (Start a run; Spawn Agent; Save
> Settings). Secondary actions are gray; destructive are red and confirm.

---

## 6. How to design a new feature here (the checklist)

1. **Pick the altitude** (§1) — which audience, which tab.
2. **What can't the user currently see?** Surface that, live (§2.4).
3. **Reuse the vocabulary** (§4) before making a new component. New modal? Use
   the shell. New status? You almost certainly don't need one.
4. **Map every state to the sacred colors** (§3) — including empty, loading,
   error, and "nothing yet" states. A lone-planner graph still says something
   ("waiting to delegate"), never looks broken.
5. **Live data path:** REST seed on mount → SSE deltas → store. No polling.
6. **Errors & confirms:** server message in the snackbar; ConfirmModal for
   destructive; no native dialogs.
7. **Plain language for the Runs surface**, precise terms elsewhere.
8. **Test the contract, not the internals:** a Playwright test that watches
   behavior (a node appears, a pulse fires, no polling happens) is worth more
   than asserting a function was called.

## 7. Known design debts / opportunities (good next work)
- The flow graph is planner-left / workers-right; with many workers it could use
  curved edges and grouping. Reviewer vs developer could be visually distinct.
- Empty states could be warmer (illustrations/affordances) on first run.
- A run "timeline" (what happened, when) would complement the live graph for
  after-the-fact review.
- Mobile/responsive is untested — the dashboard assumes desktop width.
- Accessibility: status is color-coded; add text/ARIA so it's not color-only.

---

*When in doubt: open the Runs tab, look at a live run, and ask "would a
non-technical person understand this in 2 seconds, and does it match the colors
and shapes already on screen?" If yes, you're aligned.*

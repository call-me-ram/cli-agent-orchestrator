# CAO Dashboard — Build Spec (chosen directions)

> Handoff spec for implementation. Derived from design explorations approved on Jun 12, 2026.
> Read alongside `UI_DESIGN_GUIDE.md` — that doc is the constitution; this doc says exactly
> **which** explored variant to build for each surface and how it behaves.
> STATUS: implemented (see commit history).

| Surface | Variant | Summary |
|---|---|---|
| Runs board | **V1 — Stacked board** | Full-width run cards, mini flow graph inside each active card |
| Flow graph | **A — Curved + role groups** | Planner left, workers right grouped by role, curved edges, animated message pulses |
| Agents | **A2 — Master-detail** | Session rail on the left, terminal tabs + live xterm preview on the right |
| Flows | **F1 — Flow cards** | One horizontal card per flow with toggle, schedule, next run, last result |

Key invariants (§ numbers refer to the full spec discussion):
- §1.1 design tokens as CSS custom properties (`--page/--card/--border`, text tiers `--t1..t4`, the six status hues, brand emerald).
- §1.3 six sacred status mappings — color is meaning; `pulse-dot` on PROCESSING/WAITING; `ring-pulse` on busy avatars; all motion off under `prefers-reduced-motion`.
- §1.4 language altitude: Runs = plain English; Agents/Flows = raw enums + mono identifiers.
- §1.5 avatars: crown=planner, code=developer, clipboard+SQUARED shape=reviewer (shape, not color, distinguishes roles).
- §1.6 56px shell, `cao` mono brand, exactly one emerald primary action per page.
- §2.3 needs-you cards show the agent's question inline with an amber answer field.
- §3 graph: cubic Bézier edges, dashed for IDLE, 30%-alpha traffic tint, amber out / emerald back pulses; mini 392×190 variant in cards.
- §4 Agents: 248px session rail, terminal tab pills, inline live xterm preview, technical footer row.
- §5 Flows: toggle · identity · SCHEDULE · NEXT RUN · LAST RUN · Run now; disabled cards at 60% opacity.

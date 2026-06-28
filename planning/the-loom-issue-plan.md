# The Loom — Issue Breakdown & Model Routing Plan

**Status:** Living plan (companion to `the-loom-design.md`)
**Created:** 2026-06-27
**Scope:** GitHub milestones, issues, and per-issue model assignments for building The Loom

This document is the operational counterpart to [`the-loom-design.md`](./the-loom-design.md). The design doc says _what_ The Loom is; this says _how the work is split into issues_ and _which model should do each one_. Phase 0 and Phase 1 are detailed, ready-to-work issues; Phases 2–5 are epic-level stubs to be expanded when their phase opens (MVP-first, per design §10).

---

## Milestones

| #   | Milestone                                  | Issues   | Roadmap phase |
| --- | ------------------------------------------ | -------- | ------------- |
| 13  | The Loom — Phase 0: Decommission & Salvage | #286–292 | 0             |
| 14  | The Loom — Phase 1: MVP                    | #293–310 | 1             |
| 15  | The Loom — Phase 2: Living World           | #311–313 | 2             |
| 16  | The Loom — Phase 3: Rapid Worlds           | #314–315 | 3             |
| 17  | The Loom — Phase 4: Multiplayer            | #316–317 | 4             |
| 18  | The Loom — Phase 5: Visuals                | #318     | 5             |

All issues carry the `loom` label and a `> Suggested model:` line in the body. They follow the repo's existing issue template (Overview, design-doc ref, Phase, Depends-on, Deliverables, Acceptance criteria) and reference the **Olympus Web System** project in the footer (add manually — the API token lacks Projects scope).

---

## Model-routing rubric

The aim is to **keep Opus off the bulk of the work** and reserve it for the parts where a plausible-but-wrong result is expensive and hard to detect.

| Model          | When to use                                                                                                                                                                                                         | Character                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **Haiku 4.5**  | Mechanical, single-file, trivially verifiable edits (flag flip, doc banner). No design judgment.                                                                                                                    | Cheapest; bounded        |
| **Sonnet 4.6** | The **default for implementation**: a clear spec plus an existing in-repo pattern to mirror. Features, UI, rules, data models, tests, summarizers, conversions.                                                     | The bulk of the build    |
| **Opus 4.8**   | The control **spine** (pipeline orchestrator, adjudication engine, canon schema seam, exit-criterion proof) and all **design decisions / epic decompositions** (lay out tradeoffs; the human makes the final call). | Reserved; highest-stakes |

**Distribution:** 2 Haiku · 19 Sonnet · 12 Opus. Of the 12 Opus, only ~6 are actual coding — the rest are decision or epic-decomposition issues.

---

## Phase 0 — Decommission & Salvage (milestone #13)

| ID    | #   | Title                                                               | Model      | Why                                                                         |
| ----- | --- | ------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------- |
| L-001 | 286 | Soft-retire Void Odyssey (`enabled:false`)                          | **Haiku**  | One-line config flip, trivially verifiable                                  |
| L-002 | 287 | Salvage VO journeys/ships → scenario; document resolution-injection | **Sonnet** | Read two known config files, write a draft + note                           |
| L-003 | 288 | Export/archive VO Firestore collections                             | **Sonnet** | Straightforward export scripting; handle live data carefully                |
| L-004 | 289 | Remove VO code, clean apps.yaml, dispose claims                     | **Sonnet** | Multi-file removal against a concrete checklist; must not break shared code |
| L-005 | 290 | Archive `tortuga-design.md` into Loom lineage                       | **Haiku**  | Superseded banner + cross-links to one file                                 |
| L-006 | 291 | Tortuga issue disposition pass (triage ~26)                         | **Opus**   | Per-issue judgment mapping onto a new design; human-in-the-loop             |
| L-007 | 292 | Remove Tortuga scaffolding                                          | **Sonnet** | Multi-file removal; Tortuga is client-side only (no Cloud Functions)        |

## Phase 1 — MVP (milestone #14)

| ID    | #   | Title                                                      | Model      | Why                                                                             |
| ----- | --- | ---------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------- |
| L-100 | 293 | App scaffold (`/public/apps/loom/`, registry, claim, auth) | **Sonnet** | Well-trodden scaffolding with a pattern to mirror                               |
| L-101 | 294 | Firestore collections + security rules                     | **Sonnet** | Mirror existing rule blocks; verified via rules tests                           |
| L-102 | 295 | Data models for world_state / saves / turns (§8)           | **Sonnet** | §8 is an explicit spec                                                          |
| L-103 | 296 | Canon layer: static config format + seed world             | **Opus**   | Schema is the seam Phase 3 ingestion must map onto (content authoring → Sonnet) |
| L-110 | 297 | `loomPlayTurn` pipeline orchestrator                       | **Opus**   | Defines the stage interfaces; the spine of "LLM proposes, server disposes"      |
| L-111 | 298 | Stage 2 INTERPRET (Flash structured output)                | **Sonnet** | One bounded LLM call with a fixed schema                                        |
| L-112 | 299 | Stage 3 ADJUDICATE (rules engine + server dice)            | **Opus**   | Where rule-breaking/hallucination is stopped; correctness is the thesis         |
| L-113 | 300 | Stage 4 NARRATE (constrained by Resolution)                | **Sonnet** | Context assembly + one Flash call against fixed inputs                          |
| L-114 | 301 | Stage 5 COMMIT (apply mutations, log, regen)               | **Sonnet** | Against the orchestrator interface; correctness-critical → lean on tests        |
| L-115 | 302 | Soft-canon quarantine + promotion                          | **Sonnet** | Bounded once L-141 policy is decided (else escalate to Opus)                    |
| L-116 | 303 | Rolling summary regeneration                               | **Sonnet** | Bounded async summarizer, one `callGemini` call                                 |
| L-117 | 304 | Entity-keyed retrieval from event log                      | **Sonnet** | Firestore query + helper against a clear schema                                 |
| L-120 | 305 | Play UI (routing, turn input, narration)                   | **Sonnet** | Standard vanilla-JS front end                                                   |
| L-121 | 306 | Save & resume (lift Tortuga pattern)                       | **Sonnet** | A proven in-repo pattern to port                                                |
| L-130 | 307 | Jest integration tests for `loomPlayTurn`                  | **Sonnet** | Direct port of the VO turn-test harness                                         |
| L-131 | 308 | Phase 1 verification harness (exit-criterion proof)        | **Opus**   | Adversarial proof of the whole thesis; a false pass is expensive                |
| L-140 | 309 | Decision: rule-engine expressiveness                       | **Opus**   | Design decision; shapes the entire adjudication layer                           |
| L-141 | 310 | Decision: canon authority                                  | **Opus**   | Design decision; constrains security model + promotion path                     |

## Phases 2–5 — Epics & later decisions (milestones #15–18)

| ID    | #   | Title                                         | Model      | Why                                                                  |
| ----- | --- | --------------------------------------------- | ---------- | -------------------------------------------------------------------- |
| L-200 | 311 | [Epic] `loomWorldTick` batch world simulation | **Opus**   | Decompose + design batch-sim model (concurrency-sensitive)           |
| L-201 | 312 | Decision: world-tick vs. player presence      | **Opus**   | Concurrency reasoning; multiplayer-compat implications               |
| L-202 | 313 | [Epic] Richer rule sets                       | **Sonnet** | Epic shell + additive rules (Opus only if a rule _schema_ is chosen) |
| L-300 | 314 | [Epic] Cartographer → Loom canon ingestion    | **Opus**   | Decompose + design lossless schema mapping onto the L-103 seam       |
| L-301 | 315 | Convert Caribbean/VO settings into worlds     | **Sonnet** | Content conversion against an established schema                     |
| L-400 | 316 | [Epic] Multiplayer (four tiers)               | **Opus**   | Decompose + design shared-state/concurrency model                    |
| L-401 | 317 | Decision: multiplayer conflict resolution     | **Opus**   | Distributed-write correctness; ripples into earlier write model      |
| L-500 | 318 | [Epic] Imagen 4 scene/portrait generation     | **Sonnet** | Imagen already proven elsewhere in Olympus                           |

---

## Summary by model

- **Haiku 4.5 (2):** #286, #290
- **Sonnet 4.6 (19):** #287, #288, #289, #292, #293, #294, #295, #298, #300, #301, #302, #303, #304, #305, #306, #307, #313, #315, #318
- **Opus 4.8 (12):** #291, #296, #297, #299, #308, #309, #310, #311, #312, #314, #316, #317
  - _Coding spine (~6):_ #296, #297, #299, #308 (+ epic design in #311, #314, #316)
  - _Decisions:_ #309, #310, #312, #317
  - _Judgment/triage:_ #291

## Critical path note (Phase 1)

The only Opus work on the Phase 1 build path is the spine chain **L-103 (#296) → L-110 (#297) → L-112 (#299)**, plus **L-131 (#308)** at the exit gate. Everything that feeds them and follows them — the other four pipeline stages (#298/#300/#301), memory machinery (#302/#303/#304), the UI (#305/#306), and tests (#307) — is Sonnet. Practical sequencing: have Opus define the seams (canon schema, orchestrator interfaces, adjudication engine), then hand the stage implementations to Sonnet. The two decision issues (#309 rule-engine, #310 canon authority) should be resolved early because they block #299 and #302 respectively.

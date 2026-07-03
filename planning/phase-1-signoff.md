# The Loom — Phase 1 (MVP) Exit-Criterion Sign-Off

**Milestone:** The Loom — Phase 1: MVP
**Gate (design doc §10):** "A multi-session adventure that, across a session gap, never forgets hard state, never breaks the seeded rules, and never silently contradicts canon. Resume works."

## Verification method

`tests/loom-verification.test.js` (L-131 / #308) is the automated, reproducible
demonstration of the gate. It runs the real `loomCreateSave` / `loomPlayTurn` /
`loomDeleteSave` callables against the Firestore emulator and the real
shattered-coast canon world, with only `functions/gemini.js` mocked (so the
scenario is deterministic and network-free while every other stage of the §5
pipeline — INTERPRET, ADJUDICATE, NARRATE, COMMIT, soft-canon, retrieval,
summary — runs for real).

It scripts one continuous adventure across a simulated session gap:

1. **Session 1** — the player talks to Captain Orla Vance (the model invents a
   one-off NPC, "Bramwell," mentioned once) and then makes a legal move to
   Skeleton Cove. This sets the hard fact under test: `save.location` and
   `worldState.worldClock`.
2. **Session gap** — the test re-reads the save and world state directly from
   Firestore, standing in for the player closing the app and returning later.
   Nothing is carried in process memory.
3. **Session 2**:
   - An illegal move (Skeleton Cove → Fort Augustine, not a direct
     connection) is attempted; the mocked model's narration lies and claims
     arrival. ADJUDICATE rejects it regardless — the seeded rule holds.
   - The player rows back to Widow's Reach and talks to the captain again;
     the NARRATE call for that turn is asserted to receive session 1's
     narration about her, proving entity-keyed retrieval survives the gap.
   - Bramwell is mentioned a second time. Only now is the entity promoted into
     `worldState.globalFlags`. The frozen canon module (`functions/loom-canon`)
     is snapshotted before the scenario and diffed after: it is byte-for-byte
     identical, and no character named "Bramwell" exists in it — the invention
     never became canon.
4. Cleanup deletes the save via `loomDeleteSave`.

## Result

**PASS.** All four checks (hard state, seeded rules, canon integrity, resume)
and the cleanup step pass. The scenario runs as part of the standard test
suite (`cd tests && npm test`), which executes in CI on every push/PR to
`main` via `.github/workflows/firestore-rules.yml`, so this sign-off is
continuously re-verified rather than a one-time manual check.

To reproduce locally:

```bash
firebase emulators:exec --only firestore --project demo-loom-test \
  "cd tests && npx jest loom-verification --verbose"
```

This is the Phase 1 gate sign-off referenced by design doc §10. Phase 2 work
should not begin until this file reflects a passing run against the current
`main`.

# Initiative 1 — MCP Foundation

**Status:** Draft for review
**Project:** Olympus (`olympus-dfa00`)
**Program:** Crawl / Walk / Run — three initiatives that build on each other
**This initiative:** Crawl — prove inbound MCP works end to end, as a reusable per-app substrate
**Related:** The Loom (frozen as-is), The Cartographer (Initiative 2), Loom-as-game-system (Initiative 3)

---

## 1. Program Context

This is the first of three initiatives that bring Claude and Olympus together incrementally:

| #     | Initiative                    | Role                                                                                                                                    |
| ----- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **MCP Foundation** (this doc) | Make MCP a first-class, reusable capability of the Olympus platform, proven by a throwaway POC app. Core plumbing for everything after. |
| 2     | The Cartographer              | A world/lore-building app that uses the Initiative 1 MCP layer so Claude can help author canon.                                         |
| 3     | Game system                   | Brings it together, meeting the Loom's goals — using MCP + Claude (external) for AI flavor instead of Gemini.                           |

The Loom as it exists today is left untouched. Initiatives 2 and 3 are separate planning docs/milestones; this doc is scoped strictly to Initiative 1.

---

## 2. The One Direction: Inbound Only

MCP can be integrated in two directions. **This initiative builds only one of them, end to end.**

- **Inbound (this initiative):** Olympus _is_ an MCP server. A human talks to _their own_ Claude client — including the **iOS Claude app** — and Claude reaches into Olympus to read and write via MCP tools and resources. The thinking happens in the user's Claude; **Olympus runs no LLM in this path and incurs no model cost.**
- **Outbound (out of scope for the whole program):** Olympus calling a hosted LLM API to drive its own features. There is no current use case, so no outbound code is written anywhere in this three-initiative program. **All three initiatives are inbound-only** — Initiative 3 is Claude-as-narrator inside the Claude app, with Olympus as host and game engine (see §13), not Olympus calling out. If an internal LLM need ever arises, it would use **Gemini** (already proven in Olympus), never an outbound Anthropic call.

**Consequence:** because iOS is a required target from day one, and the iOS/claude.ai custom-connector path only speaks **OAuth 2.1**, the OAuth authorization server is core to Initiative 1 — not a later "walk" step. There is no personal-access-token product path; a static bearer token exists only as a local dev/testing shim for MCP Inspector.

---

## 3. Goals and Non-Goals

**Goals**

- A reusable MCP capability any Olympus app can plug into by registering tools/resources — mirroring how apps already register in `apps.yaml` and own a `hasApp()` claim.
- **Per-app connectors:** each app (POC, later Symposium, Loom, Cartographer) is a _separate connector_ the user sets up on the client, with its own URL, its own audience-bound token, and its own tool list.
- Full inbound OAuth 2.1 handshake with **Dynamic Client Registration**, so a connector can be added on iOS by pasting a URL.
- A throwaway POC app that proves create/read/update/delete from an external Claude client with real Olympus auth.
- Identity and authorization that reuse the existing Firebase Auth + custom-claims model exactly.

**Non-Goals (for now)**

- Any outbound LLM API usage (not in this program; a future internal LLM need would use Gemini).
- Any LLM running inside an Olympus app (the whole point is the external client).
- Cartographer / Loom domain tools (later initiatives; only their _pattern_ is proven here).
- MCP resources/prompts beyond the minimum needed to prove the model (rich resource catalogs come with real apps).
- Fine-grained intra-app scopes (read vs. write). The connector boundary = app boundary for the MVP; intra-app scopes stay behind a seam.

---

## 4. Design Principles

Inherits Olympus conventions, adds MCP-specific ones:

- **The connector boundary is the app boundary.** One app = one MCP resource server = one connector. Isolation is enforced at three layers: separate connector URL, audience-bound token, and `hasApp(appId)` claim check.
- **Build shared plumbing once, mount per app.** One OAuth AS, one host framework; apps contribute only a tool module. No app re-implements auth or transport.
- **Reuse the existing identity model.** Login is Firebase Auth. Authorization is the existing custom claims. The MCP server never invents a parallel user system.
- **Stateless on serverless.** MCP Streamable HTTP runs in stateless mode; access tokens are self-validating (signed JWT) so no per-request datastore read on the hot path.
- **Tokens can't cross apps.** Resource indicators (RFC 8707) bind every token to exactly one app's audience.
- **The server disposes.** Mutating tools validate exactly like the app's own writes would; the external model proposes, Olympus validates and commits.
- **Design doc first, MVP discipline, explicit phase exit criteria.**

---

## 5. Architecture

### 5.1 Topology

```
                       ┌─────────────────────────────────────────┐
   iOS / desktop /     │            Olympus (olympus-dfa00)        │
   claude.ai Claude    │                                           │
        │              │   Shared OAuth 2.1 Authorization Server   │
        │  OAuth 2.1   │   - /.well-known/oauth-authorization-server
        ├─────────────▶│   - /authorize  (consent, Firebase login) │
        │  (DCR, PKCE) │   - /token, /register, /revoke            │
        │              │              │ issues audience-bound tokens│
        │              │              ▼                             │
        │  MCP over     │   Per-app MCP resource servers (mounted): │
        │  Streamable   │   /mcp/scriptorium   (aud: .../scriptorium)
        ├─────────────▶│   /mcp/symposium     (aud: .../symposium)  ← later
        │              │   /mcp/loom          (aud: .../loom)       ← later
        │              │        each: /.well-known/oauth-protected-resource/<path>
        │              │              │                             │
        │              │              ▼                             │
        │              │   Shared MCP host framework                │
        │              │   (transport · token validation · registry)│
        │              │              │                             │
        │              │              ▼                             │
        │              │   Firestore (per-app collections, claims)  │
        └──────────────┴─────────────────────────────────────────┘
```

### 5.2 Clean origin via Hosting rewrites

`/mcp/**` and `/.well-known/**` are served on the **primary Olympus origin** via Firebase Hosting rewrites to the MCP Cloud Function:

```json
// firebase.json (sketch)
"rewrites": [
  { "source": "/mcp/**", "function": "mcpServer" },
  { "source": "/.well-known/oauth-authorization-server", "function": "mcpServer" },
  { "source": "/.well-known/oauth-protected-resource/**", "function": "mcpServer" }
]
```

This gives stable, pretty connector URLs (`https://olympus-dfa00.web.app/mcp/scriptorium`) and keeps OAuth resource-metadata origins matching the MCP endpoint origins, which the spec requires.

### 5.3 Per-app resource servers

Each app is a distinct **OAuth resource** identified by its endpoint URL:

- Discovery: `/.well-known/oauth-protected-resource/mcp/<appId>` (RFC 9728, path-based) describes that resource and points to the single shared AS.
- Audience: tokens for that connector carry `aud = https://.../mcp/<appId>` (RFC 8707 resource indicators). The resource server rejects any other audience.
- Access: every tool in the app checks `hasApp(appId)` against the token's mapped claims.

Adding a new app later is: implement a tool module, register it under an `appId`, and it auto-mounts at `/mcp/<appId>` with its own discovery doc and audience. No OAuth or transport work repeated.

---

## 6. OAuth 2.1 Flow

The AS is a small authorization server implemented in Cloud Functions. Firebase Auth performs the human login; the AS mints Olympus-issued tokens.

**Handshake (add-by-URL on iOS):**

1. Client fetches `/.well-known/oauth-protected-resource/mcp/<appId>` → learns the AS.
2. Client fetches `/.well-known/oauth-authorization-server` → learns endpoints, PKCE support (S256 required), registration endpoint.
3. **Dynamic Client Registration** (RFC 7591) at `/register` → client gets a `client_id` (public client, PKCE).
4. `/authorize` renders consent; the user signs in with **Firebase Auth** (same login as the web apps). Consent names the app being connected.
5. Authorization code (PKCE) → `/token` → **access token (short-lived, signed JWT, audience-bound) + refresh token (rotated, hashed at rest)**.
6. Client calls `/mcp/<appId>` with the bearer token; the resource server validates signature + `aud` locally, maps `sub` → uid → claims, exposes only that app's tools gated by `hasApp(appId)`.

**Token strategy**

- **Access token:** signed JWT (`sub=uid`, `aud=<app resource>`, `exp` short, minimal claims snapshot). Self-validating → no datastore read on the hot path (matters on serverless).
- **Refresh token:** opaque, stored hashed in Firestore, rotated on use, revocable.
- **Signing key:** Functions secret for MVP (symmetric); asymmetric/KMS noted as a hardening follow-up.

**Scopes ↔ claims:** MVP uses one scope per app (`mcp:<appId>`) that maps to the `hasApp(appId)` requirement. Intra-app read/write scopes stay behind a seam for later.

---

## 7. Olympus Integration

| Concern   | Implementation                                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Endpoints | Firebase Hosting rewrites → `mcpServer` Cloud Function (v2 `onRequest`, Node 22)                                                 |
| Transport | MCP Streamable HTTP, **stateless mode**                                                                                          |
| SDK       | `@modelcontextprotocol/sdk` (ESM) consumed from CommonJS functions via dynamic `import()` — resolved in the foundation spike     |
| AS        | Same function (or a sibling) hosting `/authorize`, `/token`, `/register`, `/revoke`, discovery docs                              |
| Identity  | Firebase Auth for login; custom claims (`apps[]`, `admin`) for authorization — unchanged                                         |
| Rules     | New `mcp_*` and `scriptorium_*` collections default-deny; server writes via Admin SDK act as the mapped user's authority in code |
| Deploy    | Existing GitHub Actions; new function + rewrites ride the standard merge deploy                                                  |

**New Firestore collections (Initiative 1):**

```
mcp_oauth_clients     // DCR-registered clients (client_id, redirect_uris, metadata)
mcp_oauth_codes       // short-lived authorization codes (PKCE), TTL
mcp_oauth_tokens      // refresh tokens (hashed), rotation + revocation state
mcp_audit             // tool-call + auth audit log (hardening)
scriptorium_notes     // the POC app's trivial CRUD data
```

---

## 8. The Tool Registry Pattern

The reusable seam every app plugs into. An app contributes a module:

```
registerApp('scriptorium', {
  resource: 'https://.../mcp/scriptorium',
  tools: [
    { name: 'list_notes',   schema, handler(ctx, args) { /* ctx.uid, ctx.claims */ } },
    { name: 'create_note',  schema, handler(ctx, args) { /* validates, writes */ } },
    { name: 'update_note',  schema, handler },
    { name: 'delete_note',  schema, handler },
  ],
  resources: [ { uri, name, read(ctx) } ],
});
```

The host composes registered apps, mounts each at `/mcp/<appId>`, generates its discovery doc, and injects an authenticated `ctx` (uid + claims) into every handler after validating the audience-bound token and `hasApp(appId)`. Apps never touch OAuth or transport.

---

## 9. The POC App — "Scriptorium"

Deliberately dumb; its only purpose is to exercise the plumbing.

- **No UI logic, no LLM.** A tiny Firestore-backed notes/facts list (`scriptorium_notes`), owner-scoped.
- **Tools:** `list_notes`, `create_note`, `update_note`, `delete_note` (+ one read-only `resource`).
- **Claim:** a `scriptorium` app claim, granted via The Pantheon like any other app.
- **Why separate from Symposium:** isolates MCP plumbing from real-app complexity for the crawl. Symposium becomes the _second connector_ that proves reuse and per-app isolation (stretch).

---

## 10. Security Model

- **Three-layer app isolation:** separate connector URL · audience-bound token (RFC 8707) · `hasApp(appId)` check.
- **PKCE S256 mandatory**, public clients only, exact redirect-URI matching per DCR registration.
- **Short-lived access tokens**, rotating refresh tokens, revocation endpoint + `mcp_oauth_tokens` state.
- **Least privilege in tools:** every handler authorizes against the mapped claims and validates inputs before any write; no raw passthrough to Firestore.
- **Audit log** of auth events and tool calls (`mcp_audit`).
- **Default-deny Firestore rules** for all new collections; the server writes via Admin SDK only after in-code authorization.

---

## 11. Roadmap (within Initiative 1)

Crawl → walk → run _inside_ the initiative. Explicit exit criteria.

| Phase                                | Scope                                                                                               | Exit criterion                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **1a — Transport spike**             | `mcpServer` function, Streamable HTTP stateless, ESM/CJS resolved, one `ping` tool, dev bearer shim | MCP Inspector lists and calls `ping` locally                                                           |
| **1b — Origin & discovery**          | Hosting rewrites; RFC 9728 (path-based) + RFC 8414 metadata                                         | Discovery docs resolve on the primary origin                                                           |
| **1c — OAuth AS core**               | `/authorize` + consent via Firebase Auth, `/token`, PKCE, JWT access + refresh                      | Auth-code + PKCE flow yields a working token by hand                                                   |
| **1d — DCR**                         | `/register` (RFC 7591)                                                                              | A client self-registers and completes the flow with no pre-config                                      |
| **1e — Resource binding + registry** | Per-app mount, audience validation (RFC 8707), `ctx` injection, `hasApp` gate                       | A token for app A is rejected by app B's endpoint                                                      |
| **1f — POC app**                     | Scriptorium claim, collection, 4 tools + 1 resource                                                 | Tools CRUD `scriptorium_notes` under the caller's identity                                             |
| **1g — iOS acceptance**              | Add the Scriptorium connector on the **iOS Claude app** by URL                                      | **From iOS: authorize with Olympus login, then create/read/update/delete Scriptorium data via Claude** |
| **1h — Hardening**                   | Revocation, rate limiting, audit log, cold-start/latency stance, error semantics                    | Revoked token denied; abusive calls throttled; events audited                                          |
| **1i — Grand Hall connections**      | "Manage connections" view in the Grand Hall profile: list authorized connectors, revoke each        | A user sees their active connectors and can revoke one; the revoked token is denied on next call       |
| **1j — Second connector (stretch)**  | One Symposium read tool as a second app module                                                      | Two connectors coexist on the client, each sees only its own tools; cross-app token replay fails       |

**Initiative exit criterion (the whole point):**

> From the **iOS Claude app**, add Olympus as a connector by URL, authorize with your Olympus login, and have Claude **read and write the POC app's data** — with a second app's connector proving clean per-app division.

If that holds, the seam is proven and Cartographer (Initiative 2) and the game system (Initiative 3) inherit it.

---

## 12. Open Questions & Decisions

### Decided (2026-07-03)

- **Inbound only, end to end** — no outbound Anthropic API in this initiative.
- **iOS is a day-one target** — therefore OAuth 2.1 is core, not deferred; personal-access tokens are a dev shim only.
- **DCR is in scope** — required for frictionless add-by-URL on mobile.
- **Per-app connectors** — one shared AS + one host framework + N per-app resource servers; each app is a separate connector with an audience-bound token. This is the isolation model, replacing a single mega-connector with intra-connector scopes.
- **Throwaway POC app ("Scriptorium")** — no LLM, no real domain; exists solely to prove the plumbing.
- **Clean origin via Hosting rewrites** — `/mcp/**` and `/.well-known/**` on the primary origin.
- **Access-token signing** — symmetric Functions secret for MVP; asymmetric/KMS is a later hardening option, not now.
- **Consent management** — per-connect consent **plus** a "manage connections" list in the Grand Hall profile where a user can review and revoke authorized connectors (phase 1i).
- **Cold-start latency** — accepted; no min-instances spend on `mcpServer` for the MVP. Revisit only if measured latency breaks client timeouts.

### Still open

- **Intra-app scopes (read vs. write):** one scope per app for the MVP (connector = app); a `requiredScope` field per tool is a purely additive change behind the §8 seam. Recommendation is to defer. The likely early pull is **Cartographer** (Initiative 2): read canon freely, gate canon writes behind explicit consent. Decide when we design Cartographer, not now.

---

## 13. Handoff to Later Initiatives

- **Initiative 2 (Cartographer):** a new app module registered through §8, mounted at `/mcp/cartographer`; its tools author canon. No new plumbing.
- **Initiative 3 (game system):** also **inbound**. Claude, inside the user's Claude app, is the **narrator and intent layer**; Olympus is the **host and game engine** — rules, server dice, authoritative world/character state, and canon — exposed through the Initiative 1 MCP layer as tools (submit action, query state), MCP prompts (start/continue an adventure), and resources (current scene, character sheet). Olympus adjudicates and disposes; Claude narrates the fixed result. This carries the Loom's "the model proposes, the server disposes" pipeline into MCP without Olympus running any LLM. No new plumbing beyond richer tools/prompts/resources registered through §8.

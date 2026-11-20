# The Image Studio — Local Images — Design Document v0.1

**Status:** Decided 2026-11-20. Sub-issues L-971 to L-974 filed as #884–#887 (§6).
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-970 (#883), Phase 6 — Studio and new worlds (milestone #22). Built alongside L-958 and L-960; it touches the studio and the MCP host, not the Loom.
**Depends on:** L-700 (the studio, [`the-image-studio.md`](./the-image-studio.md)), MCP Initiative 1 (the OAuth server, [`initiative-1-mcp-foundation.md`](./initiative-1-mcp-foundation.md)), `studio_import` (#833).
**Related:** [`the-muse.md`](./the-muse.md) (its photo libraries hold studio images)

---

## 1. Purpose

Gemini images cost $0.04–0.14 each. Story scenes and character portraits can be made instead on the owner's PC, which has an RTX 4090 (24 GB), with open models run in ComfyUI. Gemini stays for the art built into maps.

Two things are missing:

- **A way into the studio from the PC.** The page upload needs a person at the page. `studio_import` takes a file as base64, so a local file sent through Claude costs hundreds of thousands of tokens.
- **A steady way for Claude Code on the PC to make images** with ComfyUI.

This epic builds an uploader, a ComfyUI helper and a guide. Claude Code on the PC can then make images, look at them, and send the keepers to the studio, with no clicking and no tokens spent on the bytes.

---

## 2. What there is today

- **The library** (`studio_images`, L-701): each image has a title, a kind, labels, a view (L-955), an optional prompt, and `via` (generate, edit, upload, import, fit) with its source.
- **The page upload** is two steps: the file goes to Storage at `cartographer/{uid}/{uploadId}/`, then `studioUpload` checks and records it.
- **`studio_import`** (#833) takes a link or base64 (up to 5 MB). It skips an image already imported from the same link (`findBySource`). It doesn't recognise the same bytes arriving twice.
- **The MCP host** (`functions/mcp/`):
  - runs an OAuth 2.1 server: dynamic client registration, PKCE, one scope per connector (`mcp:<appId>`), grants;
  - keeps an audit log;
  - lets users list and revoke connections in the Grand Hall's "Manage connections" (`mcpListConnections`, `mcpRevokeConnection`).
- **ComfyUI** answers on `localhost:8188`:
  - `POST /prompt` takes a workflow in its API format;
  - `/history` reports a run;
  - each PNG it saves carries the workflow and the prompt in its text chunks.

---

## 3. Gap sheet

Answered 2026-11-20, every question as recommended.

### Decisions

| ID      | Decision                                                                                                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UP1** | A command-line uploader in the repo (`tools/studio-upload/`) for files, with a `--watch` mode that sends every new image saved in a folder                                                                 |
| **UP2** | A Node 22 script run with `npx` from the checkout; no packaged .exe                                                                                                                                        |
| **AU1** | It signs in like a connector: through the existing OAuth server in the browser once, approved as "Studio uploader", listed and revoked in Manage connections. Uploads go to a new endpoint on the MCP host |
| **AU2** | Upload only: it adds images and reads them (§4.1), and nothing else; no deleting, generating or spending                                                                                                   |
| **MD1** | Title, kind, labels and view from the command (or a sidecar file); the prompt, model, seed and size read from the PNG ComfyUI saved                                                                        |
| **MD2** | `via: 'local'`, with the model, seed and size kept on the record and shown on the card. The workflow itself isn't kept                                                                                     |
| **MD3** | The same image twice is skipped: by its bytes' hash, in the uploader and on the server                                                                                                                     |
| **MD4** | A `--world` option adds the world's label; assigning an image to a character or place stays with `studio_assign`                                                                                           |
| **MD5** | Local images counted on the costs page at $0, by model                                                                                                                                                     |
| **CC1** | A ComfyUI helper (`tools/comfy/`) that runs a named workflow and prints its files, and a Claude Code skill in the repo on making, picking and uploading                                                    |
| **CC2** | Starting workflows: Z-Image Turbo (portraits and scenes), Qwen-Image FP8 (finished scenes, text), Qwen-Image-Edit-2511 FP8 (a character again from a reference). Not FLUX.2 [dev]                          |
| **CC3** | The helper can fetch a studio image as a reference for the edit workflow                                                                                                                                   |
| **CC4** | No LoRA training in this epic; base models first                                                                                                                                                           |
| **PL1** | Built now, alongside L-958 and L-960                                                                                                                                                                       |
| **PL2** | The owner installs ComfyUI Desktop and the starting models before L-973, from steps in the guide                                                                                                           |
| **PL3** | The exit criterion as proposed (§5)                                                                                                                                                                        |

---

## 4. Design

### 4.1 The endpoint and its sign-in (AU1, AU2, MD2, MD3; L-971)

- **A scope of its own:** `studio:upload`. The OAuth server issues it only to a user with the `cartographer` claim, as it checks `hasApp` for `mcp:<appId>`.
  - The uploader registers as a client like any connector and asks for this scope alone.
  - Its grant is listed in Manage connections as "Studio uploader". Revoking it ends its tokens, as for a connector.
- **The endpoint:** `POST /mcp/studio/upload`, served by `mcpServer` under the existing `/mcp/**` rewrite.
  - It takes the image as the request body, with its details as a JSON header or a multipart part: title, kind, labels, view, prompt, and `made` (model, seed, width, height).
  - Its limits are the page upload's: PNG, JPEG, WebP or SVG, up to 30 MB.
  - It is checked by the same `readImage` and recorded by `library.addImage`, so a big image gets its screen copy as the page's do.
  - Each call is written to the audit log and rate-limited per user, as MCP calls are.
- **Reading an image (CC3):** `GET /mcp/studio/image/{imageId}` returns an image's file to the same token. It reads only, and gives no list, so it can't search the library. AU2's "nothing else" covers changes and spending; this read is what CC3 needs.
- **The record:**
  - `via: 'local'`;
  - `made: { model, seed, width, height }`, all optional;
  - `hash`, the SHA-256 of the bytes, which every new image now carries whatever its `via`.
- **Duplicates (MD3):** an image whose hash is already in the library isn't added again. The endpoint returns the existing image's id with `existing: true`.

### 4.2 The uploader (UP1, UP2, MD1, MD3, MD4; L-972)

- **`tools/studio-upload/`:** a Node 22 script with no build step.
  - **First run:** `studio-upload login` registers the client, opens the browser to `/authorize` with PKCE, and takes the code on a `localhost` redirect.
    - Its tokens are kept in the user's config folder (`%APPDATA%\olympus\studio-upload.json` on Windows), readable by the user only.
    - The access token is refreshed when it expires.
  - **Sending files:** `studio-upload <files…> --kind portrait --labels a,b --view iso --world <worldId> --title "…"`.
    - A file with no `--title` gets its name as its title.
    - A sidecar `<file>.json` beside an image can set any of these and wins over the command.
  - **Reading the PNG:** the prompt, the model (the checkpoint or UNet loader's file name), the seed and the size come from the PNG's ComfyUI text chunks, when it has them.
  - **Watching:** `--watch <folder>` sends each new image when it is complete, its size steady for a second. It keeps a list of hashes already sent, so a restart sends nothing twice.
  - **Its output:** one line of JSON per image (id, title, `existing`, or the error), so Claude Code can read it.

### 4.3 ComfyUI, the workflows and the guide (CC1–CC4, PL2; L-973)

- **`tools/comfy/`:** `comfy run <workflow> --prompt "…" --seed 7 --size 832x1216 --count 3 [--reference <file or studio:<imageId>>]`.
  - It fills the workflow's marked inputs, sends it to `localhost:8188`, and waits on `/history`.
  - It prints each output file's path as one line of JSON.
  - A `studio:<imageId>` reference is fetched through §4.1's read with the uploader's token.
- **The workflows** in `tools/comfy/workflows/`, in ComfyUI's API format, each with its inputs marked:
  - `portrait` and `scene-fast`: Z-Image Turbo;
  - `scene`: Qwen-Image FP8;
  - `edit-reference`: Qwen-Image-Edit-2511 FP8.
- **The guide:** `.claude/skills/studio-art/SKILL.md` tells Claude Code how to:
  - write a prompt from a world's brief and art direction (`get_world`) and a character's appearance;
  - make a few, look at them, and keep the best;
  - upload them with the right kind, view, labels and world.

  It also has the one-time setup: ComfyUI Desktop, the three models and where they go, and `studio-upload login`.

- **Testing:**
  - `comfy` runs against a small fake ComfyUI server in its tests;
  - the real models are tried once on the owner's PC, the epic's exit criterion (§5).

### 4.4 The page and the costs (MD2, MD5; L-974)

- **The studio page:**
  - a local image's card and detail say "Made locally with Z-Image Turbo, seed 4211, 832 × 1216";
  - the library can be filtered by how images came (generated, edited, uploaded, imported, local).
- **The costs:** each local image is entered at $0, under its model. The month's view shows local images beside Gemini's spending, by model and by day, so it shows how much has moved off Gemini.

### 4.5 Grading

Nothing to add: this epic adds a way to make art, not content to a world.

---

## 5. Exit criterion

On the owner's PC:

1. Claude Code is asked for "three portraits of a character in a world's style".
2. It makes them with ComfyUI from the world's brief, shows them, and uploads the ones the owner keeps.
3. Each appears in the studio with its kind, labels, prompt, model and seed, and at $0 on the costs page.
4. The uploader shows in Manage connections. Revoking it stops the next upload.

---

## 6. Sub-issues (filed 2026-11-20)

| ID    | Story                               | Issue | Depends on | Model  |
| ----- | ----------------------------------- | ----- | ---------- | ------ |
| L-971 | The upload endpoint and its sign-in | #884  | —          | Opus   |
| L-972 | The uploader                        | #885  | L-971      | Sonnet |
| L-973 | ComfyUI, the workflows and a guide  | #886  | L-972      | Sonnet |
| L-974 | Local images on the page and costs  | #887  | L-971      | Sonnet |

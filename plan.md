# JSX Runner App — Implementation Plan

## Overview

A new Olympus app at `/apps/jsx-runner/` that dynamically loads and runs JSX applets in the browser. Users select an applet from a sidebar menu (driven by a YAML manifest), and the JSX is transpiled and rendered client-side using Babel Standalone + React (loaded from CDN). No build step required — fits the existing static-hosting architecture.

---

## Architecture

```
public/apps/jsx-runner/
├── index.html          ← Main app shell (menu + render area)
├── jsx-runner.css       ← App-specific styles
├── js/
│   └── app.js           ← Core logic: YAML loading, menu rendering, JSX loading/transpiling
├── applets/             ← Drop folder for .jsx files
│   └── hello-world.jsx  ← Example applet
└── applets.yaml         ← Manifest controlling the menu
```

---

## Step-by-step Plan

### Step 1 — Create the YAML manifest format (`applets.yaml`)

Define the schema for `applets.yaml` that controls the sidebar menu:

```yaml
applets:
  - id: hello-world
    name: Hello World
    description: A simple greeting applet
    icon: 👋
    file: hello-world.jsx
  - id: counter
    name: Counter
    description: A click counter demo
    icon: 🔢
    file: counter.jsx
```

Each entry maps to a `.jsx` file in the `applets/` folder. The menu is built from this list.

### Step 2 — Create `index.html` (app shell)

- Follow the existing `_template/index.html` pattern (Firebase SDK, auth guard, shared header)
- Load CDN dependencies:
  - **React 18** + **ReactDOM 18** (UMD builds from `unpkg.com` or `cdnjs`)
  - **Babel Standalone** (for in-browser JSX transpilation)
  - **js-yaml** (for parsing the YAML manifest)
- Layout: sidebar (applet menu) + main content area (render target)
- The render target is a `<div id="jsx-root">` where React mounts the selected applet

### Step 3 — Create `jsx-runner.css` (styles)

- Sidebar menu styling consistent with Olympus dark theme
- Active applet highlight
- Responsive layout (sidebar collapses on mobile)
- Render area styling

### Step 4 — Create `js/app.js` (core logic)

Key responsibilities:

1. **Load manifest** — `fetch('applets.yaml')` → parse with `jsyaml.load()`
2. **Render menu** — Build sidebar from parsed YAML; each item is clickable
3. **Load applet** — On menu click:
   - `fetch('applets/<file>.jsx')` to get the raw JSX source
   - Transpile with `Babel.transform(source, { presets: ['react'] })`
   - Create a module-like wrapper that provides `React` and `ReactDOM` as globals
   - Execute the transpiled code and mount the exported component into `#jsx-root`
4. **Cleanup** — Unmount previous React root before mounting a new applet
5. **Error handling** — Display transpilation/runtime errors in the render area instead of crashing

**Applet contract**: Each `.jsx` file should export a default component by assigning to `window.__JSX_APPLET__`:

```jsx
function HelloWorld() {
  const [name, setName] = React.useState('World');
  return (
    <div>
      <h2>Hello, {name}!</h2>
      <input value={name} onChange={(e) => setName(e.target.value)} />
    </div>
  );
}
window.__JSX_APPLET__ = HelloWorld;
```

### Step 5 — Create example applet (`applets/hello-world.jsx`)

A simple interactive applet to demonstrate the system works.

### Step 6 — Register the app in Firestore (documentation)

The app needs to be registered via the existing `scripts/add-app.js` admin script so it appears in the Grand Hall. This is a manual admin step, not automated. Document it in a comment.

### Step 7 — Lint & format

Run `npm run lint:fix && npm run format` per project CLAUDE.md instructions.

---

## CDN Dependencies

| Library | CDN URL | Purpose |
|---------|---------|---------|
| React 18 | `unpkg.com/react@18/umd/react.production.min.js` | UI rendering |
| ReactDOM 18 | `unpkg.com/react-dom@18/umd/react-dom.production.min.js` | DOM mounting |
| Babel Standalone | `unpkg.com/@babel/standalone/babel.min.js` | JSX transpilation |
| js-yaml | `unpkg.com/js-yaml@4/dist/js-yaml.min.js` | YAML parsing |

---

## Files to Create (6 total)

1. `public/apps/jsx-runner/index.html`
2. `public/apps/jsx-runner/jsx-runner.css`
3. `public/apps/jsx-runner/js/app.js`
4. `public/apps/jsx-runner/applets.yaml`
5. `public/apps/jsx-runner/applets/hello-world.jsx`
6. `public/apps/jsx-runner/applets/counter.jsx` (second example)

No existing files need modification.

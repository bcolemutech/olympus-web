# olympus-web

Web application hosted on Firebase.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18.0.0
- [Firebase CLI](https://firebase.google.com/docs/cli) (`npm install -g firebase-tools`)

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/bcolemutech/olympus-web.git
   cd olympus-web
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Login to Firebase:
   ```bash
   firebase login
   ```

## Development

### Local Preview

Run the Firebase emulator to preview the site locally:

```bash
npm run emulator
```

Or run only hosting emulator:

```bash
npm run emulator:hosting
```

The site will be available at `http://localhost:5000`.

### Linting

Check for JavaScript issues:

```bash
npm run lint
```

Auto-fix issues:

```bash
npm run lint:fix
```

### Formatting

Format all files:

```bash
npm run format
```

Check formatting without changes:

```bash
npm run format:check
```

## Deployment

### Manual Deployment

Deploy to production:

```bash
npm run deploy
```

Deploy to a preview channel:

```bash
npm run deploy:preview
```

### CI/CD (GitHub Actions)

The project includes automated deployments via GitHub Actions:

| Workflow | Trigger | Action |
|----------|---------|--------|
| `firebase-hosting-pull-request.yml` | Pull Request | Deploys to a preview channel and comments the URL on the PR |
| `firebase-hosting-merge.yml` | Push to `main` | Deploys to production |

#### Required Secret

Add the following secret to your GitHub repository:

1. Go to **Settings** > **Secrets and variables** > **Actions**
2. Create a new secret named `FIREBASE_SERVICE_ACCOUNT_OLYMPUS_DFA00`
3. Value: JSON contents from Firebase Console > Project Settings > Service Accounts > Generate New Private Key

## Project Structure

```
olympus-web/
├── public/              # Static files served by Firebase Hosting
│   ├── index.html       # Main entry point (Grand Hall)
│   ├── styles/          # Shared CSS
│   ├── js/components/   # Shared JS components (e.g. app-header.js)
│   └── apps/            # Individual apps
│       ├── _template/   # Starter template for new apps
│       └── symposium/   # Example multi-file app
├── .github/workflows/   # GitHub Actions CI/CD
├── firebase.json        # Firebase configuration
├── firestore.rules      # Firestore security rules
├── firestore.indexes.json
├── .firebaserc          # Firebase project mapping
├── package.json         # Node.js dependencies and scripts
├── eslint.config.js     # ESLint configuration
└── .prettierrc          # Prettier configuration
```

## App Structure

Each app lives in `public/apps/<app-name>/`. Small apps can keep everything inline in `index.html` (see `_template/`). When an app grows beyond ~300 lines of inline JS, split into external files:

```
public/apps/<app-name>/
├── index.html          # HTML markup + auth guard + <script> tags
├── <app-name>.css      # App-specific styles (extracted from inline <style>)
└── js/
    ├── state.js        # Namespace init, constants, shared state, helpers
    ├── <module>.js     # Feature modules (IIFE, extends namespace)
    └── app.js          # Event listeners, init sequence (loads last)
```

**Namespace pattern** — each JS file is a self-executing IIFE that reads/extends a global namespace:

```js
(function () {
  'use strict';
  var AppName = window.AppName;
  AppName.myModule = {
    doSomething: function () { /* ... */ }
  };
})();
```

Script loading order matters — `state.js` first, `app.js` last. See `symposium/` for a complete example.

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run lint` | Check JavaScript for issues |
| `npm run lint:fix` | Auto-fix linting issues |
| `npm run format` | Format all files with Prettier |
| `npm run format:check` | Check formatting without changes |
| `npm run emulator` | Start Firebase emulators |
| `npm run emulator:hosting` | Start only hosting emulator |
| `npm run deploy` | Deploy to production |
| `npm run deploy:preview` | Deploy to preview channel |

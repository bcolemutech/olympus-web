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

## Cloud Functions

Firebase Cloud Functions live in `functions/` and use Node.js 22 with the Firebase Functions v2 (Gen 2) API.

### Available Functions

| Function | Description |
|----------|-------------|
| `setAdminRole` | Grants `admin: true` to a user by email. Caller must be an admin. |
| `removeAdminRole` | Revokes the `admin` claim from a user by email. Caller must be an admin. |

Both functions are callable from client code using the Firebase SDK:

```js
const setAdminRole = firebase.functions().httpsCallable('setAdminRole');
const result = await setAdminRole({ email: 'user@example.com' });
// result.data => { success: true, email: 'user@example.com' }
```

After a claim change, the target user must refresh their ID token before the new claim takes effect:

```js
await firebase.auth().currentUser.getIdToken(true); // force token refresh
```

### Bootstrap Admin Process

Because no user has `admin: true` initially, the very first admin must be set manually. This is a one-time operation.

**Option A — Firebase Console**

1. Go to the [Firebase Console](https://console.firebase.google.com/) > **Authentication** > **Users**
2. Find the user's UID
3. Open **Cloud Firestore** or use the Firebase Admin SDK REST API to set the custom claim — the Console UI does not support custom claims directly, so use Option B instead

**Option B — One-time script (recommended)**

Create a temporary local script (never commit credentials):

```js
// bootstrap-admin.js — run once locally, then delete
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import serviceAccount from './service-account-key.json' assert { type: 'json' };

const app = initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth(app);

const user = await auth.getUserByEmail('your-email@example.com');
const existing = user.customClaims || {};
await auth.setCustomUserClaims(user.uid, { ...existing, admin: true });
console.log('Admin claim set for', user.email);
process.exit(0);
```

Run it:

```bash
node bootstrap-admin.js
```

Then sign out and back in (or force a token refresh) to see the claim take effect. After this, subsequent admin grants and revocations can be done via the `setAdminRole` / `removeAdminRole` callable functions from any admin-authenticated client session.

> **Security note:** Obtain the service account key from Firebase Console > Project Settings > Service Accounts > Generate New Private Key. Never commit this file to the repository.

### Local Development with Functions

The `npm run emulator` command starts all emulators including Functions:

```
Firestore emulator → http://localhost:8080
Functions emulator → http://localhost:5001
```

> **Note:** The Firebase Functions emulator requires Java to be installed. Install it via your system package manager or from https://adoptium.net/.

### Functions Dependencies

Install the functions dependencies separately:

```bash
npm install --prefix functions
```

## Project Structure

```
olympus-web/
├── functions/           # Firebase Cloud Functions (Node.js 22, CommonJS)
│   ├── index.js         # setAdminRole, removeAdminRole callable functions
│   └── package.json     # Functions-specific dependencies
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

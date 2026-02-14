# The Oracle's Mirror — Profile & Access Revelation

**Priority:** High
**Effort:** Medium
**Dependencies:** The Grand Hall (#3), Manage Access Workflow (#14)

## Prophecy

When a mortal ascends to Olympus, they must be able to gaze into **The Oracle's Mirror** and behold their own reflection — who they are, when they arrived, and which divine halls they may enter. This story forges that mirror: a profile page where users see their identity and the apps the gods have granted them access to.

The Oracle's Mirror reads the user's Firebase Auth identity, consults the custom claims already inscribed by the Manage Access workflow, and reveals the names and descriptions of each granted app by querying the **App Registry** in Firestore.

## Acceptance Criteria

- [ ] Profile page created within `index.html` as a new view (consistent with SPA pattern)
- [ ] Navigation from The Grand Hall to the profile view and back
- [ ] User identity displayed: email, verification status, UID, account creation date
- [ ] Custom claims read from the user's ID token to determine app access
- [ ] App details fetched from the Firestore `apps` collection and displayed
- [ ] Empty state handled gracefully when no apps are granted
- [ ] Firestore security rules updated from temporary to permanent (authenticated read on `apps`, admin-only write)
- [ ] GitHub Actions workflow created to populate the App Registry via `workflow_dispatch`
- [ ] Visual design consistent with Olympus theme (golden gradients, night sky, divine glow)
- [ ] Responsive layout for mortal devices (mobile < 600px)

## The Vision

### The Oracle's Mirror (Profile View)

A new view within the SPA that reveals the user's divine credentials and granted dominions. The header provides passage back to The Grand Hall.

```
+--------------------------------------------------+
|  <- The Grand Hall          The Oracle's Mirror   |
+--------------------------------------------------+
|                                                    |
|  ---- Divine Credentials ----                      |
|                                                    |
|  Inscription:    mortal@olympus.com                |
|  Verified:       By decree of the gods             |
|  Divine Mark:    abc123...                          |
|  Ascended:       February 10, 2026                 |
|                                                    |
|  ---- Granted Dominions ----                       |
|                                                    |
|  +----------------------------------------------+ |
|  | [icon]  Forge of Hephaestus                   | |
|  |         The divine workshop of creation       | |
|  +----------------------------------------------+ |
|  | [icon]  Athena's Archive                      | |
|  |         Wisdom preserved in scroll and stone  | |
|  +----------------------------------------------+ |
|                                                    |
+--------------------------------------------------+
```

When no dominions have been granted:

```
  The Fates have not yet woven your thread
  to any divine halls. Seek an audience
  with the gods of Olympus.
```

### Firestore App Registry

The `apps` collection stores metadata for each application available on the platform. Documents are written exclusively via the Admin SDK (through GitHub Actions) and readable by any authenticated user.

```
apps/{appId}
  - name: string
  - description: string
  - icon: string (emoji)
  - type: 'embedded' | 'redirect'
  - url: string (for redirect apps)
  - path: string (for embedded apps)
  - enabled: boolean
  - order: number
```

### Permanent Firestore Rules

Replace the temporary development rules with permanent ones:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /apps/{appId} {
      allow read: if request.auth != null;
      allow write: if false; // Managed via Admin SDK only
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### App Registry Workflow

A `workflow_dispatch` workflow (`.github/workflows/add-app.yml`) that accepts app metadata inputs (ID, name, description, icon, type, path/URL, display order) and writes the document to the Firestore `apps` collection using the Admin SDK. Gated behind the `production` environment for approval.

## Technical Notes

- The profile view follows the existing SPA pattern in `index.html` — toggling visibility between The Grand Hall and The Oracle's Mirror rather than creating a separate HTML file
- Custom claims are already managed by `scripts/manage-access.js` and the Manage Access workflow (#14) — this story only reads them client-side via `getIdTokenResult()`
- Firestore SDK is already loaded in the page; initialize with `firebase.firestore()` (compat mode)
- The `add-app.yml` workflow follows the same pattern as `invite-user.yml` and `manage-access.yml` — isolated script with `scripts/package.json` dependencies

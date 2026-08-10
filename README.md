# Multi-workspace setup

## What changed

- Your apartment uses `?workspace=main` and stores data in `apartments/main`.
- Every additional apartment uses its own `apartments/{workspaceId}` document and a workspace-specific browser storage key.
- A platform administrator has the existing Firebase custom claim `{ admin: true }` and can open every workspace and create new ones.
- A created apartment administrator receives `{ workspaceId, workspaceAdmin: true }` and can open only that apartment's exact link.
- Visitors who open a workspace link without signing in receive a sanitized, read-only transparency view. It includes payment status and financial transactions but excludes resident contact/profile data and all editing features.

## Deploy once

From this project directory, install the Firebase CLI if needed, sign in, and select `tee-shirt-2`. Then deploy the rules, workspace function, and hosting:

```bash
firebase login
firebase use tee-shirt-2
cd functions
npm install
cd ..
firebase deploy --only firestore:rules,functions:createWorkspaceAccount,hosting
```

The first time the platform administrator opens the deployed site, the app migrates the old `budgetApp/apartment-amotan-main` data into `apartments/main`. Export a backup before deployment and confirm the new document before removing any legacy data.

After deploying the updated rules and website, sign into each workspace once. This publishes its initial sanitized `publicApartmentViews/{workspaceId}` document. After that, every administrator save refreshes the public view automatically.

## Create and share an apartment

1. Sign into the main site using the platform-administrator account.
2. Open **Settings**.
3. Under **Create Another Apartment**, enter the apartment name, administrator email, and a temporary password of at least 12 characters.
4. Select **Create Workspace & Login**.
5. Send the generated workspace link and temporary password separately.

Passwords are handled by Firebase Authentication and are never stored in Firestore. The recipient must use the exact workspace link. To change or reset a password, use Firebase Authentication's password-reset workflow or the Firebase Console.

## Current simple-account limitation

Each created account belongs to one apartment workspace. To move an account to a different apartment, update its custom claims from a privileged Admin SDK environment or create a different email account.

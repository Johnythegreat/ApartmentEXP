Apartment Amotan Tracker - Multi-Workspace Safety Upgrade

Upload these files to your GitHub Pages repo:
- index.html
- app.js
- styles.css
- firestore.rules only goes to Firebase Rules, not GitHub

Important Firebase setup:
1. Open Firebase Console > tee-shirt-2 project.
2. Go to Firestore Database.
3. Create database if not created yet.
4. Go to Rules.
5. Paste firestore.rules content.
6. Publish.
7. Hard refresh your GitHub Pages site: Ctrl + Shift + R.

Enable Firebase Authentication (Email/Password), create the admin user, and assign
that user an `admin: true` custom claim. The tracker intentionally refuses cloud
reads and writes for non-admin users because it contains resident and financial data.

If the badge says "Synced online", this signed-in browser can sync.
If the badge says "Local only", Firestore is not enabled, rules are not published, or the browser/network blocked Firebase.

Firestore documents used by the app:
apartments/{workspaceId}

Your existing apartment is apartments/main. The old
budgetApp/apartment-amotan-main document is read only for one-time migration.
See MULTI_WORKSPACE_SETUP.md before deployment and before creating accounts for
other apartments.

Open the browser console to confirm reads and writes. Logs start with:
[Firestore]

The app now uses one simple transaction form:
- Choose Money In or Expense.
- Enter amount, description, and date.
- Members are checked paid from the Members panel.

For local design testing without Firebase writes, open:
http://127.0.0.1:4173/?offline=1

There is no shared/default admin password. Use the Firebase admin account.

Before publishing the new rules, export a backup from the old app. After deploying
the rules and createWorkspaceAccount function, sign in and verify apartments/main.

Cycle rollover is manual. When 15 days have elapsed, the app warns the admin instead
of clearing income and expenses automatically. Download a backup and click End Cycle.

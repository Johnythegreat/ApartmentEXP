Apartment Amotan Tracker - Realtime Firebase Version

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

If the badge says "Synced online", phone and laptop will sync.
If the badge says "Local only", Firestore is not enabled, rules are not published, or the browser/network blocked Firebase.

Firestore document used by the app:
budgetApp/apartment-amotan-main

Open the browser console to confirm reads and writes. Logs start with:
[Firestore]

The app now uses one simple transaction form:
- Choose Money In or Expense.
- Enter amount, description, and date.
- Members are checked paid from the Members panel.

For local design testing without Firebase writes, open:
http://127.0.0.1:4173/?offline=1

Admin password: Master

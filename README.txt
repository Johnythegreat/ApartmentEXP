Apartment Amotan Tracker - Rebuilt Debugged Version

Features:
- Firebase realtime sync using onSnapshot
- Saves member checkbox state online
- Each checked member adds ₱700
- Manual Money In remains separate
- Expenses / Money Out
- Remaining balance = carryover + checked members + money in - expenses
- 15-day cycle auto check
- New cycle keeps sobra/carryover
- Password asked once per browser tab/session
- Password: Master

Setup:
1. Upload all files to GitHub Pages / Netlify.
2. In Firebase, enable Firestore Database.
3. Open Firestore Rules.
4. Paste the contents of firestore.rules and Publish.
5. Open the website on phone and laptop.
6. Make an edit and wait for the status to show Saved online / Online sync active.

If it still does not sync:
- Hard refresh browser.
- Make sure Firestore Database is created.
- Make sure rules are published.
- Open browser console and check for Firebase errors.

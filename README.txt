Apartment Amotan Tracker - Debugged + Data Merge

What is fixed:
- Removed visible password hint/message from the UI.
- Keeps one-time password unlock per browser session.
- Realtime Firebase sync for phone + laptop.
- Adds Recover Old Data button.
- Auto-detects old local saved data from previous versions and merges it.
- Member checkbox = ₱700 paid amotan.
- Money In remains separate.
- Expenses, carryover/sobra, reports, chart, announcements, dark mode, and CSV export remain included.

Important:
1. Upload all files to GitHub Pages.
2. Publish firestore.rules in Firebase Firestore Rules.
3. Hard refresh browser: Ctrl + Shift + R.
4. Open the app on the device/browser that contains your old data and click Recover Old Data.
5. After it syncs online, open it on your other device.

If the top badge says Local only, Firestore is not connected or rules are blocking access.

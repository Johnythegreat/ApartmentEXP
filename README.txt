APARTMENT DINNER BUDGET - CLOUD SYNC VERSION

Default admin password: Master

This app now works two ways:
1. Without Firebase config: saves locally only on the same phone/browser.
2. With Firebase config: syncs between phone, laptop, and other browsers.

HOW TO ENABLE PHONE + LAPTOP SYNC:
1. Create/open your Firebase project.
2. Enable Authentication > Sign-in method > Anonymous.
3. Enable Firestore Database.
4. Copy your Firebase Web App config.
5. Open firebase-config.js and replace the placeholder values.
6. In Firebase Firestore Rules, paste firestore.rules and publish.
7. Upload index.html, app.js, styles.css, firebase-config.js to Netlify/GitHub Pages.

Important:
- Same APARTMENT_ROOM_ID = same shared apartment budget.
- Change APARTMENT_ROOM_ID if you want a different apartment/group.
- Positive remaining balance/sobra carries over during reset.
- Member checkbox adds ₱700 per paid member.

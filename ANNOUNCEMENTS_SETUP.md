# Announcements setup

This is a static GitHub Pages frontend using Firebase Firestore. Secure admin management and notification delivery require Firebase Authentication, Firestore rules, and Cloud Functions.

1. Enable Firebase Authentication > Email/Password and create admin accounts.
2. Assign an `admin: true` custom claim with the Firebase Admin SDK, then have the user sign out/in.
3. Deploy `firestore.rules`.
4. In `functions/`, run `npm install`, then deploy with Firebase CLI.
5. Set secrets: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`.
6. A confirmation-email function should change subscriptions from `pending` to `active` and create a signed unsubscribe URL before production use.

## Messenger (optional, real server-side integration only)
Use a Meta app connected to a Facebook Page, Messenger Platform webhooks, explicit user opt-in, and approved messaging permissions. Required environment variables: `META_APP_ID`, `META_APP_SECRET`, `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `META_VERIFY_TOKEN`. Store Page-scoped user IDs only after opt-in. Send from Cloud Functions through the official Graph API and log a unique delivery key to prevent duplicates. Meta review/approval may be required depending on message type and timing window.

## Security note
The existing budget tracker still uses a shared client-side password and public Firestore access. This is not secure authentication. Migrate budget writes to Firebase Auth and restrictive per-user/role rules before storing sensitive data.

# Remaining known issues

- The tracker is still a large, single-page JavaScript application backed by one Firestore budget document. Revision checks prevent silent overwrites, but record-level collections would provide better multi-device merging and audit history.
- Existing local/browser data is not encrypted at rest. Use a dedicated admin device/browser profile and sign out/clear site data when retiring a device.
- The main dashboard's announcements are stored inside the private tracker document. The separate `announcements.js`/Cloud Functions collection workflow is an unfinished optional subsystem and is not loaded by `index.html`; email subscriptions and delivery therefore require a future integration pass.
- Email confirmation and signed self-service unsubscribe URLs are not implemented. Do not activate email subscriptions in production until those consent flows exist.
- Scheduled Cloud Function publishing requires Firebase billing/Cloud Scheduler and may require a Firestore composite index for `status` plus `scheduledAt`.
- Recovery snapshots are kept only in the same browser's local storage (five copies). They protect against common mistakes and sync conflicts but are not a substitute for downloaded/off-device backups.
- The Firestore rules and Cloud Functions were syntax-reviewed, but could not be deployed or exercised against the live Firebase project from this offline/local test environment.
- Profile images are embedded in the main document. Firestore's 1 MiB document limit can eventually be reached; move photos to Firebase Storage before using many resident photos.

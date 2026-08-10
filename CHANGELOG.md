# Safety upgrade changelog

## Multi-workspace upgrade

- Added isolated apartment workspaces selected by a shareable `?workspace=` link.
- Added a platform-admin Settings form that securely provisions a workspace and its first Firebase login through a protected callable Cloud Function.
- Added workspace-specific Firebase claims and Firestore authorization; created users can access only their assigned apartment.
- Added automatic one-time migration of the existing main tracker document into `apartments/main`.
- Scoped local browser storage, backups, and cloud conflict revisions to the selected workspace.

- Replaced the hard-coded shared `Master` password with Firebase Email/Password sign-in and an `admin: true` custom-claim check.
- Restricted the private tracker document to authenticated admins in Firestore rules; added deny-by-default coverage.
- Stopped automatic 15-day rollover from clearing transaction history on page load. The app now warns and requires a deliberate End Cycle action.
- Added rolling browser recovery snapshots before cycle rollover, restore, activity clearing, and full deletion.
- Added revision-checked Firestore transactions. Concurrent device changes now produce a visible conflict and recovery snapshot instead of silent last-write-wins data loss.
- Hardened backup restore with required-schema checks, app identity checks, a 20 MB limit, and ZIP bounds validation.
- Limited profile uploads to JPEG, PNG, and WebP to avoid storing active image formats.
- Tightened announcement subscription creation rules and protected notification delivery records.
- Updated the service worker cache version, removed stale caches on activation, and limited caching to same-origin GET requests.
- Updated deployment and admin setup documentation.

## Important deployment note

Export a backup before publishing the new rules. Configure Firebase Authentication and the admin custom claim first; otherwise the app will correctly remain local/read-only.

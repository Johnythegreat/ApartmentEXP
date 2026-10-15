# ApartmentEXP — Apartment Budget & Transparency Tracker

A multi-tenant apartment management and financial transparency progressive web app built on Firebase (Firestore, Authentication, Cloud Functions, and Hosting).

## Key Features & Architecture

### 1. Multi-Workspace Architecture
- **Isolated Namespaces:** Each apartment workspace operates within its own Firestore document (`apartments/{workspaceId}`) and public view document (`publicApartmentViews/{workspaceId}`), with strictly scoped local browser storage (`apartment-amotan-state-v5-workspace-{workspaceId}`).
- **Interactive Workspace Switcher:** Click the workspace indicator in the topbar or open Settings to launch the **Apartment Workspaces** modal.
  - **Platform Admin Directory:** Platform administrators can view and switch between all active apartment workspaces with a single click.
  - **Recent Workspaces:** Automatically tracks recently visited workspaces in `localStorage` for quick 1-click toggling on mobile and desktop.
  - **Direct Navigation:** Jump to any workspace slug or paste a full workspace URL.
  - **Instant Link Sharing:** One-click copy buttons for both the Workspace Management Link and Public Transparency Link with animated toast confirmation.

### 2. Firestore Sync & Intelligent Conflict Recovery
- **Real-Time Synchronization:** Listens to authoritative Firestore snapshots with optimistic local UI updates and debounce queueing.
- **Smart Conflict Resolution Dialog:** When concurrent edits occur across devices or sessions, a non-destructive conflict modal appears with comparative diff statistics (residents count, payment status, income, expenses) offering three clear resolution options:
  1. **Smart Merge (Recommended):** Intelligently merges records without data loss — combines transactions by ID, marks members paid if paid in either version, unifies utility bill shares, and retains the latest announcements.
  2. **Keep My Local Changes:** Bumps revision and pushes local state to the cloud (safely keeping a copy of the cloud document in Recovery Snapshots first).
  3. **Accept Cloud Version:** Loads the authoritative cloud document (safely keeping prior local edits in Recovery Snapshots first).
- **Recovery Snapshots Manager:** Accessible in Settings (`backupView`), this panel displays all automated restore points created during sync conflicts, cycle resets, or prior to data restores. Users can inspect, download as JSON, or perform a 1-click restore.
- **Online / Offline Auto-Reconnection:** Event listeners on `window.online` and `window.offline` seamlessly detect network status changes and immediately trigger sync retries for any pending edits when the connection returns.

### 3. Mobile-First Sign-In & Authentication
- **Dedicated Responsive Modal (`#signInModal`):** High-contrast, touch-optimized dialog with 44px tap targets, password visibility toggle, accessible `<form>` wrapper for virtual keyboard "Go/Enter" submissions, and inline error messaging.
- **Mobile Navigation Drawer Integration:** The slide-out mobile drawer (`#mainNav`) includes a persistent account status footer showing the current workspace, role ("Public Visitor" vs "Admin"), and a finger-friendly "Admin Sign In" or "Sign Out" button.
- **iOS Safari Optimization:** Input font sizes are locked at 16px to prevent automatic mobile Safari viewport zooming.
- **Email Memory:** Remembers the last signed-in admin email in `localStorage` so mobile administrators don't have to retype long email addresses.
- **Dual Support:** Inline topbar sign-in remains intact for desktop power users while linking cleanly with the modal.

### 4. Public Transaction Viewing & Transparency Mode
- **Read-Only Transparency View:** Visitors opening any workspace link without signing in receive a clean, read-only experience loaded directly from `publicApartmentViews/{workspaceId}`.
- **Privacy Protection:** Resident contact numbers, emails, emergency contacts, notes, and photos are strictly excluded from public views.
- **Transparent Transaction Explorer:**
  - Real-time Activity panel on Dashboard with live search keyword filter and segmented filter buttons (**All**, **Money In**, **Expenses**).
  - Detailed breakdown of all expenses, payment methods (Cash, GCash, Bank Transfer), categories, and notes in the Finance view.
  - Interactive financial reports and charts (monthly income vs expenses, category breakdowns, collection progress).
  - Clean UI: Admin mutation controls (Add Resident, Add Transaction, Add Expense, End Cycle, Delete buttons) are hidden in public mode to prevent confusion.
  - Official digital receipts for paid residents remain viewable and printable in public mode.

---

## Deployment Instructions

From this project directory, sign in to Firebase CLI and deploy:

```bash
firebase login
firebase use tee-shirt-2
cd functions
npm install
cd ..
firebase deploy --only firestore:rules,functions,hosting
```

### Daily Telegram Backup

The `sendDailyTelegramBackup` Cloud Function exports all documents in the `apartments` collection to JSON and sends it to Telegram daily at 2:00 AM (Asia/Manila time).

Set the required Firebase secrets:

```bash
firebase functions:secrets:set TELEGRAM_BOT_TOKEN
firebase functions:secrets:set TELEGRAM_CHAT_ID
firebase deploy --only functions:sendDailyTelegramBackup
```

---

## Creating and Managing Workspaces

1. Sign into the app using a platform administrator account (`{ admin: true }`).
2. Open **Settings** (`backupView`).
3. Under **Create Another Apartment**, enter:
   - Apartment Name
   - Workspace Link Name (slug, e.g. `green-valley`)
   - Administrator Email
   - Temporary Password (minimum 12 characters)
4. Select **Create Workspace & Login**.
5. Copy the generated workspace link and share credentials with the apartment admin.

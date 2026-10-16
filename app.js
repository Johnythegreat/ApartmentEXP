import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  collection,
  setDoc,
  onSnapshot,
  enableIndexedDbPersistence,
  serverTimestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyDYE1h4hmU8ppSa18Jz-veC6GADBgsIa3g",
  authDomain: "tee-shirt-2.firebaseapp.com",
  projectId: "tee-shirt-2",
  storageBucket: "tee-shirt-2.firebasestorage.app",
  messagingSenderId: "795409975965",
  appId: "1:795409975965:web:679a7672811d748677e274",
  measurementId: "G-QY4MJ62VFZ"
};

const AMOTAN_AMOUNT = 700;
const CYCLE_DAYS = 15;
const ELECTRICITY_AC_CHARGE = 1350;
const ELECTRICITY_AC_SHARE = 675;
const params = new URLSearchParams(window.location.search);
const OFFLINE_MODE = params.has("offline");
const STORAGE_SCOPE = params.get("test");
const requestedWorkspace = params.get("workspace") || "main";
const WORKSPACE_ID = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(requestedWorkspace) ? requestedWorkspace : "main";
const BASE_LOCAL_KEY = "apartment-amotan-state-v5";
const WORKSPACE_LOCAL_KEY = WORKSPACE_ID === "main" ? BASE_LOCAL_KEY : `${BASE_LOCAL_KEY}-workspace-${WORKSPACE_ID}`;
const LOCAL_KEY = STORAGE_SCOPE ? `${WORKSPACE_LOCAL_KEY}-${STORAGE_SCOPE}` : WORKSPACE_LOCAL_KEY;
const LEGACY_LOCAL_KEYS = STORAGE_SCOPE ? [] : ["apartment-amotan-state-v4", "apartment-amotan-state-v3"];
const FIRESTORE_COLLECTION = "apartments";
const FIRESTORE_DOC_ID = WORKSPACE_ID;
const FIRESTORE_DOC_PATH = `${FIRESTORE_COLLECTION}/${FIRESTORE_DOC_ID}`;
const LEGACY_FIRESTORE_DOC_PATH = "budgetApp/apartment-amotan-main";
const PROFILE_FIELDS = [
  { key: "fullName", label: "Full Name", inputId: "profileFullName" },
  { key: "nickname", label: "Nickname", inputId: "profileNickname" },
  { key: "dateOfBirth", label: "Date of Birth", inputId: "profileDateOfBirth" },
  { key: "gender", label: "Gender", inputId: "profileGender" },
  { key: "phone", label: "Phone Number", inputId: "profilePhone" },
  { key: "email", label: "Email", inputId: "profileEmail" },
  { key: "occupation", label: "Occupation", inputId: "profileOccupation" },
  { key: "emergencyContact", label: "Emergency Contact", inputId: "profileEmergencyContact" },
  { key: "apartmentRoom", label: "Apartment / Room", inputId: "profileApartmentRoom" },
  { key: "address", label: "Address", inputId: "profileAddress" },
  { key: "facebook", label: "Facebook Link", inputId: "profileFacebook" },
  { key: "notes", label: "Notes / Biography", inputId: "profileNotes" }
];
const PROFILE_PHOTO_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const BACKUP_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const EXPENSE_CATEGORIES = [
  "Electricity",
  "Water",
  "Internet",
  "Maintenance",
  "Repairs",
  "Cleaning",
  "Security",
  "Supplies",
  "Salary",
  "Miscellaneous"
];
const REPORT_EXPORT_NAME = "apartment-report";
const BACKUP_EXPORT_NAME = "apartment-tracker-backup";
const ANNOUNCEMENT_PRIORITIES = ["normal", "important", "urgent"];
const ANNOUNCEMENT_STATUSES = ["draft", "published", "scheduled", "archived"];
const THEME_KEY = "apartment-theme";
const SIDEBAR_KEY = "apartment-sidebar-collapsed";
const PAGE_TITLES = {
  home: "Dashboard",
  announcements: "Announcements",
  membersInfo: "Residents",
  reports: "Reports",
  expenses: "Finance",
  backup: "Settings"
};

const $ = (id) => document.getElementById(id);
const todayISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const money = (value) => `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const defaultState = () => ({
  members: [],
  announcements: [],
  income: [],
  expenses: [],
  bills: {
    electricity: defaultBill("Electricity Bill", "electricity"),
    water: defaultBill("Water Bill", "water")
  },
  rooms: [],
  settings: defaultSettings(),
  carryover: 0,
  cycleStarted: todayISO(),
  updatedAt: null
});

function defaultBill(name, key) {
  return {
    id: key,
    name,
    amount: 0,
    members: [],
    paidMembers: [],
    weights: {},
    date: todayISO(),
    updatedAt: null
  };
}

function defaultSettings() {
  return {
    apartmentName: "Apartment Tracker",
    autoBackup: {
      enabled: false,
      frequency: "weekly",
      lastRun: null
    }
  };
}

function defaultProfile() {
  return PROFILE_FIELDS.reduce((profile, field) => {
    profile[field.key] = "";
    return profile;
  }, { photo: "" });
}

function normalizeProfile(profile = {}) {
  const next = defaultProfile();
  for (const field of PROFILE_FIELDS) {
    next[field.key] = String(profile?.[field.key] || "").trim();
  }
  next.photo = typeof profile?.photo === "string" ? profile.photo : "";
  return next;
}

function normalizeMember(member = {}) {
  const profile = normalizeProfile(member.profile || {});
  return {
    ...member,
    id: member.id || uid(),
    name: String(member.name || profile.fullName || "Unnamed Member").trim(),
    paid: Boolean(member.paid),
    profile
  };
}

function normalizeAnnouncement(item = {}) {
  const priority = ANNOUNCEMENT_PRIORITIES.includes(item.priority) ? item.priority : "normal";
  const status = ANNOUNCEMENT_STATUSES.includes(item.status) ? item.status : "draft";
  const createdAt = item.createdAt || new Date().toISOString();
  return {
    ...item,
    id: item.id || uid(),
    title: String(item.title ?? "Untitled announcement").trim(),
    message: String(item.message || "").trim(),
    author: String(item.author || "Apartment Admin").trim(),
    priority,
    status,
    pinned: Boolean(item.pinned),
    date: item.date || todayISO(),
    scheduledAt: item.scheduledAt || "",
    publishedAt: item.publishedAt || "",
    createdAt,
    updatedAt: item.updatedAt || createdAt
  };
}

function normalizeIncome(item = {}) {
  return {
    ...item,
    id: item.id || uid(),
    amount: Number(item.amount || 0),
    description: String(item.description || "Money In").trim(),
    date: item.date || todayISO()
  };
}

function normalizeExpense(item = {}) {
  const category = EXPENSE_CATEGORIES.includes(item.category) ? item.category : "Miscellaneous";
  return {
    ...item,
    id: item.id || uid(),
    date: item.date || todayISO(),
    category,
    description: String(item.description || "Expense").trim(),
    amount: Number(item.amount || 0),
    paidBy: String(item.paidBy || "").trim(),
    paymentMethod: String(item.paymentMethod || "").trim(),
    receiptNumber: String(item.receiptNumber || "").trim(),
    notes: String(item.notes || "").trim()
  };
}

function normalizeRoom(room = {}) {
  return {
    ...room,
    id: room.id || uid(),
    name: String(room.name || room.number || "Room").trim(),
    status: room.status === "vacant" ? "vacant" : "occupied",
    memberId: room.memberId || ""
  };
}

function normalizeSettings(settings = {}) {
  const defaults = defaultSettings();
  const frequency = ["daily", "weekly", "monthly"].includes(settings?.autoBackup?.frequency)
    ? settings.autoBackup.frequency
    : defaults.autoBackup.frequency;
  return {
    ...defaults,
    ...(settings || {}),
    apartmentName: String(settings?.apartmentName || defaults.apartmentName).trim(),
    autoBackup: {
      ...defaults.autoBackup,
      ...(settings?.autoBackup || {}),
      enabled: Boolean(settings?.autoBackup?.enabled),
      frequency,
      lastRun: settings?.autoBackup?.lastRun || null
    }
  };
}

let state = defaultState();
let unlocked = false;
let docRef = null;
let auth = null;
let functions = null;
let isPlatformAdmin = false;
let cloudRevision = 0;
let cloudConflict = false;
let persistenceInitialized = false;
let publicDocRef = null;
let publicUnsubscribe = null;
let saveTimer = null;
let applyingRemote = false;
let saveInFlight = false;      // a cloud write is currently running
let saveQueued = false;        // another save was requested while one was running
let localDirty = false;        // local edits exist that the cloud has not confirmed yet
let ownRevisionInFlight = null; // revision our own write is about to produce (to ignore its echo)
let cloudUnsubscribe = null;   // so the realtime listener is never attached twice
const unsyncedKey = () => `${LOCAL_KEY}-unsynced`;
const RECENT_WORKSPACES_KEY = "apartment-recent-workspaces";
let pendingConflict = null;
let activityFilterType = "all";
let activitySearchTerm = "";
let activeProfileMemberId = null;
let editingProfileMemberId = null;
let activeView = "home";
let pendingRestoreState = null;
let deleteBackupDownloaded = false;
let showAllAnnouncements = false;
let expandedAnnouncementIds = new Set();
let resolveConfirm = null;

function logFirestore(action, detail = "") {
  console.info(`[Firestore] ${action}: ${FIRESTORE_DOC_PATH}${detail ? ` (${detail})` : ""}`);
}

function hasMeaningfulLocalData(localState) {
  return Boolean(
    localState.members?.length ||
    localState.announcements?.length ||
    localState.income?.length ||
    localState.expenses?.length ||
    localState.carryover ||
    localState.bills?.electricity?.amount ||
    localState.bills?.water?.amount
  );
}

function normalizeState(data) {
  const next = {
    ...defaultState(),
    ...(data || {}),
    members: Array.isArray(data?.members) ? data.members.map(normalizeMember) : [],
    announcements: Array.isArray(data?.announcements) ? data.announcements.map(normalizeAnnouncement) : [],
    income: Array.isArray(data?.income) ? data.income.map(normalizeIncome) : [],
    expenses: Array.isArray(data?.expenses) ? data.expenses.map(normalizeExpense) : [],
    bills: {
      electricity: normalizeBill(data?.bills?.electricity, "Electricity Bill", "electricity"),
      water: normalizeBill(data?.bills?.water, "Water Bill", "water")
    },
    rooms: Array.isArray(data?.rooms) ? data.rooms.map(normalizeRoom) : [],
    settings: normalizeSettings(data?.settings),
    carryover: Number(data?.carryover || 0),
    cycleStarted: data?.cycleStarted || todayISO()
  };
  syncBillMembers(next);
  return next;
}

function normalizeBill(bill, name, key) {
  return {
    ...defaultBill(name, key),
    ...(bill || {}),
    amount: Number(bill?.amount || 0),
    members: Array.isArray(bill?.members) ? bill.members : [],
    paidMembers: Array.isArray(bill?.paidMembers) ? bill.paidMembers : [],
    paidDates: bill?.paidDates && typeof bill.paidDates === "object" ? bill.paidDates : {},
    weights: bill?.weights && typeof bill.weights === "object" ? bill.weights : {},
    date: bill?.date || todayISO(),
    airconMembers: Array.isArray(bill?.airconMembers) ? bill.airconMembers.slice(0, 2) : []
  };
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY) || LEGACY_LOCAL_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
    return raw ? normalizeState(JSON.parse(raw)) : defaultState();
  } catch (error) {
    console.error("Local data could not be read; preserving the damaged value for recovery.", error);
    return defaultState();
  }
}

function saveLocal() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...state, updatedAt: Date.now() }));
  } catch (error) {
    console.error("Local save failed:", error);
    showNotice("This browser could not save locally. Download a backup before continuing.", false);
  }
}

function saveRecoverySnapshot(reason, data = state) {
  try {
    const key = `${LOCAL_KEY}-recovery`;
    const snapshots = JSON.parse(localStorage.getItem(key) || "[]");
    snapshots.unshift({ reason, savedAt: new Date().toISOString(), data: normalizeState(data) });
    localStorage.setItem(key, JSON.stringify(snapshots.slice(0, 5)));
  } catch (error) {
    console.warn("Recovery snapshot could not be stored:", error);
  }
}

function setStatus(text, mode) {
  const el = $("syncStatus");
  el.textContent = text;
  el.className = `status ${mode}`;
}

function showNotice(text = "", hidden = true) {
  const box = $("notice");
  box.hidden = hidden;
  box.textContent = text;
}

function setEditState() {
  const isUnlocked = Boolean(unlocked);
  document.body.classList.toggle("is-locked", !isUnlocked);

  $("editState").textContent = isUnlocked ? "Unlocked" : "Locked";
  if ($("unlockBox")) $("unlockBox").hidden = isUnlocked;
  if ($("openSignInModalBtn")) $("openSignInModalBtn").hidden = isUnlocked;
  if ($("summaryReportBtn")) $("summaryReportBtn").hidden = false;
  if ($("balanceActivityReportBtn")) $("balanceActivityReportBtn").hidden = false;
  if ($("lockBtn")) $("lockBtn").hidden = !isUnlocked;

  // Mobile nav drawer account info
  if ($("navAuthBadge")) {
    $("navAuthBadge").textContent = isUnlocked ? (isPlatformAdmin ? "Platform Admin" : "Workspace Admin") : "Public Visitor";
    $("navAuthBadge").classList.toggle("is-admin", isUnlocked);
  }
  if ($("navWorkspaceBadge")) $("navWorkspaceBadge").textContent = WORKSPACE_ID;
  if ($("navSignInBtn")) $("navSignInBtn").hidden = isUnlocked;
  if ($("navSignOutBtn")) $("navSignOutBtn").hidden = !isUnlocked;

  // Public Transparency Banner on Dashboard
  if ($("publicTransparencyBanner")) {
    $("publicTransparencyBanner").hidden = isUnlocked;
    if ($("transparencyApartmentName")) {
      $("transparencyApartmentName").textContent = state.settings?.apartmentName || "this apartment";
    }
  }

  // Finance view public transparency notice
  if ($("expensePublicNotice")) $("expensePublicNotice").hidden = isUnlocked;

  // Admin-only panels, quick actions, and disclosures
  if ($("addTransactionDisclosure")) $("addTransactionDisclosure").hidden = !isUnlocked;
  if ($("addMemberDisclosure")) $("addMemberDisclosure").hidden = !isUnlocked;
  if ($("cycleAdminTools")) $("cycleAdminTools").hidden = !isUnlocked;
  if ($("expenseFormPanel")) $("expenseFormPanel").hidden = !isUnlocked;
  if ($("quickActions")) $("quickActions").hidden = !isUnlocked;
  if ($("restoreFile")) $("restoreFile").disabled = !isUnlocked;
  if ($("autoBackupEnabled")) $("autoBackupEnabled").disabled = !isUnlocked;
  if ($("autoBackupFrequency")) $("autoBackupFrequency").disabled = !isUnlocked;
  if ($("downloadBeforeDelete")) $("downloadBeforeDelete").disabled = !isUnlocked;
  if ($("deleteConfirmInput")) $("deleteConfirmInput").disabled = !isUnlocked;

  if ($("workspaceLabel")) {
    const workspaceName = state.settings?.apartmentName || "Apartment Tracker";
    $("workspaceLabel").textContent = `Workspace: ${workspaceName} (${WORKSPACE_ID})`;
  }
  if ($("workspaceManager")) $("workspaceManager").hidden = !isPlatformAdmin;
  $("passwordInput").value = "";
}

function publicStatePayload() {
  const cleanMember = (member) => ({
    id: member.id,
    name: profileName(member),
    paid: Boolean(member.paid),
    paidAt: member.paidAt || ""
  });
  const cleanIncome = (item) => ({
    id: item.id,
    date: item.date,
    amount: Number(item.amount || 0),
    description: String(item.description || "")
  });
  const cleanExpense = (item) => ({
    id: item.id,
    date: item.date,
    amount: Number(item.amount || 0),
    description: String(item.description || ""),
    category: item.category || "Miscellaneous",
    paidBy: String(item.paidBy || ""),
    paymentMethod: String(item.paymentMethod || ""),
    receiptNumber: String(item.receiptNumber || ""),
    notes: String(item.notes || "")
  });
  const cleanBill = (bill) => ({
    id: bill.id,
    name: bill.name,
    amount: Number(bill.amount || 0),
    date: bill.date,
    members: Array.isArray(bill.members) ? bill.members : [],
    paidMembers: Array.isArray(bill.paidMembers) ? bill.paidMembers : [],
    paidDates: bill.paidDates && typeof bill.paidDates === "object" ? bill.paidDates : {},
    airconMembers: Array.isArray(bill.airconMembers) ? bill.airconMembers : []
  });
  return {
    workspaceId: WORKSPACE_ID,
    members: state.members.map(cleanMember),
    announcements: state.announcements.filter(announcementIsPublic),
    income: state.income.map(cleanIncome),
    expenses: state.expenses.map(cleanExpense),
    bills: { electricity: cleanBill(state.bills.electricity), water: cleanBill(state.bills.water) },
    rooms: [],
    settings: { apartmentName: state.settings.apartmentName },
    carryover: Number(state.carryover || 0),
    cycleStarted: state.cycleStarted,
    publishedAt: serverTimestamp()
  };
}

async function loadPublicWorkspace(db) {
  publicUnsubscribe?.();
  publicDocRef = doc(db, "publicApartmentViews", WORKSPACE_ID);
  const snapshot = await getDoc(publicDocRef);
  if (snapshot.exists()) {
    state = normalizeState(snapshot.data());
    recordRecentWorkspace(WORKSPACE_ID, state.settings?.apartmentName || WORKSPACE_ID);
    render();
    setStatus("Public view", "online");
    showNotice("Read-only transparency view. Sign in only if you are an apartment administrator.", false);
  } else {
    state = defaultState();
    render();
    setStatus("Public view", "local");
    showNotice("The administrator has not published this workspace's transparency view yet.", false);
  }
  publicUnsubscribe = onSnapshot(publicDocRef, (nextSnapshot) => {
    if (!nextSnapshot.exists() || unlocked) return;
    state = normalizeState(nextSnapshot.data());
    render();
    setStatus("Public view", "online");
  }, (error) => {
    console.error("Public workspace listener failed:", error);
    setStatus("Public view unavailable", "local");
  });
}


// ==========================================================================
// WORKSPACE RECENT TRACKING & NAVIGATION
// ==========================================================================

function getRecentWorkspaces() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_WORKSPACES_KEY) || "[]");
  } catch {
    return [];
  }
}

function recordRecentWorkspace(slug, name) {
  try {
    if (!slug) return;
    let recents = getRecentWorkspaces().filter((item) => item.slug !== slug);
    recents.unshift({
      slug,
      name: name || slug,
      lastVisited: new Date().toISOString()
    });
    localStorage.setItem(RECENT_WORKSPACES_KEY, JSON.stringify(recents.slice(0, 10)));
  } catch (e) {
    console.warn("Could not save recent workspace:", e);
  }
}

function extractWorkspaceSlug(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (raw.includes("workspace=") || /^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw, window.location.origin);
      const fromParam = parsed.searchParams.get("workspace");
      if (fromParam) return workspaceSlug(fromParam);
    } catch {
      const match = raw.match(/[?&]workspace=([^&#]+)/i);
      if (match) return workspaceSlug(decodeURIComponent(match[1]));
    }
  }
  return workspaceSlug(raw);
}

function isValidWorkspaceSlug(slug) {
  return slug === "main" || /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug);
}

function switchWorkspace(targetInput) {
  const sanitized = extractWorkspaceSlug(targetInput);
  if (!isValidWorkspaceSlug(sanitized)) {
    showNotice("Use a valid 3–40 character workspace slug (lowercase letters, numbers, and hyphens) or 'main'.", false);
    return;
  }
  if (sanitized === WORKSPACE_ID) {
    closeWorkspaceSwitcher();
    return;
  }
  if (unlocked || OFFLINE_MODE) {
    saveLocal();
  }
  recordRecentWorkspace(WORKSPACE_ID, state.settings?.apartmentName || WORKSPACE_ID);
  const existingRecent = getRecentWorkspaces().find((item) => item.slug === sanitized);
  recordRecentWorkspace(sanitized, existingRecent?.name || sanitized);
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set("workspace", sanitized);
  window.location.href = currentUrl.toString();
}

async function renderAdminWorkspacesList() {
  const container = $("platformAdminWorkspacesList");
  if (!container || !isPlatformAdmin) return;
  try {
    container.innerHTML = `<p class="loading-state">Loading workspaces...</p>`;
    const app = getApps()[0];
    if (!app) return;
    const db = getFirestore(app);
    const snap = await getDocs(collection(db, "apartments"));
    if (snap.empty) {
      container.innerHTML = `<p class="empty-state">No other apartment workspaces created yet.</p>`;
      return;
    }
    const workspaces = snap.docs.map((d) => ({
      id: d.id,
      name: d.data().settings?.apartmentName || d.id,
      memberCount: (d.data().members || []).length
    }));
    container.innerHTML = workspaces.map((w) => `
      <div class="workspace-card-item">
        <div>
          <strong>${escapeHTML(w.name)}</strong>
          <small>${escapeHTML(w.id)} • ${w.memberCount} resident${w.memberCount === 1 ? "" : "s"}</small>
        </div>
        <button class="secondary-btn mini switch-to-workspace-btn" data-slug="${escapeAttr(w.id)}" type="button" ${w.id === WORKSPACE_ID ? "disabled" : ""}>
          ${w.id === WORKSPACE_ID ? "Current" : "Switch"}
        </button>
      </div>
    `).join("");
  } catch (error) {
    console.warn("Could not load admin workspace directory:", error);
    container.innerHTML = `<p class="empty-state">Could not load directory. Deploy multi-workspace rules or check connection.</p>`;
  }
}

function renderWorkspaceSwitcher() {
  if ($("switcherActiveName")) $("switcherActiveName").textContent = state.settings?.apartmentName || "Apartment Tracker";
  if ($("switcherActiveSlug")) $("switcherActiveSlug").textContent = WORKSPACE_ID;

  const recentList = $("recentWorkspacesList");
  if (recentList) {
    const recents = getRecentWorkspaces().filter((item) => item.slug !== WORKSPACE_ID);
    if (!recents.length) {
      recentList.innerHTML = `<p class="empty-state">No other workspaces visited on this device yet.</p>`;
    } else {
      recentList.innerHTML = recents.map((item) => `
        <button class="recent-workspace-chip switch-to-workspace-btn" data-slug="${escapeAttr(item.slug)}" type="button">
          <i data-lucide="building" aria-hidden="true"></i>
          <span>${escapeHTML(item.name || item.slug)}</span>
        </button>
      `).join("");
    }
  }

  if ($("platformAdminWorkspacesBox")) {
    $("platformAdminWorkspacesBox").hidden = !isPlatformAdmin;
    if (isPlatformAdmin) renderAdminWorkspacesList();
  }

  refreshIcons();
}

function openWorkspaceSwitcher() {
  const modal = $("workspaceSwitcherModal");
  if (!modal) return;
  modal.hidden = false;
  renderWorkspaceSwitcher();
}

function closeWorkspaceSwitcher() {
  const modal = $("workspaceSwitcherModal");
  if (modal) modal.hidden = true;
  if ($("switcherCopyNotice")) $("switcherCopyNotice").hidden = true;
}

async function copyToClipboard(text, noticeEl) {
  try {
    await navigator.clipboard.writeText(text);
    if (noticeEl) {
      noticeEl.hidden = false;
      setTimeout(() => { noticeEl.hidden = true; }, 2500);
    } else {
      showNotice("Link copied to clipboard!", false);
    }
  } catch {
    showNotice("Could not copy link automatically. You can copy the URL from your browser address bar.", false);
  }
}

// ==========================================================================
// MOBILE & ACCESSIBLE AUTHENTICATION MODAL
// ==========================================================================

function openSignInModal() {
  const modal = $("signInModal");
  if (!modal) return;
  modal.hidden = false;
  if ($("modalSignInError")) {
    $("modalSignInError").hidden = true;
    $("modalSignInError").textContent = "";
  }
  if ($("modalTargetWorkspace")) $("modalTargetWorkspace").textContent = WORKSPACE_ID;
  const lastEmail = localStorage.getItem("apartment-last-admin-email") || "";
  if (lastEmail && $("modalEmailInput")) $("modalEmailInput").value = lastEmail;
  if ($("modalEmailInput") && $("modalEmailInput").value) {
    $("modalPasswordInput")?.focus();
  } else {
    $("modalEmailInput")?.focus();
  }
  refreshIcons();
}

function closeSignInModal() {
  const modal = $("signInModal");
  if (modal) modal.hidden = true;
  if ($("modalPasswordInput")) $("modalPasswordInput").value = "";
}

async function handleModalSignIn(e) {
  e.preventDefault();
  const email = $("modalEmailInput").value.trim();
  const password = $("modalPasswordInput").value;
  const errorBox = $("modalSignInError");
  const submitBtn = $("modalSignInSubmit");
  const btnText = submitBtn?.querySelector(".btn-text");
  const btnSpinner = submitBtn?.querySelector(".btn-spinner");

  if (OFFLINE_MODE) {
    if (errorBox) {
      errorBox.textContent = "Admin editing is disabled in offline preview mode.";
      errorBox.hidden = false;
    }
    return;
  }
  if (!email || !password) {
    if (errorBox) {
      errorBox.textContent = "Please enter both admin email and password.";
      errorBox.hidden = false;
    }
    return;
  }
  if (!auth) {
    if (errorBox) {
      errorBox.textContent = "Firebase authentication is still initializing. Please try again in a moment.";
      errorBox.hidden = false;
    }
    return;
  }

  try {
    if (submitBtn) submitBtn.disabled = true;
    if (btnText) btnText.hidden = true;
    if (btnSpinner) btnSpinner.hidden = false;
    if (errorBox) errorBox.hidden = true;

    const credential = await signInWithEmailAndPassword(auth, email, password);
    const token = await credential.user.getIdTokenResult(true);
    const canAccessWorkspace = token.claims.admin === true || (token.claims.workspaceAdmin === true && token.claims.workspaceId === WORKSPACE_ID);

    if (!canAccessWorkspace) {
      await signOut(auth);
      throw new Error(`This account cannot open workspace "${WORKSPACE_ID}". Use your assigned apartment link or sign in as platform admin.`);
    }

    localStorage.setItem("apartment-last-admin-email", email);
    isPlatformAdmin = token.claims.admin === true;
    unlocked = true;
    closeSignInModal();
    setEditState();
    renderAnnouncements();
    showNotice("Admin signed in. Loading shared tracker…", false);
    setAccountMenu(false);
    await initFirebase();
  } catch (error) {
    console.error("Sign in failed:", error);
    if (errorBox) {
      errorBox.textContent = error.message || "Admin sign-in failed. Please verify email and password.";
      errorBox.hidden = false;
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (btnText) btnText.hidden = false;
    if (btnSpinner) btnSpinner.hidden = true;
  }
}

// ==========================================================================
// SMART CONFLICT RESOLUTION & RECOVERY
// ==========================================================================

function smartMergeStates(local, remote) {
  const merged = normalizeState(remote);

  // 1. Members (merge profile fields preferring non-empty values so blank defaults never wipe cloud PII)
  const memberMap = new Map();
  for (const m of (remote.members || [])) {
    memberMap.set(m.id, { ...m });
  }
  for (const localMember of (local.members || [])) {
    if (memberMap.has(localMember.id)) {
      const existing = memberMap.get(localMember.id);
      const mergedProfile = defaultProfile();
      for (const field of PROFILE_FIELDS) {
        mergedProfile[field.key] = localMember.profile?.[field.key] || existing.profile?.[field.key] || "";
      }
      mergedProfile.photo = localMember.profile?.photo || existing.profile?.photo || "";
      memberMap.set(localMember.id, {
        ...existing,
        paid: Boolean(existing.paid || localMember.paid),
        paidAt: localMember.paidAt || existing.paidAt || (existing.paid || localMember.paid ? todayISO() : ""),
        name: (localMember.name && localMember.name !== "Unnamed Member") ? localMember.name : (existing.name || localMember.name),
        profile: mergedProfile
      });
    } else {
      memberMap.set(localMember.id, { ...localMember });
    }
  }
  merged.members = Array.from(memberMap.values());

  // 2. Income transactions (union by id, preferring local edits if modified)
  const incomeMap = new Map();
  for (const item of (remote.income || [])) incomeMap.set(item.id, item);
  for (const item of (local.income || [])) {
    incomeMap.set(item.id, item);
  }
  merged.income = Array.from(incomeMap.values()).sort((a, b) => `${b.date || ""}${b.id}`.localeCompare(`${a.date || ""}${a.id}`));

  // 3. Expenses (union by id, preferring local edits if modified)
  const expenseMap = new Map();
  for (const item of (remote.expenses || [])) expenseMap.set(item.id, item);
  for (const item of (local.expenses || [])) {
    expenseMap.set(item.id, item);
  }
  merged.expenses = Array.from(expenseMap.values()).sort((a, b) => `${b.date || ""}${b.id}`.localeCompare(`${a.date || ""}${a.id}`));

  // 3b. Rooms (union by id)
  const roomMap = new Map();
  for (const r of (remote.rooms || [])) roomMap.set(r.id, r);
  for (const r of (local.rooms || [])) roomMap.set(r.id, r);
  merged.rooms = Array.from(roomMap.values());

  // 4. Announcements (union by id, prefer newest updatedAt)
  const announcementMap = new Map();
  for (const a of (remote.announcements || [])) announcementMap.set(a.id, a);
  for (const a of (local.announcements || [])) {
    if (!announcementMap.has(a.id)) {
      announcementMap.set(a.id, a);
    } else {
      const remoteA = announcementMap.get(a.id);
      if ((a.updatedAt || "") > (remoteA.updatedAt || "")) {
        announcementMap.set(a.id, a);
      }
    }
  }
  merged.announcements = Array.from(announcementMap.values());

  // 5. Utility bills
  for (const key of ["electricity", "water"]) {
    const localBill = local.bills?.[key] || defaultBill("", key);
    const remoteBill = remote.bills?.[key] || defaultBill("", key);
    const billMembers = Array.from(new Set([...(localBill.members || []), ...(remoteBill.members || [])]));
    const paidMembers = Array.from(new Set([...(localBill.paidMembers || []), ...(remoteBill.paidMembers || [])]));
    const paidDates = { ...(remoteBill.paidDates || {}), ...(localBill.paidDates || {}) };
    const airconMembers = Array.from(new Set([...(localBill.airconMembers || []), ...(remoteBill.airconMembers || [])])).slice(0, 2);

    merged.bills[key] = {
      ...remoteBill,
      amount: Math.max(Number(localBill.amount || 0), Number(remoteBill.amount || 0)),
      date: localBill.date && localBill.date > (remoteBill.date || "") ? localBill.date : remoteBill.date || todayISO(),
      members: billMembers,
      paidMembers: paidMembers.filter((id) => billMembers.includes(id)),
      paidDates,
      airconMembers
    };
  }

  // 6. Settings
  merged.settings = {
    ...normalizeSettings(remote.settings),
    apartmentName: local.settings?.apartmentName || remote.settings?.apartmentName || "Apartment Tracker"
  };

  syncBillMembers(merged);
  return merged;
}

function showConflictModal(conflict) {
  pendingConflict = conflict;
  const modal = $("conflictModal");
  if (!modal) return;

  const localState = conflict.localState || state;
  const remoteState = conflict.remoteState || {};

  const localMembers = (localState.members || []).length;
  const localPaid = (localState.members || []).filter((m) => m.paid).length;
  const localTrans = (localState.income || []).length + (localState.expenses || []).length;

  const remoteMembers = (remoteState.members || []).length;
  const remotePaid = (remoteState.members || []).filter((m) => m.paid).length;
  const remoteTrans = (remoteState.income || []).length + (remoteState.expenses || []).length;

  if ($("conflictLocalTime")) $("conflictLocalTime").textContent = "Current Session";
  if ($("conflictLocalStats")) {
    $("conflictLocalStats").innerHTML = `
      <li><strong>${localMembers}</strong> residents (${localPaid} marked paid)</li>
      <li><strong>${localTrans}</strong> transactions (${(localState.income || []).length} in, ${(localState.expenses || []).length} out)</li>
    `;
  }

  if ($("conflictRemoteRevision")) $("conflictRemoteRevision").textContent = `Revision ${conflict.remoteRevision || "Cloud"}`;
  if ($("conflictRemoteStats")) {
    $("conflictRemoteStats").innerHTML = `
      <li><strong>${remoteMembers}</strong> residents (${remotePaid} marked paid)</li>
      <li><strong>${remoteTrans}</strong> transactions (${(remoteState.income || []).length} in, ${(remoteState.expenses || []).length} out)</li>
    `;
  }

  modal.hidden = false;
  refreshIcons();
}

function resolveConflict(choice) {
  if (!pendingConflict) return;
  const conflict = pendingConflict;

  if (choice === "merge") {
    saveRecoverySnapshot("Before applying smart merge conflict resolution", state);
    const merged = smartMergeStates(state, conflict.remoteState);
    state = merged;
    cloudRevision = Math.max(cloudRevision, conflict.remoteRevision);
    cloudConflict = false;
    pendingConflict = null;
    $("conflictModal").hidden = true;
    saveLocal();
    render();
    scheduleSave();
    showNotice("Conflict resolved: local changes and cloud data have been merged and saved.", false);
  } else if (choice === "keep-local") {
    saveRecoverySnapshot("Cloud copy superseded by keeping local version", conflict.remoteState);
    cloudRevision = Math.max(cloudRevision, conflict.remoteRevision);
    cloudConflict = false;
    pendingConflict = null;
    $("conflictModal").hidden = true;
    saveLocal();
    render();
    scheduleSave();
    showNotice("Conflict resolved: your local version has been scheduled to overwrite the cloud copy.", false);
  } else if (choice === "use-cloud") {
    saveRecoverySnapshot("Local edits kept before accepting cloud version", state);
    state = normalizeState(conflict.remoteState);
    cloudRevision = conflict.remoteRevision;
    cloudConflict = false;
    localDirty = false;
    pendingConflict = null;
    try { localStorage.removeItem(unsyncedKey()); } catch { /* ignore */ }
    $("conflictModal").hidden = true;
    saveLocal();
    checkAutoCycle();
    render();
    setStatus("Synced online", "online");
    showNotice("Conflict resolved: cloud version accepted. Your prior local edits are saved in Recovery Snapshots.", false);
  }
}

// ==========================================================================
// RECOVERY SNAPSHOTS MANAGER (IN SETTINGS)
// ==========================================================================

function renderRecoverySnapshots() {
  const container = $("recoverySnapshotsList");
  if (!container) return;
  try {
    const key = `${LOCAL_KEY}-recovery`;
    const snapshots = JSON.parse(localStorage.getItem(key) || "[]");
    if (!snapshots.length) {
      container.innerHTML = `<p class="empty-row">No recovery snapshots stored for this workspace yet.</p>`;
      return;
    }
    container.innerHTML = snapshots.map((snap, index) => {
      const data = snap.data || {};
      const memberCount = (data.members || []).length;
      const transCount = (data.income || []).length + (data.expenses || []).length;
      const dateStr = snap.savedAt ? new Date(snap.savedAt).toLocaleString("en-PH") : "Unknown date";
      return `
        <div class="snapshot-item-card">
          <div class="snapshot-meta">
            <strong>${escapeHTML(snap.reason || "Automatic Snapshot")}</strong>
            <small>${escapeHTML(dateStr)} • ${memberCount} resident${memberCount === 1 ? "" : "s"} • ${transCount} transaction${transCount === 1 ? "" : "s"}</small>
          </div>
          <div class="snapshot-actions">
            ${unlocked ? `<button class="secondary-btn mini restore-snapshot-btn" data-index="${index}" type="button">Restore</button>` : ""}
            <button class="ghost-btn mini download-snapshot-btn" data-index="${index}" type="button">Download</button>
          </div>
        </div>
      `;
    }).join("");
  } catch (error) {
    console.warn("Failed to render recovery snapshots:", error);
    container.innerHTML = `<p class="empty-row">Could not read recovery snapshots.</p>`;
  }
}

function daysBetween(startISO, endISO) {
  const start = new Date(`${startISO}T00:00:00`);
  const end = new Date(`${endISO}T00:00:00`);
  return Math.floor((end - start) / 86400000);
}

function escapeHTML(text = "") {
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

function escapeAttr(text = "") {
  return escapeHTML(text).replaceAll("\"", "&quot;");
}

function refreshIcons() {
  if (window.lucide?.createIcons) {
    window.lucide.createIcons({ attrs: { "stroke-width": 2 } });
  }
}

function setTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
  const toggle = $("themeToggle");
  if (toggle) {
    toggle.setAttribute("aria-label", next === "dark" ? "Switch to light mode" : "Switch to dark mode");
    toggle.innerHTML = `<i data-lucide="${next === "dark" ? "sun" : "moon"}" aria-hidden="true"></i>`;
  }
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = next === "dark" ? "#0f172a" : "#f8fafc";
  refreshIcons();
  renderReports();
}

function toggleTheme() {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  localStorage.setItem(SIDEBAR_KEY, collapsed ? "yes" : "no");
  const button = $("collapseNavBtn");
  if (button) {
    button.setAttribute("aria-pressed", String(collapsed));
    button.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    button.innerHTML = `<i data-lucide="${collapsed ? "panel-left-open" : "panel-left-close"}" aria-hidden="true"></i>`;
  }
  refreshIcons();
}

function setMobileNav(open) {
  document.body.classList.toggle("nav-open", open);
  if ($("mobileNavOverlay")) $("mobileNavOverlay").hidden = !open;
  if ($("mobileMenuBtn")) $("mobileMenuBtn").setAttribute("aria-expanded", String(open));
}

function setAccountMenu(open) {
  const menu = $("topbarActions");
  const button = $("topbarMenuBtn");
  if (!menu || !button) return;
  menu.classList.toggle("is-open", open);
  button.setAttribute("aria-expanded", String(open));
  button.setAttribute("aria-label", open ? "Close account menu" : "Open account menu");
}

function focusableElements(container) {
  return [...container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && el.offsetParent !== null);
}

function openConfirm({ title = "Confirm action", message = "This action cannot be undone.", acceptLabel = "Confirm", danger = true } = {}) {
  const modal = $("confirmModal");
  if (!modal) return Promise.resolve(window.confirm(message));
  $("confirmModalTitle").textContent = title;
  $("confirmModalBody").textContent = message;
  $("confirmAcceptBtn").textContent = acceptLabel;
  $("confirmAcceptBtn").className = danger ? "danger-btn" : "primary-btn";
  modal.hidden = false;
  refreshIcons();
  $("confirmCancelBtn").focus();
  return new Promise((resolve) => {
    resolveConfirm = resolve;
  });
}

function closeConfirm(accepted = false) {
  if ($("confirmModal")) $("confirmModal").hidden = true;
  if (resolveConfirm) resolveConfirm(accepted);
  resolveConfirm = null;
}

function safeURL(url = "") {
  const value = String(url || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value, window.location.href);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function profileName(member) {
  return member.profile?.fullName || member.name;
}

function profileInitials(member) {
  const source = profileName(member) || member.name || "?";
  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

function avatarMarkup(member, sizeClass = "") {
  const photo = member.profile?.photo;
  if (photo) {
    return `<img class="profile-avatar ${sizeClass}" src="${escapeAttr(photo)}" alt="${escapeAttr(profileName(member))}" />`;
  }
  return `<div class="profile-avatar default-avatar ${sizeClass}" aria-hidden="true">${escapeHTML(profileInitials(member))}</div>`;
}

function renderProfileValue(field, value) {
  if (field.key === "facebook") {
    const href = safeURL(value);
    return href ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(value)}</a>` : escapeHTML(value);
  }
  if (field.key === "email") {
    return `<a href="mailto:${escapeAttr(value)}">${escapeHTML(value)}</a>`;
  }
  if (field.key === "phone") {
    return `<a href="tel:${escapeAttr(value)}">${escapeHTML(value)}</a>`;
  }
  return escapeHTML(value);
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function resizeImageDataURL(dataURL) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxSide = 480;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.78));
    };
    img.onerror = () => resolve(dataURL);
    img.src = dataURL;
  });
}

async function profilePhotoFromFile(file) {
  if (!file) return "";
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPEG, PNG, or WebP profile photo.");
  if (file.size > PROFILE_PHOTO_MAX_UPLOAD_BYTES) throw new Error("Profile photo must be 5 MB or smaller.");
  return resizeImageDataURL(await readFileAsDataURL(file));
}

async function profileFromAddForm() {
  const profile = defaultProfile();
  for (const field of PROFILE_FIELDS) {
    profile[field.key] = $(field.inputId)?.value.trim() || "";
  }
  const photoFile = $("profilePhoto")?.files?.[0];
  profile.photo = photoFile ? await profilePhotoFromFile(photoFile) : "";
  return profile;
}

async function profileFromEditForm(form, existingProfile) {
  const profile = defaultProfile();
  for (const field of PROFILE_FIELDS) {
    profile[field.key] = form.elements[field.key]?.value.trim() || "";
  }
  profile.photo = form.elements.removePhoto?.checked ? "" : existingProfile.photo || "";
  const photoFile = form.elements.photo?.files?.[0];
  if (photoFile) profile.photo = await profilePhotoFromFile(photoFile);
  return profile;
}

function resetProfileForm() {
  for (const field of PROFILE_FIELDS) {
    const input = $(field.inputId);
    if (input) input.value = "";
  }
  if ($("profilePhoto")) $("profilePhoto").value = "";
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isoFromDate(date) {
  return date.toISOString().slice(0, 10);
}

function parseDate(value) {
  return value ? new Date(`${value}T00:00:00`) : null;
}

function inRange(dateValue, range) {
  const date = parseDate(dateValue);
  if (!date) return true;
  return date >= range.start && date <= range.end;
}

function monthKey(dateValue) {
  return (dateValue || todayISO()).slice(0, 7);
}

function ageFromBirthday(dateValue) {
  const birthday = parseDate(dateValue);
  if (!birthday) return "";
  const today = new Date();
  let age = today.getFullYear() - birthday.getFullYear();
  const monthDelta = today.getMonth() - birthday.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthday.getDate())) age--;
  return age >= 0 ? String(age) : "";
}

function prettyDate(dateValue) {
  const date = parseDate(dateValue);
  return date ? date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "";
}

function announcementIsPublic(announcement) {
  if (announcement.status === "published") return true;
  if (announcement.status !== "scheduled" || !announcement.scheduledAt) return false;
  return new Date(announcement.scheduledAt).getTime() <= Date.now();
}

function announcementTimestamp(announcement) {
  const value = announcement.status === "scheduled" && announcement.scheduledAt
    ? announcement.scheduledAt
    : announcement.publishedAt || `${announcement.date || todayISO()}T00:00:00`;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function publishedAnnouncements() {
  return state.announcements
    .filter(announcementIsPublic)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || announcementTimestamp(b) - announcementTimestamp(a));
}

function announcementPriorityLabel(priority) {
  return priority === "urgent" ? "Urgent" : priority === "important" ? "Important" : "Normal";
}

function announcementDisplayDate(announcement) {
  const date = announcement.status === "scheduled" && announcement.scheduledAt
    ? new Date(announcement.scheduledAt)
    : parseDate(announcement.date) || new Date(announcement.publishedAt || announcement.createdAt);
  return date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function announcementCardMarkup(announcement, compact = false) {
  const isExpanded = expandedAnnouncementIds.has(announcement.id);
  const isLong = announcement.message.length > 180;
  const shouldClamp = compact && isLong && !isExpanded;
  return `
    <article class="announcement-item priority-${announcement.priority} ${announcement.pinned ? "is-pinned" : ""}" data-id="${escapeAttr(announcement.id)}">
      <div class="announcement-item-head">
        <div class="announcement-labels">
          <span class="priority-label priority-${announcement.priority}">${announcementPriorityLabel(announcement.priority)}</span>
          ${announcement.pinned ? `<span class="pin-label">Pinned</span>` : ""}
        </div>
        <time datetime="${escapeAttr(announcement.date)}">${escapeHTML(announcementDisplayDate(announcement))}</time>
      </div>
      <h3>${escapeHTML(announcement.title)}</h3>
      <p class="announcement-message ${shouldClamp ? "is-preview" : ""}">${escapeHTML(announcement.message)}</p>
      ${compact && isLong ? `<button class="read-more-btn" type="button" data-id="${escapeAttr(announcement.id)}">${isExpanded ? "Show less" : "Read more"}</button>` : ""}
      <div class="announcement-meta">Posted by ${escapeHTML(announcement.author)}</div>
    </article>
  `;
}

function dateTimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function resetAnnouncementForm() {
  $("announcementId").value = "";
  $("announcementTitle").value = "";
  $("announcementAuthor").value = "Apartment Admin";
  $("announcementPriority").value = "normal";
  $("announcementDate").value = todayISO();
  $("announcementSchedule").value = "";
  $("announcementPinned").checked = false;
  $("announcementMessage").value = "";
  if ($("announcementCharacterGuide")) {
    $("announcementCharacterGuide").textContent = "0 / 1200 characters. Times use your browser timezone.";
  }
  $("cancelAnnouncementEdit").hidden = true;
}

function announcementFromForm() {
  const existing = state.announcements.find((item) => item.id === $("announcementId").value);
  return normalizeAnnouncement({
    ...(existing || {}),
    id: existing?.id || uid(),
    title: $("announcementTitle").value.trim(),
    message: $("announcementMessage").value.trim(),
    author: $("announcementAuthor").value.trim() || "Apartment Admin",
    priority: $("announcementPriority").value,
    pinned: $("announcementPinned").checked,
    date: $("announcementDate").value || todayISO(),
    updatedAt: new Date().toISOString()
  });
}

function validateAnnouncement(announcement) {
  if (!announcement.title) {
    showNotice("Enter an announcement title.", false);
    return false;
  }
  if (!announcement.message) {
    showNotice("Enter an announcement message.", false);
    return false;
  }
  return true;
}

function saveAnnouncement(status) {
  if (!requireUnlock()) return;
  const announcement = announcementFromForm();
  if (!validateAnnouncement(announcement)) return;
  const now = new Date().toISOString();

  if (status === "scheduled") {
    const scheduledValue = $("announcementSchedule").value;
    if (!scheduledValue) {
      showNotice("Choose a date and time before scheduling.", false);
      return;
    }
    const scheduledDate = new Date(scheduledValue);
    if (Number.isNaN(scheduledDate.getTime())) {
      showNotice("Choose a valid schedule date and time.", false);
      return;
    }
    if (scheduledDate.getTime() <= Date.now()) {
      showNotice("Choose a future date and time for a scheduled announcement.", false);
      return;
    }
    announcement.scheduledAt = scheduledDate.toISOString();
    announcement.publishedAt = "";
  } else if (status === "published") {
    announcement.publishedAt = now;
    announcement.scheduledAt = "";
  } else {
    announcement.scheduledAt = "";
  }

  announcement.status = status;
  const index = state.announcements.findIndex((item) => item.id === announcement.id);
  if (index >= 0) state.announcements[index] = announcement;
  else state.announcements.unshift(announcement);

  resetAnnouncementForm();
  showNotice(status === "draft" ? "Announcement saved as a draft." : status === "scheduled" ? "Announcement scheduled." : "Announcement published.", false);
  render();
  scheduleSave();
}

function editAnnouncement(id) {
  const announcement = state.announcements.find((item) => item.id === id);
  if (!announcement || !requireUnlock()) return;
  $("announcementId").value = announcement.id;
  $("announcementTitle").value = announcement.title;
  $("announcementAuthor").value = announcement.author;
  $("announcementPriority").value = announcement.priority;
  $("announcementDate").value = announcement.date;
  $("announcementSchedule").value = dateTimeLocalValue(announcement.scheduledAt);
  $("announcementPinned").checked = announcement.pinned;
  $("announcementMessage").value = announcement.message;
  if ($("announcementCharacterGuide")) {
    $("announcementCharacterGuide").textContent = `${announcement.message.length} / 1200 characters. Times use your browser timezone.`;
  }
  $("cancelAnnouncementEdit").hidden = false;
}

function updateAnnouncementStatus(id, status) {
  if (!requireUnlock()) return;
  const announcement = state.announcements.find((item) => item.id === id);
  if (!announcement) return;
  announcement.status = status;
  announcement.updatedAt = new Date().toISOString();
  if (status === "published") {
    announcement.publishedAt = new Date().toISOString();
    announcement.scheduledAt = "";
  }
  render();
  scheduleSave();
}

function previewAnnouncement(announcement = announcementFromForm()) {
  if (!validateAnnouncement(announcement)) return;
  $("announcementPreviewTitle").textContent = announcement.title;
  $("announcementPreviewBody").innerHTML = announcementCardMarkup({
    ...announcement,
    status: "published",
    publishedAt: new Date().toISOString()
  });
  $("announcementPreviewModal").hidden = false;
}

function getReportRange() {
  const period = document.querySelector('input[name="reportPeriod"]:checked')?.value || "monthly";
  const today = startOfDay(new Date());
  let start = new Date(today);
  let end = endOfDay(today);

  if (period === "weekly") {
    const day = start.getDay();
    start = startOfDay(addDays(start, -day));
    end = endOfDay(addDays(start, 6));
  } else if (period === "monthly") {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
    end = endOfDay(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  } else if (period === "yearly") {
    start = new Date(today.getFullYear(), 0, 1);
    end = endOfDay(new Date(today.getFullYear(), 11, 31));
  } else if (period === "custom") {
    start = parseDate($("reportStartDate")?.value) || start;
    end = endOfDay(parseDate($("reportEndDate")?.value) || start);
  }

  return { period, start: startOfDay(start), end };
}

function currentCollections() {
  const bills = [getBillData("electricity"), getBillData("water")];
  const billCollections = bills.reduce((sum, bill) => sum + bill.collected, 0);
  return calcTotals().amotanTotal + billCollections;
}

function currentOverdue() {
  const unpaidAmotan = state.members.filter((member) => !member.paid).length * AMOTAN_AMOUNT;
  const bills = [getBillData("electricity"), getBillData("water")];
  return unpaidAmotan + bills.reduce((sum, bill) => sum + bill.outstanding, 0);
}

function roomStats() {
  const explicitRooms = state.rooms || [];
  const occupiedFromRooms = explicitRooms.filter((room) => room.status === "occupied").length;
  const vacantFromRooms = explicitRooms.filter((room) => room.status === "vacant").length;
  const occupiedFromMembers = new Set(
    state.members
      .map((member) => member.profile?.apartmentRoom)
      .filter(Boolean)
      .map((room) => room.toLowerCase())
  ).size;
  return {
    occupied: explicitRooms.length ? occupiedFromRooms : occupiedFromMembers,
    vacant: explicitRooms.length ? vacantFromRooms : 0,
    total: explicitRooms.length || occupiedFromMembers
  };
}

function reportRecords(range = getReportRange()) {
  const income = state.income.filter((item) => inRange(item.date, range));
  const expenses = state.expenses.filter((item) => inRange(item.date, range));
  const totals = calcTotals();
  const cycleStart = parseDate(state.cycleStarted) || startOfDay(new Date());
  const rangeOverlapsCurrentCycle = cycleStart <= range.end && endOfDay(new Date()) >= range.start;
  const amotanIncome = totals.amotanTotal > 0 && rangeOverlapsCurrentCycle
    ? {
      id: "current-cycle-amotan",
      amount: totals.amotanTotal,
      description: `Amotan collections (${totals.paidMembers} paid member${totals.paidMembers === 1 ? "" : "s"})`,
      date: todayISO(),
      category: "Member Amotan",
      type: "Income",
      isAmotan: true
    }
    : null;
  const reportIncome = amotanIncome ? [...income, amotanIncome] : income;
  const transactions = [
    ...reportIncome.map((item) => ({ ...item, type: "Income", category: item.category || "Income" })),
    ...expenses.map((item) => ({ ...item, type: "Expense" }))
  ].sort((a, b) => `${b.date || ""}${b.id}`.localeCompare(`${a.date || ""}${a.id}`));
  return { income: reportIncome, expenses, transactions, amotanIncome };
}

function reportData() {
  const range = getReportRange();
  const records = reportRecords(range);
  const trackerTotals = calcTotals();
  const incomeTotal = records.income.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expenseTotal = records.expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const rooms = roomStats();
  const monthlyCollections = currentCollections();
  const overduePayments = currentOverdue();
  return {
    range,
    records,
    summary: {
      incomeTotal,
      amotanIncome: Number(records.amotanIncome?.amount || 0),
      carryover: Number(state.carryover || 0),
      expenseTotal,
      netBalance: incomeTotal - expenseTotal,
      availableBalance: trackerTotals.remaining,
      totalMembers: state.members.length,
      occupiedRooms: rooms.occupied,
      vacantRooms: rooms.vacant,
      monthlyCollections,
      overduePayments
    }
  };
}

function sumByMonth(items) {
  const buckets = new Map();
  for (const item of items) {
    const key = monthKey(item.date);
    buckets.set(key, (buckets.get(key) || 0) + Number(item.amount || 0));
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12);
}

function sumByCategory(expenses) {
  const buckets = new Map();
  for (const item of expenses) {
    buckets.set(item.category, (buckets.get(item.category) || 0) + Number(item.amount || 0));
  }
  return [...buckets.entries()].sort((a, b) => b[1] - a[1]);
}

function drawBarChart(canvasId, rows, color) {
  const canvas = $(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const css = getComputedStyle(document.documentElement);
  const chartBg = css.getPropertyValue("--surface-secondary").trim() || "#f0f4f6";
  const chartText = css.getPropertyValue("--text-secondary").trim() || "#5f6f7a";
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = chartBg;
  ctx.fillRect(0, 0, width, height);
  const max = Math.max(1, ...rows.map((row) => row[1]));
  const chartTop = 24;
  const chartBottom = height - 42;
  const chartHeight = chartBottom - chartTop;
  const barGap = 12;
  const barWidth = rows.length ? Math.max(18, (width - 48 - barGap * (rows.length - 1)) / rows.length) : 32;
  ctx.fillStyle = chartText;
  ctx.font = "12px system-ui, sans-serif";

  if (!rows.length) {
    ctx.fillText("No data yet", 20, 36);
    return;
  }

  rows.forEach(([label, value], index) => {
    const x = 24 + index * (barWidth + barGap);
    const barHeight = Math.round((value / max) * chartHeight);
    const y = chartBottom - barHeight;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, barWidth, barHeight);
    ctx.fillStyle = chartText;
    ctx.fillText(label.slice(5) || label, x, height - 18);
  });
}

function drawDonutChart(canvasId, rows) {
  const canvas = $(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const css = getComputedStyle(document.documentElement);
  const chartBg = css.getPropertyValue("--surface-secondary").trim() || "#f0f4f6";
  const chartSurface = css.getPropertyValue("--surface").trim() || "#ffffff";
  const chartText = css.getPropertyValue("--text-primary").trim() || "#1f2933";
  const colors = [
    css.getPropertyValue("--primary").trim() || "#2563eb",
    css.getPropertyValue("--warning").trim() || "#d97706",
    css.getPropertyValue("--success").trim() || "#16a34a",
    css.getPropertyValue("--danger").trim() || "#dc2626",
    "#64748b",
    "#7c3aed",
    "#0891b2",
    "#475569"
  ];
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = chartBg;
  ctx.fillRect(0, 0, width, height);
  const total = rows.reduce((sum, row) => sum + Number(row[1] || 0), 0);
  if (!total) {
    ctx.fillStyle = chartText;
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText("No data yet", 20, 36);
    return;
  }
  let angle = -Math.PI / 2;
  const cx = 118;
  const cy = height / 2;
  const radius = 78;
  rows.forEach(([label, value], index) => {
    const slice = (value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = colors[index % colors.length];
    ctx.fill();
    angle += slice;
  });
  ctx.beginPath();
  ctx.arc(cx, cy, 42, 0, Math.PI * 2);
  ctx.fillStyle = chartSurface;
  ctx.fill();
  ctx.font = "12px system-ui, sans-serif";
  rows.slice(0, 6).forEach(([label, value], index) => {
    const y = 50 + index * 28;
    ctx.fillStyle = colors[index % colors.length];
    ctx.fillRect(250, y - 10, 12, 12);
    ctx.fillStyle = chartText;
    ctx.fillText(`${label}: ${money(value)}`, 270, y);
  });
}

function setActiveView(view) {
  activeView = view;
  if ($("pageTitle")) $("pageTitle").textContent = PAGE_TITLES[view] || "Dashboard";
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== view;
    panel.classList.toggle("active", panel.dataset.viewPanel === view);
  });
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === view);
    if (tab.dataset.view === view) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
  setMobileNav(false);
  renderAnnouncements();
  renderReports();
  renderExpenseManagement();
  renderBackupSettings();
  refreshIcons();
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildReportRows() {
  const data = reportData();
  const rangeText = `${isoFromDate(data.range.start)} to ${isoFromDate(data.range.end)}`;
  const summaryRows = [
    ["Company/Apartment Name", state.settings.apartmentName],
    ["Report Date", todayISO()],
    ["Selected Date Range", rangeText],
    ["Total Income", data.summary.incomeTotal],
    ["Amotan Collections", data.summary.amotanIncome],
    ["Carried Sobra", data.summary.carryover],
    ["Total Expenses", data.summary.expenseTotal],
    ["Profit/Loss", data.summary.netBalance],
    ["Available Balance", data.summary.availableBalance],
    ["Total Members", data.summary.totalMembers],
    ["Total Occupied Rooms", data.summary.occupiedRooms],
    ["Total Vacant Rooms", data.summary.vacantRooms],
    ["Total Monthly Collections", data.summary.monthlyCollections],
    ["Overdue Payments", data.summary.overduePayments]
  ];
  const detailRows = data.records.transactions.map((item) => [
    item.date,
    item.type,
    item.category || "",
    item.description,
    item.amount,
    item.paidBy || "",
    item.paymentMethod || "",
    item.receiptNumber || "",
    item.notes || ""
  ]);
  return { summaryRows, detailRows, data };
}

function exportReportCSV() {
  const { summaryRows, detailRows } = buildReportRows();
  const rows = [
    ["Summary"],
    ...summaryRows,
    [],
    ["Detailed Transactions"],
    ["Date", "Type", "Category", "Description", "Amount", "Paid By", "Payment Method", "Receipt Number", "Notes"],
    ...detailRows
  ];
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  downloadBlob(`${REPORT_EXPORT_NAME}-${todayISO()}.csv`, new Blob([csv], { type: "text/csv;charset=utf-8" }));
}

function pdfText(text) {
  return String(text).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function exportReportPDF() {
  const { summaryRows, detailRows } = buildReportRows();
  const lines = [
    `${state.settings.apartmentName} Financial Report`,
    `Report Date: ${todayISO()}`,
    "",
    "Summary",
    ...summaryRows.map(([label, value]) => `${label}: ${typeof value === "number" ? money(value) : value}`),
    "",
    "Detailed Transactions",
    ...detailRows.slice(0, 32).map((row) => `${row[0]} | ${row[1]} | ${row[3]} | ${money(row[4])}`)
  ];
  const content = [
    "BT",
    "/F1 10 Tf",
    "40 780 Td",
    ...lines.flatMap((line, index) => [
      index ? "0 -14 Td" : "",
      `(${pdfText(line).slice(0, 110)}) Tj`
    ]).filter(Boolean),
    "ET"
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  downloadBlob(`${REPORT_EXPORT_NAME}-${todayISO()}.pdf`, new Blob([pdf], { type: "application/pdf" }));
}

function crc32(text) {
  const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  const bytes = new TextEncoder().encode(text);
  let crc = -1;
  for (const byte of bytes) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function dosTime(date = new Date()) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function createZipBlob(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const stamp = dosTime();
  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.content);
    const crc = crc32(file.content);
    const local = new ArrayBuffer(30);
    const localView = new DataView(local);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(10, stamp.time, true);
    localView.setUint16(12, stamp.date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, dataBytes.length, true);
    localView.setUint32(22, dataBytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    chunks.push(local, nameBytes, dataBytes);
    const centralHeader = new ArrayBuffer(46);
    const centralView = new DataView(centralHeader);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(12, stamp.time, true);
    centralView.setUint16(14, stamp.date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, dataBytes.length, true);
    centralView.setUint32(24, dataBytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.push(centralHeader, nameBytes);
    offset += 30 + nameBytes.length + dataBytes.length;
  }
  const centralOffset = offset;
  const centralSize = central.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const end = new ArrayBuffer(22);
  const endView = new DataView(end);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  return new Blob([...chunks, ...central, end], { type: "application/zip" });
}

function sheetXml(rows) {
  const cell = (value) => `<c t="inlineStr"><is><t>${escapeHTML(value)}</t></is></c>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
${rows.map((row, index) => `<row r="${index + 1}">${row.map(cell).join("")}</row>`).join("")}
</sheetData></worksheet>`;
}

function exportReportExcel() {
  const { summaryRows, detailRows } = buildReportRows();
  const rows = [
    ["Summary"],
    ...summaryRows,
    [],
    ["Detailed Transactions"],
    ["Date", "Type", "Category", "Description", "Amount", "Paid By", "Payment Method", "Receipt Number", "Notes"],
    ...detailRows
  ];
  const files = [
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
    { name: "xl/worksheets/sheet1.xml", content: sheetXml(rows) }
  ];
  downloadBlob(`${REPORT_EXPORT_NAME}-${todayISO()}.xlsx`, createZipBlob(files));
}

function backupPayload() {
  return {
    app: "Apartment Amotan Tracker",
    version: 6,
    exportedAt: new Date().toISOString(),
    databasePath: FIRESTORE_DOC_PATH,
    data: normalizeState(state),
    reports: reportData()
  };
}

function downloadBackup(format = "json") {
  const payload = backupPayload();
  const json = JSON.stringify(payload, null, 2);
  if (format === "zip") {
    downloadBlob(`${BACKUP_EXPORT_NAME}-${todayISO()}.zip`, createZipBlob([
      { name: "backup.json", content: json },
      { name: "reports.json", content: JSON.stringify(payload.reports, null, 2) }
    ]));
  } else {
    downloadBlob(`${BACKUP_EXPORT_NAME}-${todayISO()}.json`, new Blob([json], { type: "application/json" }));
  }
}

async function readBackupFile(file) {
  if (file.size > BACKUP_MAX_UPLOAD_BYTES) throw new Error("Backup files must be 20 MB or smaller.");
  const buffer = await file.arrayBuffer();
  if (file.name.toLowerCase().endsWith(".zip")) {
    return extractBackupJsonFromZip(buffer);
  }
  return new TextDecoder().decode(buffer);
}

function extractBackupJsonFromZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder();
  for (let i = 0; i < bytes.length - 30; i++) {
    if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b || bytes[i + 2] !== 0x03 || bytes[i + 3] !== 0x04) continue;
    const view = new DataView(buffer, i, 30);
    const compressed = view.getUint16(8, true);
    const size = view.getUint32(18, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const nameStart = i + 30;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    const dataStart = nameStart + nameLength + extraLength;
    if (name === "backup.json" && compressed === 0) {
      if (size > BACKUP_MAX_UPLOAD_BYTES || dataStart + size > bytes.length) throw new Error("Backup ZIP is invalid or too large.");
      return decoder.decode(bytes.slice(dataStart, dataStart + size));
    }
  }
  throw new Error("Backup ZIP must contain an uncompressed backup.json file.");
}

function validateBackupPayload(payload) {
  const data = payload?.data || payload;
  if (!data || typeof data !== "object") throw new Error("Backup file is empty or invalid.");
  if (!Array.isArray(data.members) || !Array.isArray(data.income) || !Array.isArray(data.expenses)) {
    throw new Error("Backup is missing required members, income, or expense records.");
  }
  if (payload?.app && payload.app !== "Apartment Amotan Tracker") throw new Error("This backup belongs to a different application.");
  const normalized = normalizeState(data);
  return normalized;
}

function renderRestorePreview(statePreview) {
  const rooms = statePreview.rooms || [];
  $("restorePreview").innerHTML = `
    <div class="preview-grid">
      <span>Members <strong>${statePreview.members.length}</strong></span>
      <span>Rooms <strong>${rooms.length}</strong></span>
      <span>Income <strong>${statePreview.income.length}</strong></span>
      <span>Expenses <strong>${statePreview.expenses.length}</strong></span>
      <span>Transactions <strong>${statePreview.income.length + statePreview.expenses.length}</strong></span>
    </div>
  `;
}

function autoBackupDue() {
  const config = state.settings.autoBackup;
  if (!config.enabled) return false;
  if (!config.lastRun) return true;
  const days = daysBetween(config.lastRun.slice(0, 10), todayISO());
  if (config.frequency === "daily") return days >= 1;
  if (config.frequency === "weekly") return days >= 7;
  return days >= 30;
}

function runAutoBackupIfDue() {
  if (!autoBackupDue()) return;
  const key = `${LOCAL_KEY}-auto-backups`;
  const backups = JSON.parse(localStorage.getItem(key) || "[]");
  backups.unshift(backupPayload());
  localStorage.setItem(key, JSON.stringify(backups.slice(0, 10)));
  state.settings.autoBackup.lastRun = new Date().toISOString();
  saveLocal();
}

function requireUnlock() {
  if (unlocked) return true;
  showNotice("Sign in with an authorized Firebase admin account to edit.", false);
  return false;
}

async function unlockAdmin() {
  if (unlocked && auth?.currentUser && docRef) {
    showNotice("", true);
    return;
  }
  if (OFFLINE_MODE) {
    showNotice("Admin editing is disabled in offline preview mode.", false);
    return;
  }
  const email = $("adminEmailInput").value.trim();
  const password = $("passwordInput").value;
  if (!email || !password || !auth) {
    showNotice("Enter your admin email and password.", false);
    return;
  }
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const token = await credential.user.getIdTokenResult(true);
    const canAccessWorkspace = token.claims.admin === true || (token.claims.workspaceAdmin === true && token.claims.workspaceId === WORKSPACE_ID);
    if (!canAccessWorkspace) {
      await signOut(auth);
      throw new Error("This account does not have access to this workspace link.");
    }
    localStorage.setItem("apartment-last-admin-email", email);
    isPlatformAdmin = token.claims.admin === true;
    unlocked = true;
    setEditState();
    renderAnnouncements();
    showNotice("Admin signed in. Loading the shared tracker…", false);
    setAccountMenu(false);
    await initFirebase();
  } catch (error) {
    console.error("Admin sign-in failed:", error);
    showNotice(error.message || "Admin sign-in failed.", false);
  }
}

function workspaceSlug(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

async function createWorkspaceAccount(event) {
  event.preventDefault();
  if (!isPlatformAdmin || !functions) return;
  const name = $("newWorkspaceName").value.trim();
  const slug = workspaceSlug($("newWorkspaceSlug").value || name);
  const email = $("newWorkspaceEmail").value.trim().toLowerCase();
  const password = $("newWorkspacePassword").value;
  const output = $("workspaceCreateResult");
  output.textContent = "Creating workspace…";
  try {
    const provision = httpsCallable(functions, "createWorkspaceAccount");
    const result = await provision({ name, slug, email, password });
    recordRecentWorkspace(result.data.workspaceId, name);
    const link = `${window.location.origin}${window.location.pathname}?workspace=${encodeURIComponent(result.data.workspaceId)}`;
    output.replaceChildren();
    const message = document.createElement("p");
    message.textContent = `Workspace created for ${email}. Send this link and the password separately:`;
    const anchor = document.createElement("a");
    anchor.href = link;
    anchor.textContent = link;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    output.append(message, anchor);
    event.target.reset();
  } catch (error) {
    console.error("Workspace creation failed:", error);
    output.textContent = error.message || "Workspace creation failed.";
  }
}

function scheduleSave() {
  localDirty = true;
  try { localStorage.setItem(unsyncedKey(), "1"); } catch { /* storage full: local save will warn */ }
  saveLocal();
  try {
    runAutoBackupIfDue();
  } catch (error) {
    console.warn("Automatic backup skipped:", error);
  }
  clearTimeout(saveTimer);
  if (!cloudConflict) saveTimer = setTimeout(saveCloudNow, 350);
}

async function saveCloudNow() {
  saveLocal();
  if (OFFLINE_MODE || !docRef || applyingRemote || cloudConflict) return;
  // Only one cloud write at a time. Two overlapping writes used to compare against the
  // same old revision, so the second one was rejected as a "conflict" and that edit was lost.
  if (saveInFlight) {
    saveQueued = true;
    return;
  }
  saveInFlight = true;
  saveQueued = false;
  localDirty = false; // any edit made while this write runs marks it dirty again
  try {
    const expectedRevision = cloudRevision;
    const payload = normalizeState(state);
    logFirestore("write transaction", `expected revision ${expectedRevision}`);
    const nextRevision = await runTransaction(docRef.firestore, async (transaction) => {
      ownRevisionInFlight = null;
      const snapshot = await transaction.get(docRef);
      const remoteRevision = Number(snapshot.data()?.revision || 0);
      if (remoteRevision !== expectedRevision) throw new Error("SYNC_CONFLICT");
      const revision = remoteRevision + 1;
      ownRevisionInFlight = revision;
      transaction.set(docRef, { ...payload, revision, updatedAt: serverTimestamp() });
      return revision;
    });
    cloudRevision = Math.max(cloudRevision, nextRevision);
    ownRevisionInFlight = null;
    try {
      await setDoc(doc(docRef.firestore, "publicApartmentViews", WORKSPACE_ID), publicStatePayload());
    } catch (publicError) {
      console.warn("Public view could not be refreshed:", publicError);
    }
    if (!localDirty) {
      try { localStorage.removeItem(unsyncedKey()); } catch { /* ignore */ }
    }
    setStatus("Synced online", "online");
    showNotice("", true);
  } catch (error) {
    ownRevisionInFlight = null;
    localDirty = true; // the cloud does not have these edits yet
    console.error("Cloud save failed:", error);
    if (error.message === "SYNC_CONFLICT") {
      cloudConflict = true;
      saveRecoverySnapshot("Cloud conflict: unsynced local version");
      setStatus("Sync conflict", "local");
      try {
        const remoteSnap = await getDocFromServer(docRef);
        if (remoteSnap.exists()) {
          pendingConflict = {
            localState: normalizeState(state),
            remoteState: normalizeState(remoteSnap.data()),
            remoteRevision: Number(remoteSnap.data()?.revision || 0),
            time: new Date()
          };
          showConflictModal(pendingConflict);
          return;
        }
      } catch (fetchErr) {
        console.warn("Could not fetch remote conflict document:", fetchErr);
      }
      showNotice("Another device changed the tracker. A conflict resolution dialog has been prepared.", false);
    } else {
      setStatus("Local only", "local");
      showNotice("Saved locally. Firestore is offline or blocked. Your changes will sync when the connection returns.", false);
    }
  } finally {
    saveInFlight = false;
    if (saveQueued && !cloudConflict) {
      saveQueued = false;
      saveCloudNow();
    }
  }
}

function syncBillMembers(nextState = state) {
  const memberIds = new Set(nextState.members.map((member) => member.id));
  for (const bill of [nextState.bills.electricity, nextState.bills.water]) {
    bill.members = bill.members.filter((id) => memberIds.has(id));
    bill.paidMembers = bill.paidMembers.filter((id) => memberIds.has(id) && bill.members.includes(id));
  }
  ensureAirconMembers(nextState);
}

function calcTotals() {
  const paidMembers = state.members.filter((m) => m.paid).length;
  const amotanTotal = paidMembers * AMOTAN_AMOUNT;
  const incomeTotal = state.income.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expenseTotal = state.expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const remaining = Number(state.carryover || 0) + amotanTotal + incomeTotal - expenseTotal;
  return { paidMembers, amotanTotal, incomeTotal, expenseTotal, remaining };
}

function summaryText(totals) {
  const parts = [];
  if (totals.amotanTotal) parts.push(`${money(totals.amotanTotal)} amotan`);
  if (totals.incomeTotal) parts.push(`${money(totals.incomeTotal)} money in`);
  if (totals.expenseTotal) parts.push(`${money(totals.expenseTotal)} spent`);
  return parts.length ? parts.join(" + ") : "No payments or expenses yet.";
}

function getBillData(key) {
  const bill = state.bills[key];
  const members = bill.members
    .map((id) => state.members.find((member) => member.id === id))
    .filter(Boolean);
  const paidMembers = members.filter((member) => bill.paidMembers.includes(member.id));
  const unpaidMembers = members.filter((member) => !bill.paidMembers.includes(member.id));
  const amount = Number(bill.amount || 0);

  if (!members.length) {
    return {
      bill,
      members,
      paidMembers,
      unpaidMembers,
      totalMembers: 0,
      share: 0,
      airconShare: 0,
      sharedBillPortion: 0,
      collected: 0,
      outstanding: 0,
      rows: []
    };
  }

  if (key === "electricity") {
    const totalMembers = members.length;
    const sharedBillPortion = Math.max(0, amount - ELECTRICITY_AC_CHARGE);
    const share = sharedBillPortion / totalMembers;
    const activeAirconMembers = new Set((bill.airconMembers || []).slice(0, 2));
    const rows = members.map((member) => {
      const airconCharge = activeAirconMembers.has(member.id) ? ELECTRICITY_AC_SHARE : 0;
      const totalDue = share + airconCharge;
      const paid = bill.paidMembers.includes(member.id);
      return {
        id: member.id,
        name: member.name,
        share,
        airconCharge,
        totalDue,
        paid
      };
    });
    const collected = rows.filter((row) => row.paid).reduce((sum, row) => sum + row.totalDue, 0);
    return {
      bill,
      members,
      paidMembers,
      unpaidMembers,
      totalMembers,
      share,
      airconShare: ELECTRICITY_AC_CHARGE,
      sharedBillPortion,
      collected,
      outstanding: Math.max(0, rows.reduce((sum, row) => sum + row.totalDue, 0) - collected),
      rows
    };
  }

  const totalMembers = members.length;
  const share = amount / totalMembers;
  const rows = members.map((member) => {
    const paid = bill.paidMembers.includes(member.id);
    return {
      id: member.id,
      name: member.name,
      share,
      airconCharge: 0,
      totalDue: share,
      paid
    };
  });
  const collected = rows.filter((row) => row.paid).reduce((sum, row) => sum + row.totalDue, 0);
  return {
    bill,
    members,
    paidMembers,
    unpaidMembers,
    totalMembers,
    share,
    airconShare: 0,
    sharedBillPortion: amount,
    collected,
    outstanding: Math.max(0, amount - collected),
    rows
  };
}

function renderMembers() {
  const box = $("membersList");
  if (!state.members.length) {
    box.innerHTML = `<p class="empty">No members yet.</p>`;
    return;
  }

  box.innerHTML = state.members.map((m) => `
    <div class="member-row" data-id="${m.id}" role="button" tabindex="0" aria-label="Open profile for ${escapeAttr(profileName(m))}">
      <label class="paid-control">
        <input type="checkbox" class="member-paid" data-id="${m.id}" ${m.paid ? "checked" : ""} ${unlocked ? "" : "disabled"} />
        ${avatarMarkup(m, "avatar-sm")}
        <span>${escapeHTML(profileName(m))}</span>
      </label>
      <strong>${m.paid ? money(AMOTAN_AMOUNT) : "Unpaid"}</strong>
      ${m.paid ? `<button class="mini receipt-btn" data-kind="amotan" data-id="${m.id}" type="button">Receipt</button>` : ""}
      ${unlocked ? `<button class="mini danger delete-member" data-id="${m.id}" type="button">Delete</button>` : ""}
    </div>
  `).join("");
}

function profileFieldsHTML(member) {
  const profile = member.profile || defaultProfile();
  const rows = [
    { label: "Member ID", value: member.id, key: "memberId" },
    ...PROFILE_FIELDS
      .filter((field) => field.key !== "fullName" && field.key !== "nickname" && field.key !== "notes")
      .map((field) => ({ ...field, value: profile[field.key] }))
  ].filter((field) => field.value);

  const fieldRows = rows.map((field) => `
    <div class="profile-field">
      <span>${escapeHTML(field.label)}</span>
      <strong>${renderProfileValue(field, field.value)}</strong>
    </div>
  `).join("");

  const notes = profile.notes
    ? `<section class="profile-section"><h3>Biography / Notes</h3><p>${escapeHTML(profile.notes)}</p></section>`
    : "";

  return `
    <section class="profile-section">
      <h3>Contact Information</h3>
      <div class="profile-field-grid">${fieldRows || `<p class="empty-row">No optional profile details yet.</p>`}</div>
    </section>
    ${notes}
  `;
}

function renderProfileView(member) {
  const profile = member.profile || defaultProfile();
  const nickname = profile.nickname ? `<p class="profile-nickname">${escapeHTML(profile.nickname)}</p>` : "";
  $("profileModalBody").innerHTML = `
    <div class="profile-view">
      <div class="profile-hero">
        ${avatarMarkup(member, "avatar-lg")}
        <div>
          <h3>${escapeHTML(profileName(member))}</h3>
          ${nickname}
          <p>${escapeHTML(member.name)} ${member.paid ? "has paid this cycle." : "is unpaid this cycle."}</p>
        </div>
      </div>
      ${profileFieldsHTML(member)}
      ${unlocked ? `
        <div class="profile-actions">
          <button id="editProfileBtn" class="primary-btn" type="button">Edit Profile</button>
        </div>
      ` : ""}
    </div>
  `;
}

function editFieldHTML(field, profile) {
  const value = escapeAttr(profile[field.key] || "");
  if (field.key === "notes") {
    return `<textarea name="${field.key}" placeholder="${escapeAttr(field.label)}">${escapeHTML(profile[field.key] || "")}</textarea>`;
  }
  const type = field.key === "dateOfBirth" ? "date" : field.key === "email" ? "email" : field.key === "facebook" ? "url" : field.key === "phone" ? "tel" : "text";
  return `<input name="${field.key}" type="${type}" placeholder="${escapeAttr(field.label)}" value="${value}" autocomplete="off" />`;
}

function renderProfileEdit(member) {
  const profile = member.profile || defaultProfile();
  $("profileModalBody").innerHTML = `
    <form id="profileEditForm" class="profile-edit-form">
      <div class="profile-hero">
        ${avatarMarkup(member, "avatar-lg")}
        <div>
          <label>
            <span>Member Name</span>
            <input name="memberName" type="text" value="${escapeAttr(member.name)}" required autocomplete="off" />
          </label>
          <p>Optional profile fields can be left blank.</p>
        </div>
      </div>
      <div class="profile-form-grid">
        ${PROFILE_FIELDS.map((field) => editFieldHTML(field, profile)).join("")}
        <label class="photo-upload">
          <span>Profile Photo</span>
          <input name="photo" type="file" accept="image/*" />
        </label>
        ${profile.photo ? `
          <label class="remove-photo">
            <input name="removePhoto" type="checkbox" />
            <span>Remove current photo</span>
          </label>
        ` : ""}
      </div>
      <div class="profile-actions">
        <button class="primary-btn" type="submit">Save Profile</button>
        <button id="cancelProfileEdit" class="secondary-btn" type="button">Cancel</button>
      </div>
    </form>
  `;
}

function renderProfileModal() {
  const member = state.members.find((m) => m.id === activeProfileMemberId);
  if (!member) {
    closeProfileModal();
    return;
  }
  $("profileModalTitle").textContent = profileName(member);
  if (editingProfileMemberId === member.id) renderProfileEdit(member);
  else renderProfileView(member);
}

function openProfileModal(memberId, edit = false) {
  activeProfileMemberId = memberId;
  editingProfileMemberId = edit ? memberId : null;
  $("profileModal").hidden = false;
  renderProfileModal();
}

function closeProfileModal() {
  $("profileModal").hidden = true;
  activeProfileMemberId = null;
  editingProfileMemberId = null;
}

function renderTransactions() {
  let items = [
    ...state.income.map((item) => ({ ...item, kind: "income" })),
    ...state.expenses.map((item) => ({ ...item, kind: "expense" }))
  ].sort((a, b) => `${b.date || ""}${b.id}`.localeCompare(`${a.date || ""}${a.id}`));

  if (activityFilterType === "income") {
    items = items.filter((item) => item.kind === "income");
  } else if (activityFilterType === "expense") {
    items = items.filter((item) => item.kind === "expense");
  }

  if (activitySearchTerm) {
    const term = activitySearchTerm.toLowerCase();
    items = items.filter((item) =>
      (item.description || "").toLowerCase().includes(term) ||
      (item.category || "").toLowerCase().includes(term) ||
      (item.paidBy || "").toLowerCase().includes(term) ||
      (item.paymentMethod || "").toLowerCase().includes(term) ||
      (item.date || "").includes(term) ||
      String(item.amount || "").includes(term)
    );
  }

  const list = $("transactionsList");
  if (!items.length) {
    list.innerHTML = `<p class="empty">${activitySearchTerm || activityFilterType !== "all" ? "No transactions match your search filter." : "No activity yet."}</p>`;
    $("activityTotals").textContent = `${state.income.length} money in, ${state.expenses.length} expenses.`;
    return;
  }

  const countLabel = items.length !== (state.income.length + state.expenses.length)
    ? `${state.income.length} money in, ${state.expenses.length} expenses (${items.length} matching).`
    : `${state.income.length} money in, ${state.expenses.length} expenses.`;
  $("activityTotals").textContent = countLabel;

  list.innerHTML = items.map((item) => `
    <div class="transaction-row ${item.kind}">
      <div class="transaction-main">
        <strong>${escapeHTML(item.description)}</strong>
        <div class="transaction-meta-tags">
          <span>${escapeHTML(item.date)}</span>
          ${item.category ? `<span class="pill mini-pill">${escapeHTML(item.category)}</span>` : ""}
          ${item.paymentMethod ? `<span class="pill mini-pill muted-pill">${escapeHTML(item.paymentMethod)}</span>` : ""}
        </div>
      </div>
      <div class="transaction-meta">
        <strong>${item.kind === "income" ? "+" : "-"} ${money(item.amount)}</strong>
        ${unlocked ? `<button class="mini danger delete-transaction" data-kind="${item.kind}" data-id="${item.id}" type="button">Delete</button>` : ""}
      </div>
    </div>
  `).join("");
}

function renderSummary() {
  const totals = calcTotals();
  const electricity = getBillData("electricity");
  const water = getBillData("water");
  const outstanding = electricity.outstanding + water.outstanding + state.members.filter((member) => !member.paid).length * AMOTAN_AMOUNT;
  const activeAnnouncements = publishedAnnouncements().length;
  $("remainingBalance").textContent = money(totals.remaining);
  $("paidMembers").textContent = `${totals.paidMembers}/${state.members.length}`;
  $("carryoverAmount").textContent = money(state.carryover);
  $("cycleStarted").textContent = state.cycleStarted || "Today";
  if ($("brandName")) $("brandName").textContent = state.settings.apartmentName || "Apartment Tracker";

  const elapsed = daysBetween(state.cycleStarted, todayISO());
  const left = Math.max(0, CYCLE_DAYS - elapsed);
  $("cycleLeft").textContent = `${left} day${left === 1 ? "" : "s"} left`;
  $("summaryBreakdown").textContent = summaryText(totals);
  if ($("dashboardPulse")) {
    $("dashboardPulse").textContent = `${state.members.length} resident${state.members.length === 1 ? "" : "s"}, ${activeAnnouncements} active announcement${activeAnnouncements === 1 ? "" : "s"}, ${money(outstanding)} still outstanding.`;
  }
}

function endCycle() {
  saveRecoverySnapshot("Before ending cycle");
  const totals = calcTotals();
  state = {
    ...state,
    members: state.members.map((m) => ({ ...m, paid: false, paidAt: "" })),
    income: [],
    expenses: [],
    carryover: Math.max(0, totals.remaining),
    cycleStarted: todayISO()
  };
  render();
  scheduleSave();
}

function clearActivity() {
  saveRecoverySnapshot("Before clearing activity");
  state = {
    ...state,
    income: [],
    expenses: []
  };
  render();
  scheduleSave();
}

function checkAutoCycle() {
  if (daysBetween(state.cycleStarted, todayISO()) >= CYCLE_DAYS) {
    showNotice("This cycle is due to end. Review the totals, download a backup, then use End Cycle when ready.", false);
  }
}

function updateBillMemberSelection(billKey, memberId, checked) {
  const bill = state.bills[billKey];
  if (checked) {
    if (!bill.members.includes(memberId)) bill.members.push(memberId);
  } else {
    bill.members = bill.members.filter((id) => id !== memberId);
    bill.paidMembers = bill.paidMembers.filter((id) => id !== memberId);
    if (billKey === "electricity" && Array.isArray(bill.airconMembers)) {
      bill.airconMembers = bill.airconMembers.filter((id) => id !== memberId);
    }
  }
}

function ensureAirconMembers(targetState = state) {
  const bill = targetState.bills.electricity;
  if (!Array.isArray(bill.airconMembers)) bill.airconMembers = [];
  bill.airconMembers = bill.airconMembers.filter((id) => bill.members.includes(id));
  const selected = bill.airconMembers;
  if (selected.length > 2) bill.airconMembers = selected.slice(0, 2);
}

function updateBillPaidStatus(billKey, memberId, checked) {
  const bill = state.bills[billKey];
  if (!bill.paidDates || typeof bill.paidDates !== "object") bill.paidDates = {};
  if (checked) {
    if (!bill.paidMembers.includes(memberId)) bill.paidMembers.push(memberId);
    bill.paidDates[memberId] = todayISO();
  } else {
    bill.paidMembers = bill.paidMembers.filter((id) => id !== memberId);
    delete bill.paidDates[memberId];
  }
}

// ---------- Receipts ----------
let activeReceipt = null;

function receiptDateLabel(iso) {
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? String(iso || "")
    : date.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });
}

function receiptHash(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(36).toUpperCase().padStart(4, "0").slice(-4);
}

function buildReceipt(kind, memberId) {
  const member = state.members.find((m) => m.id === memberId);
  if (!member) return null;
  const base = {
    kind,
    apartment: state.settings?.apartmentName || "Apartment Tracker",
    resident: profileName(member),
    room: member.profile?.apartmentRoom || "",
    receivedBy: "Apartment Admin"
  };

  if (kind === "amotan") {
    if (!member.paid) return null;
    const paidAt = member.paidAt || todayISO();
    const period = state.cycleStarted || paidAt;
    return {
      ...base,
      title: "Amotan Contribution",
      paidAt,
      periodLabel: `Cycle starting ${receiptDateLabel(period)}`,
      lines: [{ label: "Amotan contribution", amount: AMOTAN_AMOUNT }],
      total: AMOTAN_AMOUNT,
      number: `AMO-${String(period).replaceAll("-", "")}-${receiptHash(`${kind}${memberId}${period}`)}`
    };
  }

  const bill = state.bills[kind];
  if (!bill || !bill.paidMembers.includes(memberId)) return null;
  const row = getBillData(kind).rows.find((r) => r.id === memberId);
  if (!row) return null;
  const paidAt = bill.paidDates?.[memberId] || todayISO();
  const period = bill.date || paidAt;
  const label = kind === "electricity" ? "Electricity Bill" : "Water Bill";
  const lines = [{ label: `${label} share`, amount: row.share }];
  if (row.airconCharge) lines.push({ label: "Aircon charge", amount: row.airconCharge });
  return {
    ...base,
    title: label,
    paidAt,
    periodLabel: `Bill dated ${receiptDateLabel(period)}`,
    lines,
    total: row.totalDue,
    number: `${kind === "electricity" ? "ELEC" : "WTR"}-${String(period).replaceAll("-", "")}-${receiptHash(`${kind}${memberId}${period}`)}`
  };
}

function receiptMarkup(r) {
  return `
    <div class="receipt-paper" id="receiptPaper">
      <div class="receipt-head">
        <strong>${escapeHTML(r.apartment)}</strong>
        <span>Official Payment Receipt</span>
      </div>
      <div class="receipt-row"><span>Receipt No.</span><strong>${escapeHTML(r.number)}</strong></div>
      <div class="receipt-row"><span>Date Paid</span><strong>${escapeHTML(receiptDateLabel(r.paidAt))}</strong></div>
      <div class="receipt-row"><span>Received From</span><strong>${escapeHTML(r.resident)}</strong></div>
      ${r.room ? `<div class="receipt-row"><span>Room</span><strong>${escapeHTML(r.room)}</strong></div>` : ""}
      <div class="receipt-row"><span>Payment For</span><strong>${escapeHTML(r.title)}</strong></div>
      <div class="receipt-row"><span>Period</span><strong>${escapeHTML(r.periodLabel)}</strong></div>
      <div class="receipt-lines">
        ${r.lines.map((l) => `<div class="receipt-row"><span>${escapeHTML(l.label)}</span><strong>${money(l.amount)}</strong></div>`).join("")}
      </div>
      <div class="receipt-total"><span>Total Paid</span><strong>${money(r.total)}</strong></div>
      <div class="receipt-stamp">PAID</div>
      <p class="receipt-foot">Received by ${escapeHTML(r.receivedBy)}. Thank you!</p>
    </div>
  `;
}

function receiptText(r) {
  return [
    r.apartment,
    "OFFICIAL PAYMENT RECEIPT",
    "",
    `Receipt No.: ${r.number}`,
    `Date Paid: ${receiptDateLabel(r.paidAt)}`,
    `Received From: ${r.resident}${r.room ? ` (${r.room})` : ""}`,
    `Payment For: ${r.title}`,
    `Period: ${r.periodLabel}`,
    ...r.lines.map((l) => `${l.label}: ${money(l.amount)}`),
    `TOTAL PAID: ${money(r.total)}`,
    "Status: PAID",
    "",
    `Received by ${r.receivedBy}. Thank you!`
  ].join("\n");
}

function openReceipt(kind, memberId) {
  const receipt = buildReceipt(kind, memberId);
  if (!receipt) return;
  activeReceipt = receipt;
  $("receiptModalBody").innerHTML = receiptMarkup(receipt);
  $("receiptModal").hidden = false;
}

function closeReceipt() {
  $("receiptModal").hidden = true;
  document.body.classList.remove("printing-receipt");
  activeReceipt = null;
}

function receiptCanvas(r) {
  const W = 760, pad = 52, scale = 2;
  const H = 560 + r.lines.length * 44 + (r.room ? 44 : 0);
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  const font = (weight, size) => `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#284f63";
  ctx.fillRect(0, 0, W, 14);

  let y = 82;
  ctx.fillStyle = "#1f2933";
  ctx.font = font(700, 30);
  ctx.fillText(r.apartment, pad, y, W - pad * 2);
  y += 30;
  ctx.fillStyle = "#5f6f7a";
  ctx.font = font(600, 14);
  ctx.fillText("OFFICIAL PAYMENT RECEIPT", pad, y);
  y += 20;
  ctx.strokeStyle = "#d8e1e6";
  ctx.lineWidth = 1;
  const rule = () => { ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke(); };
  rule();
  y += 40;

  const row = (label, value) => {
    ctx.fillStyle = "#5f6f7a";
    ctx.font = font(500, 17);
    ctx.textAlign = "left";
    ctx.fillText(label, pad, y);
    ctx.fillStyle = "#1f2933";
    ctx.font = font(600, 17);
    ctx.textAlign = "right";
    ctx.fillText(value, W - pad, y, W - pad * 2 - 170);
    ctx.textAlign = "left";
    y += 44;
  };
  row("Receipt No.", r.number);
  row("Date Paid", receiptDateLabel(r.paidAt));
  row("Received From", r.resident);
  if (r.room) row("Room", r.room);
  row("Payment For", r.title);
  row("Period", r.periodLabel);
  y -= 14;
  rule();
  y += 40;
  r.lines.forEach((l) => row(l.label, money(l.amount)));
  y -= 14;
  rule();
  y += 44;
  ctx.fillStyle = "#1f2933";
  ctx.font = font(700, 20);
  ctx.fillText("Total Paid", pad, y);
  ctx.fillStyle = "#2f6b4f";
  ctx.font = font(800, 30);
  ctx.textAlign = "right";
  ctx.fillText(money(r.total), W - pad, y);
  ctx.textAlign = "left";
  y += 64;

  ctx.save();
  ctx.translate(pad + 70, y);
  ctx.rotate(-0.1);
  ctx.strokeStyle = "#2f6b4f";
  ctx.fillStyle = "#2f6b4f";
  ctx.lineWidth = 4;
  ctx.strokeRect(-56, -30, 112, 52);
  ctx.font = font(800, 28);
  ctx.textAlign = "center";
  ctx.fillText("PAID", 0, 8);
  ctx.restore();
  ctx.textAlign = "left";

  ctx.fillStyle = "#5f6f7a";
  ctx.font = font(500, 15);
  ctx.fillText(`Received by ${r.receivedBy}. Thank you!`, pad, H - 44);
  return canvas;
}

function receiptFileName(r) {
  const who = r.resident.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "resident";
  return `receipt-${r.number}-${who}`;
}

function receiptBlob(r) {
  return new Promise((resolve) => receiptCanvas(r).toBlob(resolve, "image/png"));
}

async function downloadReceiptImage() {
  if (!activeReceipt) return;
  const blob = await receiptBlob(activeReceipt);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${receiptFileName(activeReceipt)}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function copyReceiptText() {
  if (!activeReceipt) return;
  try {
    await navigator.clipboard.writeText(receiptText(activeReceipt));
    showNotice("Receipt text copied. Paste it into Messenger, SMS, or email.", false);
  } catch {
    showNotice("Copy was blocked by the browser. Use Save Image or Print instead.", false);
  }
}

async function shareReceipt() {
  if (!activeReceipt) return;
  const r = activeReceipt;
  try {
    const blob = await receiptBlob(r);
    const file = new File([blob], `${receiptFileName(r)}.png`, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `Receipt ${r.number}`, text: `Payment receipt for ${r.resident}` });
    } else if (navigator.share) {
      await navigator.share({ title: `Receipt ${r.number}`, text: receiptText(r) });
    } else {
      await copyReceiptText();
    }
  } catch (error) {
    if (error?.name !== "AbortError") await copyReceiptText();
  }
}

function printReceipt() {
  if (!activeReceipt) return;
  document.body.classList.add("printing-receipt");
  window.print();
}

function bindReceiptEvents() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".receipt-btn");
    if (btn) openReceipt(btn.dataset.kind, btn.dataset.id);
  });
  $("closeReceiptModal").addEventListener("click", closeReceipt);
  $("receiptModal").addEventListener("click", (e) => {
    if (e.target.id === "receiptModal") closeReceipt();
  });
  $("receiptPrintBtn").addEventListener("click", printReceipt);
  $("receiptImageBtn").addEventListener("click", downloadReceiptImage);
  $("receiptShareBtn").addEventListener("click", shareReceipt);
  $("receiptCopyBtn").addEventListener("click", copyReceiptText);
  window.addEventListener("afterprint", () => document.body.classList.remove("printing-receipt"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("receiptModal").hidden) closeReceipt();
  });
}

// ---------- Messenger summary report ----------
function buildSummaryReport({ unpaidOnly = false } = {}) {
  const apartment = state.settings?.apartmentName || "Apartment Tracker";
  const electricity = getBillData("electricity");
  const water = getBillData("water");
  const electricityById = new Map(electricity.rows.map((row) => [row.id, row]));
  const waterById = new Map(water.rows.map((row) => [row.id, row]));

  const people = state.members.map((member) => {
    const parts = [{ label: "Amotan", amount: AMOTAN_AMOUNT, paid: Boolean(member.paid), note: "" }];
    const e = electricityById.get(member.id);
    if (e && e.totalDue > 0) {
      parts.push({
        label: "Electricity",
        amount: e.totalDue,
        paid: e.paid,
        note: e.airconCharge ? ` (incl. aircon ${money(e.airconCharge)})` : ""
      });
    }
    const w = waterById.get(member.id);
    if (w && w.totalDue > 0) parts.push({ label: "Water", amount: w.totalDue, paid: w.paid, note: "" });
    const total = parts.reduce((sum, p) => sum + p.amount, 0);
    const paidTotal = parts.filter((p) => p.paid).reduce((sum, p) => sum + p.amount, 0);
    return { name: profileName(member), parts, total, paidTotal, balance: Math.max(0, total - paidTotal) };
  });

  const shown = unpaidOnly ? people.filter((p) => p.balance > 0.004) : people;
  const grandTotal = people.reduce((sum, p) => sum + p.total, 0);
  const collected = people.reduce((sum, p) => sum + p.paidTotal, 0);
  const outstanding = people.reduce((sum, p) => sum + p.balance, 0);

  const lines = [`🏠 ${apartment}`, `📋 Payment Summary - ${receiptDateLabel(todayISO())}`, ""];
  lines.push(`Amotan: ${money(AMOTAN_AMOUNT)} each`);
  if (electricity.bill.amount > 0 && electricity.totalMembers) {
    const ac = electricity.rows.some((row) => row.airconCharge) ? ` (+${money(ELECTRICITY_AC_SHARE)} for aircon users)` : "";
    lines.push(`⚡ Electricity: ${money(electricity.bill.amount)} total, ${money(electricity.share)} each${ac}`);
  }
  if (water.bill.amount > 0 && water.totalMembers) {
    lines.push(`💧 Water: ${money(water.bill.amount)} total, ${money(water.share)} each`);
  }
  lines.push("", "✅ = paid   ⏳ = not yet paid", "");

  if (!shown.length) {
    lines.push("Everyone is fully paid. Thank you! 🙏");
  } else {
    shown.forEach((person, index) => {
      lines.push(`${index + 1}. ${person.name}`);
      person.parts.forEach((p) => lines.push(`   ${p.label}: ${money(p.amount)}${p.note} ${p.paid ? "✅" : "⏳"}`));
      lines.push(`   TOTAL: ${money(person.total)}`);
      lines.push(person.balance > 0.004 ? `   Balance to pay: ${money(person.balance)}` : "   Fully paid ✅");
      lines.push("");
    });
  }

  lines.push("────────────");
  lines.push(`Total of all residents: ${money(grandTotal)}`);
  lines.push(`Collected: ${money(collected)}`);
  lines.push(`Still to collect: ${money(outstanding)}`);
  lines.push("", "Thank you! 🙏");
  return lines.join("\n");
}

function refreshSummaryReport() {
  $("summaryReportText").value = buildSummaryReport({ unpaidOnly: $("summaryUnpaidOnly").checked });
}

function openSummaryReport() {
  $("summaryUnpaidOnly").checked = false;
  refreshSummaryReport();
  $("summaryModal").hidden = false;
}

function closeSummaryReport() {
  $("summaryModal").hidden = true;
}

async function copySummaryReport() {
  const area = $("summaryReportText");
  const button = $("summaryCopyBtn");
  let copied = false;
  try {
    await navigator.clipboard.writeText(area.value);
    copied = true;
  } catch {
    area.focus();
    area.select();
    try { copied = document.execCommand("copy"); } catch { copied = false; }
  }
  button.textContent = copied ? "Copied for Messenger ✓" : "Select text & copy";
  setTimeout(() => { button.textContent = "Copy for Messenger"; }, 1800);
}

async function shareSummaryReport() {
  const text = $("summaryReportText").value;
  if (navigator.share) {
    try {
      await navigator.share({ title: "Payment Summary", text });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  await copySummaryReport();
}

// ---------- Separated Available Balance & All Activities (Money In & Expense) Messenger Report ----------
function getSelectedBalanceReportScope() {
  const checked = document.querySelector('input[name="balanceReportScope"]:checked');
  return checked ? checked.value : "all";
}

function buildBalanceActivityReport({ scope = "all", includePaidMembers = false } = {}) {
  const apartment = state.settings?.apartmentName || "Apartment Tracker";
  const totals = calcTotals();
  const carryover = Number(state.carryover || 0);
  const totalResidents = state.members.length;
  const paidResidents = state.members.filter((m) => m.paid);

  const incomeItems = [...state.income].sort((a, b) => `${b.date || ""}${b.id}`.localeCompare(`${a.date || ""}${a.id}`));
  const expenseItems = [...state.expenses].sort((a, b) => `${b.date || ""}${b.id}`.localeCompare(`${a.date || ""}${a.id}`));

  if ($("balModalCarryover")) $("balModalCarryover").textContent = money(carryover);
  if ($("balModalAmotan")) $("balModalAmotan").textContent = `+${money(totals.amotanTotal)}`;
  if ($("balModalIncome")) $("balModalIncome").textContent = `+${money(totals.incomeTotal)}`;
  if ($("balModalExpense")) $("balModalExpense").textContent = `-${money(totals.expenseTotal)}`;
  if ($("balModalRemaining")) $("balModalRemaining").textContent = money(totals.remaining);

  const lines = [
    `🏠 ${apartment}`,
    `📊 Available Balance & Activity Report - ${receiptDateLabel(todayISO())}`,
    `Cycle Started: ${state.cycleStarted || todayISO()}`,
    "",
    "💰 AVAILABLE BALANCE BREAKDOWN",
    `• Carried Sobra: ${money(carryover)}`,
    `• Paid Amotan (${totals.paidMembers}/${totalResidents} × ${money(AMOTAN_AMOUNT)}): +${money(totals.amotanTotal)}`,
    `• Extra Money In (${incomeItems.length}): +${money(totals.incomeTotal)}`,
    `• Total Expenses (${expenseItems.length}): -${money(totals.expenseTotal)}`,
    "────────────────────",
    `✅ AVAILABLE BALANCE: ${money(totals.remaining)}`,
    ""
  ];

  if (includePaidMembers) {
    lines.push(`👥 PAID AMOTAN RESIDENTS (${paidResidents.length}/${totalResidents})`);
    if (!paidResidents.length) {
      lines.push("   No Amotan payments recorded yet.");
    } else {
      paidResidents.forEach((m, i) => {
        lines.push(`   ${i + 1}. ${profileName(m)} — +${money(AMOTAN_AMOUNT)} ✅`);
      });
    }
    lines.push("");
  }

  if (scope === "all" || scope === "income") {
    lines.push(`📥 MONEY IN ACTIVITIES (${incomeItems.length}) — Subtotal: +${money(totals.incomeTotal)}`);
    if (!incomeItems.length) {
      lines.push("   No extra Money In entries this cycle.");
    } else {
      incomeItems.forEach((item, index) => {
        const datePart = item.date ? `[${item.date}] ` : "";
        lines.push(`   ${index + 1}. ${datePart}${item.description || "Money In"} — +${money(item.amount)}`);
      });
    }
    lines.push("");
  }

  if (scope === "all" || scope === "expense") {
    lines.push(`📤 EXPENSE ACTIVITIES (${expenseItems.length}) — Subtotal: -${money(totals.expenseTotal)}`);
    if (!expenseItems.length) {
      lines.push("   No expense entries recorded this cycle.");
    } else {
      expenseItems.forEach((item, index) => {
        const datePart = item.date ? `[${item.date}] ` : "";
        const catPart = item.category ? ` (${item.category})` : "";
        const metaParts = [item.paidBy ? `Paid by ${item.paidBy}` : "", item.paymentMethod || ""].filter(Boolean);
        const metaSuffix = metaParts.length ? ` • ${metaParts.join(" via ")}` : "";
        lines.push(`   ${index + 1}. ${datePart}${item.description || "Expense"}${catPart} — -${money(item.amount)}${metaSuffix}`);
      });
    }
    lines.push("");
  }

  lines.push("────────────────────");
  lines.push(`Total Funds In (Sobra + Amotan + Money In): ${money(carryover + totals.amotanTotal + totals.incomeTotal)}`);
  lines.push(`Total Spent (Expenses): -${money(totals.expenseTotal)}`);
  lines.push(`Remaining Available Balance: ${money(totals.remaining)}`);
  lines.push("", "Thank you! 🙏");
  return lines.join("\n");
}

function refreshBalanceActivityReport() {
  const area = $("balanceActivityReportText");
  if (!area) return;
  const scope = getSelectedBalanceReportScope();
  const includePaidMembers = Boolean($("balanceIncludePaidMembers")?.checked);
  area.value = buildBalanceActivityReport({ scope, includePaidMembers });
}

function openBalanceActivityReport(defaultScope = "all") {
  const radio = document.querySelector(`input[name="balanceReportScope"][value="${defaultScope}"]`);
  if (radio) radio.checked = true;
  refreshBalanceActivityReport();
  if ($("balanceActivityModal")) $("balanceActivityModal").hidden = false;
  refreshIcons();
}

function closeBalanceActivityReport() {
  if ($("balanceActivityModal")) $("balanceActivityModal").hidden = true;
}

async function copyBalanceActivityReport() {
  const area = $("balanceActivityReportText");
  const button = $("balanceActivityCopyBtn");
  if (!area || !button) return;
  let copied = false;
  try {
    await navigator.clipboard.writeText(area.value);
    copied = true;
  } catch {
    area.focus();
    area.select();
    try { copied = document.execCommand("copy"); } catch { copied = false; }
  }
  button.textContent = copied ? "Copied for Messenger ✓" : "Select text & copy";
  if (copied) showNotice("Balance & Activity Report copied! Ready to paste in Messenger.", false);
  setTimeout(() => { button.textContent = "Copy for Messenger"; }, 1800);
}

async function shareBalanceActivityReport() {
  const area = $("balanceActivityReportText");
  if (!area) return;
  const text = area.value;
  if (navigator.share) {
    try {
      await navigator.share({ title: "Balance & Activity Summary", text });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  await copyBalanceActivityReport();
}

function buildUtilityBillStatusReport(billKey) {
  const apartment = state.settings?.apartmentName || "Apartment Tracker";
  const data = getBillData(billKey);
  const isElec = billKey === "electricity";
  const icon = isElec ? "⚡" : "💧";
  const title = isElec ? "Electricity Bill" : "Water Bill";
  const lines = [
    `🏠 ${apartment}`,
    `${icon} ${title} Status - ${receiptDateLabel(data.bill.date || todayISO())}`,
    `Total Bill: ${money(data.bill.amount)} (${data.totalMembers} members)`,
    `Base Share: ${money(data.share)} each${isElec && data.rows.some((r) => r.airconCharge) ? ` (+${money(ELECTRICITY_AC_SHARE)} Aircon)` : ""}`,
    "",
    `✅ PAID (${data.paidMembers.length}/${data.totalMembers}) — Collected: ${money(data.collected)}`
  ];
  const paidRows = data.rows.filter((r) => r.paid);
  if (!paidRows.length) {
    lines.push("   None yet");
  } else {
    paidRows.forEach((r, idx) => {
      lines.push(`   ${idx + 1}. ${r.name}: ${money(r.totalDue)} ✅`);
    });
  }
  lines.push("", `⏳ UNPAID (${data.unpaidMembers.length}/${data.totalMembers}) — Remaining: ${money(data.outstanding)}`);
  const unpaidRows = data.rows.filter((r) => !r.paid);
  if (!unpaidRows.length) {
    lines.push("   Everyone is paid! 🎉");
  } else {
    unpaidRows.forEach((r, idx) => {
      lines.push(`   ${idx + 1}. ${r.name}: ${money(r.totalDue)} ⏳`);
    });
  }
  return lines.join("\n");
}

async function copyUtilityBillStatus(billKey, btnEl) {
  const text = buildUtilityBillStatusReport(billKey);
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    const temp = document.createElement("textarea");
    temp.value = text;
    document.body.appendChild(temp);
    temp.select();
    try { copied = document.execCommand("copy"); } catch { copied = false; }
    temp.remove();
  }
  if (btnEl) {
    const orig = btnEl.innerHTML;
    btnEl.textContent = copied ? "Copied ✓" : "Copy failed";
    setTimeout(() => {
      btnEl.innerHTML = orig;
      refreshIcons();
    }, 1800);
  }
  if (copied) {
    showNotice(`${billKey === "electricity" ? "Electricity" : "Water"} bill Paid/Unpaid status copied for Messenger!`, false);
  }
}

function bindSummaryEvents() {
  $("summaryReportBtn")?.addEventListener("click", openSummaryReport);
  $("closeSummaryModal")?.addEventListener("click", closeSummaryReport);
  $("summaryModal")?.addEventListener("click", (e) => {
    if (e.target.id === "summaryModal") closeSummaryReport();
  });
  $("summaryUnpaidOnly")?.addEventListener("change", refreshSummaryReport);
  $("summaryCopyBtn")?.addEventListener("click", copySummaryReport);
  $("summaryShareBtn")?.addEventListener("click", shareSummaryReport);

  // Separated Balance & Activity Summary Report bindings
  $("balanceActivityReportBtn")?.addEventListener("click", () => openBalanceActivityReport("all"));
  $("openBalanceCardReportBtn")?.addEventListener("click", () => openBalanceActivityReport("all"));
  $("openActivityPanelReportBtn")?.addEventListener("click", () => openBalanceActivityReport("all"));
  $("openReportsBalanceSummaryBtn")?.addEventListener("click", () => openBalanceActivityReport("all"));
  $("closeBalanceActivityModal")?.addEventListener("click", closeBalanceActivityReport);
  $("balanceActivityModal")?.addEventListener("click", (e) => {
    if (e.target.id === "balanceActivityModal") closeBalanceActivityReport();
  });
  document.querySelectorAll('input[name="balanceReportScope"]').forEach((radio) => {
    radio.addEventListener("change", refreshBalanceActivityReport);
  });
  $("balanceIncludePaidMembers")?.addEventListener("change", refreshBalanceActivityReport);
  $("balanceActivityCopyBtn")?.addEventListener("click", copyBalanceActivityReport);
  $("balanceActivityShareBtn")?.addEventListener("click", shareBalanceActivityReport);

  // Utility bill status Messenger copy buttons
  $("copyElectricityStatusBtn")?.addEventListener("click", (e) => copyUtilityBillStatus("electricity", e.currentTarget));
  $("copyWaterStatusBtn")?.addEventListener("click", (e) => copyUtilityBillStatus("water", e.currentTarget));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("summaryModal") && !$("summaryModal").hidden) closeSummaryReport();
    if (e.key === "Escape" && $("balanceActivityModal") && !$("balanceActivityModal").hidden) closeBalanceActivityReport();
  });
}

function bindEvents() {
  bindReceiptEvents();
  bindSummaryEvents();
  $("transactionDate").value = todayISO();
  $("electricityDate").value = todayISO();
  $("waterDate").value = todayISO();
  $("reportStartDate").value = isoFromDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  $("reportEndDate").value = todayISO();
  $("announcementDate").value = todayISO();
  $("announcementAuthor").value = "Apartment Admin";
  setTheme(localStorage.getItem(THEME_KEY) || document.documentElement.dataset.theme || "light");
  setSidebarCollapsed(localStorage.getItem(SIDEBAR_KEY) === "yes");

  $("themeToggle")?.addEventListener("click", toggleTheme);

  // Online / Offline Auto-recovery handlers
  window.addEventListener("online", () => {
    console.info("Network connectivity restored.");
    if (unlocked && docRef && !cloudConflict) {
      if (localDirty || localStorage.getItem(unsyncedKey())) {
        setStatus("Reconnecting...", "local");
        saveCloudNow();
      } else {
        setStatus("Synced online", "online");
      }
    } else if (unlocked && !docRef) {
      initFirebase();
    } else if (!unlocked) {
      const app = getApps()[0];
      if (app) loadPublicWorkspace(getFirestore(app));
    }
  });

  window.addEventListener("offline", () => {
    console.info("Network went offline.");
    setStatus("Offline (Local only)", "local");
  });

  // Mobile and Modal Authentication
  $("openSignInModalBtn")?.addEventListener("click", openSignInModal);
  $("navSignInBtn")?.addEventListener("click", () => {
    setMobileNav(false);
    openSignInModal();
  });
  $("bannerSignInLink")?.addEventListener("click", openSignInModal);
  $("closeSignInModal")?.addEventListener("click", closeSignInModal);
  $("modalSignInCancel")?.addEventListener("click", closeSignInModal);
  $("signInModal")?.addEventListener("click", (e) => {
    if (e.target.id === "signInModal") closeSignInModal();
  });
  $("modalSignInForm")?.addEventListener("submit", handleModalSignIn);
  $("modalPasswordToggle")?.addEventListener("click", () => {
    const input = $("modalPasswordInput");
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    $("modalPasswordToggle").setAttribute("aria-label", showing ? "Show password" : "Hide password");
    $("modalPasswordToggle").innerHTML = `<i data-lucide="${showing ? "eye" : "eye-off"}" aria-hidden="true"></i>`;
    refreshIcons();
  });

  // Nav drawer sign-out button
  $("navSignOutBtn")?.addEventListener("click", async () => {
    setMobileNav(false);
    unlocked = false;
    isPlatformAdmin = false;
    cloudUnsubscribe?.();
    cloudUnsubscribe = null;
    if (auth?.currentUser) await signOut(auth);
    docRef = null;
    setEditState();
    renderAnnouncements();
    const app = getApps()[0];
    if (app) await loadPublicWorkspace(getFirestore(app));
  });

  // Workspace Switcher Modal
  $("workspaceLabel")?.addEventListener("click", openWorkspaceSwitcher);
  $("closeWorkspaceSwitcher")?.addEventListener("click", closeWorkspaceSwitcher);
  $("workspaceSwitcherModal")?.addEventListener("click", (e) => {
    if (e.target.id === "workspaceSwitcherModal") closeWorkspaceSwitcher();
  });
  $("joinWorkspaceDirectForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const slug = $("joinWorkspaceInput")?.value.trim();
    if (slug) switchWorkspace(slug);
  });
  $("workspaceSwitcherModal")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".switch-to-workspace-btn");
    if (btn && btn.dataset.slug) switchWorkspace(btn.dataset.slug);
  });
  $("refreshAdminWorkspacesBtn")?.addEventListener("click", renderAdminWorkspacesList);

  // Copy Workspace Links
  const getWorkspaceUrl = () => `${window.location.origin}${window.location.pathname}?workspace=${encodeURIComponent(WORKSPACE_ID)}`;
  $("copyWorkspaceShareBtn")?.addEventListener("click", () => {
    copyToClipboard(getWorkspaceUrl(), $("switcherCopyNotice"));
  });
  $("copyPublicShareBtn")?.addEventListener("click", () => {
    copyToClipboard(getWorkspaceUrl(), $("switcherCopyNotice"));
  });
  $("shareWorkspaceBtn")?.addEventListener("click", () => {
    copyToClipboard(getWorkspaceUrl());
  });
  $("shareTransparencyBtn")?.addEventListener("click", () => {
    copyToClipboard(getWorkspaceUrl());
  });

  // Conflict Resolution Dialog
  $("conflictMergeBtn")?.addEventListener("click", () => resolveConflict("merge"));
  $("conflictKeepLocalBtn")?.addEventListener("click", () => resolveConflict("keep-local"));
  $("conflictUseCloudBtn")?.addEventListener("click", () => resolveConflict("use-cloud"));

  // Recovery Snapshots Manager
  $("recoverySnapshotsList")?.addEventListener("click", async (e) => {
    const restoreBtn = e.target.closest(".restore-snapshot-btn");
    const downloadBtn = e.target.closest(".download-snapshot-btn");
    const key = `${LOCAL_KEY}-recovery`;
    const snapshots = JSON.parse(localStorage.getItem(key) || "[]");

    if (restoreBtn) {
      if (!requireUnlock()) return;
      const index = Number(restoreBtn.dataset.index);
      const target = snapshots[index];
      if (!target?.data) return;
      const ok = await openConfirm({
        title: "Restore recovery snapshot?",
        message: `Restore snapshot "${target.reason || "Snapshot"}" saved at ${new Date(target.savedAt).toLocaleString()}? Your current state will be saved as a backup first.`,
        acceptLabel: "Restore",
        danger: false
      });
      if (!ok) return;
      saveRecoverySnapshot("Before restoring recovery snapshot", state);
      state = normalizeState(target.data);
      saveLocal();
      render();
      scheduleSave();
      showNotice(`Restored snapshot from ${new Date(target.savedAt).toLocaleString()}.`, false);
      renderRecoverySnapshots();
    }

    if (downloadBtn) {
      const index = Number(downloadBtn.dataset.index);
      const target = snapshots[index];
      if (!target) return;
      const blob = new Blob([JSON.stringify(target, null, 2)], { type: "application/json" });
      downloadBlob(`recovery-snapshot-${WORKSPACE_ID}-${index + 1}.json`, blob);
    }
  });

  $("refreshSnapshotsBtn")?.addEventListener("click", renderRecoverySnapshots);
  $("clearSnapshotsBtn")?.addEventListener("click", async () => {
    const ok = await openConfirm({
      title: "Clear recovery snapshots?",
      message: "This will remove all stored recovery snapshots for this workspace from this browser.",
      acceptLabel: "Clear Snapshots",
      danger: true
    });
    if (!ok) return;
    localStorage.removeItem(`${LOCAL_KEY}-recovery`);
    renderRecoverySnapshots();
    showNotice("Recovery snapshots cleared.", false);
  });

  // Activity search and filter
  $("activitySearchInput")?.addEventListener("input", (e) => {
    activitySearchTerm = e.target.value.trim();
    renderTransactions();
  });
  document.querySelectorAll('input[name="activityTypeFilter"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      activityFilterType = e.target.value;
      renderTransactions();
    });
  });
  $("mobileMenuBtn")?.addEventListener("click", () => setMobileNav(!document.body.classList.contains("nav-open")));
  $("topbarMenuBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    setAccountMenu(!$("topbarActions").classList.contains("is-open"));
  });
  document.addEventListener("click", (event) => {
    const menu = $("topbarActions");
    if (menu?.classList.contains("is-open") && !menu.contains(event.target) && !$("topbarMenuBtn").contains(event.target)) {
      setAccountMenu(false);
    }
  });
  $("mobileNavOverlay")?.addEventListener("click", () => setMobileNav(false));
  $("collapseNavBtn")?.addEventListener("click", () => setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed")));
  $("passwordToggle")?.addEventListener("click", () => {
    const input = $("passwordInput");
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    $("passwordToggle").setAttribute("aria-label", showing ? "Show password" : "Hide password");
    $("passwordToggle").innerHTML = `<i data-lucide="${showing ? "eye" : "eye-off"}" aria-hidden="true"></i>`;
    refreshIcons();
  });
  ["confirmCancelBtn", "confirmCancelX"].forEach((id) => $(id)?.addEventListener("click", () => closeConfirm(false)));
  $("confirmAcceptBtn")?.addEventListener("click", () => closeConfirm(true));
  $("confirmModal")?.addEventListener("click", (e) => {
    if (e.target.id === "confirmModal") closeConfirm(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("confirmModal")?.hidden) closeConfirm(false);
      if (!$("profileModal")?.hidden) closeProfileModal();
      if (!$("signInModal")?.hidden) closeSignInModal();
      if (!$("workspaceSwitcherModal")?.hidden) closeWorkspaceSwitcher();
      if (!$("announcementPreviewModal")?.hidden) $("announcementPreviewModal").hidden = true;
      if (document.body.classList.contains("nav-open")) setMobileNav(false);
      setAccountMenu(false);
    }
    if (e.key !== "Tab" || $("confirmModal")?.hidden) return;
    const focusables = focusableElements($("confirmModal"));
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  $("unlockBtn").addEventListener("click", unlockAdmin);
  $("passwordInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") unlockAdmin();
  });
  $("workspaceCreateForm")?.addEventListener("submit", createWorkspaceAccount);

  $("lockBtn").addEventListener("click", async () => {
    unlocked = false;
    isPlatformAdmin = false;
    cloudUnsubscribe?.();
    cloudUnsubscribe = null;
    if (auth?.currentUser) await signOut(auth);
    docRef = null;
    setEditState();
    renderAnnouncements();
    const app = getApps()[0];
    if (app) await loadPublicWorkspace(getFirestore(app));
  });

  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", () => setActiveView(tab.dataset.view));
  });

  document.querySelectorAll('input[name="reportPeriod"]').forEach((input) => {
    input.addEventListener("change", renderReports);
  });
  $("reportStartDate").addEventListener("change", () => {
    document.querySelector('input[name="reportPeriod"][value="custom"]').checked = true;
    renderReports();
  });
  $("reportEndDate").addEventListener("change", () => {
    document.querySelector('input[name="reportPeriod"][value="custom"]').checked = true;
    renderReports();
  });
  $("exportCsvBtn").addEventListener("click", exportReportCSV);
  $("exportPdfBtn").addEventListener("click", exportReportPDF);
  $("exportExcelBtn").addEventListener("click", exportReportExcel);

  $("viewAllAnnouncements").addEventListener("click", () => {
    showAllAnnouncements = !showAllAnnouncements;
    renderAnnouncements();
  });
  $("announcementBoardList").addEventListener("click", (e) => {
    const btn = e.target.closest(".read-more-btn");
    if (!btn) return;
    if (expandedAnnouncementIds.has(btn.dataset.id)) expandedAnnouncementIds.delete(btn.dataset.id);
    else expandedAnnouncementIds.add(btn.dataset.id);
    renderAnnouncements();
  });

  ["announcementSearch", "announcementStatusFilter", "announcementPriorityFilter", "announcementDateFilter"].forEach((id) => {
    $(id)?.addEventListener("input", renderAnnouncements);
    $(id)?.addEventListener("change", renderAnnouncements);
  });
  $("clearAnnouncementFilters")?.addEventListener("click", () => {
    $("announcementSearch").value = "";
    $("announcementStatusFilter").value = "";
    $("announcementPriorityFilter").value = "";
    $("announcementDateFilter").value = "";
    renderAnnouncements();
  });
  $("announcementMessage")?.addEventListener("input", () => {
    if ($("announcementCharacterGuide")) {
      $("announcementCharacterGuide").textContent = `${$("announcementMessage").value.length} / 1200 characters. Times use your browser timezone.`;
    }
  });

  $("saveAnnouncementDraft").addEventListener("click", () => saveAnnouncement("draft"));
  $("publishAnnouncement").addEventListener("click", () => saveAnnouncement("published"));
  $("scheduleAnnouncement").addEventListener("click", () => saveAnnouncement("scheduled"));
  $("previewAnnouncement").addEventListener("click", () => {
    if (!requireUnlock()) return;
    previewAnnouncement();
  });
  $("cancelAnnouncementEdit").addEventListener("click", resetAnnouncementForm);
  $("closeAnnouncementPreview").addEventListener("click", () => {
    $("announcementPreviewModal").hidden = true;
  });
  $("announcementPreviewModal").addEventListener("click", (e) => {
    if (e.target.id === "announcementPreviewModal") $("announcementPreviewModal").hidden = true;
  });

  $("announcementAdminBody").addEventListener("click", async (e) => {
    const editBtn = e.target.closest(".edit-announcement");
    const publishBtn = e.target.closest(".publish-announcement");
    const archiveBtn = e.target.closest(".archive-announcement");
    const deleteBtn = e.target.closest(".delete-announcement");
    if (editBtn) {
      editAnnouncement(editBtn.dataset.id);
      return;
    }
    if (publishBtn) {
      updateAnnouncementStatus(publishBtn.dataset.id, "published");
      return;
    }
    if (archiveBtn) {
      const ok = await openConfirm({
        title: "Archive announcement?",
        message: "Archived announcements will no longer appear on the public board.",
        acceptLabel: "Archive",
        danger: false
      });
      if (ok) updateAnnouncementStatus(archiveBtn.dataset.id, "archived");
      return;
    }
    if (deleteBtn) {
      if (!requireUnlock()) return;
      const ok = await openConfirm({
        title: "Delete announcement?",
        message: "This announcement will be permanently removed. This action cannot be undone.",
        acceptLabel: "Delete",
        danger: true
      });
      if (!ok) return;
      state.announcements = state.announcements.filter((item) => item.id !== deleteBtn.dataset.id);
      resetAnnouncementForm();
      render();
      scheduleSave();
    }
  });

  $("memberInfoSearch").addEventListener("input", renderMembersInfo);
  $("clearMemberInfoSearch").addEventListener("click", () => {
    $("memberInfoSearch").value = "";
    renderMembersInfo();
  });
  $("membersInfoBody").addEventListener("click", (e) => {
    const viewBtn = e.target.closest(".view-member-info");
    const editBtn = e.target.closest(".edit-member-info");
    if (viewBtn) openProfileModal(viewBtn.dataset.id);
    if (editBtn) {
      if (!requireUnlock()) return;
      openProfileModal(editBtn.dataset.id, true);
    }
  });

  $("memberForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!requireUnlock()) return;
    const name = $("memberName").value.trim();
    if (!name) {
      showNotice("Add a member name first.", false);
      return;
    }
    let profile;
    try {
      profile = await profileFromAddForm();
    } catch (error) {
      showNotice(error.message || "Profile photo could not be loaded.", false);
      return;
    }
    state.members.push({ id: uid(), name, paid: false, profile });
    $("memberName").value = "";
    resetProfileForm();
    showNotice("", true);
    render();
    scheduleSave();
  });

  $("membersList").addEventListener("change", (e) => {
    if (!e.target.classList.contains("member-paid")) return;
    if (!requireUnlock()) {
      e.target.checked = !e.target.checked;
      return;
    }
    const member = state.members.find((m) => m.id === e.target.dataset.id);
    if (member) {
      member.paid = e.target.checked;
      member.paidAt = member.paid ? todayISO() : "";
    }
    render();
    scheduleSave();
    if (member?.paid) openReceipt("amotan", member.id);
  });

  $("membersList").addEventListener("click", async (e) => {
    const btn = e.target.closest(".delete-member");
    if (btn) {
      if (!requireUnlock()) return;
      const ok = await openConfirm({
        title: "Delete resident?",
        message: "This resident will be removed from member and utility bill lists.",
        acceptLabel: "Delete",
        danger: true
      });
      if (!ok) return;
      const memberId = btn.dataset.id;
      state.members = state.members.filter((m) => m.id !== memberId);
      for (const bill of [state.bills.electricity, state.bills.water]) {
        bill.members = bill.members.filter((id) => id !== memberId);
        bill.paidMembers = bill.paidMembers.filter((id) => id !== memberId);
        if (bill.airconMembers) bill.airconMembers = bill.airconMembers.filter((id) => id !== memberId);
      }
      if (activeProfileMemberId === memberId) closeProfileModal();
      render();
      scheduleSave();
      return;
    }

    if (e.target.closest("label, input, button")) return;
    const row = e.target.closest(".member-row");
    if (row?.dataset.id) openProfileModal(row.dataset.id);
  });

  $("membersList").addEventListener("keydown", (e) => {
    if (!["Enter", " "].includes(e.key)) return;
    if (e.target.closest("label, input, button")) return;
    const row = e.target.closest(".member-row");
    if (!row?.dataset.id) return;
    e.preventDefault();
    openProfileModal(row.dataset.id);
  });

  $("closeProfileModal").addEventListener("click", closeProfileModal);

  $("profileModal").addEventListener("click", (e) => {
    if (e.target.id === "profileModal") closeProfileModal();
  });

  $("profileModalBody").addEventListener("click", (e) => {
    if (e.target.closest("#editProfileBtn")) {
      if (!requireUnlock()) return;
      editingProfileMemberId = activeProfileMemberId;
      renderProfileModal();
      return;
    }
    if (e.target.closest("#cancelProfileEdit")) {
      editingProfileMemberId = null;
      renderProfileModal();
    }
  });

  $("profileModalBody").addEventListener("submit", async (e) => {
    if (e.target.id !== "profileEditForm") return;
    e.preventDefault();
    if (!requireUnlock()) return;
    const member = state.members.find((m) => m.id === activeProfileMemberId);
    if (!member) return;
    const memberName = e.target.elements.memberName.value.trim();
    if (!memberName) {
      showNotice("Member name is required.", false);
      return;
    }
    try {
      member.name = memberName;
      member.profile = await profileFromEditForm(e.target, member.profile || defaultProfile());
    } catch (error) {
      showNotice(error.message || "Profile photo could not be loaded.", false);
      return;
    }
    editingProfileMemberId = null;
    showNotice("", true);
    render();
    renderProfileModal();
    scheduleSave();
  });

  $("transactionForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!requireUnlock()) return;

    const type = e.target.querySelector('input[name="transactionType"]:checked')?.value || "income";
    const amount = Number($("transactionAmount").value);
    const description = $("transactionDesc").value.trim();
    const date = $("transactionDate").value || todayISO();

    if (!amount || amount <= 0) {
      showNotice("Enter a valid amount.", false);
      return;
    }
    if (!description) {
      showNotice("Enter a short description.", false);
      return;
    }

    const entry = type === "expense"
      ? normalizeExpense({ id: uid(), amount, description, date, category: "Miscellaneous" })
      : normalizeIncome({ id: uid(), amount, description, date });
    if (type === "expense") state.expenses.unshift(entry);
    else state.income.unshift(entry);

    $("transactionAmount").value = "";
    $("transactionDesc").value = "";
    $("transactionDate").value = todayISO();
    showNotice("", true);
    render();
    scheduleSave();
  });

  $("transactionForm").addEventListener("change", (e) => {
    if (e.target.name !== "transactionType") return;
    $("transactionSubmit").textContent = e.target.value === "expense" ? "Add Expense" : "Add Money In";
    $("transactionSubmit").className = e.target.value === "expense" ? "danger-btn" : "success-btn";
  });

  $("transactionsList").addEventListener("click", async (e) => {
    const btn = e.target.closest(".delete-transaction");
    if (!btn) return;
    if (!requireUnlock()) return;
    const ok = await openConfirm({
      title: "Delete transaction?",
      message: "This activity entry will be permanently removed.",
      acceptLabel: "Delete",
      danger: true
    });
    if (!ok) return;
    const kind = btn.dataset.kind;
    const id = btn.dataset.id;
    if (kind === "expense") state.expenses = state.expenses.filter((item) => item.id !== id);
    else state.income = state.income.filter((item) => item.id !== id);
    render();
    scheduleSave();
  });

  $("expenseForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!requireUnlock()) return;
    const amount = Number($("expenseAmount").value);
    const description = $("expenseDescription").value.trim();
    if (!amount || amount <= 0) {
      showNotice("Enter a valid expense amount.", false);
      return;
    }
    if (!description) {
      showNotice("Enter an expense description.", false);
      return;
    }
    const entry = normalizeExpense({
      id: $("expenseId").value || uid(),
      date: $("expenseDate").value || todayISO(),
      category: $("expenseCategory").value || "Miscellaneous",
      description,
      amount,
      paidBy: $("expensePaidBy").value,
      paymentMethod: $("expensePaymentMethod").value,
      receiptNumber: $("expenseReceiptNumber").value,
      notes: $("expenseNotes").value
    });
    const existingIndex = state.expenses.findIndex((expense) => expense.id === entry.id);
    if (existingIndex >= 0) state.expenses[existingIndex] = entry;
    else state.expenses.unshift(entry);
    resetExpenseForm();
    showNotice("", true);
    render();
    scheduleSave();
  });

  $("expenseCancelBtn").addEventListener("click", resetExpenseForm);

  ["expenseSearch", "expenseFilterCategory", "expenseFilterStart", "expenseFilterEnd"].forEach((id) => {
    $(id).addEventListener("input", renderExpenseManagement);
    $(id).addEventListener("change", renderExpenseManagement);
  });

  $("clearExpenseFilters").addEventListener("click", () => {
    $("expenseSearch").value = "";
    $("expenseFilterCategory").value = "";
    $("expenseFilterStart").value = "";
    $("expenseFilterEnd").value = "";
    renderExpenseManagement();
  });

  $("expensesTableBody").addEventListener("click", async (e) => {
    const editBtn = e.target.closest(".edit-expense");
    const deleteBtn = e.target.closest(".delete-expense");
    if (editBtn) {
      const expense = state.expenses.find((item) => item.id === editBtn.dataset.id);
      if (!expense) return;
      $("expenseId").value = expense.id;
      $("expenseDate").value = expense.date || todayISO();
      $("expenseCategory").value = expense.category || "Miscellaneous";
      $("expenseDescription").value = expense.description || "";
      $("expenseAmount").value = expense.amount || "";
      $("expensePaidBy").value = expense.paidBy || "";
      $("expensePaymentMethod").value = expense.paymentMethod || "";
      $("expenseReceiptNumber").value = expense.receiptNumber || "";
      $("expenseNotes").value = expense.notes || "";
      $("expenseSubmitBtn").textContent = "Save Expense";
      $("expenseCancelBtn").hidden = false;
      return;
    }
    if (deleteBtn) {
      if (!requireUnlock()) return;
      const ok = await openConfirm({
        title: "Delete expense?",
        message: "This expense record will be permanently removed.",
        acceptLabel: "Delete",
        danger: true
      });
      if (!ok) return;
      state.expenses = state.expenses.filter((item) => item.id !== deleteBtn.dataset.id);
      render();
      scheduleSave();
    }
  });

  $("downloadJsonBackup").addEventListener("click", () => downloadBackup("json"));
  $("downloadZipBackup").addEventListener("click", () => downloadBackup("zip"));
  $("downloadBeforeDelete").addEventListener("click", () => {
    downloadBackup("json");
    deleteBackupDownloaded = true;
    renderBackupSettings();
  });

  $("restoreFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    pendingRestoreState = null;
    $("confirmRestoreBtn").disabled = true;
    $("restorePreview").innerHTML = "";
    if (!file) return;
    try {
      const text = await readBackupFile(file);
      pendingRestoreState = validateBackupPayload(JSON.parse(text));
      renderRestorePreview(pendingRestoreState);
      $("confirmRestoreBtn").disabled = false;
      showNotice("", true);
    } catch (error) {
      showNotice(error.message || "Invalid or corrupted backup file.", false);
    }
  });

  $("confirmRestoreBtn").addEventListener("click", async () => {
    if (!pendingRestoreState) return;
    if (!requireUnlock()) return;
    const ok = await openConfirm({
      title: "Restore backup?",
      message: "Current records will be replaced by the uploaded backup. This action cannot be undone.",
      acceptLabel: "Restore",
      danger: true
    });
    if (!ok) return;
    saveRecoverySnapshot("Before restoring backup");
    state = normalizeState(pendingRestoreState);
    pendingRestoreState = null;
    $("restoreFile").value = "";
    $("restorePreview").innerHTML = "";
    $("confirmRestoreBtn").disabled = true;
    render();
    scheduleSave();
  });

  $("autoBackupEnabled").addEventListener("change", () => {
    if (!requireUnlock()) {
      $("autoBackupEnabled").checked = state.settings.autoBackup.enabled;
      return;
    }
    state.settings.autoBackup.enabled = $("autoBackupEnabled").checked;
    renderBackupSettings();
    scheduleSave();
  });

  $("autoBackupFrequency").addEventListener("change", () => {
    if (!requireUnlock()) {
      $("autoBackupFrequency").value = state.settings.autoBackup.frequency;
      return;
    }
    state.settings.autoBackup.frequency = $("autoBackupFrequency").value;
    renderBackupSettings();
    scheduleSave();
  });

  $("deleteConfirmInput").addEventListener("input", renderBackupSettings);

  $("safeDeleteBtn").addEventListener("click", async () => {
    if (!requireUnlock()) return;
    if (!deleteBackupDownloaded || $("deleteConfirmInput").value.trim() !== "DELETE") return;
    const ok = await openConfirm({
      title: "Delete all data?",
      message: "All apartment tracker data will be cleared after your backup gate. This action cannot be undone.",
      acceptLabel: "Delete all data",
      danger: true
    });
    if (!ok) return;
    saveRecoverySnapshot("Before deleting all data");
    state = defaultState();
    deleteBackupDownloaded = false;
    $("deleteConfirmInput").value = "";
    render();
    scheduleSave();
  });

  $("manualResetBtn").addEventListener("click", async () => {
    if (!requireUnlock()) return;
    const ok = await openConfirm({
      title: "End current cycle?",
      message: "Paid members, money in, and expenses will reset while the remaining balance becomes next cycle's sobra.",
      acceptLabel: "End cycle",
      danger: false
    });
    if (ok) endCycle();
  });

  $("clearActivityBtn").addEventListener("click", async () => {
    if (!requireUnlock()) return;
    const ok = await openConfirm({
      title: "Clear activity?",
      message: "Money in and expense records for this cycle will be removed.",
      acceptLabel: "Clear activity",
      danger: true
    });
    if (ok) clearActivity();
  });

  $("clearAllBtn").addEventListener("click", () => {
    if (!requireUnlock()) return;
    setActiveView("backup");
    showNotice("Use the Danger Zone to download a backup, type DELETE, and confirm before clearing all data.", false);
  });

  $("electricityAmount").addEventListener("input", () => {
    if (!requireUnlock()) {
      render();
      return;
    }
    state.bills.electricity.amount = Number($("electricityAmount").value || 0);
    renderBillInputs();
    renderBillDashboard();
    scheduleSave();
  });

  $("electricityDate").addEventListener("change", () => {
    if (!requireUnlock()) {
      render();
      return;
    }
    state.bills.electricity.date = $("electricityDate").value || todayISO();
    scheduleSave();
  });

  $("waterAmount").addEventListener("input", () => {
    if (!requireUnlock()) {
      render();
      return;
    }
    state.bills.water.amount = Number($("waterAmount").value || 0);
    renderBillInputs();
    renderBillDashboard();
    scheduleSave();
  });

  $("waterDate").addEventListener("change", () => {
    if (!requireUnlock()) {
      render();
      return;
    }
    state.bills.water.date = $("waterDate").value || todayISO();
    scheduleSave();
  });

  for (const key of ["electricity", "water"]) {
    const memberList = $(`${key}Members`);
    const tableBody = $(`${key}MembersBody`);
    const unpaidList = $(`${key}UnpaidList`);

    memberList.addEventListener("change", (e) => {
      if (!e.target.classList.contains(`${key}-member`)) return;
      if (!requireUnlock()) {
        e.target.checked = !e.target.checked;
        return;
      }
      updateBillMemberSelection(key, e.target.dataset.id, e.target.checked);
      if (key === "electricity") ensureAirconMembers();
      render();
      scheduleSave();
    });

    memberList.addEventListener("click", (e) => {
      const btn = e.target.closest(".aircon-toggle");
      if (!btn || key !== "electricity") return;
      if (!requireUnlock()) return;
      const bill = state.bills.electricity;
      const memberId = btn.dataset.id;
      if (!bill.airconMembers) bill.airconMembers = [];
      if (bill.airconMembers.includes(memberId)) {
        bill.airconMembers = bill.airconMembers.filter((id) => id !== memberId);
      } else if (bill.airconMembers.length < 2) {
        bill.airconMembers.push(memberId);
      }
      render();
      scheduleSave();
    });

    tableBody.addEventListener("change", (e) => {
      if (!e.target.classList.contains(`${key}-paid`)) return;
      if (!requireUnlock()) {
        e.target.checked = !e.target.checked;
        return;
      }
      const paidId = e.target.dataset.id;
      const nowPaid = e.target.checked;
      updateBillPaidStatus(key, paidId, nowPaid);
      render();
      scheduleSave();
      if (nowPaid) openReceipt(key, paidId);
    });

    unpaidList.addEventListener("click", (e) => {
      const btn = e.target.closest(".mark-paid");
      if (!btn) return;
      if (!requireUnlock()) return;
      updateBillPaidStatus(key, btn.dataset.id, true);
      render();
      scheduleSave();
      openReceipt(key, btn.dataset.id);
    });
  }
}

function renderBillInputs() {
  for (const key of ["electricity", "water"]) {
    const bill = state.bills[key];
    const members = state.members;
    const list = $(`${key}Members`);
    const summary = getBillData(key);
    const acMembers = new Set(bill.airconMembers || []);
    const amountInput = $(`${key}Amount`);
    const dateInput = $(`${key}Date`);
    const summaryEl = $(`${key}Summary`);
    const totalsEl = $(`${key}Totals`);

    if (amountInput) {
      amountInput.disabled = !unlocked;
      if (document.activeElement !== amountInput) amountInput.value = bill.amount || "";
    }
    if (dateInput) {
      dateInput.disabled = !unlocked;
      if (document.activeElement !== dateInput) dateInput.value = bill.date || todayISO();
    }
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div><strong>${money(summary.bill.amount)}</strong><span>Total Bill Amount</span></div>
        <div><strong>${summary.totalMembers}</strong><span>Number of Members</span></div>
        <div><strong>${money(summary.share)}</strong><span>Amount Per Member</span></div>
        <div><strong>${money(summary.collected)}</strong><span>Total Collected</span></div>
        <div><strong>${money(summary.outstanding)}</strong><span>Remaining Balance</span></div>
      `;
    }
    if (totalsEl) {
      totalsEl.innerHTML = key === "electricity"
        ? `
          <div><strong>${money(summary.bill.amount)}</strong><span>Original Electricity Bill</span></div>
          <div><strong>${money(ELECTRICITY_AC_CHARGE)}</strong><span>Aircon Charges Total</span></div>
          <div><strong>${money(summary.sharedBillPortion)}</strong><span>Shared Bill Portion</span></div>
          <div><strong>${money(summary.collected)}</strong><span>Total Collected</span></div>
          <div><strong>${money(summary.outstanding)}</strong><span>Remaining Balance</span></div>
        `
        : `
          <div><strong>${money(summary.bill.amount)}</strong><span>Total Water Bill</span></div>
          <div><strong>${money(summary.share)}</strong><span>Amount Per Member</span></div>
          <div><strong>${money(summary.collected)}</strong><span>Total Collected</span></div>
          <div><strong>${money(summary.outstanding)}</strong><span>Remaining Balance</span></div>
        `;
    }

    list.innerHTML = members.length
      ? members.map((member) => `
        <div class="bill-member-row">
          <label>
            <input type="checkbox" class="${key}-member" data-id="${member.id}" ${bill.members.includes(member.id) ? "checked" : ""} ${unlocked ? "" : "disabled"} />
            <span>${escapeHTML(member.name)}</span>
          </label>
          ${key === "electricity" ? `
            <button type="button" class="mini aircon-toggle ${acMembers.has(member.id) ? "active" : ""}" data-id="${member.id}" ${(!bill.members.includes(member.id) || !unlocked) ? "disabled" : ""}>${acMembers.has(member.id) ? "Aircon User" : "Set Aircon"}</button>
          ` : `<span class="bill-badge">${bill.paidMembers.includes(member.id) ? "Paid" : "Unpaid"}</span>`}
        </div>
      `).join("")
      : `<p class="empty">Add household members first.</p>`;

    const tableBody = $(`${key}MembersBody`);
    if (tableBody) {
      tableBody.innerHTML = summary.rows.length
        ? summary.rows.map((row) => `
          <tr>
            <td>${escapeHTML(row.name)}</td>
            <td>${money(row.share)}</td>
            <td>${money(row.airconCharge)}</td>
            <td>${money(row.totalDue)}</td>
            <td>
              <label class="paid-toggle ${row.paid ? "is-paid" : "is-unpaid"}">
                <input type="checkbox" class="${key}-paid" data-id="${row.id}" ${row.paid ? "checked" : ""} ${unlocked ? "" : "disabled"} />
                <span>${row.paid ? "Paid" : "Unpaid"}</span>
              </label>
              ${row.paid ? `<button class="mini receipt-btn" data-kind="${key}" data-id="${row.id}" type="button">Receipt</button>` : ""}
            </td>
          </tr>
        `).join("")
        : `<tr><td colspan="5" class="empty-row">Select members for this bill.</td></tr>`;
    }

    const paidList = $(`${key}PaidList`);
    const unpaidList = $(`${key}UnpaidList`);
    if (paidList) {
      paidList.innerHTML = summary.paidMembers.length
        ? summary.paidMembers.map((member) => `<li class="paid-item">${escapeHTML(member.name)} <span>${money(summary.rows.find((row) => row.id === member.id)?.totalDue || 0)}</span> <button class="mini receipt-btn" data-kind="${key}" data-id="${member.id}" type="button">Receipt</button></li>`).join("")
        : `<li class="empty-row">No paid members yet.</li>`;
    }
    if (unpaidList) {
      unpaidList.innerHTML = summary.unpaidMembers.length
        ? summary.unpaidMembers.map((member) => `
          <li class="unpaid-item">
            <span>${escapeHTML(member.name)} <strong>${money(summary.rows.find((row) => row.id === member.id)?.totalDue || 0)}</strong></span>
            ${unlocked ? `<button class="mini mark-paid" data-id="${member.id}" type="button">Mark Paid</button>` : ""}
          </li>
        `).join("")
        : `<li class="empty-row">All members paid.</li>`;
    }
  }
}

function renderBillDashboard() {
  const electricity = getBillData("electricity");
  const water = getBillData("water");
  const totalCollected = electricity.collected + water.collected;
  const totalOutstanding = electricity.outstanding + water.outstanding;
  $("billElectricityTotal").textContent = money(electricity.bill.amount);
  $("billWaterTotal").textContent = money(water.bill.amount);
  $("billCollectedTotal").textContent = money(totalCollected);
  $("billOutstandingTotal").textContent = money(totalOutstanding);
}

function renderAnnouncements() {
  if (!$("announcementBoardList")) return;
  const published = publishedAnnouncements();
  const visible = showAllAnnouncements ? published : published.slice(0, 2);
  $("announcementCount").textContent = `${published.length} published`;
  $("announcementBoardList").innerHTML = visible.length
    ? visible.map((announcement) => announcementCardMarkup(announcement, published.length > 1 && !showAllAnnouncements)).join("")
    : `
      <div class="announcement-empty">
        <strong>No announcements right now</strong>
        <span>New apartment updates will appear here.</span>
      </div>
    `;
  $("viewAllAnnouncements").hidden = published.length <= 2;
  $("viewAllAnnouncements").textContent = showAllAnnouncements ? "Show latest announcements" : "View all announcements";

  $("announcementAdminState").textContent = unlocked ? "Unlocked" : "Locked";
  $("announcementAdminGate").hidden = unlocked;
  $("announcementAdminContent").hidden = !unlocked;
  if (!unlocked) return;

  const filters = {
    search: $("announcementSearch")?.value.trim().toLowerCase() || "",
    status: $("announcementStatusFilter")?.value || "",
    priority: $("announcementPriorityFilter")?.value || "",
    fromDate: $("announcementDateFilter")?.value || ""
  };
  const allAnnouncements = [...state.announcements].sort((a, b) => {
    return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
  });
  const announcements = allAnnouncements.filter((announcement) => {
    const haystack = [announcement.title, announcement.author, announcement.message, announcement.status, announcement.priority].join(" ").toLowerCase();
    if (filters.search && !haystack.includes(filters.search)) return false;
    if (filters.status && announcement.status !== filters.status) return false;
    if (filters.priority && announcement.priority !== filters.priority) return false;
    if (filters.fromDate && (announcement.date || todayISO()) < filters.fromDate) return false;
    return true;
  });
  $("announcementAdminSummary").textContent = `${announcements.length} of ${allAnnouncements.length} announcement${allAnnouncements.length === 1 ? "" : "s"} shown.`;
  $("announcementAdminBody").innerHTML = announcements.length
    ? announcements.map((announcement) => {
      const publishText = announcement.status === "scheduled" && announcement.scheduledAt
        ? new Date(announcement.scheduledAt).toLocaleString("en-PH")
        : announcement.status === "published"
          ? announcementDisplayDate(announcement)
          : "-";
      return `
        <tr>
          <td>
            <strong>${escapeHTML(announcement.title)}</strong>
            <small>By ${escapeHTML(announcement.author)}${announcement.pinned ? " | Pinned" : ""}</small>
          </td>
          <td><span class="priority-label priority-${announcement.priority}">${announcementPriorityLabel(announcement.priority)}</span></td>
          <td><span class="status-label status-${announcement.status}">${escapeHTML(announcement.status[0].toUpperCase() + announcement.status.slice(1))}</span></td>
          <td>${escapeHTML(publishText)}</td>
          <td class="table-actions">
            <button class="mini edit-announcement" data-id="${announcement.id}" type="button">Edit</button>
            ${announcement.status !== "published" ? `<button class="mini publish-announcement" data-id="${announcement.id}" type="button">Publish</button>` : ""}
            ${announcement.status !== "archived" ? `<button class="mini archive-announcement" data-id="${announcement.id}" type="button">Archive</button>` : ""}
            <button class="mini danger delete-announcement" data-id="${announcement.id}" type="button">Delete</button>
          </td>
        </tr>
      `;
    }).join("")
    : `<tr><td colspan="5" class="empty-row">${allAnnouncements.length ? "No announcements match the current filters." : "No announcements yet."}</td></tr>`;
}

function renderReports() {
  if (!$("reportsSummary")) return;
  const data = reportData();
  const totalDue = data.summary.monthlyCollections + data.summary.overduePayments;
  const collectionRate = totalDue ? Math.round((data.summary.monthlyCollections / totalDue) * 100) : 0;
  const topCategory = sumByCategory(data.records.expenses)[0];
  const unpaidMembers = state.members.filter((member) => !member.paid).length;
  const rangeStart = data.range.start.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  const rangeEnd = data.range.end.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  const netText = data.summary.netBalance >= 0
    ? `You received ${money(data.summary.netBalance)} more than you spent in this period.`
    : `You spent ${money(Math.abs(data.summary.netBalance))} more than you received in this period.`;
  const balanceText = `The report and Tracker available balance are both ${money(data.summary.availableBalance)}. This includes ${money(data.summary.carryover)} carried sobra.`;

  $("reportRangeLabel").textContent = `${rangeStart} to ${rangeEnd}`;
  $("reportPlainSummary").textContent = `${balanceText} ${netText}`;
  $("reportInsights").innerHTML = `
    <article class="report-insight ${data.summary.availableBalance >= 0 ? "is-positive" : "is-warning"}">
      <span>Available balance</span>
      <strong>${money(data.summary.availableBalance)}</strong>
      <p>Matches the Tracker and includes ${money(data.summary.carryover)} carried sobra.</p>
    </article>
    <article class="report-insight">
      <span>Collection progress</span>
      <strong>${collectionRate}% collected</strong>
      <p>${money(data.summary.monthlyCollections)} collected and ${money(data.summary.overduePayments)} still unpaid.</p>
    </article>
    <article class="report-insight">
      <span>Largest expense</span>
      <strong>${escapeHTML(topCategory?.[0] || "No expenses")}</strong>
      <p>${topCategory ? `${money(topCategory[1])} spent in this category.` : "Add expenses to see the biggest spending area."}</p>
    </article>
    <article class="report-insight ${unpaidMembers ? "is-warning" : "is-positive"}">
      <span>Member payments</span>
      <strong>${unpaidMembers ? `${unpaidMembers} unpaid` : "Everyone paid"}</strong>
      <p>${unpaidMembers ? "These member payments still need follow-up." : "All member contributions are marked paid."}</p>
    </article>
  `;

  const cards = [
    ["Money Received", money(data.summary.incomeTotal), `Includes ${money(data.summary.amotanIncome)} from paid \u20B1700 amotan`],
    ["Money Spent", money(data.summary.expenseTotal), "Expenses recorded during the selected dates"],
    ["Period Difference", money(data.summary.netBalance), "Money received minus money spent for the selected dates"],
    ["Carried Sobra", money(data.summary.carryover), "Balance brought forward from the previous cycle"],
    ["Available Balance", money(data.summary.availableBalance), "Matches the Available Balance shown on the Tracker"],
    ["Residents", data.summary.totalMembers, "Members currently saved"],
    ["Rooms Occupied", data.summary.occupiedRooms, "Rooms assigned to residents"],
    ["Rooms Vacant", data.summary.vacantRooms, "Known rooms without residents"],
    ["Collected This Cycle", money(data.summary.monthlyCollections), "Member and utility payments marked paid"],
    ["Still Unpaid", money(data.summary.overduePayments), "Member and utility amounts needing follow-up"]
  ];
  $("reportsSummary").innerHTML = cards.map(([label, value, helper]) => `
    <article class="summary-card">
      <span>${escapeHTML(label)}</span>
      <strong>${escapeHTML(value)}</strong>
      <small>${escapeHTML(helper)}</small>
    </article>
  `).join("");

  drawBarChart("incomeChart", sumByMonth(data.records.income), "#2f6f89");
  drawBarChart("expenseChart", sumByMonth(data.records.expenses), "#a66f43");
  drawDonutChart("categoryChart", sumByCategory(data.records.expenses));
  drawDonutChart("collectionChart", [
    ["Collected", data.summary.monthlyCollections],
    ["Overdue", data.summary.overduePayments]
  ]);

  $("reportTransactionsBody").innerHTML = data.records.transactions.length
    ? data.records.transactions.slice(0, 10).map((item) => `
      <tr>
        <td>${escapeHTML(item.date)}</td>
        <td>${escapeHTML(item.type)}</td>
        <td>${escapeHTML(item.description)}</td>
        <td>${money(item.amount)}</td>
      </tr>
    `).join("")
    : `<tr><td class="empty-row" colspan="4">No recent transactions for this range.</td></tr>`;

  $("financialReportBody").innerHTML = `
    <tr><th>Money received</th><td>${money(data.summary.incomeTotal)}</td></tr>
    <tr><th>From \u20B1700 amotan</th><td>${money(data.summary.amotanIncome)}</td></tr>
    <tr><th>Carried sobra</th><td>${money(data.summary.carryover)}</td></tr>
    <tr><th>Money spent</th><td>${money(data.summary.expenseTotal)}</td></tr>
    <tr><th>Period difference</th><td>${money(data.summary.netBalance)}</td></tr>
    <tr><th>Available balance</th><td><strong>${money(data.summary.availableBalance)}</strong> (matches Tracker)</td></tr>
    <tr><th>What it means</th><td>${escapeHTML(netText)}</td></tr>
    <tr><th>Top expense category</th><td>${topCategory ? `${escapeHTML(topCategory[0])}: ${money(topCategory[1])}` : "No expenses in this period"}</td></tr>
    <tr><th>Collection progress</th><td>${collectionRate}% of current dues collected</td></tr>
  `;

  const rooms = roomStats();
  $("occupancyReportBody").innerHTML = `
    <tr><th>Known rooms</th><td>${rooms.total}</td></tr>
    <tr><th>Occupied</th><td>${rooms.occupied}</td></tr>
    <tr><th>Vacant</th><td>${rooms.vacant}</td></tr>
    <tr><th>Collected this cycle</th><td>${money(data.summary.monthlyCollections)}</td></tr>
    <tr><th>Still unpaid</th><td>${money(data.summary.overduePayments)}</td></tr>
  `;

  const overdueMembers = state.members.filter((member) => !member.paid);
  $("overdueReportBody").innerHTML = overdueMembers.length
    ? overdueMembers.map((member) => `
      <tr>
        <td>${escapeHTML(profileName(member))}</td>
        <td>${escapeHTML(member.profile?.apartmentRoom || "No room")}</td>
        <td>${money(AMOTAN_AMOUNT)}</td>
      </tr>
    `).join("")
    : `<tr><td class="empty-row" colspan="3">No overdue member payments.</td></tr>`;
}

function expenseCategoryOptions(selected = "", includeAll = false) {
  return [
    ...(includeAll ? [`<option value="">All categories</option>`] : []),
    ...EXPENSE_CATEGORIES.map((category) => `<option value="${escapeAttr(category)}" ${category === selected ? "selected" : ""}>${escapeHTML(category)}</option>`)
  ].join("");
}

function resetExpenseForm() {
  $("expenseId").value = "";
  $("expenseDate").value = todayISO();
  $("expenseCategory").value = "Miscellaneous";
  $("expenseDescription").value = "";
  $("expenseAmount").value = "";
  $("expensePaidBy").value = "";
  $("expensePaymentMethod").value = "";
  $("expenseReceiptNumber").value = "";
  $("expenseNotes").value = "";
  $("expenseSubmitBtn").textContent = "Add Expense";
  $("expenseCancelBtn").hidden = true;
}

function expenseFilters() {
  return {
    search: $("expenseSearch")?.value.trim().toLowerCase() || "",
    category: $("expenseFilterCategory")?.value || "",
    start: $("expenseFilterStart")?.value || "",
    end: $("expenseFilterEnd")?.value || ""
  };
}

function filteredExpenses() {
  const filters = expenseFilters();
  return state.expenses
    .filter((expense) => {
      const haystack = [expense.category, expense.description, expense.paidBy, expense.paymentMethod, expense.receiptNumber, expense.notes].join(" ").toLowerCase();
      if (filters.search && !haystack.includes(filters.search)) return false;
      if (filters.category && expense.category !== filters.category) return false;
      if (filters.start && expense.date < filters.start) return false;
      if (filters.end && expense.date > filters.end) return false;
      return true;
    })
    .sort((a, b) => `${b.date || ""}${b.id}`.localeCompare(`${a.date || ""}${a.id}`));
}

function renderExpenseManagement() {
  if (!$("expenseCategory")) return;
  if (!$("expenseCategory").innerHTML) {
    $("expenseCategory").innerHTML = expenseCategoryOptions("Miscellaneous");
    $("expenseFilterCategory").innerHTML = expenseCategoryOptions("", true);
    $("expenseDate").value = todayISO();
  }
  const expenses = filteredExpenses();
  const total = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  $("expenseListSummary").textContent = `${expenses.length} expense${expenses.length === 1 ? "" : "s"} shown, ${money(total)} total.`;
  $("expensesTableBody").innerHTML = expenses.length
    ? expenses.map((expense) => `
      <tr>
        <td>${escapeHTML(expense.date)}</td>
        <td>${escapeHTML(expense.category)}</td>
        <td>
          <strong>${escapeHTML(expense.description)}</strong>
          ${expense.notes ? `<small>${escapeHTML(expense.notes)}</small>` : ""}
        </td>
        <td>${money(expense.amount)}</td>
        <td>${escapeHTML(expense.paidBy || "-")}</td>
        <td>${escapeHTML(expense.paymentMethod || "-")}</td>
        <td>${escapeHTML(expense.receiptNumber || "-")}</td>
        <td class="table-actions">
          ${unlocked ? `
            <button class="mini edit-expense" data-id="${expense.id}" type="button">Edit</button>
            <button class="mini danger delete-expense" data-id="${expense.id}" type="button">Delete</button>
          ` : `<span class="pill mini-pill">View only</span>`}
        </td>
      </tr>
    `).join("")
    : `<tr><td colspan="8" class="empty-row">No expenses match the current filters.</td></tr>`;
}

function renderMembersInfo() {
  if (!$("membersInfoBody")) return;
  const search = $("memberInfoSearch")?.value.trim().toLowerCase() || "";
  const members = state.members
    .filter((member) => {
      const profile = member.profile || {};
      const haystack = [
        member.name,
        profile.fullName,
        profile.nickname,
        profile.dateOfBirth,
        profile.apartmentRoom,
        profile.phone,
        profile.email,
        profile.emergencyContact,
        profile.occupation
      ].join(" ").toLowerCase();
      return !search || haystack.includes(search);
    })
    .sort((a, b) => profileName(a).localeCompare(profileName(b)));

  $("membersInfoBody").innerHTML = members.length
    ? members.map((member) => {
      const profile = member.profile || defaultProfile();
      return `
        <tr>
          <td>
            <div class="member-info-name">
              ${avatarMarkup(member, "avatar-sm")}
              <div>
                <strong>${escapeHTML(profileName(member))}</strong>
                <small>${escapeHTML(profile.nickname || member.name)}</small>
              </div>
            </div>
          </td>
          <td>${escapeHTML(prettyDate(profile.dateOfBirth) || "-")}</td>
          <td>${escapeHTML(ageFromBirthday(profile.dateOfBirth) || "-")}</td>
          <td>${escapeHTML(profile.apartmentRoom || "-")}</td>
          <td>${profile.phone ? renderProfileValue({ key: "phone" }, profile.phone) : "-"}</td>
          <td>${profile.email ? renderProfileValue({ key: "email" }, profile.email) : "-"}</td>
          <td>${escapeHTML(profile.emergencyContact || "-")}</td>
          <td class="table-actions">
            <button class="mini view-member-info" data-id="${member.id}" type="button">View</button>
            ${unlocked ? `<button class="mini edit-member-info" data-id="${member.id}" type="button">Edit</button>` : ""}
          </td>
        </tr>
      `;
    }).join("")
    : `<tr><td colspan="8" class="empty-row">No members match the current search.</td></tr>`;
}

function renderBackupSettings() {
  if (!$("autoBackupEnabled")) return;
  const config = state.settings.autoBackup;
  $("autoBackupEnabled").checked = config.enabled;
  $("autoBackupFrequency").value = config.frequency;
  $("autoBackupStatus").textContent = config.enabled
    ? `Automatic backup is on (${config.frequency}). Last backup: ${config.lastRun ? new Date(config.lastRun).toLocaleString() : "not yet run"}.`
    : "Automatic backup is off.";
  $("safeDeleteBtn").disabled = $("deleteConfirmInput").value.trim() !== "DELETE" || !deleteBackupDownloaded;
}

function render() {
  renderAnnouncements();
  renderSummary();
  renderMembers();
  renderTransactions();
  renderBillInputs();
  renderBillDashboard();
  renderMembersInfo();
  renderReports();
  renderExpenseManagement();
  renderBackupSettings();
  renderRecoverySnapshots();
  if ($("balanceActivityModal") && !$("balanceActivityModal").hidden) {
    refreshBalanceActivityReport();
  }
  setEditState();
  refreshIcons();
}

async function initFirebase() {
  if (OFFLINE_MODE) {
    setStatus("Offline preview", "local");
    return;
  }

  try {
    setStatus("Connecting...", "local");
    const app = getApps()[0] || initializeApp(firebaseConfig);
    auth = getAuth(app);
    functions = getFunctions(app);
    const db = getFirestore(app);
    if (!persistenceInitialized) {
      persistenceInitialized = true;
      await enableIndexedDbPersistence(db).catch((error) => {
        console.warn("Offline Firestore persistence is unavailable in this browser session:", error);
      });
    }
    const user = await new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
        unsubscribe();
        resolve(nextUser);
      });
    });
    if (!user) {
      unlocked = false;
      isPlatformAdmin = false;
      await loadPublicWorkspace(db);
      return;
    }
    const token = await user.getIdTokenResult();
    const canAccessWorkspace = token.claims.admin === true || (token.claims.workspaceAdmin === true && token.claims.workspaceId === WORKSPACE_ID);
    if (!canAccessWorkspace) {
      unlocked = false;
      isPlatformAdmin = false;
      setStatus("Wrong workspace account", "local");
      showNotice("This account cannot open this apartment workspace. Use the exact link supplied by the platform administrator.", false);
      await loadPublicWorkspace(db);
      return;
    }
    isPlatformAdmin = token.claims.admin === true;
    unlocked = true;
    publicUnsubscribe?.();
    publicUnsubscribe = null;
    docRef = doc(db, FIRESTORE_COLLECTION, FIRESTORE_DOC_ID);

    let recoveredUnsynced = false;
    logFirestore("read getDoc");
    // Conflict checks must start from the authoritative cloud revision, not a
    // potentially stale IndexedDB snapshot left by an earlier browser session.
    const snap = await getDocFromServer(docRef);
    let startupConflict = null;
    if (snap.exists()) {
      console.info(`[Firestore] loaded snapshot from ${FIRESTORE_DOC_PATH}`);
      const remoteData = normalizeState(snap.data());
      cloudRevision = Number(snap.data().revision || 0);
      if (localStorage.getItem(unsyncedKey())) {
        const unsyncedLocal = loadLocal();
        saveRecoverySnapshot("Unsynced local edits from previous session", unsyncedLocal);
        localStorage.removeItem(unsyncedKey());
        recoveredUnsynced = true;
        if (hasMeaningfulLocalData(unsyncedLocal) && JSON.stringify({ ...unsyncedLocal, updatedAt: null }) !== JSON.stringify({ ...remoteData, updatedAt: null })) {
          startupConflict = {
            localState: unsyncedLocal,
            remoteState: remoteData,
            remoteRevision: cloudRevision,
            time: new Date()
          };
        }
      }
      state = startupConflict ? startupConflict.localState : remoteData;
      localDirty = Boolean(startupConflict);
      cloudConflict = Boolean(startupConflict);
    } else {
      const localState = loadLocal();
      let legacyState = null;
      if (WORKSPACE_ID === "main" && isPlatformAdmin) {
        const legacySnapshot = await getDoc(doc(db, "budgetApp", "apartment-amotan-main"));
        if (legacySnapshot.exists()) legacyState = normalizeState(legacySnapshot.data());
      }
      if (legacyState && hasMeaningfulLocalData(legacyState)) {
        console.info(`[Firestore] migrating legacy tracker into ${FIRESTORE_DOC_PATH}`);
        state = legacyState;
      } else if (hasMeaningfulLocalData(localState)) {
        console.info(`[Firestore] remote empty, seeding from local storage into ${FIRESTORE_DOC_PATH}`);
        state = localState;
      } else {
        state = defaultState();
        console.info(`[Firestore] remote empty and local empty; initializing ${FIRESTORE_DOC_PATH}`);
      }
      logFirestore("write setDoc", "initial seed");
      cloudRevision = 1;
      await setDoc(docRef, { ...state, revision: cloudRevision, updatedAt: serverTimestamp() });
    }

    if (!startupConflict) {
      saveLocal();
      await setDoc(doc(db, "publicApartmentViews", WORKSPACE_ID), publicStatePayload());
      setStatus("Synced online", "online");
      showNotice("", true);
    }
    recordRecentWorkspace(WORKSPACE_ID, state.settings?.apartmentName || WORKSPACE_ID);
    checkAutoCycle();
    render();

    if (startupConflict) {
      setStatus("Sync conflict", "local");
      showConflictModal(startupConflict);
    } else if (recoveredUnsynced) {
      showNotice("Some edits from your last session never reached the cloud. They were kept in browser recovery snapshots, and the latest cloud copy is shown.", false);
    }

    cloudUnsubscribe?.(); // never keep two listeners alive after a re-login
    cloudUnsubscribe = onSnapshot(docRef, (snapshot) => {
      if (!snapshot.exists()) return;
      // Cached or locally pending snapshots can be older than the server copy; applying them reverted data.
      if (snapshot.metadata.hasPendingWrites || snapshot.metadata.fromCache) return;
      const data = snapshot.data();
      const remoteRevision = Number(data.revision || 0);
      // The echo of our own write, or an older copy: nothing to apply.
      if (ownRevisionInFlight !== null && remoteRevision === ownRevisionInFlight) {
        cloudRevision = Math.max(cloudRevision, remoteRevision);
        return;
      }
      if (remoteRevision <= cloudRevision) return;
      // A write of ours is running: its own result decides whether this is a conflict.
      if (saveInFlight) return;
      // If a conflict dialog is already active, update its remote target without duplicating snapshots or overwriting local state.
      if (cloudConflict) {
        pendingConflict = {
          localState: normalizeState(state),
          remoteState: normalizeState(data),
          remoteRevision,
          time: new Date()
        };
        showConflictModal(pendingConflict);
        return;
      }
      // Never overwrite edits that have not been saved yet.
      if (localDirty) {
        cloudConflict = true;
        saveRecoverySnapshot("Cloud changed while local edits were unsaved");
        setStatus("Sync conflict", "local");
        pendingConflict = {
          localState: normalizeState(state),
          remoteState: normalizeState(data),
          remoteRevision,
          time: new Date()
        };
        showConflictModal(pendingConflict);
        return;
      }
      applyingRemote = true;
      try {
        logFirestore("listener snapshot", `revision ${remoteRevision}`);
        state = normalizeState(data);
        cloudRevision = remoteRevision;
        cloudConflict = false;
        saveLocal();
        try { localStorage.removeItem(unsyncedKey()); } catch { /* ignore */ }
        checkAutoCycle();
        render();
        setStatus("Synced online", "online");
      } finally {
        applyingRemote = false; // always released, even if render() throws
      }
    }, (error) => {
      console.error("Realtime listener failed:", error);
      setStatus("Local only", "local");
      showNotice(error.code === "permission-denied"
        ? "Firebase denied cloud access. Deploy the multi-workspace Firestore rules, then refresh and sign in again. Your browser copy remains available locally."
        : "Realtime cloud sync stopped. Your browser copy remains available locally.", false);
    });
  } catch (error) {
    console.error("Firebase init failed:", error);
    state = loadLocal();
    setStatus("Local only", "local");
    showNotice(error.code === "permission-denied"
      ? "Firebase denied cloud access. Deploy the multi-workspace Firestore rules, then refresh and sign in again. Your browser copy remains available locally."
      : `Cloud sync could not start${error.message ? `: ${error.message}` : "."} Your browser copy remains available locally.`, false);
  }
}

async function boot() {
  bindEvents();
  state = loadLocal();
  recordRecentWorkspace(WORKSPACE_ID, state.settings?.apartmentName || WORKSPACE_ID);
  checkAutoCycle();
  render();
  setActiveView(activeView);
  setStatus("Local ready", "local");
  document.body.classList.remove("is-loading");

  await initFirebase();
  checkAutoCycle();
  render();
}

boot();

// Premium dashboard quick actions
(() => {
  const toggle = document.getElementById("quickActionToggle");
  const menu = document.getElementById("quickActionMenu");
  if (!toggle || !menu) return;

  const setOpen = (open) => {
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close quick actions" : "Open quick actions");
    const icon = toggle.querySelector("i, svg");
    if (icon?.setAttribute) icon.setAttribute("data-lucide", open ? "x" : "plus");
    window.lucide?.createIcons?.({ attrs: { "stroke-width": 2 } });
  };

  toggle.addEventListener("click", () => setOpen(menu.hidden));
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#quickActions")) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });

  menu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-quick-view]");
    if (!button) return;
    const view = button.dataset.quickView;
    document.querySelector(`.nav-tab[data-view="${view}"]`)?.click();
    setOpen(false);
    const focusId = button.dataset.quickFocus;
    if (focusId) {
      window.setTimeout(() => {
        const target = document.getElementById(focusId);
        const parentDetails = target?.closest("details");
        if (parentDetails) parentDetails.open = true;
        target?.focus();
      }, 120);
    }
  });
})();

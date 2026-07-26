import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  enableIndexedDbPersistence,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDYE1h4hmU8ppSa18Jz-veC6GADBgsIa3g",
  authDomain: "tee-shirt-2.firebaseapp.com",
  projectId: "tee-shirt-2",
  storageBucket: "tee-shirt-2.firebasestorage.app",
  messagingSenderId: "795409975965",
  appId: "1:795409975965:web:679a7672811d748677e274",
  measurementId: "G-QY4MJ62VFZ"
};

const PASSWORD = "Master";
const AMOTAN_AMOUNT = 700;
const CYCLE_DAYS = 15;
const ELECTRICITY_AC_CHARGE = 1350;
const ELECTRICITY_AC_SHARE = 675;
const params = new URLSearchParams(window.location.search);
const OFFLINE_MODE = params.has("offline");
const STORAGE_SCOPE = params.get("test");
const BASE_LOCAL_KEY = "apartment-amotan-state-v5";
const LOCAL_KEY = STORAGE_SCOPE ? `${BASE_LOCAL_KEY}-${STORAGE_SCOPE}` : BASE_LOCAL_KEY;
const LEGACY_LOCAL_KEYS = STORAGE_SCOPE ? [] : ["apartment-amotan-state-v4", "apartment-amotan-state-v3"];
const FIRESTORE_COLLECTION = "budgetApp";
const FIRESTORE_DOC_ID = "apartment-amotan-main";
const FIRESTORE_DOC_PATH = `${FIRESTORE_COLLECTION}/${FIRESTORE_DOC_ID}`;
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

const $ = (id) => document.getElementById(id);
const todayISO = () => new Date().toISOString().slice(0, 10);
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
let unlocked = sessionStorage.getItem("amotUnlock") === "yes";
let docRef = null;
let saveTimer = null;
let applyingRemote = false;
let activeProfileMemberId = null;
let editingProfileMemberId = null;
let activeView = "home";
let pendingRestoreState = null;
let deleteBackupDownloaded = false;
let showAllAnnouncements = false;

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
    weights: bill?.weights && typeof bill.weights === "object" ? bill.weights : {},
    date: bill?.date || todayISO(),
    airconMembers: Array.isArray(bill?.airconMembers) ? bill.airconMembers.slice(0, 2) : []
  };
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY) || LEGACY_LOCAL_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
    return raw ? normalizeState(JSON.parse(raw)) : defaultState();
  } catch {
    return defaultState();
  }
}

function saveLocal() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...state, updatedAt: Date.now() }));
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
  $("editState").textContent = unlocked ? "Unlocked" : "Locked";
  $("passwordInput").value = "";
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
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file for the profile photo.");
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
  return `
    <article class="announcement-item priority-${announcement.priority} ${announcement.pinned ? "is-pinned" : ""}">
      <div class="announcement-item-head">
        <div class="announcement-labels">
          <span class="priority-label priority-${announcement.priority}">${announcementPriorityLabel(announcement.priority)}</span>
          ${announcement.pinned ? `<span class="pin-label">Pinned</span>` : ""}
        </div>
        <time datetime="${escapeAttr(announcement.date)}">${escapeHTML(announcementDisplayDate(announcement))}</time>
      </div>
      <h3>${escapeHTML(announcement.title)}</h3>
      <p class="announcement-message ${compact ? "is-preview" : ""}">${escapeHTML(announcement.message)}</p>
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
  const transactions = [
    ...income.map((item) => ({ ...item, type: "Income", category: "Income" })),
    ...expenses.map((item) => ({ ...item, type: "Expense" }))
  ].sort((a, b) => `${b.date || ""}${b.id}`.localeCompare(`${a.date || ""}${a.id}`));
  return { income, expenses, transactions };
}

function reportData() {
  const range = getReportRange();
  const records = reportRecords(range);
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
      expenseTotal,
      netBalance: incomeTotal - expenseTotal,
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
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f0f4f6";
  ctx.fillRect(0, 0, width, height);
  const max = Math.max(1, ...rows.map((row) => row[1]));
  const chartTop = 24;
  const chartBottom = height - 42;
  const chartHeight = chartBottom - chartTop;
  const barGap = 12;
  const barWidth = rows.length ? Math.max(18, (width - 48 - barGap * (rows.length - 1)) / rows.length) : 32;
  ctx.fillStyle = "#5f6f7a";
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
    ctx.fillStyle = "#5f6f7a";
    ctx.fillText(label.slice(5) || label, x, height - 18);
  });
}

function drawDonutChart(canvasId, rows) {
  const canvas = $(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const colors = ["#2f6f89", "#a66f43", "#2f6b4f", "#9b3f3f", "#6f7f89", "#6d6587", "#58756b", "#8a6a56"];
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f0f4f6";
  ctx.fillRect(0, 0, width, height);
  const total = rows.reduce((sum, row) => sum + Number(row[1] || 0), 0);
  if (!total) {
    ctx.fillStyle = "#5f6f7a";
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
  ctx.fillStyle = "#fdfefe";
  ctx.fill();
  ctx.font = "12px system-ui, sans-serif";
  rows.slice(0, 6).forEach(([label, value], index) => {
    const y = 50 + index * 28;
    ctx.fillStyle = colors[index % colors.length];
    ctx.fillRect(250, y - 10, 12, 12);
    ctx.fillStyle = "#1f2933";
    ctx.fillText(`${label}: ${money(value)}`, 270, y);
  });
}

function setActiveView(view) {
  activeView = view;
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== view;
    panel.classList.toggle("active", panel.dataset.viewPanel === view);
  });
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === view);
  });
  renderAnnouncements();
  renderReports();
  renderExpenseManagement();
  renderBackupSettings();
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
    ["Total Expenses", data.summary.expenseTotal],
    ["Profit/Loss", data.summary.netBalance],
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
      return decoder.decode(bytes.slice(dataStart, dataStart + size));
    }
  }
  throw new Error("Backup ZIP must contain an uncompressed backup.json file.");
}

function validateBackupPayload(payload) {
  const data = payload?.data || payload;
  if (!data || typeof data !== "object") throw new Error("Backup file is empty or invalid.");
  const normalized = normalizeState(data);
  if (!Array.isArray(normalized.members) || !Array.isArray(normalized.income) || !Array.isArray(normalized.expenses)) {
    throw new Error("Backup is missing required tracker records.");
  }
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
  const entered = $("passwordInput").value.trim();
  if (entered === PASSWORD) {
    unlocked = true;
    sessionStorage.setItem("amotUnlock", "yes");
    setEditState();
    showNotice("Unlocked for editing.", false);
    return true;
  }
  showNotice("Enter the correct password to edit.", false);
  return false;
}

function scheduleSave() {
  saveLocal();
  try {
    runAutoBackupIfDue();
  } catch (error) {
    console.warn("Automatic backup skipped:", error);
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCloudNow, 250);
}

async function saveCloudNow() {
  saveLocal();
  if (OFFLINE_MODE || !docRef || applyingRemote) return;
  try {
    logFirestore("write setDoc", "scheduled save");
    await setDoc(docRef, { ...state, updatedAt: serverTimestamp() }, { merge: true });
    setStatus("Synced online", "online");
    showNotice("", true);
  } catch (error) {
    console.error("Cloud save failed:", error);
    setStatus("Local only", "local");
    showNotice("Saved locally. Firestore is offline or blocked.", false);
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
        <input type="checkbox" class="member-paid" data-id="${m.id}" ${m.paid ? "checked" : ""} />
        ${avatarMarkup(m, "avatar-sm")}
        <span>${escapeHTML(profileName(m))}</span>
      </label>
      <strong>${m.paid ? money(AMOTAN_AMOUNT) : "Unpaid"}</strong>
      <button class="mini danger delete-member" data-id="${m.id}" type="button">Delete</button>
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
      <div class="profile-actions">
        <button id="editProfileBtn" class="primary-btn" type="button">Edit Profile</button>
      </div>
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
  const items = [
    ...state.income.map((item) => ({ ...item, kind: "income" })),
    ...state.expenses.map((item) => ({ ...item, kind: "expense" }))
  ].sort((a, b) => `${b.date || ""}${b.id}`.localeCompare(`${a.date || ""}${a.id}`));

  const list = $("transactionsList");
  if (!items.length) {
    list.innerHTML = `<p class="empty">No activity yet.</p>`;
    $("activityTotals").textContent = "No entries yet.";
    return;
  }

  $("activityTotals").textContent = `${state.income.length} money in, ${state.expenses.length} expenses.`;
  list.innerHTML = items.map((item) => `
    <div class="transaction-row ${item.kind}">
      <div class="transaction-main">
        <strong>${escapeHTML(item.description)}</strong>
        <span>${escapeHTML(item.date)}</span>
      </div>
      <div class="transaction-meta">
        <strong>${item.kind === "income" ? "+" : "-"} ${money(item.amount)}</strong>
        <button class="mini danger delete-transaction" data-kind="${item.kind}" data-id="${item.id}" type="button">Delete</button>
      </div>
    </div>
  `).join("");
}

function renderSummary() {
  const totals = calcTotals();
  $("remainingBalance").textContent = money(totals.remaining);
  $("paidMembers").textContent = `${totals.paidMembers}/${state.members.length}`;
  $("carryoverAmount").textContent = money(state.carryover);
  $("cycleStarted").textContent = state.cycleStarted || "Today";

  const elapsed = daysBetween(state.cycleStarted, todayISO());
  const left = Math.max(0, CYCLE_DAYS - elapsed);
  $("cycleLeft").textContent = `${left} day${left === 1 ? "" : "s"} left`;
  $("summaryBreakdown").textContent = summaryText(totals);
}

function endCycle() {
  const totals = calcTotals();
  state = {
    ...state,
    members: state.members.map((m) => ({ ...m, paid: false })),
    income: [],
    expenses: [],
    carryover: Math.max(0, totals.remaining),
    cycleStarted: todayISO()
  };
  render();
  scheduleSave();
}

function clearActivity() {
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
    endCycle();
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
  if (checked) {
    if (!bill.paidMembers.includes(memberId)) bill.paidMembers.push(memberId);
  } else {
    bill.paidMembers = bill.paidMembers.filter((id) => id !== memberId);
  }
}

function bindEvents() {
  $("transactionDate").value = todayISO();
  $("electricityDate").value = todayISO();
  $("waterDate").value = todayISO();
  $("reportStartDate").value = isoFromDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  $("reportEndDate").value = todayISO();
  $("announcementDate").value = todayISO();
  $("announcementAuthor").value = "Apartment Admin";

  $("unlockBtn").addEventListener("click", () => {
    if (requireUnlock()) render();
  });

  $("lockBtn").addEventListener("click", () => {
    unlocked = false;
    sessionStorage.removeItem("amotUnlock");
    setEditState();
    renderAnnouncements();
    showNotice("Locked. Enter the password again to edit.", false);
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

  $("announcementAdminBody").addEventListener("click", (e) => {
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
      updateAnnouncementStatus(archiveBtn.dataset.id, "archived");
      return;
    }
    if (deleteBtn) {
      if (!requireUnlock()) return;
      if (!confirm("Delete this announcement? This action cannot be undone.")) return;
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
    if (member) member.paid = e.target.checked;
    render();
    scheduleSave();
  });

  $("membersList").addEventListener("click", (e) => {
    const btn = e.target.closest(".delete-member");
    if (btn) {
      if (!requireUnlock()) return;
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

  $("transactionsList").addEventListener("click", (e) => {
    const btn = e.target.closest(".delete-transaction");
    if (!btn) return;
    if (!requireUnlock()) return;
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

  $("expensesTableBody").addEventListener("click", (e) => {
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
      if (!confirm("Delete this expense?")) return;
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

  $("confirmRestoreBtn").addEventListener("click", () => {
    if (!pendingRestoreState) return;
    if (!requireUnlock()) return;
    if (!confirm("Restore this backup? Current records will be replaced. This action cannot be undone.")) return;
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

  $("safeDeleteBtn").addEventListener("click", () => {
    if (!requireUnlock()) return;
    if (!deleteBackupDownloaded || $("deleteConfirmInput").value.trim() !== "DELETE") return;
    if (!confirm("This action cannot be undone. Delete all apartment tracker data?")) return;
    state = defaultState();
    deleteBackupDownloaded = false;
    $("deleteConfirmInput").value = "";
    render();
    scheduleSave();
  });

  $("manualResetBtn").addEventListener("click", () => {
    if (!requireUnlock()) return;
    if (confirm("End this cycle now and carry over any remaining balance?")) endCycle();
  });

  $("clearActivityBtn").addEventListener("click", () => {
    if (!requireUnlock()) return;
    if (confirm("Clear all money in and expenses for this cycle?")) clearActivity();
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
      updateBillPaidStatus(key, e.target.dataset.id, e.target.checked);
      render();
      scheduleSave();
    });

    unpaidList.addEventListener("click", (e) => {
      const btn = e.target.closest(".mark-paid");
      if (!btn) return;
      if (!requireUnlock()) return;
      updateBillPaidStatus(key, btn.dataset.id, true);
      render();
      scheduleSave();
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

    if (amountInput && document.activeElement !== amountInput) amountInput.value = bill.amount || "";
    if (dateInput && document.activeElement !== dateInput) dateInput.value = bill.date || todayISO();
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
            <input type="checkbox" class="${key}-member" data-id="${member.id}" ${bill.members.includes(member.id) ? "checked" : ""} />
            <span>${escapeHTML(member.name)}</span>
          </label>
          ${key === "electricity" ? `
            <button type="button" class="mini aircon-toggle ${acMembers.has(member.id) ? "active" : ""}" data-id="${member.id}" ${!bill.members.includes(member.id) ? "disabled" : ""}>${acMembers.has(member.id) ? "Aircon User" : "Set Aircon"}</button>
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
                <input type="checkbox" class="${key}-paid" data-id="${row.id}" ${row.paid ? "checked" : ""} />
                <span>${row.paid ? "Paid" : "Unpaid"}</span>
              </label>
            </td>
          </tr>
        `).join("")
        : `<tr><td colspan="5" class="empty-row">Select members for this bill.</td></tr>`;
    }

    const paidList = $(`${key}PaidList`);
    const unpaidList = $(`${key}UnpaidList`);
    if (paidList) {
      paidList.innerHTML = summary.paidMembers.length
        ? summary.paidMembers.map((member) => `<li class="paid-item">${escapeHTML(member.name)} <span>${money(summary.rows.find((row) => row.id === member.id)?.totalDue || 0)}</span></li>`).join("")
        : `<li class="empty-row">No paid members yet.</li>`;
    }
    if (unpaidList) {
      unpaidList.innerHTML = summary.unpaidMembers.length
        ? summary.unpaidMembers.map((member) => `
          <li class="unpaid-item">
            <span>${escapeHTML(member.name)} <strong>${money(summary.rows.find((row) => row.id === member.id)?.totalDue || 0)}</strong></span>
            <button class="mini mark-paid" data-id="${member.id}" type="button">Mark Paid</button>
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

  const announcements = [...state.announcements].sort((a, b) => {
    return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
  });
  $("announcementAdminSummary").textContent = `${announcements.length} announcement${announcements.length === 1 ? "" : "s"} saved.`;
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
          <td><span class="status-label status-${announcement.status}">${escapeHTML(announcement.status)}</span></td>
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
    : `<tr><td colspan="5" class="empty-row">No announcements yet.</td></tr>`;
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

  $("reportRangeLabel").textContent = `${rangeStart} to ${rangeEnd}`;
  $("reportPlainSummary").textContent = netText;
  $("reportInsights").innerHTML = `
    <article class="report-insight ${data.summary.netBalance >= 0 ? "is-positive" : "is-warning"}">
      <span>Cash flow</span>
      <strong>${data.summary.netBalance >= 0 ? "Money is ahead" : "Spending is ahead"}</strong>
      <p>${escapeHTML(netText)}</p>
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
    ["Money Received", money(data.summary.incomeTotal), "Income added during the selected dates"],
    ["Money Spent", money(data.summary.expenseTotal), "Expenses recorded during the selected dates"],
    ["Money Left", money(data.summary.netBalance), "Received minus spent for this period"],
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
    <tr><th>Money spent</th><td>${money(data.summary.expenseTotal)}</td></tr>
    <tr><th>Difference</th><td>${money(data.summary.netBalance)}</td></tr>
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
          <button class="mini edit-expense" data-id="${expense.id}" type="button">Edit</button>
          <button class="mini danger delete-expense" data-id="${expense.id}" type="button">Delete</button>
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
            <button class="mini edit-member-info" data-id="${member.id}" type="button">Edit</button>
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
  setEditState();
}

async function initFirebase() {
  if (OFFLINE_MODE) {
    setStatus("Offline preview", "local");
    return;
  }

  try {
    setStatus("Connecting...", "local");
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    enableIndexedDbPersistence(db).catch(() => {});
    docRef = doc(db, FIRESTORE_COLLECTION, FIRESTORE_DOC_ID);

    logFirestore("read getDoc");
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      console.info(`[Firestore] loaded snapshot from ${FIRESTORE_DOC_PATH}`);
      state = normalizeState(snap.data());
    } else {
      const localState = loadLocal();
      if (hasMeaningfulLocalData(localState)) {
        console.info(`[Firestore] remote empty, seeding from local storage into ${FIRESTORE_DOC_PATH}`);
        state = localState;
      } else {
        state = defaultState();
        console.info(`[Firestore] remote empty and local empty; initializing ${FIRESTORE_DOC_PATH}`);
      }
      logFirestore("write setDoc", "initial seed");
      await setDoc(docRef, { ...state, updatedAt: serverTimestamp() }, { merge: true });
    }

    setStatus("Synced online", "online");

    onSnapshot(docRef, (snapshot) => {
      if (!snapshot.exists()) return;
      applyingRemote = true;
      logFirestore("listener snapshot", `exists=${snapshot.exists()}`);
      state = normalizeState(snapshot.data());
      saveLocal();
      checkAutoCycle();
      render();
      applyingRemote = false;
      setStatus("Synced online", "online");
    }, (error) => {
      console.error("Realtime listener failed:", error);
      setStatus("Local only", "local");
    });
  } catch (error) {
    console.error("Firebase init failed:", error);
    state = loadLocal();
    setStatus("Local only", "local");
  }
}

async function boot() {
  bindEvents();
  state = loadLocal();
  checkAutoCycle();
  render();
  setStatus("Local ready", "local");
  document.body.classList.remove("is-loading");

  await initFirebase();
  checkAutoCycle();
  render();
}

boot();

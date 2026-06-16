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
const LOCAL_KEY = "apartment-amotan-state-v4";

const $ = (id) => document.getElementById(id);
const todayISO = () => new Date().toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const money = (value) => `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const defaultState = () => ({
  members: [],
  income: [],
  expenses: [],
  carryover: 0,
  cycleStarted: todayISO(),
  updatedAt: null
});

let state = defaultState();
let unlocked = sessionStorage.getItem("amotUnlock") === "yes";
let docRef = null;
let saveTimer = null;
let applyingRemote = false;

function normalizeState(data) {
  return {
    ...defaultState(),
    ...(data || {}),
    members: Array.isArray(data?.members) ? data.members : [],
    income: Array.isArray(data?.income) ? data.income : [],
    expenses: Array.isArray(data?.expenses) ? data.expenses : [],
    carryover: Number(data?.carryover || 0),
    cycleStarted: data?.cycleStarted || todayISO()
  };
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
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

function escapeHTML(text = "") {
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
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
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCloudNow, 250);
}

async function saveCloudNow() {
  saveLocal();
  if (!docRef || applyingRemote) return;
  try {
    await setDoc(docRef, { ...state, updatedAt: serverTimestamp() }, { merge: true });
    setStatus("Synced online", "online");
    showNotice("", true);
  } catch (error) {
    console.error("Cloud save failed:", error);
    setStatus("Local only", "local");
    showNotice("Saved locally. Firestore is offline or blocked.", false);
  }
}

function renderMembers() {
  const box = $("membersList");
  if (!state.members.length) {
    box.innerHTML = `<p class="empty">No members yet.</p>`;
    return;
  }

  box.innerHTML = state.members.map((m) => `
    <div class="member-row">
      <label>
        <input type="checkbox" class="member-paid" data-id="${m.id}" ${m.paid ? "checked" : ""} />
        <span>${escapeHTML(m.name)}</span>
      </label>
      <strong>${m.paid ? money(AMOTAN_AMOUNT) : "Unpaid"}</strong>
      <button class="mini danger delete-member" data-id="${m.id}" type="button">Delete</button>
    </div>
  `).join("");
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

  const totals = calcTotals();
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

function render() {
  renderSummary();
  renderMembers();
  renderTransactions();
  setEditState();
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

function bindEvents() {
  $("transactionDate").value = todayISO();

  $("unlockBtn").addEventListener("click", () => {
    if (requireUnlock()) render();
  });

  $("lockBtn").addEventListener("click", () => {
    unlocked = false;
    sessionStorage.removeItem("amotUnlock");
    setEditState();
    showNotice("Locked. Enter the password again to edit.", false);
  });

  $("memberForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!requireUnlock()) return;
    const name = $("memberName").value.trim();
    if (!name) {
      showNotice("Add a member name first.", false);
      return;
    }
    state.members.push({ id: uid(), name, paid: false });
    $("memberName").value = "";
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
    if (!btn) return;
    if (!requireUnlock()) return;
    state.members = state.members.filter((m) => m.id !== btn.dataset.id);
    render();
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

    const entry = { id: uid(), amount, description, date };
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
    if (confirm("Clear everything: members, money in, expenses, and carryover?")) {
      state = defaultState();
      render();
      scheduleSave();
    }
  });
}

async function initFirebase() {
  try {
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    enableIndexedDbPersistence(db).catch(() => {});
    docRef = doc(db, "budgetApp", "apartmentAmotan");

    const snap = await getDoc(docRef);
    if (snap.exists()) {
      state = normalizeState(snap.data());
    } else {
      state = loadLocal();
      await setDoc(docRef, { ...state, updatedAt: serverTimestamp() }, { merge: true });
    }

    setStatus("Synced online", "online");

    onSnapshot(docRef, (snapshot) => {
      if (!snapshot.exists()) return;
      applyingRemote = true;
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
  render();
  await initFirebase();
  checkAutoCycle();
  render();
}

boot();

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
const LOCAL_KEY = "apartment-amotan-state-v3";

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
let db = null;
let docRef = null;
let firebaseOnline = false;
let applyingRemote = false;
let saveTimer = null;

const $ = (id) => document.getElementById(id);

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function money(value) {
  const num = Number(value || 0);
  return "₱" + num.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHTML(text = "") {
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

function daysBetween(startISO, endISO) {
  const start = new Date(startISO + "T00:00:00");
  const end = new Date(endISO + "T00:00:00");
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

function requireUnlock() {
  if (unlocked) return true;
  const input = prompt("Enter admin password:");
  if (input === PASSWORD) {
    unlocked = true;
    sessionStorage.setItem("amotUnlock", "yes");
    return true;
  }
  if (input !== null) alert("Incorrect password.");
  return false;
}

function setStatus(text, mode) {
  const el = $("syncStatus");
  el.textContent = text;
  el.className = `status ${mode}`;
}

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

async function saveCloudNow() {
  saveLocal();
  if (!docRef || applyingRemote) return;
  try {
    await setDoc(docRef, { ...state, updatedAt: serverTimestamp() }, { merge: true });
    firebaseOnline = true;
    setStatus("Synced online", "online");
  } catch (error) {
    console.error("Cloud save failed:", error);
    firebaseOnline = false;
    setStatus("Local only - check Firestore rules", "local");
  }
}

function scheduleSave() {
  saveLocal();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCloudNow, 350);
}

function render() {
  const totals = calcTotals();
  $("remainingBalance").textContent = money(totals.remaining);
  $("paidMembers").textContent = `${totals.paidMembers}/${state.members.length}`;
  $("carryoverAmount").textContent = money(state.carryover);
  $("cycleStarted").textContent = state.cycleStarted || "—";

  const used = daysBetween(state.cycleStarted, todayISO());
  const left = Math.max(0, CYCLE_DAYS - used);
  $("cycleLeft").textContent = `${left} day(s) left`;

  renderMembers();
  renderIncome();
  renderExpenses();
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

function renderIncome() {
  const body = $("incomeBody");
  if (!state.income.length) {
    body.innerHTML = `<tr><td colspan="4" class="empty">No money in yet.</td></tr>`;
    return;
  }
  body.innerHTML = state.income.map((i) => `
    <tr>
      <td>${escapeHTML(i.date)}</td>
      <td>${escapeHTML(i.description)}</td>
      <td>${money(i.amount)}</td>
      <td><button class="mini danger delete-income" data-id="${i.id}" type="button">Delete</button></td>
    </tr>
  `).join("");
}

function renderExpenses() {
  const body = $("expenseBody");
  if (!state.expenses.length) {
    body.innerHTML = `<tr><td colspan="4" class="empty">No expenses yet.</td></tr>`;
    return;
  }
  body.innerHTML = state.expenses.map((e) => `
    <tr>
      <td>${escapeHTML(e.date)}</td>
      <td>${escapeHTML(e.description)}</td>
      <td>${money(e.amount)}</td>
      <td><button class="mini danger delete-expense" data-id="${e.id}" type="button">Delete</button></td>
    </tr>
  `).join("");
}

function endCycle() {
  const totals = calcTotals();
  const nextCarryover = Math.max(0, totals.remaining);
  state = {
    ...state,
    members: state.members.map((m) => ({ ...m, paid: false })),
    income: [],
    expenses: [],
    carryover: nextCarryover,
    cycleStarted: todayISO()
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
  $("incomeDate").value = todayISO();
  $("expenseDate").value = todayISO();

  $("lockBtn").addEventListener("click", () => {
    unlocked = false;
    sessionStorage.removeItem("amotUnlock");
    alert("Locked. Password will be requested on next change.");
  });

  $("memberForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!requireUnlock()) return;
    const name = $("memberName").value.trim();
    if (!name) return alert("Enter member name.");
    state.members.push({ id: uid(), name, paid: false });
    $("memberName").value = "";
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

  $("incomeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!requireUnlock()) return;
    const amount = Number($("incomeAmount").value);
    const description = $("incomeDesc").value.trim();
    const date = $("incomeDate").value || todayISO();
    if (!amount || amount <= 0) return alert("Enter valid money in amount.");
    if (!description) return alert("Enter description/source.");
    state.income.unshift({ id: uid(), amount, description, date });
    e.target.reset();
    $("incomeDate").value = todayISO();
    render();
    scheduleSave();
  });

  $("incomeBody").addEventListener("click", (e) => {
    const btn = e.target.closest(".delete-income");
    if (!btn) return;
    if (!requireUnlock()) return;
    state.income = state.income.filter((i) => i.id !== btn.dataset.id);
    render();
    scheduleSave();
  });

  $("expenseForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!requireUnlock()) return;
    const amount = Number($("expenseAmount").value);
    const description = $("expenseDesc").value.trim();
    const date = $("expenseDate").value || todayISO();
    if (!amount || amount <= 0) return alert("Enter valid expense amount.");
    if (!description) return alert("Enter expense description.");
    state.expenses.unshift({ id: uid(), amount, description, date });
    e.target.reset();
    $("expenseDate").value = todayISO();
    render();
    scheduleSave();
  });

  $("expenseBody").addEventListener("click", (e) => {
    const btn = e.target.closest(".delete-expense");
    if (!btn) return;
    if (!requireUnlock()) return;
    state.expenses = state.expenses.filter((x) => x.id !== btn.dataset.id);
    render();
    scheduleSave();
  });

  $("manualResetBtn").addEventListener("click", () => {
    if (!requireUnlock()) return;
    if (confirm("End this 15-day cycle now? Sobra will carry over.")) endCycle();
  });

  $("clearAllBtn").addEventListener("click", () => {
    if (!requireUnlock()) return;
    if (confirm("Clear ALL members, logs, and carryover?")) {
      state = defaultState();
      render();
      scheduleSave();
    }
  });
}

async function initFirebase() {
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    enableIndexedDbPersistence(db).catch(() => {});
    docRef = doc(db, "budgetApp", "apartmentAmotan");

    const snap = await getDoc(docRef);
    if (snap.exists()) {
      state = normalizeState(snap.data());
    } else {
      const local = loadLocal();
      state = normalizeState(local);
      await setDoc(docRef, { ...state, updatedAt: serverTimestamp() }, { merge: true });
    }

    firebaseOnline = true;
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
      firebaseOnline = false;
      setStatus("Local only - rules/network issue", "local");
    });
  } catch (error) {
    console.error("Firebase init failed:", error);
    state = loadLocal();
    firebaseOnline = false;
    setStatus("Local only - Firebase not connected", "local");
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

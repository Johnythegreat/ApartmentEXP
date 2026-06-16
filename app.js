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

const $ = (id) => document.getElementById(id);
const todayISO = () => new Date().toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const money = (value) => `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const defaultState = () => ({
  members: [],
  income: [],
  expenses: [],
  bills: {
    electricity: defaultBill("Electricity Bill", "electricity"),
    water: defaultBill("Water Bill", "water")
  },
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
    updatedAt: null
  };
}

let state = defaultState();
let unlocked = sessionStorage.getItem("amotUnlock") === "yes";
let docRef = null;
let saveTimer = null;
let applyingRemote = false;

function normalizeState(data) {
  const next = {
    ...defaultState(),
    ...(data || {}),
    members: Array.isArray(data?.members) ? data.members : [],
    income: Array.isArray(data?.income) ? data.income : [],
    expenses: Array.isArray(data?.expenses) ? data.expenses : [],
    bills: {
      electricity: normalizeBill(data?.bills?.electricity, "Electricity Bill", "electricity"),
      water: normalizeBill(data?.bills?.water, "Water Bill", "water")
    },
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
  if (OFFLINE_MODE || !docRef || applyingRemote) return;
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
    const memberId = btn.dataset.id;
    state.members = state.members.filter((m) => m.id !== memberId);
    for (const bill of [state.bills.electricity, state.bills.water]) {
      bill.members = bill.members.filter((id) => id !== memberId);
      bill.paidMembers = bill.paidMembers.filter((id) => id !== memberId);
      if (bill.airconMembers) bill.airconMembers = bill.airconMembers.filter((id) => id !== memberId);
    }
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
    if (confirm("Clear everything: members, money in, expenses, bills, and carryover?")) {
      state = defaultState();
      render();
      scheduleSave();
    }
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
    const summaryEl = $(`${key}Summary`);
    const totalsEl = $(`${key}Totals`);

    if (amountInput && document.activeElement !== amountInput) amountInput.value = bill.amount || "";
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

function render() {
  renderSummary();
  renderMembers();
  renderTransactions();
  renderBillInputs();
  renderBillDashboard();
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
  checkAutoCycle();
  render();
  setStatus("Local ready", "local");
  document.body.classList.remove("is-loading");

  await initFirebase();
  checkAutoCycle();
  render();
}

boot();

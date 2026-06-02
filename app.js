/* Apartment Amotan Tracker - rebuilt/debugged */
const ADMIN_PASSWORD = 'Master';
const AMOTAN_PER_MEMBER = 700;
const CYCLE_DAYS = 15;
const LOCAL_KEY = 'apartment-amotan-state-v3';
const SESSION_KEY = 'apartment-amotan-unlocked';
const DOC_PATH = ['budgetApp', 'apartmentAmotanMain'];

let db = null;
let unsub = null;
let cloudReady = false;
let isRemoteApplying = false;
let saveTimer = null;

const defaultState = () => ({
  members: [],
  incomes: [],
  expenses: [],
  carryover: 0,
  cycleStartedAt: todayISO(),
  updatedAt: Date.now()
});

let state = defaultState();

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function money(n) {
  const amount = Number(n || 0);
  return '₱' + amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}

function normalize(raw) {
  const clean = defaultState();
  if (!raw || typeof raw !== 'object') return clean;
  clean.members = Array.isArray(raw.members) ? raw.members.map(m => ({
    id: String(m.id || uid()),
    name: String(m.name || 'Member'),
    paid: Boolean(m.paid)
  })) : [];
  clean.incomes = Array.isArray(raw.incomes) ? raw.incomes.map(i => ({
    id: String(i.id || uid()),
    amount: Number(i.amount || 0),
    description: String(i.description || ''),
    date: String(i.date || todayISO())
  })) : [];
  clean.expenses = Array.isArray(raw.expenses) ? raw.expenses.map(e => ({
    id: String(e.id || uid()),
    amount: Number(e.amount || 0),
    description: String(e.description || ''),
    date: String(e.date || todayISO())
  })) : [];
  clean.carryover = Number(raw.carryover || 0);
  clean.cycleStartedAt = String(raw.cycleStartedAt || todayISO());
  clean.updatedAt = Number(raw.updatedAt || Date.now());
  return clean;
}

function loadLocal() {
  try {
    const saved = localStorage.getItem(LOCAL_KEY);
    return saved ? normalize(JSON.parse(saved)) : defaultState();
  } catch (err) {
    console.warn('Local load failed:', err);
    return defaultState();
  }
}

function saveLocal() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Local save failed:', err);
  }
}

function initFirebase() {
  try {
    if (!window.firebaseConfig || !window.firebase) throw new Error('Firebase config/scripts missing');
    if (!firebase.apps.length) firebase.initializeApp(window.firebaseConfig || firebaseConfig);
    db = firebase.firestore();
    cloudReady = true;
    setStatus('Online sync connecting...', 'online');
    listenCloud();
  } catch (err) {
    cloudReady = false;
    setStatus('Local only', 'offline');
    console.warn('Firebase unavailable:', err);
  }
}

function setStatus(text, mode) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.textContent = text;
  el.className = 'status ' + mode;
}

function cloudDoc() {
  return db.collection(DOC_PATH[0]).doc(DOC_PATH[1]);
}

function listenCloud() {
  if (!cloudReady) return;
  if (unsub) unsub();
  unsub = cloudDoc().onSnapshot(async snap => {
    if (!snap.exists) {
      await cloudDoc().set({ ...state, updatedAt: Date.now() }, { merge: true });
      return;
    }
    const remote = normalize(snap.data());
    const localUpdated = Number(state.updatedAt || 0);
    if (remote.updatedAt >= localUpdated) {
      isRemoteApplying = true;
      state = remote;
      saveLocal();
      render();
      isRemoteApplying = false;
    }
    setStatus('Online sync active', 'online');
  }, err => {
    console.error('Firestore listener error:', err);
    setStatus('Cloud blocked - check rules', 'offline');
  });
}

function saveCloudDebounced() {
  if (isRemoteApplying) return;
  state.updatedAt = Date.now();
  saveLocal();
  if (!cloudReady) {
    setStatus('Saved locally', 'offline');
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await cloudDoc().set(JSON.parse(JSON.stringify(state)), { merge: true });
      setStatus('Saved online', 'online');
    } catch (err) {
      console.error('Cloud save failed:', err);
      setStatus('Cloud save failed', 'offline');
    }
  }, 250);
}

function isUnlocked() {
  return sessionStorage.getItem(SESSION_KEY) === 'yes';
}

function requireAdmin() {
  if (isUnlocked()) return true;
  const pass = prompt('Enter admin password:');
  if (pass === ADMIN_PASSWORD) {
    sessionStorage.setItem(SESSION_KEY, 'yes');
    return true;
  }
  if (pass !== null) alert('Incorrect password.');
  return false;
}

function totals() {
  const memberPaid = state.members.filter(m => m.paid).length * AMOTAN_PER_MEMBER;
  const incomeTotal = state.incomes.reduce((s, i) => s + Number(i.amount || 0), 0);
  const expenseTotal = state.expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const balance = Number(state.carryover || 0) + memberPaid + incomeTotal - expenseTotal;
  return { memberPaid, incomeTotal, expenseTotal, balance };
}

function daysLeft() {
  const started = new Date(state.cycleStartedAt + 'T00:00:00');
  const now = new Date(todayISO() + 'T00:00:00');
  const elapsed = Math.floor((now - started) / 86400000);
  return Math.max(0, CYCLE_DAYS - elapsed);
}

function autoCycleCheck() {
  if (daysLeft() > 0) return;
  const t = totals();
  state.carryover = Math.max(0, t.balance);
  state.members = state.members.map(m => ({ ...m, paid: false }));
  state.incomes = [];
  state.expenses = [];
  state.cycleStartedAt = todayISO();
  saveCloudDebounced();
}

function render() {
  const t = totals();
  document.getElementById('balance-amount').textContent = money(t.balance);
  document.getElementById('paid-members-count').textContent = `${state.members.filter(m => m.paid).length}/${state.members.length}`;
  document.getElementById('carryover-amount').textContent = money(state.carryover);
  document.getElementById('cycle-start-label').textContent = state.cycleStartedAt;
  document.getElementById('cycle-days-left').textContent = `${daysLeft()} day(s) left`;

  const membersList = document.getElementById('members-list');
  membersList.innerHTML = state.members.length ? state.members.map(m => `
    <div class="member-item">
      <label>
        <input type="checkbox" class="member-paid" data-id="${esc(m.id)}" ${m.paid ? 'checked' : ''} />
        <span>${esc(m.name)}</span>
      </label>
      <span class="member-amount">${m.paid ? money(AMOTAN_PER_MEMBER) : 'Unpaid'}</span>
      <button class="mini danger remove-member" data-id="${esc(m.id)}" type="button">Delete</button>
    </div>
  `).join('') : '<p class="empty">No members yet.</p>';

  document.getElementById('income-body').innerHTML = state.incomes.length ? state.incomes.map(i => `
    <tr><td>${esc(i.date)}</td><td>${esc(i.description)}</td><td>${money(i.amount)}</td><td><button class="mini danger delete-income" data-id="${esc(i.id)}" type="button">Delete</button></td></tr>
  `).join('') : '<tr><td colspan="4" class="empty">No money in yet.</td></tr>';

  document.getElementById('expense-body').innerHTML = state.expenses.length ? state.expenses.map(e => `
    <tr><td>${esc(e.date)}</td><td>${esc(e.description)}</td><td>${money(e.amount)}</td><td><button class="mini danger delete-expense" data-id="${esc(e.id)}" type="button">Delete</button></td></tr>
  `).join('') : '<tr><td colspan="4" class="empty">No expenses yet.</td></tr>';
}

function startNewCycle() {
  const t = totals();
  state.carryover = Math.max(0, t.balance);
  state.members = state.members.map(m => ({ ...m, paid: false }));
  state.incomes = [];
  state.expenses = [];
  state.cycleStartedAt = todayISO();
  saveCloudDebounced();
  render();
}

function bindEvents() {
  document.getElementById('member-form').addEventListener('submit', e => {
    e.preventDefault();
    if (!requireAdmin()) return;
    const input = document.getElementById('member-name');
    const name = input.value.trim();
    if (!name) return;
    state.members.push({ id: uid(), name, paid: false });
    input.value = '';
    saveCloudDebounced();
    render();
  });

  document.getElementById('members-list').addEventListener('change', e => {
    const box = e.target.closest('.member-paid');
    if (!box) return;
    if (!requireAdmin()) { box.checked = !box.checked; return; }
    const member = state.members.find(m => m.id === box.dataset.id);
    if (member) member.paid = box.checked;
    saveCloudDebounced();
    render();
  });

  document.getElementById('members-list').addEventListener('click', e => {
    const btn = e.target.closest('.remove-member');
    if (!btn) return;
    if (!requireAdmin()) return;
    state.members = state.members.filter(m => m.id !== btn.dataset.id);
    saveCloudDebounced();
    render();
  });

  document.getElementById('money-in-form').addEventListener('submit', e => {
    e.preventDefault();
    if (!requireAdmin()) return;
    const amount = Number(document.getElementById('income-amount').value);
    const description = document.getElementById('income-desc').value.trim();
    const date = document.getElementById('income-date').value || todayISO();
    if (!amount || amount <= 0 || !description) return alert('Please enter valid money in details.');
    state.incomes.push({ id: uid(), amount, description, date });
    e.target.reset();
    document.getElementById('income-date').value = todayISO();
    saveCloudDebounced();
    render();
  });

  document.getElementById('expense-form').addEventListener('submit', e => {
    e.preventDefault();
    if (!requireAdmin()) return;
    const amount = Number(document.getElementById('expense-amount').value);
    const description = document.getElementById('expense-desc').value.trim();
    const date = document.getElementById('expense-date').value || todayISO();
    if (!amount || amount <= 0 || !description) return alert('Please enter valid expense details.');
    state.expenses.push({ id: uid(), amount, description, date });
    e.target.reset();
    document.getElementById('expense-date').value = todayISO();
    saveCloudDebounced();
    render();
  });

  document.body.addEventListener('click', e => {
    const incomeBtn = e.target.closest('.delete-income');
    const expenseBtn = e.target.closest('.delete-expense');
    if (incomeBtn) {
      if (!requireAdmin()) return;
      state.incomes = state.incomes.filter(i => i.id !== incomeBtn.dataset.id);
      saveCloudDebounced();
      render();
    }
    if (expenseBtn) {
      if (!requireAdmin()) return;
      state.expenses = state.expenses.filter(x => x.id !== expenseBtn.dataset.id);
      saveCloudDebounced();
      render();
    }
  });

  document.getElementById('reset-cycle-btn').addEventListener('click', () => {
    if (!requireAdmin()) return;
    if (confirm('Start new 15-day cycle? Current remaining sobra will become carryover.')) startNewCycle();
  });

  document.getElementById('reset-all-btn').addEventListener('click', () => {
    if (!requireAdmin()) return;
    if (confirm('Reset everything? This removes all members, money in, expenses, and carryover.')) {
      state = defaultState();
      saveCloudDebounced();
      render();
    }
  });

  document.getElementById('lock-btn').addEventListener('click', () => {
    sessionStorage.removeItem(SESSION_KEY);
    alert('App locked. Password will be asked on next edit.');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('income-date').value = todayISO();
  document.getElementById('expense-date').value = todayISO();
  state = loadLocal();
  bindEvents();
  autoCycleCheck();
  render();
  initFirebase();
});

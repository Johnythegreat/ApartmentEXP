const MEMBER_AMOUNT = 700;
const LOCAL_KEY = 'apartment-budget-cloud-v1';
const DEFAULT_PASSWORD = 'Master';

let state = defaultState();
let db = null;
let docRef = null;
let unsubscribeCloud = null;
let cloudReady = false;
let applyingRemote = false;
let chart = null;
let isAdmin = false;

function defaultState() {
  const today = todayStr();
  return {
    adminPassword: DEFAULT_PASSWORD,
    cycleStart: today,
    carryover: 0,
    members: [
      { id: uid(), name: 'Member 1', paid: false },
      { id: uid(), name: 'Member 2', paid: false },
      { id: uid(), name: 'Member 3', paid: false },
      { id: uid(), name: 'Member 4', paid: false }
    ],
    income: [],
    expenses: [],
    updatedAt: Date.now()
  };
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function todayStr() { return new Date().toISOString().split('T')[0]; }
function money(n) { return '₱' + Number(n || 0).toFixed(2); }
function esc(v) { const d = document.createElement('div'); d.textContent = String(v ?? ''); return d.innerHTML; }
function dateLabel(date) { return new Date(date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }); }

function loadLocal() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY));
    if (saved && typeof saved === 'object') state = { ...defaultState(), ...saved };
  } catch {}
  if (!state.adminPassword || state.adminPassword === 'admin123') state.adminPassword = DEFAULT_PASSWORD;
}

function saveLocal() {
  state.updatedAt = Date.now();
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
}

const saveCloudDebounced = debounce(async () => {
  if (!cloudReady || !docRef || applyingRemote) return;
  try {
    await docRef.set({ ...state, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    setSyncStatus('Cloud synced');
  } catch (err) {
    console.warn(err);
    setSyncStatus('Local save only');
  }
}, 400);

function persist() {
  saveLocal();
  render();
  saveCloudDebounced();
}

function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

function isFirebaseConfigured() {
  const cfg = window.firebaseConfig || {};
  return cfg.apiKey && !String(cfg.apiKey).includes('PASTE_') && cfg.projectId && !String(cfg.projectId).includes('PASTE_');
}

async function initFirebase() {
  if (!window.firebase || !isFirebaseConfigured()) {
    setSyncStatus('Local save');
    return;
  }
  try {
    firebase.initializeApp(window.firebaseConfig);
    await firebase.auth().signInAnonymously();
    db = firebase.firestore();
    const roomId = window.APARTMENT_ROOM_ID || 'default-apartment';
    docRef = db.collection('apartmentBudgets').doc(roomId);
    const snap = await docRef.get();
    if (!snap.exists) {
      await docRef.set({ ...state, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    } else {
      const remote = snap.data();
      if (remote && remote.members) {
        state = normalizeRemote(remote);
        saveLocal();
      }
    }
    unsubscribeCloud = docRef.onSnapshot((snapshot) => {
      if (!snapshot.exists) return;
      applyingRemote = true;
      state = normalizeRemote(snapshot.data());
      saveLocal();
      render();
      applyingRemote = false;
      setSyncStatus('Cloud synced');
    });
    cloudReady = true;
    setSyncStatus('Cloud synced');
  } catch (err) {
    console.warn('Firebase unavailable:', err);
    setSyncStatus('Local save only');
  }
}

function normalizeRemote(data) {
  const base = defaultState();
  return {
    ...base,
    ...data,
    adminPassword: data.adminPassword || DEFAULT_PASSWORD,
    cycleStart: data.cycleStart || todayStr(),
    carryover: Number(data.carryover || 0),
    members: Array.isArray(data.members) ? data.members : base.members,
    income: Array.isArray(data.income) ? data.income : [],
    expenses: Array.isArray(data.expenses) ? data.expenses : []
  };
}

function setSyncStatus(text) {
  const el = document.getElementById('sync-status');
  if (el) el.textContent = text;
}

function totals() {
  const memberPaid = state.members.filter(m => m.paid).length * MEMBER_AMOUNT;
  const memberUnpaid = state.members.filter(m => !m.paid).length * MEMBER_AMOUNT;
  const manualPaid = state.income.reduce((sum, i) => sum + (i.paid ? Number(i.amount) : 0), 0);
  const manualUnpaid = state.income.reduce((sum, i) => sum + (!i.paid ? Number(i.amount) : 0), 0);
  const expenses = state.expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const paidIn = state.carryover + memberPaid + manualPaid;
  const balance = paidIn - expenses;
  return { memberPaid, memberUnpaid, manualPaid, manualUnpaid, paidIn, unpaid: memberUnpaid + manualUnpaid, expenses, balance };
}

function render() {
  const t = totals();
  document.getElementById('balance-amount').textContent = money(t.balance);
  document.getElementById('paid-in').textContent = money(t.paidIn);
  document.getElementById('unpaid-amount').textContent = money(t.unpaid);
  document.getElementById('spent-amount').textContent = money(t.expenses);
  document.getElementById('carryover-amount').textContent = money(state.carryover);
  document.getElementById('total-amount').textContent = money(t.expenses);
  const bal = document.getElementById('balance-amount');
  bal.classList.toggle('positive', t.balance >= 0);
  bal.classList.toggle('negative', t.balance < 0);
  renderCycleStatus();
  renderMembers();
  renderIncome();
  renderExpenses();
  renderChart();
}

function renderCycleStatus() {
  const start = new Date(state.cycleStart + 'T00:00:00');
  const next = new Date(start);
  next.setDate(start.getDate() + 15);
  const daysLeft = Math.ceil((next - new Date()) / 86400000);
  const label = daysLeft > 0 ? `${daysLeft} day(s) left before next reset` : 'Cycle is over. Reset when ready.';
  document.getElementById('cycle-status').textContent = `Started ${dateLabel(state.cycleStart)} • ${label}`;
}

function renderMembers() {
  const list = document.getElementById('member-list');
  const paidCount = state.members.filter(m => m.paid).length;
  document.getElementById('paid-member-count').textContent = `${paidCount}/${state.members.length} paid`;
  document.getElementById('member-paid-total').textContent = money(paidCount * MEMBER_AMOUNT);
  list.innerHTML = state.members.map(m => `
    <div class="member-item">
      <label class="member-check">
        <input type="checkbox" data-member-paid="${m.id}" ${m.paid ? 'checked' : ''} />
        <span>${esc(m.name)}</span>
      </label>
      <strong>${m.paid ? money(MEMBER_AMOUNT) : 'Unpaid'}</strong>
      <button class="mini-delete" data-delete-member="${m.id}">Delete</button>
    </div>
  `).join('');
}

function renderIncome() {
  const body = document.getElementById('income-body');
  if (!state.income.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty-state">No manual money in yet.</td></tr>';
    return;
  }
  body.innerHTML = state.income.slice().reverse().map(i => `
    <tr>
      <td>${dateLabel(i.date)}</td><td>${esc(i.source)}</td><td>${esc(i.description)}</td><td>${money(i.amount)}</td>
      <td><input type="checkbox" data-income-paid="${i.id}" ${i.paid ? 'checked' : ''}></td>
      <td><button class="delete-btn" data-delete-income="${i.id}">Delete</button></td>
    </tr>
  `).join('');
}

function renderExpenses() {
  const body = document.getElementById('expense-body');
  if (!state.expenses.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty-state">No expenses yet.</td></tr>';
    return;
  }
  body.innerHTML = state.expenses.slice().reverse().map(e => `
    <tr>
      <td>${dateLabel(e.date)}</td><td><span class="category-badge ${esc(e.category).toLowerCase()}">${esc(e.category)}</span></td><td>${esc(e.description)}</td><td>${money(e.amount)}</td>
      <td><button class="delete-btn" data-delete-expense="${e.id}">Delete</button></td>
    </tr>
  `).join('');
}

function renderChart() {
  const canvas = document.querySelector('#chart');
  if (!canvas || !window.Chart) return;
  const ctx = canvas.getContext('2d');
  if (chart) chart.destroy();
  const grouped = {};
  state.expenses.forEach(e => grouped[e.category] = (grouped[e.category] || 0) + Number(e.amount));
  const labels = Object.keys(grouped);
  const data = Object.values(grouped);
  if (!labels.length) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#8a7b68';
    ctx.textAlign = 'center';
    ctx.fillText('No expenses yet', canvas.width / 2, canvas.height / 2);
    return;
  }
  chart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: ['#b7791f', '#7c3aed', '#0f766e', '#dc2626', '#2563eb'], borderWidth: 2 }] },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
  });
}

function requireAdmin() {
  if (isAdmin) return true;
  const pass = prompt('Enter admin password:');
  if (pass === state.adminPassword) { isAdmin = true; return true; }
  if (pass !== null) alert('Incorrect password.');
  return false;
}

function resetCycle() {
  const t = totals();
  const newCarryover = Math.max(0, t.balance);
  state.carryover = newCarryover;
  state.cycleStart = todayStr();
  state.income = [];
  state.expenses = [];
  state.members = state.members.map(m => ({ ...m, paid: false }));
  persist();
}

function bindEvents() {
  const today = todayStr();
  document.getElementById('income-date').value = today;
  document.getElementById('expense-date').value = today;

  document.getElementById('member-form').addEventListener('submit', e => {
    e.preventDefault(); if (!requireAdmin()) return;
    const input = document.getElementById('member-name');
    state.members.push({ id: uid(), name: input.value.trim(), paid: false });
    input.value = ''; persist();
  });

  document.getElementById('income-form').addEventListener('submit', e => {
    e.preventDefault(); if (!requireAdmin()) return;
    state.income.push({ id: uid(), amount: Number(document.getElementById('income-amount').value), source: document.getElementById('income-source').value, description: document.getElementById('income-description').value.trim(), date: document.getElementById('income-date').value, paid: document.getElementById('income-paid').checked });
    e.target.reset(); document.getElementById('income-date').value = todayStr(); document.getElementById('income-paid').checked = true; persist();
  });

  document.getElementById('expense-form').addEventListener('submit', e => {
    e.preventDefault(); if (!requireAdmin()) return;
    state.expenses.push({ id: uid(), amount: Number(document.getElementById('expense-amount').value), category: document.getElementById('expense-category').value, description: document.getElementById('expense-description').value.trim(), date: document.getElementById('expense-date').value });
    e.target.reset(); document.getElementById('expense-date').value = todayStr(); persist();
  });

  document.body.addEventListener('change', e => {
    if (e.target.matches('[data-member-paid]')) { if (!requireAdmin()) { e.target.checked = !e.target.checked; return; } const id = e.target.dataset.memberPaid; state.members = state.members.map(m => m.id === id ? { ...m, paid: e.target.checked } : m); persist(); }
    if (e.target.matches('[data-income-paid]')) { if (!requireAdmin()) { e.target.checked = !e.target.checked; return; } const id = e.target.dataset.incomePaid; state.income = state.income.map(i => i.id === id ? { ...i, paid: e.target.checked } : i); persist(); }
  });

  document.body.addEventListener('click', e => {
    const delMember = e.target.closest('[data-delete-member]');
    const delIncome = e.target.closest('[data-delete-income]');
    const delExpense = e.target.closest('[data-delete-expense]');
    if (delMember) { if (!requireAdmin()) return; state.members = state.members.filter(m => m.id !== delMember.dataset.deleteMember); persist(); }
    if (delIncome) { if (!requireAdmin()) return; state.income = state.income.filter(i => i.id !== delIncome.dataset.deleteIncome); persist(); }
    if (delExpense) { if (!requireAdmin()) return; state.expenses = state.expenses.filter(x => x.id !== delExpense.dataset.deleteExpense); persist(); }
  });

  document.getElementById('reset-cycle-btn').addEventListener('click', () => {
    if (!requireAdmin()) return;
    if (confirm('Reset this 15-day cycle? Sobra will carry over.')) resetCycle();
  });

  document.getElementById('password-form').addEventListener('submit', e => {
    e.preventDefault();
    const current = document.getElementById('current-password').value;
    const next = document.getElementById('new-password').value;
    if (current !== state.adminPassword) return alert('Current password is incorrect.');
    if (next.length < 4) return alert('New password must be at least 4 characters.');
    state.adminPassword = next;
    isAdmin = false;
    e.target.reset();
    persist();
    alert('Password updated.');
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  loadLocal();
  bindEvents();
  render();
  await initFirebase();
  // Auto reset check: does not force reset without carrying sobra.
  const start = new Date(state.cycleStart + 'T00:00:00');
  const days = Math.floor((new Date() - start) / 86400000);
  if (days >= 15) {
    // Auto reset safely. Positive remaining balance becomes carryover.
    resetCycle();
  }
});

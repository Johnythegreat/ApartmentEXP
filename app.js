import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getFirestore, doc, onSnapshot, setDoc, getDoc, enableIndexedDbPersistence } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyDYE1h4hmU8ppSa18Jz-veC6GADBgsIa3g",
  authDomain: "tee-shirt-2.firebaseapp.com",
  projectId: "tee-shirt-2",
  storageBucket: "tee-shirt-2.firebasestorage.app",
  messagingSenderId: "795409975965",
  appId: "1:795409975965:web:679a7672811d748677e274",
  measurementId: "G-QY4MJ62VFZ"
};

const ADMIN_PASSWORD = 'Master';
const MEMBER_AMOUNT = 700;
const CYCLE_DAYS = 15;
const LOCAL_KEY = 'apartment-amotan-realtime-state-v3';

let db = null;
let cloudRef = null;
let cloudReady = false;
let applyingRemote = false;
let saveTimer = null;

const today = () => new Date().toISOString().slice(0, 10);
const peso = n => '₱' + Number(n || 0).toFixed(2);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const defaultState = () => ({
  cycleStart: today(),
  carryover: 0,
  members: [
    { id: uid(), name: 'Member 1', paid: false },
    { id: uid(), name: 'Member 2', paid: false },
    { id: uid(), name: 'Member 3', paid: false }
  ],
  income: [],
  expenses: [],
  updatedAt: Date.now()
});

let state = loadLocal() || defaultState();

function cleanState(raw){
  const base = defaultState();
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    cycleStart: s.cycleStart || base.cycleStart,
    carryover: Number(s.carryover || 0),
    members: Array.isArray(s.members) ? s.members.map(m => ({ id: m.id || uid(), name: String(m.name || 'Member'), paid: !!m.paid })) : base.members,
    income: Array.isArray(s.income) ? s.income.map(i => ({ id: i.id || uid(), amount: Number(i.amount || 0), source: String(i.source || ''), description: String(i.description || ''), date: i.date || today() })) : [],
    expenses: Array.isArray(s.expenses) ? s.expenses.map(e => ({ id: e.id || uid(), amount: Number(e.amount || 0), category: String(e.category || 'Other'), description: String(e.description || ''), date: e.date || today() })) : [],
    updatedAt: Number(s.updatedAt || Date.now())
  };
}

function loadLocal(){
  try { return cleanState(JSON.parse(localStorage.getItem(LOCAL_KEY))); } catch { return null; }
}
function saveLocal(){ localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); }
function requireAdmin(){
  const pass = prompt('Enter admin password:');
  if (pass === ADMIN_PASSWORD) return true;
  if (pass !== null) alert('Incorrect password.');
  return false;
}
function setStatus(text, mode='local'){
  const el = document.getElementById('cloud-status');
  if (!el) return;
  el.textContent = text;
  el.className = 'status-dot ' + mode;
}

function totals(){
  const memberTotal = state.members.filter(m => m.paid).length * MEMBER_AMOUNT;
  const incomeTotal = state.income.reduce((a,b)=>a + Number(b.amount || 0), 0);
  const expenseTotal = state.expenses.reduce((a,b)=>a + Number(b.amount || 0), 0);
  const balance = Number(state.carryover || 0) + memberTotal + incomeTotal - expenseTotal;
  return { memberTotal, incomeTotal, expenseTotal, balance };
}

function daysSinceCycle(){
  const start = new Date((state.cycleStart || today()) + 'T00:00:00');
  const now = new Date(today() + 'T00:00:00');
  return Math.floor((now - start) / 86400000);
}

function autoCycleCheck(){
  const days = daysSinceCycle();
  if (days >= CYCLE_DAYS) resetCycle(true);
}

function resetCycle(auto=false){
  const t = totals();
  state = {
    ...state,
    cycleStart: today(),
    carryover: Math.max(t.balance, 0),
    members: state.members.map(m => ({...m, paid:false})),
    income: [],
    expenses: [],
    updatedAt: Date.now()
  };
  persist();
  if (!auto) alert('Cycle reset. Sobra was carried over.');
}

function render(){
  const t = totals();
  document.getElementById('balance-amount').textContent = peso(t.balance);
  document.getElementById('carryover-amount').textContent = peso(state.carryover);
  document.getElementById('member-total').textContent = peso(t.memberTotal);
  document.getElementById('income-total').textContent = peso(t.incomeTotal);
  document.getElementById('expense-total').textContent = peso(t.expenseTotal);
  const left = Math.max(CYCLE_DAYS - daysSinceCycle(), 0);
  document.getElementById('cycle-text').textContent = `Cycle started ${state.cycleStart}. ${left} day(s) before auto reset. Sobra carries over.`;
  renderMembers(); renderIncome(); renderExpenses();
}
function esc(str){ return String(str ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function renderMembers(){
  const box = document.getElementById('members-list');
  if (!state.members.length) { box.innerHTML = '<div class="empty">No members yet.</div>'; return; }
  box.innerHTML = state.members.map(m => `
    <div class="member-row">
      <input type="checkbox" data-action="toggle-member" data-id="${m.id}" ${m.paid ? 'checked' : ''} />
      <input type="text" data-action="rename-member" data-id="${m.id}" value="${esc(m.name)}" />
      <span class="${m.paid ? 'paid':'unpaid'}">${m.paid ? 'Paid ₱700':'Unpaid'}</span>
      <button class="btn danger" data-action="delete-member" data-id="${m.id}">Delete</button>
    </div>`).join('');
}
function renderIncome(){
  const box = document.getElementById('income-list');
  if (!state.income.length) { box.innerHTML = '<div class="empty">No money in yet.</div>'; return; }
  box.innerHTML = state.income.slice().reverse().map(i => `
    <div class="list-row"><span>${esc(i.date)}</span><div><strong>${esc(i.source)}</strong><br><small>${esc(i.description)}</small></div><strong>${peso(i.amount)}</strong><button class="btn danger" data-action="delete-income" data-id="${i.id}">Delete</button></div>`).join('');
}
function renderExpenses(){
  const box = document.getElementById('expense-list');
  if (!state.expenses.length) { box.innerHTML = '<div class="empty">No expenses yet.</div>'; return; }
  box.innerHTML = state.expenses.slice().reverse().map(e => `
    <div class="list-row"><span>${esc(e.date)}</span><div><strong>${esc(e.category)}</strong><br><small>${esc(e.description)}</small></div><strong>${peso(e.amount)}</strong><button class="btn danger" data-action="delete-expense" data-id="${e.id}">Delete</button></div>`).join('');
}

function persist(){
  state.updatedAt = Date.now();
  saveLocal();
  render();
  if (!cloudReady || !cloudRef || applyingRemote) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await setDoc(cloudRef, state, { merge: false }); setStatus('Online synced', 'online'); }
    catch (err) { console.error(err); setStatus('Cloud save blocked', 'error'); }
  }, 250);
}

async function initFirebase(){
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    enableIndexedDbPersistence(db).catch(() => {});
    cloudRef = doc(db, 'budgetApp', 'apartmentAmotanMain');
    cloudReady = true;
    setStatus('Connecting cloud...', 'local');

    const snap = await getDoc(cloudRef);
    if (!snap.exists()) await setDoc(cloudRef, state, { merge: false });

    onSnapshot(cloudRef, (docSnap) => {
      if (!docSnap.exists()) return;
      const remote = cleanState(docSnap.data());
      const localUpdated = Number(state.updatedAt || 0);
      if (remote.updatedAt >= localUpdated) {
        applyingRemote = true;
        state = remote;
        saveLocal();
        autoCycleCheck();
        render();
        applyingRemote = false;
      }
      setStatus('Online synced', 'online');
    }, (err) => {
      console.error(err);
      setStatus('Cloud read blocked', 'error');
    });
  } catch (err) {
    console.error(err);
    cloudReady = false;
    setStatus('Local save only', 'local');
  }
}

function initEvents(){
  document.getElementById('income-date').value = today();
  document.getElementById('expense-date').value = today();

  document.getElementById('member-form').addEventListener('submit', e => {
    e.preventDefault(); if (!requireAdmin()) return;
    const input = document.getElementById('member-name');
    const name = input.value.trim(); if (!name) return;
    state.members.push({ id: uid(), name, paid:false }); input.value = ''; persist();
  });
  document.getElementById('members-list').addEventListener('change', e => {
    const id = e.target.dataset.id; if (!id) return;
    const member = state.members.find(m => m.id === id); if (!member) return;
    if (e.target.dataset.action === 'toggle-member') { if (!requireAdmin()) { e.target.checked = member.paid; return; } member.paid = e.target.checked; persist(); }
    if (e.target.dataset.action === 'rename-member') { member.name = e.target.value.trim() || 'Member'; persist(); }
  });
  document.getElementById('members-list').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action="delete-member"]'); if (!btn) return;
    if (!requireAdmin()) return;
    state.members = state.members.filter(m => m.id !== btn.dataset.id); persist();
  });
  document.getElementById('income-form').addEventListener('submit', e => {
    e.preventDefault(); if (!requireAdmin()) return;
    state.income.push({ id: uid(), amount: Number(document.getElementById('income-amount').value), source: document.getElementById('income-source').value.trim(), description: document.getElementById('income-description').value.trim(), date: document.getElementById('income-date').value || today() });
    e.target.reset(); document.getElementById('income-date').value = today(); persist();
  });
  document.getElementById('expense-form').addEventListener('submit', e => {
    e.preventDefault(); if (!requireAdmin()) return;
    state.expenses.push({ id: uid(), amount: Number(document.getElementById('expense-amount').value), category: document.getElementById('expense-category').value, description: document.getElementById('expense-description').value.trim(), date: document.getElementById('expense-date').value || today() });
    e.target.reset(); document.getElementById('expense-date').value = today(); persist();
  });
  document.body.addEventListener('click', e => {
    const incomeBtn = e.target.closest('button[data-action="delete-income"]');
    const expenseBtn = e.target.closest('button[data-action="delete-expense"]');
    if (incomeBtn) { if (!requireAdmin()) return; state.income = state.income.filter(i => i.id !== incomeBtn.dataset.id); persist(); }
    if (expenseBtn) { if (!requireAdmin()) return; state.expenses = state.expenses.filter(x => x.id !== expenseBtn.dataset.id); persist(); }
  });
  document.getElementById('reset-cycle-btn').addEventListener('click', () => { if (requireAdmin() && confirm('Reset this 15-day cycle and carry over sobra?')) resetCycle(false); });
  document.getElementById('wipe-btn').addEventListener('click', () => { if (requireAdmin() && confirm('Delete all data including carryover?')) { state = defaultState(); persist(); } });
  document.getElementById('save-now-btn').addEventListener('click', () => persist());
  document.getElementById('export-btn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type:'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'apartment-amotan-backup.json'; a.click(); URL.revokeObjectURL(a.href);
  });
  document.getElementById('import-file').addEventListener('change', async e => {
    if (!requireAdmin()) return;
    const file = e.target.files[0]; if (!file) return;
    state = cleanState(JSON.parse(await file.text())); persist(); e.target.value = '';
  });
}

initEvents();
autoCycleCheck();
render();
initFirebase();

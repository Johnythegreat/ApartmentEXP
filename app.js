import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, onSnapshot, setDoc, serverTimestamp, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
const LOCAL_KEY = "apartment-amotan-pro-state-v2";
const OLD_KEYS = ["apartment-amotan-pro-state-v1", "apartment-amotan-state-v3"];
const MIGRATION_FLAG = "apartment-amotan-old-data-merged-v2";
const SESSION_KEY = "apartment-amotan-unlocked";
const $ = (id) => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);
const money = (n) => "₱" + Number(n || 0).toLocaleString("en-PH", {minimumFractionDigits:2, maximumFractionDigits:2});
let db, ref, chart;
let online = false;
let applyingRemote = false;
let booted = false;

let state = cleanState({
  members: [], income: [], expenses: [], chat: [], carryover: 0, cycleStart: today(), dark: false, updatedAt: null
});

function uid(){
  return (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
}

function defaultMembers(){
  return ["Christian John", "Mike"].map((name, i) => ({id: uid(), name, photo: "🍽️", paid: false, paidAt: null, order: i}));
}

function cleanState(input = {}){
  const s = {members: [], income: [], expenses: [], chat: [], carryover: 0, cycleStart: today(), dark: false, updatedAt: null, ...input};
  s.members = Array.isArray(s.members) ? s.members.map((m, i) => ({
    id: String(m.id || uid()),
    name: String(m.name || m.memberName || "Member").trim() || "Member",
    photo: String(m.photo || m.avatar || "🍽️"),
    paid: !!m.paid,
    paidAt: m.paidAt || null,
    order: Number.isFinite(Number(m.order)) ? Number(m.order) : i
  })) : [];
  s.income = Array.isArray(s.income) ? s.income.map(x => ({
    id: String(x.id || uid()),
    amount: Number(x.amount || 0),
    description: String(x.description || x.source || "Money in"),
    date: x.date || today()
  })).filter(x => x.amount > 0) : [];
  s.expenses = Array.isArray(s.expenses) ? s.expenses.map(x => ({
    id: String(x.id || uid()),
    amount: Number(x.amount || 0),
    category: String(x.category || "Other"),
    description: String(x.description || "Expense"),
    date: x.date || today()
  })).filter(x => x.amount > 0) : [];
  s.chat = Array.isArray(s.chat) ? s.chat.map(c => ({
    id: String(c.id || uid()),
    name: String(c.name || "Admin"),
    message: String(c.message || ""),
    time: Number(c.time || Date.now())
  })).filter(c => c.message.trim()) : [];
  s.carryover = Number(s.carryover || 0);
  s.cycleStart = s.cycleStart || today();
  s.dark = !!s.dark;
  return s;
}

function readJsonKey(key){
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function loadLocal(){
  return readJsonKey(LOCAL_KEY) || readJsonKey("apartment-amotan-pro-state-v1") || readJsonKey("apartment-amotan-state-v3") || null;
}

function saveLocal(){
  localStorage.setItem(LOCAL_KEY, JSON.stringify({...state, localSavedAt: Date.now()}));
}

function oldStandaloneData(){
  const bundle = {members: [], income: [], expenses: [], carryover: 0};
  const members = readJsonKey("apartment-budget-members");
  if (Array.isArray(members)) bundle.members = members;
  const income = readJsonKey("income-tracker-income");
  if (Array.isArray(income)) bundle.income = income;
  const expenses = readJsonKey("expenses");
  if (Array.isArray(expenses)) bundle.expenses = expenses;
  return bundle;
}

function collectOldData(){
  let merged = cleanState({});
  [...OLD_KEYS].forEach(k => {
    const data = readJsonKey(k);
    if (data) merged = mergeStates(merged, cleanState(data));
  });
  const standalone = cleanState(oldStandaloneData());
  merged = mergeStates(merged, standalone);
  return merged;
}

function keyMember(m){ return (m.name || "").trim().toLowerCase(); }
function keyEntry(x){ return [x.date, x.description, Number(x.amount || 0)].join("|").toLowerCase(); }

function mergeStates(base, extra){
  const out = cleanState(base);
  const e = cleanState(extra);
  const memberMap = new Map(out.members.map(m => [keyMember(m), m]));
  e.members.forEach(m => {
    const k = keyMember(m);
    if (!k) return;
    if (memberMap.has(k)) Object.assign(memberMap.get(k), {...m, paid: memberMap.get(k).paid || m.paid, paidAt: memberMap.get(k).paidAt || m.paidAt});
    else { out.members.push(m); memberMap.set(k, m); }
  });
  const incomeSet = new Set(out.income.map(keyEntry));
  e.income.forEach(i => { const k = keyEntry(i); if (!incomeSet.has(k)) { out.income.push(i); incomeSet.add(k); } });
  const expenseSet = new Set(out.expenses.map(keyEntry));
  e.expenses.forEach(x => { const k = keyEntry(x); if (!expenseSet.has(k)) { out.expenses.push(x); expenseSet.add(k); } });
  const chatSet = new Set(out.chat.map(c => `${c.time}|${c.name}|${c.message}`));
  e.chat.forEach(c => { const k = `${c.time}|${c.name}|${c.message}`; if (!chatSet.has(k)) { out.chat.push(c); chatSet.add(k); } });
  out.carryover = Math.max(Number(out.carryover || 0), Number(e.carryover || 0));
  if (!out.cycleStart || out.cycleStart === today()) out.cycleStart = e.cycleStart || out.cycleStart;
  out.dark = out.dark || e.dark;
  return cleanState(out);
}

function hasRealData(s){
  return (s.members && s.members.length) || (s.income && s.income.length) || (s.expenses && s.expenses.length) || Number(s.carryover || 0) > 0;
}

async function saveCloud(){
  saveLocal();
  if (!online || !ref || applyingRemote) return;
  try {
    await setDoc(ref, {...state, updatedAt: serverTimestamp()}, {merge:true});
    setBadge("Online sync", "ok");
  } catch(e) {
    console.error("Cloud save failed:", e);
    setBadge("Local only", "warn");
  }
}

function setBadge(text, cls){
  const b = $("syncBadge");
  if (!b) return;
  b.textContent = text;
  b.className = "badge " + cls;
}

function status(text){
  const el = $("mergeStatus");
  if (el) el.textContent = text;
}

function requireAdmin(){
  if (sessionStorage.getItem(SESSION_KEY) === "yes") return true;
  const pass = prompt("Password:");
  if (pass === PASSWORD){ sessionStorage.setItem(SESSION_KEY,"yes"); return true; }
  if (pass !== null) alert("Incorrect password.");
  return false;
}

function cycleDaysLeft(){
  const start = new Date(state.cycleStart + "T00:00:00");
  const diff = Math.floor((new Date() - start) / 86400000);
  return Math.max(0, CYCLE_DAYS - diff);
}

function needsCycleClose(){
  const start = new Date(state.cycleStart + "T00:00:00");
  const diff = Math.floor((new Date() - start) / 86400000);
  return diff >= CYCLE_DAYS;
}

function autoCloseCycleIfNeeded(){
  if (!needsCycleClose()) return false;
  const t = totals();
  const sobra = Math.max(0, t.balance);
  state.carryover = sobra;
  state.cycleStart = today();
  state.members = state.members.map(m => ({...m, paid:false, paidAt:null}));
  state.income = [];
  state.expenses = [];
  return true;
}

function totals(){
  const paidAmotan = state.members.filter(m=>m.paid).length * AMOTAN_AMOUNT;
  const income = state.income.reduce((s,x)=>s+Number(x.amount||0),0);
  const expenses = state.expenses.reduce((s,x)=>s+Number(x.amount||0),0);
  const balance = paidAmotan + income + Number(state.carryover||0) - expenses;
  return {paidAmotan, income, expenses, balance};
}

function closeCycle(ask=true){
  if (ask && !requireAdmin()) return;
  const t = totals();
  const sobra = Math.max(0, t.balance);
  if (ask && !confirm(`Close this 15-day cycle? Sobra ${money(sobra)} will carry over.`)) return;
  state.carryover = sobra;
  state.cycleStart = today();
  state.members = state.members.map(m=>({...m, paid:false, paidAt:null}));
  state.income = [];
  state.expenses = [];
  render(); saveCloud();
}

function render(){
  document.body.classList.toggle("dark", !!state.dark);
  const t = totals();
  $("balanceAmount").textContent = money(t.balance);
  $("paidCount").textContent = `${state.members.filter(m=>m.paid).length}/${state.members.length}`;
  $("carryoverAmount").textContent = money(state.carryover);
  $("cycleInfo").textContent = `${cycleDaysLeft()} day(s) left`;
  $("cycleStarted").textContent = `Started ${state.cycleStart}`;
  $("reportAmotan").textContent = money(t.paidAmotan);
  $("reportIncome").textContent = money(t.income);
  $("reportExpenses").textContent = money(t.expenses);
  $("reportUnpaid").textContent = state.members.filter(m=>!m.paid).length;
  renderMembers(); renderIncome(); renderExpenses(); renderChat(); renderChart();
}

function avatar(photo){
  if (!photo) return "🍽️";
  if (/^https?:\/\//.test(photo)) return `<img src="${escapeHtml(photo)}" alt="">`;
  return escapeHtml(photo);
}

function renderMembers(){
  $("memberList").innerHTML = state.members.sort((a,b)=>a.order-b.order).map(m=>`
    <div class="member ${m.paid?'paid':''}">
      <label><input type="checkbox" data-act="toggleMember" data-id="${m.id}" ${m.paid?'checked':''}> <span class="avatar">${avatar(m.photo)}</span><b>${escapeHtml(m.name)}</b></label>
      <span class="member-money">${m.paid ? money(AMOTAN_AMOUNT) : 'Unpaid'}</span>
      <button data-act="deleteMember" data-id="${m.id}" class="mini danger">Delete</button>
    </div>`).join("") || `<p class="empty">No members yet.</p>`;
}
function renderIncome(){
  $("incomeBody").innerHTML = state.income.map(x=>`<tr><td>${escapeHtml(x.date)}</td><td>${escapeHtml(x.description)}</td><td>${money(x.amount)}</td><td><button class="mini danger" data-act="deleteIncome" data-id="${x.id}">Delete</button></td></tr>`).join("") || `<tr><td colspan="4" class="empty">No money in yet.</td></tr>`;
}
function renderExpenses(){
  $("expenseBody").innerHTML = state.expenses.map(x=>`<tr><td>${escapeHtml(x.date)}</td><td>${escapeHtml(x.category)}</td><td>${escapeHtml(x.description)}</td><td>${money(x.amount)}</td><td><button class="mini danger" data-act="deleteExpense" data-id="${x.id}">Delete</button></td></tr>`).join("") || `<tr><td colspan="5" class="empty">No expenses yet.</td></tr>`;
}
function renderChat(){
  $("chatList").innerHTML = [...state.chat].slice(-40).reverse().map(c=>`<div class="chat"><b>${escapeHtml(c.name)}</b><small>${new Date(c.time).toLocaleString()}</small><p>${escapeHtml(c.message)}</p></div>`).join("") || `<p class="empty">No announcements yet.</p>`;
}
function renderChart(){
  const ctx = $("expenseChart");
  if (!window.Chart || !ctx) return;
  const grouped = {};
  state.expenses.forEach(e=> grouped[e.category]=(grouped[e.category]||0)+Number(e.amount||0));
  const labels = Object.keys(grouped);
  const data = Object.values(grouped);
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type:"doughnut",
    data:{labels: labels.length ? labels : ["No expenses"], datasets:[{data: data.length ? data : [1]}]},
    options:{plugins:{legend:{position:"bottom"}}, responsive:true, maintainAspectRatio:true}
  });
}
function escapeHtml(v){ const d=document.createElement("div"); d.textContent=String(v ?? ""); return d.innerHTML; }

function bind(){
  ["incomeDate","expenseDate"].forEach(id=>$(id).value=today());
  $("lockBtn").onclick=()=>{ sessionStorage.removeItem(SESSION_KEY); alert("Locked."); };
  $("themeBtn").onclick=()=>{ if(!requireAdmin())return; state.dark=!state.dark; render(); saveCloud(); };
  $("resetBtn").onclick=()=>closeCycle(true);
  $("exportBtn").onclick=exportCsv;
  $("recoverBtn").onclick=()=>{ if(!requireAdmin())return; recoverOldData(true); };
  $("memberForm").onsubmit=e=>{ e.preventDefault(); if(!requireAdmin())return; const name=$("memberName").value.trim(); if(!name)return; state.members.push({id:uid(), name, photo:$("memberPhoto").value.trim()||"🍽️", paid:false, paidAt:null, order:state.members.length}); e.target.reset(); render(); saveCloud(); };
  $("incomeForm").onsubmit=e=>{ e.preventDefault(); if(!requireAdmin())return; state.income.push({id:uid(), amount:Number($("incomeAmount").value), description:$("incomeDescription").value.trim(), date:$("incomeDate").value||today()}); e.target.reset(); $("incomeDate").value=today(); render(); saveCloud(); };
  $("expenseForm").onsubmit=e=>{ e.preventDefault(); if(!requireAdmin())return; state.expenses.push({id:uid(), amount:Number($("expenseAmount").value), category:$("expenseCategory").value, description:$("expenseDescription").value.trim(), date:$("expenseDate").value||today()}); e.target.reset(); $("expenseDate").value=today(); render(); saveCloud(); };
  $("chatForm").onsubmit=e=>{ e.preventDefault(); if(!requireAdmin())return; const msg=$("chatMessage").value.trim(); if(!msg)return; state.chat.push({id:uid(), name:$("chatName").value.trim()||"Admin", message:msg, time:Date.now()}); $("chatMessage").value=""; render(); saveCloud(); };
  document.body.addEventListener("click", e=>{
    const btn=e.target.closest("[data-act]"); if(!btn) return;
    if(!requireAdmin()) return;
    const {act,id}=btn.dataset;
    if(act==="deleteMember") state.members=state.members.filter(x=>x.id!==id);
    if(act==="deleteIncome") state.income=state.income.filter(x=>x.id!==id);
    if(act==="deleteExpense") state.expenses=state.expenses.filter(x=>x.id!==id);
    render(); saveCloud();
  });
  document.body.addEventListener("change", e=>{
    if(e.target.dataset.act!=="toggleMember") return;
    if(!requireAdmin()){ e.target.checked=!e.target.checked; return; }
    const m=state.members.find(x=>x.id===e.target.dataset.id); if(m){ m.paid=e.target.checked; m.paidAt=m.paid?Date.now():null; }
    render(); saveCloud();
  });
}

function recoverOldData(manual=false){
  const old = collectOldData();
  if (!hasRealData(old)) {
    if (manual) alert("No old saved data found on this device/browser.");
    status("No old local data detected on this browser.");
    return false;
  }
  const before = JSON.stringify(state);
  state = mergeStates(state, old);
  const changed = before !== JSON.stringify(state);
  if (changed) {
    saveLocal(); render(); saveCloud();
    status("Old saved data detected and merged.");
    localStorage.setItem(MIGRATION_FLAG, "yes");
    if (manual) alert("Old saved data merged successfully.");
  } else {
    status("Old saved data was already merged.");
    if (manual) alert("Old saved data was already merged.");
  }
  return changed;
}

function exportCsv(){
  const rows = [["Type","Date","Name/Category","Description","Amount","Paid"]];
  state.members.forEach(m=>rows.push(["Member", m.paidAt?new Date(m.paidAt).toLocaleDateString():"", m.name, "Amotan", m.paid?AMOTAN_AMOUNT:0, m.paid?"Yes":"No"]));
  state.income.forEach(i=>rows.push(["Money In", i.date, "", i.description, i.amount, ""]));
  state.expenses.forEach(e=>rows.push(["Expense", e.date, e.category, e.description, e.amount, ""]));
  const csv = rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"})); a.download="apartment-amotan-report.csv"; a.click();
}

async function initFirebase(){
  try{
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    enableIndexedDbPersistence(db).catch(()=>{});
    ref = doc(db, "budgetApp", "apartment-amotan-main");
    onSnapshot(ref, snap=>{
      online = true; setBadge("Online sync", "ok");
      applyingRemote = true;
      let remote = snap.exists() ? cleanState(snap.data()) : cleanState({});
      let merged = mergeStates(remote, state);
      state = merged;
      const cycleClosed = autoCloseCycleIfNeeded();
      saveLocal(); render();
      applyingRemote = false;
      if (!snap.exists() || cycleClosed || JSON.stringify(remote) !== JSON.stringify(merged)) saveCloud();
      if (!booted) { booted = true; status("Ready. Cloud sync is active."); }
    }, err=>{
      console.error("Realtime sync error:", err);
      online = false; setBadge("Local only", "warn");
      status("Using local save. Check Firestore rules if cloud sync does not connect.");
    });
  } catch(e){
    console.error("Firebase init failed:", e);
    online=false; setBadge("Local only", "warn");
    status("Using local save. Firebase did not initialize.");
  }
}

window.addEventListener("DOMContentLoaded", ()=>{
  state = cleanState(loadLocal() || {});
  if (!state.members.length) state.members = defaultMembers();
  const cycleClosed = autoCloseCycleIfNeeded();
  bind(); render(); saveLocal();
  if (localStorage.getItem(MIGRATION_FLAG) !== "yes") recoverOldData(false);
  if (cycleClosed) saveLocal();
  initFirebase();
  if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
});

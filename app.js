import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, onSnapshot, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
const LOCAL_KEY = "apartment-amotan-pro-state-v1";
const SESSION_KEY = "apartment-amotan-unlocked";
const $ = (id) => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);
const money = (n) => "₱" + Number(n || 0).toLocaleString("en-PH", {minimumFractionDigits:2, maximumFractionDigits:2});
let db, ref, unsub, chart, online = false, applyingRemote = false;

let state = {
  members: [], income: [], expenses: [], chat: [], carryover: 0, cycleStart: today(), dark: false, updatedAt: null
};

function defaultMembers(){
  return ["Christian John", "Mike"].map((name, i) => ({id: crypto.randomUUID(), name, photo: "🍽️", paid: false, paidAt: null, order: i}));
}
function loadLocal(){ try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || null; } catch { return null; } }
function saveLocal(){ localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); }
async function saveCloud(){
  saveLocal();
  if (!online || !ref || applyingRemote) return;
  try { await setDoc(ref, {...state, updatedAt: serverTimestamp()}, {merge:true}); setBadge("Online sync", "ok"); }
  catch(e){ console.error(e); setBadge("Local only", "warn"); }
}
function setBadge(text, cls){ const b=$("syncBadge"); b.textContent=text; b.className="badge "+cls; }
function requireAdmin(){
  if (sessionStorage.getItem(SESSION_KEY)==="yes") return true;
  const pass = prompt("Enter admin password:");
  if (pass === PASSWORD){ sessionStorage.setItem(SESSION_KEY,"yes"); return true; }
  if (pass !== null) alert("Incorrect password.");
  return false;
}
function cycleDaysLeft(){
  const start = new Date(state.cycleStart + "T00:00:00");
  const diff = Math.floor((new Date() - start) / 86400000);
  return Math.max(0, CYCLE_DAYS - diff);
}
function autoCloseCycleIfNeeded(){
  const start = new Date(state.cycleStart + "T00:00:00");
  const diff = Math.floor((new Date() - start) / 86400000);
  if (diff >= CYCLE_DAYS) closeCycle(false);
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
  $("memberList").innerHTML = state.members.map(m=>`
    <div class="member ${m.paid?'paid':''}">
      <label><input type="checkbox" data-act="toggleMember" data-id="${m.id}" ${m.paid?'checked':''}> <span class="avatar">${avatar(m.photo)}</span><b>${escapeHtml(m.name)}</b></label>
      <span class="member-money">${m.paid ? money(AMOTAN_AMOUNT) : 'Unpaid'}</span>
      <button data-act="deleteMember" data-id="${m.id}" class="mini danger">Delete</button>
    </div>`).join("") || `<p class="empty">No members yet.</p>`;
}
function renderIncome(){
  $("incomeBody").innerHTML = state.income.map(x=>`<tr><td>${x.date}</td><td>${escapeHtml(x.description)}</td><td>${money(x.amount)}</td><td><button class="mini danger" data-act="deleteIncome" data-id="${x.id}">Delete</button></td></tr>`).join("") || `<tr><td colspan="4" class="empty">No money in yet.</td></tr>`;
}
function renderExpenses(){
  $("expenseBody").innerHTML = state.expenses.map(x=>`<tr><td>${x.date}</td><td>${escapeHtml(x.category)}</td><td>${escapeHtml(x.description)}</td><td>${money(x.amount)}</td><td><button class="mini danger" data-act="deleteExpense" data-id="${x.id}">Delete</button></td></tr>`).join("") || `<tr><td colspan="5" class="empty">No expenses yet.</td></tr>`;
}
function renderChat(){
  $("chatList").innerHTML = [...state.chat].slice(-40).reverse().map(c=>`<div class="chat"><b>${escapeHtml(c.name)}</b><small>${new Date(c.time).toLocaleString()}</small><p>${escapeHtml(c.message)}</p></div>`).join("") || `<p class="empty">No announcements yet.</p>`;
}
function renderChart(){
  const ctx = $("expenseChart");
  if (!window.Chart || !ctx) return;
  const grouped = {};
  state.expenses.forEach(e=> grouped[e.category]=(grouped[e.category]||0)+Number(e.amount||0));
  const labels = Object.keys(grouped), data = Object.values(grouped);
  if (chart) chart.destroy();
  chart = new Chart(ctx, {type:"doughnut", data:{labels, datasets:[{data}]}, options:{plugins:{legend:{position:"bottom"}}}});
}
function escapeHtml(v){ const d=document.createElement("div"); d.textContent=String(v ?? ""); return d.innerHTML; }
function bind(){
  ["incomeDate","expenseDate"].forEach(id=>$(id).value=today());
  $("lockBtn").onclick=()=>{ sessionStorage.removeItem(SESSION_KEY); alert("Locked."); };
  $("themeBtn").onclick=()=>{ if(!requireAdmin())return; state.dark=!state.dark; render(); saveCloud(); };
  $("resetBtn").onclick=()=>closeCycle(true);
  $("exportBtn").onclick=exportCsv;
  $("memberForm").onsubmit=e=>{ e.preventDefault(); if(!requireAdmin())return; const name=$("memberName").value.trim(); if(!name)return; state.members.push({id:crypto.randomUUID(), name, photo:$("memberPhoto").value.trim()||"🍽️", paid:false, paidAt:null, order:state.members.length}); e.target.reset(); render(); saveCloud(); };
  $("incomeForm").onsubmit=e=>{ e.preventDefault(); if(!requireAdmin())return; state.income.push({id:crypto.randomUUID(), amount:Number($("incomeAmount").value), description:$("incomeDescription").value.trim(), date:$("incomeDate").value||today()}); e.target.reset(); $("incomeDate").value=today(); render(); saveCloud(); };
  $("expenseForm").onsubmit=e=>{ e.preventDefault(); if(!requireAdmin())return; state.expenses.push({id:crypto.randomUUID(), amount:Number($("expenseAmount").value), category:$("expenseCategory").value, description:$("expenseDescription").value.trim(), date:$("expenseDate").value||today()}); e.target.reset(); $("expenseDate").value=today(); render(); saveCloud(); };
  $("chatForm").onsubmit=e=>{ e.preventDefault(); if(!requireAdmin())return; state.chat.push({id:crypto.randomUUID(), name:$("chatName").value.trim()||"Admin", message:$("chatMessage").value.trim(), time:Date.now()}); $("chatMessage").value=""; render(); saveCloud(); };
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
    db = getFirestore(initializeApp(firebaseConfig));
    ref = doc(db, "budgetApp", "apartment-amotan-main");
    unsub = onSnapshot(ref, snap=>{
      online = true; setBadge("Online sync", "ok");
      if(snap.exists()){
        applyingRemote = true;
        state = {...state, ...snap.data()};
        saveLocal(); autoCloseCycleIfNeeded(); render();
        applyingRemote = false;
      } else { saveCloud(); }
    }, err=>{ console.error(err); online=false; setBadge("Local only", "warn"); });
  } catch(e){ console.error(e); online=false; setBadge("Local only", "warn"); }
}
window.addEventListener("DOMContentLoaded", ()=>{
  state = {...state, ...(loadLocal() || {})};
  if (!state.members.length) state.members = defaultMembers();
  bind(); autoCloseCycleIfNeeded(); render(); initFirebase();
  if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
});

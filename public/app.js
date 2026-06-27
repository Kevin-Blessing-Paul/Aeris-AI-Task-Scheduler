// NEXUS app.js - Firebase + Gemini + Google Calendar

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import { getFirestore, collection, doc, getDocs, setDoc, updateDoc, deleteDoc, getDoc } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, setPersistence, browserLocalPersistence, sendEmailVerification
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import { GEMINI_KEY, GCAL_CLIENT_ID, GCAL_API_KEY, firebaseConfig } from './config.js';

const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent`;
const GCAL_SCOPE     = 'https://www.googleapis.com/auth/calendar.events';

const XP_VALUES      = { critical:50, high:30, medium:20, low:10 };
const XP_EARLY       = 10;
const XP_SUBTASK     = 5;
const XP_HABIT       = 8;
const XP_MISS        = { critical:-40, high:-25, medium:-15, low:-5 };
const LEAGUES = [
  { name:'Peasant',  emblem:'🪨', minXP:0    },
  { name:'Squire',   emblem:'🛡',  minXP:100  },
  { name:'Knight',   emblem:'⚔',  minXP:300  },
  { name:'Guardian', emblem:'🗡',  minXP:600  },
  { name:'Warlord',  emblem:'👑', minXP:1000 },
  { name:'Legend',   emblem:'🌟', minXP:2000 },
];

// STATE
let db, auth, currentUid=null, tasks=[], habits=[], player={xp:0,totalXP:0}, xpLog=[];
let gcalConnected=false, tokenClient=null, accessToken=null;
let calYear=new Date().getFullYear(), calMonth=new Date().getMonth();
let currentFilter='all', editingTaskId=null, formSubtasks=[];

// BOOT - hide loader after 2s no matter what
let firebaseApp;
window.addEventListener('DOMContentLoaded', () => {
  setupNav();
  setupAuthForm();
  setTimeout(hideLoader, 2000); // guaranteed hide
  initFirebase();
});

function initFirebase() {
  try {
    firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp);
    auth = getAuth(firebaseApp);
    setPersistence(auth, browserLocalPersistence).catch(()=>{});
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        currentUid = user.uid;
        showApp(user);
        await bootData();
      } else {
        currentUid = null;
        hideLoader();
        showAuthScreen();
      }
    });
  } catch(e) {
    console.warn('Firebase init failed:', e);
    hideLoader();
    showAuthScreen();
  }
}

async function bootData() {
  try {
    await Promise.all([loadPlayer(), loadTasks(), loadHabits(), loadXPLog()]);
  } catch(e) {
    console.warn('Firestore load failed:', e);
  }
  hideLoader();
  renderAll();
  generateAIBriefing();
  loadGoogleApi();
  checkMissedDeadlines();
  setInterval(checkMissedDeadlines, 60000);
}

function showApp(user) {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  const email = user.email || '';
  const avatarEl = document.getElementById('accountAvatar');
  const emailEl = document.getElementById('accountEmail');
  if (avatarEl) avatarEl.textContent = email.charAt(0) || '?';
  if (emailEl) emailEl.textContent = email;
}

function showAuthScreen() {
  document.getElementById('appShell').classList.add('hidden');
  document.getElementById('authScreen').classList.remove('hidden');
}

// ===== AUTH UI =====
let authMode = 'login';

function switchAuthTab(mode) {
  authMode = mode;
  document.getElementById('tabLogin').classList.toggle('active', mode==='login');
  document.getElementById('tabSignup').classList.toggle('active', mode==='signup');
  document.getElementById('authConfirmGroup').classList.toggle('hidden', mode!=='signup');
  document.getElementById('authForgotBtn').classList.toggle('hidden', mode==='signup');
  document.getElementById('authSubmitBtn').textContent = mode==='login' ? 'Log In' : 'Sign Up';
  document.getElementById('authPassword').setAttribute('autocomplete', mode==='login' ? 'current-password' : 'new-password');
  hideAuthError();
}

function setupAuthForm() {
  const form = document.getElementById('authForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthError();

    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const confirm = document.getElementById('authPasswordConfirm').value;

    if (!email || !password) { showAuthError('Please fill in all fields.'); return; }
    if (password.length < 6) { showAuthError('Password must be at least 6 characters.'); return; }
    if (authMode === 'signup' && password !== confirm) { showAuthError('Passwords do not match.'); return; }

    const btn = document.getElementById('authSubmitBtn');
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = authMode==='login' ? 'Logging in…' : 'Creating account…';

    try {
      if (authMode === 'login') {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        try { await sendEmailVerification(cred.user); } catch(e){}
        toast('Account created! Check your email to verify it.', 'success');
      }
      form.reset();
    } catch (err) {
      showAuthError(friendlyAuthError(err));
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideAuthError() {
  const el = document.getElementById('authError');
  el.classList.add('hidden');
  el.textContent = '';
}

function friendlyAuthError(err) {
  const code = err && err.code || '';
  const map = {
    'auth/invalid-email':'That email address looks invalid.',
    'auth/user-not-found':'No account found with that email.',
    'auth/wrong-password':'Incorrect password. Please try again.',
    'auth/invalid-credential':'Incorrect email or password.',
    'auth/email-already-in-use':'An account already exists with that email.',
    'auth/weak-password':'Password must be at least 6 characters.',
    'auth/too-many-requests':'Too many attempts. Please wait and try again.',
    'auth/network-request-failed':'Network error. Check your connection.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

async function handleForgotPassword() {
  const email = document.getElementById('authEmail').value.trim();
  if (!email) { showAuthError('Enter your email above first, then click "Forgot password?".'); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    hideAuthError();
    toast('Password reset email sent.', 'success');
  } catch (err) {
    showAuthError(friendlyAuthError(err));
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
    // Reset in-memory state so the next login starts clean.
    tasks=[]; habits=[]; xpLog=[]; player={xp:0,totalXP:0};
    chatHistory=[];
    const chatBox=document.getElementById('chatMessages');
    if (chatBox) chatBox.innerHTML='';
    toast('Logged out', 'success');
  } catch(e) {
    toast('Could not log out', 'error');
  }
}

window.switchAuthTab = switchAuthTab;
window.handleForgotPassword = handleForgotPassword;
window.handleLogout = handleLogout;

function hideLoader() {
  const el = document.getElementById('pageLoader');
  if (el) el.classList.add('hidden');
}

// LOCAL STORAGE FALLBACK
function loadLocal() {
  tasks   = JSON.parse(localStorage.getItem('nx_tasks')  || '[]');
  habits  = JSON.parse(localStorage.getItem('nx_habits') || '[]');
  player  = JSON.parse(localStorage.getItem('nx_player') || '{"xp":0,"totalXP":0}');
  xpLog   = JSON.parse(localStorage.getItem('nx_xplog')  || '[]');
  if (!tasks.length) seedLocal();
}

function saveLocal() {
  localStorage.setItem('nx_tasks',  JSON.stringify(tasks));
  localStorage.setItem('nx_habits', JSON.stringify(habits));
  localStorage.setItem('nx_player', JSON.stringify(player));
  localStorage.setItem('nx_xplog',  JSON.stringify(xpLog));
}

function seedLocal() {
  const now = new Date();
  tasks = [
    { id:uid(), title:'Submit project proposal', desc:'Draft Q3 roadmap', deadline:addHours(now,2).toISOString(), priority:'critical', category:'work',    status:'pending',     subtasks:[], penalised:false, created:now.toISOString() },
    { id:uid(), title:'Pay electricity bill',    desc:'Online payment',   deadline:addHours(now,5).toISOString(), priority:'high',     category:'finance', status:'pending',     subtasks:[], penalised:false, created:now.toISOString() },
    { id:uid(), title:'Study for exam Ch 4-6',   desc:'DSA chapters',     deadline:addDays(now,1).toISOString(),  priority:'high',     category:'study',   status:'in-progress', subtasks:[], penalised:false, created:now.toISOString() },
    { id:uid(), title:'Prepare interview notes', desc:'Research company',  deadline:addDays(now,2).toISOString(),  priority:'critical', category:'work',    status:'pending',     subtasks:[], penalised:false, created:now.toISOString() },
    { id:uid(), title:'Book dentist appointment',desc:'',                  deadline:addDays(now,3).toISOString(),  priority:'low',      category:'health',  status:'pending',     subtasks:[], penalised:false, created:now.toISOString() },
  ];
  habits = [
    { id:uid(), name:'Morning Meditation', icon:'🧘', freq:'daily', streak:5, history:[] },
    { id:uid(), name:'Read 30 mins',       icon:'📖', freq:'daily', streak:3, history:[] },
    { id:uid(), name:'Exercise',           icon:'💪', freq:'daily', streak:7, history:[] },
  ];
  saveLocal();
}

// FIREBASE LOAD
async function loadPlayer() {
  const snap = await getDoc(doc(db,'users',currentUid,'player','main'));
  if (snap.exists()) player = snap.data();
  else await setDoc(doc(db,'users',currentUid,'player','main'), player);
}

async function loadTasks() {
  const snap = await getDocs(collection(db,'users',currentUid,'tasks'));
  tasks = snap.docs.map(d=>({id:d.id,...d.data()}));
}

async function loadHabits() {
  const snap = await getDocs(collection(db,'users',currentUid,'habits'));
  habits = snap.docs.map(d=>({id:d.id,...d.data()}));
}

async function loadXPLog() {
  const snap = await getDocs(collection(db,'users',currentUid,'xplog'));
  xpLog = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>b.ts-a.ts).slice(0,30);
}

// UTILS
function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2); }
function addHours(d,h) { return new Date(d.getTime()+h*3600000); }
function addDays(d,n)  { return new Date(d.getTime()+n*86400000); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function dlLabel(iso) {
  if (!iso) return {text:'No deadline',cls:''};
  const d=new Date(iso), now=new Date(), diff=d-now;
  if (diff<0)        return {text:'Overdue',cls:'overdue'};
  if (diff<3600000)  return {text:Math.round(diff/60000)+'m left',cls:'soon'};
  if (diff<86400000) return {text:'Today '+d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),cls:'soon'};
  if (diff<172800000)return {text:'Tomorrow',cls:''};
  return {text:d.toLocaleDateString([],{month:'short',day:'numeric'}),cls:''};
}

function priorityColor(p) {
  return {critical:'#F43F5E',high:'#F59E0B',medium:'#6366F1',low:'#10B981'}[p]||'#6366F1';
}

function getLeague(xp) {
  let l=LEAGUES[0];
  for (const lg of LEAGUES) { if(xp>=lg.minXP) l=lg; }
  return l;
}

function getNextLeague(xp) {
  return LEAGUES.find(l=>l.minXP>xp)||LEAGUES[LEAGUES.length-1];
}

// XP
async function awardXP(amount, reason) {
  player.xp = Math.max(0,(player.xp||0)+amount);
  if (amount>0) player.totalXP=(player.totalXP||0)+amount;
  try { if(db) await setDoc(doc(db,'users',currentUid,'player','main'),player); } catch(e){}
  saveLocal();
  const entry={amount,reason,ts:Date.now()};
  const lid=uid();
  try { if(db) await setDoc(doc(db,'users',currentUid,'xplog',lid),entry); } catch(e){}
  xpLog.unshift({id:lid,...entry});
  if(xpLog.length>30) xpLog.pop();
  saveLocal();
  showXPPopup(amount);
  updateLeagueUI();
  updateStats();
}

function showXPPopup(amount) {
  const el=document.getElementById('xpPopup');
  if(!el) return;
  el.textContent = amount>=0 ? '+'+amount+' XP !' : amount+' XP';
  el.style.color  = amount>=0 ? '#10B981' : '#F43F5E';
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

function updateLeagueUI() {
  const l    = getLeague(player.xp||0);
  const next = getNextLeague(player.xp||0);
  const pct  = l===next ? 100 : Math.round(((player.xp-l.minXP)/(next.minXP-l.minXP))*100);
  const eEl=document.getElementById('leagueEmblem');
  const nEl=document.getElementById('leagueName');
  const bEl=document.getElementById('xpBar');
  const cEl=document.getElementById('currentXP');
  const xEl=document.getElementById('nextXP');
  if(eEl) eEl.textContent=l.emblem;
  if(nEl) nEl.textContent=l.name;
  if(bEl) bEl.style.width=pct+'%';
  if(cEl) cEl.textContent=player.xp||0;
  if(xEl) xEl.textContent=next.minXP;
}

// MISSED DEADLINES
async function checkMissedDeadlines() {
  const now=new Date();
  for (const t of tasks) {
    if(t.status==='done'||t.penalised||!t.deadline) continue;
    if(new Date(t.deadline)<now) {
      const penalty=XP_MISS[t.priority]||-15;
      t.penalised=true;
      try { if(db) await updateDoc(doc(db,'users',currentUid,'tasks',t.id),{penalised:true}); } catch(e){}
      saveLocal();
      await awardXP(penalty,'Missed: '+t.title);
    }
  }
  checkUpcomingReminders(now);
}

// ===== NOTIFICATIONS =====
const REMINDER_WINDOW_MIN = 15; // notify when a task is due within this many minutes
const NOTIFIED_KEY = 'nx_notified';

function getNotifiedSet(){
  try { return new Set(JSON.parse(localStorage.getItem(NOTIFIED_KEY+':'+currentUid)||'[]')); }
  catch(e){ return new Set(); }
}
function saveNotifiedSet(set){
  try { localStorage.setItem(NOTIFIED_KEY+':'+currentUid, JSON.stringify([...set])); } catch(e){}
}

async function requestNotificationPermission(){
  if (!('Notification' in window)) { toast('Notifications are not supported in this browser.', 'error'); return false; }
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') { toast('Notifications are blocked - enable them in browser settings.', 'error'); return false; }
  const perm = await Notification.requestPermission();
  return perm === 'granted';
}

async function showReminderNotification(task, minutesLeft){
  const title = minutesLeft<=0 ? 'Task overdue!' : 'Task due soon';
  const body = task.title+' — due '+(minutesLeft<=0?'now':'in '+minutesLeft+' min');
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg && reg.showNotification) {
      reg.showNotification(title, { body, icon:'icon-192.png', badge:'icon-192.png', tag:'nx-task-'+task.id });
      return;
    }
  } catch(e){}
  // Fallback to plain Notification API if no service worker is active.
  if ('Notification' in window && Notification.permission==='granted') {
    new Notification(title, { body, icon:'icon-192.png' });
  }
}

function checkUpcomingReminders(now){
  if (!('Notification' in window) || Notification.permission!=='granted') return;
  const notified = getNotifiedSet();
  let changed=false;
  for (const t of tasks) {
    if (t.status==='done' || !t.deadline) continue;
    const due = new Date(t.deadline);
    const minutesLeft = Math.round((due-now)/60000);
    if (minutesLeft<=REMINDER_WINDOW_MIN && minutesLeft>=-1 && !notified.has(t.id)) {
      showReminderNotification(t, minutesLeft);
      notified.add(t.id);
      changed=true;
    }
  }
  if (changed) saveNotifiedSet(notified);
}

function syncNotifButtonState(){
  const btn = document.getElementById('notifBtn');
  const note = document.getElementById('notifNote');
  if (!('Notification' in window)) {
    if (btn) { btn.disabled=true; btn.textContent='Notifications unsupported'; }
    return;
  }
  if (Notification.permission==='granted') {
    if (btn) { btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Reminders On'; btn.disabled=true; }
    if (note) note.textContent="You'll get notified when a task is due within 15 minutes.";
  } else if (Notification.permission==='denied') {
    if (note) note.textContent='Notifications are blocked - enable them in your browser/site settings.';
  }
}

async function enableReminders(){
  const granted = await requestNotificationPermission();
  const btn = document.getElementById('notifBtn');
  const note = document.getElementById('notifNote');
  if (granted) {
    if (btn) { btn.textContent=''; btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Reminders On'; btn.disabled=true; }
    if (note) note.textContent="You'll get notified when a task is due within 15 minutes.";
    toast('Reminders enabled', 'success');
    checkUpcomingReminders(new Date());
  } else {
    if (note) note.textContent='Notifications were not enabled. You can allow them in your browser/site settings.';
  }
}
window.enableReminders=enableReminders;
window.requestNotificationPermission=requestNotificationPermission;

// RENDER ALL
function renderAll() {
  updateStats();
  updateLeagueUI();
  renderDashTasks();
  renderAIRecs();
  renderUpcoming();
  renderAllTasks();
  renderHabits();
  renderLeaderboard();
  renderXPLog();
  updateProgressRing();
  updateGcalBadge();
  syncNotifButtonState();
}

function updateStats() {
  const now=new Date();
  const pending=tasks.filter(t=>t.status!=='done');
  const urgent=pending.filter(t=>{ const d=new Date(t.deadline); return d>now&&(d-now)<86400000; });
  const overdue=pending.filter(t=>new Date(t.deadline)<now);
  const done=tasks.filter(t=>t.status==='done');
  const today=pending.filter(t=>t.deadline&&new Date(t.deadline).toDateString()===now.toDateString());
  el('urgentCount',  (urgent.length+overdue.length).toString());
  el('todayCount',   today.length.toString());
  el('completedCount',done.length.toString());
  el('totalXPStat',  (player.totalXP||0).toString());
}

function el(id,val) { const e=document.getElementById(id); if(e) e.textContent=val; }

function updateProgressRing() {
  const done=tasks.filter(t=>t.status==='done').length;
  const total=tasks.length||1;
  const pct=Math.round(done/total*100);
  const ring=document.getElementById('progressRing');
  if(ring) ring.setAttribute('stroke-dashoffset',176-176*pct/100);
  el('progressPct',pct+'%');
  el('doneTasks',done.toString());
  el('totalTasks',tasks.length.toString());
}

// TASK CARD
function taskCardHTML(task) {
  const dl=dlLabel(task.deadline);
  const now=new Date();
  const urgent=task.deadline&&(new Date(task.deadline)-now)<3600000&&new Date(task.deadline)>now;
  const isDone=task.status==='done';
  const catE={work:'💼',study:'📚',personal:'🏠',health:'💪',finance:'💰'};
  const xpV=XP_VALUES[task.priority]||20;
  const subs=task.subtasks||[];
  const subsHTML=subs.length?'<div class="subtasks-preview" onclick="event.stopPropagation()">'+
    subs.map(s=>'<div class="subtask-row '+(s.done?'done-sub':'')+'">'+'<button class="subtask-check '+(s.done?'checked':'')+'" onclick="toggleSubtask(\''+task.id+'\',\''+s.id+'\')">'+(s.done?'✓':'')+'</button>'+'<span>'+esc(s.title)+'</span></div>').join('')+'</div>':'';
  return '<div class="task-card p-'+task.priority+' '+(isDone?'done':'')+' '+(urgent&&!isDone?'urgent-pulse':'')+'" onclick="openEditTask(\''+task.id+'\')">'
    +'<button class="task-check '+(isDone?'checked':'')+'" onclick="toggleDone(\''+task.id+'\',event)">'+(isDone?'✓':'')+'</button>'
    +'<div class="task-body">'
    +'<div class="task-title">'+esc(task.title)+'</div>'
    +'<div class="task-meta">'
    +'<span class="task-date '+dl.cls+'">'+dl.text+'</span>'
    +'<span class="task-tag">'+(catE[task.category]||'')+' '+task.category+'</span>'
    +'<span class="xp-badge">+'+xpV+' XP</span>'
    +(subs.length?'<span class="task-tag">'+subs.filter(s=>s.done).length+'/'+subs.length+' subs</span>':'')
    +'</div>'+subsHTML+'</div>'
    +'<div class="task-actions" onclick="event.stopPropagation()">'
    +'<button class="task-act-btn" onclick="openEditTask(\''+task.id+'\')">Edit</button>'
    +'<button class="task-act-btn del" onclick="deleteTask(\''+task.id+'\')">Del</button>'
    +'</div></div>';
}

function sortedTasks(list) {
  const o={critical:0,high:1,medium:2,low:3};
  return [...list].sort((a,b)=>{
    if(a.status==='done'&&b.status!=='done') return 1;
    if(b.status==='done'&&a.status!=='done') return -1;
    if(o[a.priority]!==o[b.priority]) return o[a.priority]-o[b.priority];
    return (a.deadline?new Date(a.deadline):Infinity)-(b.deadline?new Date(b.deadline):Infinity);
  });
}

function renderDashTasks() {
  const e=document.getElementById('dashTaskList');
  if(!e) return;
  const list=sortedTasks(tasks).slice(0,6);
  e.innerHTML=list.length?list.map(taskCardHTML).join(''):'<div class="empty-state"><span class="empty-icon">🎉</span>No tasks yet!</div>';
}

function renderAllTasks() {
  const e=document.getElementById('allTaskList');
  if(!e) return;
  let list=tasks;
  if(currentFilter==='pending')     list=tasks.filter(t=>t.status==='pending');
  if(currentFilter==='in-progress') list=tasks.filter(t=>t.status==='in-progress');
  if(currentFilter==='done')        list=tasks.filter(t=>t.status==='done');
  const q=(document.getElementById('searchInput')?.value||'').toLowerCase();
  if(q) list=list.filter(t=>(t.title+t.desc).toLowerCase().includes(q));
  const sorted=sortedTasks(list);
  e.innerHTML=sorted.length?sorted.map(taskCardHTML).join(''):'<div class="empty-state"><span class="empty-icon">🔍</span>Nothing here.</div>';
}

window.filterByStatus=function(s,btn){
  currentFilter=s;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderAllTasks();
};
window.filterTasks=function(){ renderAllTasks(); };

// SUBTASK
window.toggleSubtask=async function(taskId,subId){
  const t=tasks.find(x=>x.id===taskId);
  if(!t) return;
  const sub=(t.subtasks||[]).find(s=>s.id===subId);
  if(!sub) return;
  sub.done=!sub.done;
  try { if(db) await updateDoc(doc(db,'users',currentUid,'tasks',taskId),{subtasks:t.subtasks}); } catch(e){}
  saveLocal();
  if(sub.done){ await awardXP(XP_SUBTASK,'Subtask: '+sub.title); toast('+'+XP_SUBTASK+' XP - Subtask done!','success'); }
  renderAll();
};

// TASK CRUD
window.openAddTask=function(){
  editingTaskId=null; formSubtasks=[];
  document.getElementById('modalTitle').textContent='Add Task';
  document.getElementById('editTaskId').value='';
  document.getElementById('taskTitle').value='';
  document.getElementById('taskDesc').value='';
  document.getElementById('taskDeadline').value='';
  document.getElementById('taskPriority').value='medium';
  document.getElementById('taskCategory').value='work';
  document.getElementById('taskStatus').value='pending';
  document.getElementById('taskGcal').checked=gcalConnected;
  renderFormSubtasks();
  openModal('taskModal');
};

window.openEditTask=function(id){
  const t=tasks.find(x=>x.id===id);
  if(!t) return;
  editingTaskId=id; formSubtasks=[...(t.subtasks||[])];
  document.getElementById('modalTitle').textContent='Edit Task';
  document.getElementById('editTaskId').value=id;
  document.getElementById('taskTitle').value=t.title;
  document.getElementById('taskDesc').value=t.desc||'';
  document.getElementById('taskDeadline').value=t.deadline?t.deadline.slice(0,16):'';
  document.getElementById('taskPriority').value=t.priority;
  document.getElementById('taskCategory').value=t.category;
  document.getElementById('taskStatus').value=t.status;
  renderFormSubtasks();
  openModal('taskModal');
};

window.addSubtaskToForm=function(){
  const inp=document.getElementById('subtaskInput');
  const val=inp.value.trim();
  if(!val) return;
  formSubtasks.push({id:uid(),title:val,done:false});
  inp.value='';
  renderFormSubtasks();
};

window.removeFormSubtask=function(id){
  formSubtasks=formSubtasks.filter(s=>s.id!==id);
  renderFormSubtasks();
};

function renderFormSubtasks(){
  const e=document.getElementById('subtaskList');
  if(!e) return;
  e.innerHTML=formSubtasks.map(s=>'<div class="subtask-form-item"><span>'+esc(s.title)+'</span><button onclick="removeFormSubtask(\''+s.id+'\')">x</button></div>').join('');
}

window.saveTask=async function(){
  const title=document.getElementById('taskTitle').value.trim();
  if(!title){ toast('Enter a task title','error'); return; }
  const desc    =document.getElementById('taskDesc').value.trim();
  const deadline=document.getElementById('taskDeadline').value;
  const priority=document.getElementById('taskPriority').value;
  const category=document.getElementById('taskCategory').value;
  const status  =document.getElementById('taskStatus').value;
  const addGcal =document.getElementById('taskGcal').checked;

  if(editingTaskId){
    const prev=tasks.find(t=>t.id===editingTaskId);
    const wasntDone=prev?.status!=='done';
    Object.assign(prev,{title,desc,deadline,priority,category,status,subtasks:formSubtasks});
    try { if(db) await updateDoc(doc(db,'users',currentUid,'tasks',editingTaskId),prev); } catch(e){}
    saveLocal();
    if(wasntDone&&status==='done') await handleCompletion(prev);
    toast('Task updated','success');
  } else {
    const task={title,desc,deadline,priority,category,status,subtasks:formSubtasks,penalised:false,created:new Date().toISOString()};
    const id=uid();
    try { if(db) await setDoc(doc(db,'users',currentUid,'tasks',id),task); } catch(e){}
    tasks.push({id,...task});
    saveLocal();
    if(addGcal&&gcalConnected&&deadline) addToGCal({id,...task});
    toast('Task added','success');
  }
  closeModal('taskModal');
  renderAll();
};

async function handleCompletion(task){
  const now=new Date();
  const dl=task.deadline?new Date(task.deadline):null;
  let xp=XP_VALUES[task.priority]||20;
  if(dl&&now<=dl) xp+=XP_EARLY;
  const allSubsDone=(task.subtasks||[]).length>0&&(task.subtasks||[]).every(s=>s.done);
  if(allSubsDone) xp+=10;
  await awardXP(xp,'Completed: '+task.title);
  toast('Task complete! +'+xp+' XP','success');
}

window.toggleDone=async function(id,e){
  e.stopPropagation();
  const t=tasks.find(x=>x.id===id);
  if(!t) return;
  const wasDone=t.status==='done';
  t.status=wasDone?'pending':'done';
  try { if(db) await updateDoc(doc(db,'users',currentUid,'tasks',id),{status:t.status}); } catch(e){}
  saveLocal();
  if(!wasDone) await handleCompletion(t);
  renderAll();
};

window.deleteTask=async function(id){
  if(!confirm('Delete this task?')) return;
  tasks=tasks.filter(t=>t.id!==id);
  try { if(db) await deleteDoc(doc(db,'users',currentUid,'tasks',id)); } catch(e){}
  saveLocal();
  renderAll();
  toast('Task deleted');
};

// AI RECS
function renderAIRecs(){
  const now=new Date();
  const pending=tasks.filter(t=>t.status!=='done');
  const overdue=pending.filter(t=>new Date(t.deadline)<now);
  const critical=pending.filter(t=>t.priority==='critical');
  const recs=[];
  if(overdue.length)   recs.push({title:'Overdue Alert',    body:overdue.length+' task'+(overdue.length>1?'s':'')+' overdue. "'+overdue[0].title+'" needs immediate action.'});
  if(critical.length)  recs.push({title:'Critical Focus',   body:'Block 90 min for "'+critical[0].title+'" - your highest-value task.'});
  if(pending.length>5) recs.push({title:'Task Overload',    body:pending.length+' open tasks. Defer or delegate lowest-priority ones.'});
  recs.push({title:'XP Tip',   body:'Complete tasks before deadlines for +'+XP_EARLY+' bonus XP each!'});
  recs.push({title:'Habit Tip',body:'Check in habits daily to maintain streaks and climb leagues.'});
  const e=document.getElementById('aiRecs');
  if(e) e.innerHTML=recs.slice(0,3).map(r=>'<div class="ai-rec-card"><strong>'+r.title+'</strong>'+r.body+'</div>').join('');
}

// UPCOMING
function renderUpcoming(){
  const now=new Date(), in7=addDays(now,7);
  const list=tasks.filter(t=>t.status!=='done'&&t.deadline&&new Date(t.deadline)>=now&&new Date(t.deadline)<=in7)
    .sort((a,b)=>new Date(a.deadline)-new Date(b.deadline)).slice(0,6);
  const e=document.getElementById('upcomingList');
  if(e) e.innerHTML=list.length?list.map(t=>'<div class="upcoming-item"><span class="upcoming-dot" style="background:'+priorityColor(t.priority)+'"></span><span class="upcoming-name">'+esc(t.title)+'</span><span class="upcoming-date">'+dlLabel(t.deadline).text+'</span></div>').join(''):'<p class="no-events">Nothing due in 7 days</p>';
}

// CALENDAR
function renderCalendar(){
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  el('calMonthLabel',months[calMonth]+' '+calYear);
  const firstDay=new Date(calYear,calMonth,1).getDay();
  const daysInM=new Date(calYear,calMonth+1,0).getDate();
  const daysInP=new Date(calYear,calMonth,0).getDate();
  const today=new Date();
  let html='';
  for(let i=firstDay-1;i>=0;i--) html+='<div class="cal-day other-month"><span>'+(daysInP-i)+'</span></div>';
  for(let d=1;d<=daysInM;d++){
    const date=new Date(calYear,calMonth,d);
    const isToday=date.toDateString()===today.toDateString();
    const hasTasks=tasks.some(t=>t.deadline&&new Date(t.deadline).toDateString()===date.toDateString());
    html+='<div class="cal-day '+(isToday?'today':'')+' '+(hasTasks?'has-tasks':'')+'" onclick="calSelectDay('+d+')" data-day="'+d+'"><span>'+d+'</span></div>';
  }
  const total=firstDay+daysInM;
  for(let d=1;d<=(7-(total%7))%7;d++) html+='<div class="cal-day other-month"><span>'+d+'</span></div>';
  const g=document.getElementById('calGrid');
  if(g) g.innerHTML=html;
}

window.changeMonth=function(dir){
  calMonth+=dir;
  if(calMonth>11){calMonth=0;calYear++;}
  if(calMonth<0){calMonth=11;calYear--;}
  renderCalendar();
  const e=document.getElementById('calEvents');
  if(e) e.innerHTML='<p class="no-events">Click a date to see tasks</p>';
};

window.calSelectDay=function(d){
  document.querySelectorAll('.cal-day').forEach(e=>e.classList.remove('selected'));
  document.querySelector('.cal-day[data-day="'+d+'"]')?.classList.add('selected');
  const sel=new Date(calYear,calMonth,d);
  const dayTasks=tasks.filter(t=>t.deadline&&new Date(t.deadline).toDateString()===sel.toDateString());
  const label=sel.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});
  const e=document.getElementById('calEvents');
  if(e) e.innerHTML='<h3>'+label+'</h3>'+(dayTasks.length?dayTasks.map(taskCardHTML).join(''):'<p class="no-events">No tasks this day.</p>');
};

// HABITS
window.openAddHabit=function(){ openModal('habitModal'); };

window.saveHabit=async function(){
  const name=document.getElementById('habitName').value.trim();
  if(!name){ toast('Enter habit name','error'); return; }
  const icon=document.getElementById('habitIcon').value;
  const freq=document.getElementById('habitFreq').value;
  const h={name,icon,freq,streak:0,history:[]};
  const id=uid();
  try { if(db) await setDoc(doc(db,'users',currentUid,'habits',id),h); } catch(e){}
  habits.push({id,...h});
  saveLocal();
  renderHabits();
  closeModal('habitModal');
  toast('Habit added','success');
};

function renderHabits(){
  const e=document.getElementById('habitsGrid');
  if(!e) return;
  const today=new Date().toDateString();
  e.innerHTML=habits.length?habits.map(h=>{
    const doneToday=(h.history||[]).includes(today);
    const last7=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);return (h.history||[]).includes(d.toDateString());});
    return '<div class="habit-card">'
      +'<div class="habit-icon">'+h.icon+'</div>'
      +'<div class="habit-name">'+esc(h.name)+'</div>'
      +'<div class="habit-freq">'+h.freq+'</div>'
      +'<div class="habit-dots">'+last7.map(f=>'<div class="habit-dot '+(f?'filled':'')+'"></div>').join('')+'</div>'
      +'<div class="habit-streak-wrap"><span class="habit-streak-num">'+(h.streak||0)+'</span><span class="habit-streak-lbl"> day streak</span></div>'
      +'<button class="habit-btn '+(doneToday?'done-today':'')+'" onclick="checkHabit(\''+h.id+'\')">'+(doneToday?'Done today':'Mark done')+'</button>'
      +'</div>';
  }).join(''):'<div class="empty-state" style="grid-column:1/-1"><span class="empty-icon">⭐</span>Add your first habit!</div>';
}

window.checkHabit=async function(id){
  const h=habits.find(x=>x.id===id);
  if(!h) return;
  const today=new Date().toDateString();
  if((h.history||[]).includes(today)){ toast('Already logged today!'); return; }
  h.history=[...(h.history||[]),today];
  h.streak=calcStreak(h.history);
  try { if(db) await updateDoc(doc(db,'users',currentUid,'habits',id),{history:h.history,streak:h.streak}); } catch(e){}
  saveLocal();
  await awardXP(XP_HABIT,'Habit: '+h.name);
  renderHabits();
  toast(h.icon+' '+h.name+' - +'+XP_HABIT+' XP! Streak: '+h.streak,'success');
};

function calcStreak(history){
  let streak=0;
  const d=new Date();
  while((history||[]).includes(d.toDateString())){ streak++; d.setDate(d.getDate()-1); }
  return streak;
}

// LEADERBOARD
function renderLeaderboard(){
  const currentLeague=getLeague(player.xp||0);
  const e=document.getElementById('leagueShowcase');
  if(e) e.innerHTML=LEAGUES.map(l=>'<div class="league-tier '+(l.name===currentLeague.name?'current':'')+'">'
    +'<div class="tier-emblem">'+l.emblem+'</div>'
    +'<div class="tier-name">'+l.name+'</div>'
    +'<div class="tier-xp">'+l.minXP+'+ XP</div></div>').join('');

  const entries=[
    {name:'You',xp:player.xp||0,emblem:currentLeague.emblem,you:true},
    {name:'Arjun M.',  xp:1850,emblem:'🌟',you:false},
    {name:'Priya S.',  xp:980, emblem:'👑',you:false},
    {name:'Rahul K.',  xp:540, emblem:'🗡', you:false},
    {name:'Sneha P.',  xp:310, emblem:'⚔', you:false},
    {name:'Vikram T.', xp:90,  emblem:'🛡', you:false},
  ].sort((a,b)=>b.xp-a.xp);

  const ranks=['gold','silver','bronze','','',''];
  const lb=document.getElementById('leaderboardList');
  if(lb) lb.innerHTML=entries.map((e,i)=>'<div class="lb-row '+(e.you?'you':'')+'">'
    +'<span class="lb-rank '+(ranks[i]||'')+'">'+(i+1)+'</span>'
    +'<span class="lb-emblem">'+e.emblem+'</span>'
    +'<span class="lb-name">'+e.name+(e.you?' (You)':'')+'</span>'
    +'<span class="lb-xp">'+e.xp+' XP</span></div>').join('');
}

function renderXPLog(){
  const e=document.getElementById('xpLog');
  if(!e) return;
  if(!xpLog.length){ e.innerHTML='<p class="no-events">No XP activity yet.</p>'; return; }
  e.innerHTML=xpLog.map(e=>'<div class="xp-log-item">'
    +'<span>'+new Date(e.ts).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+'</span>'
    +'<span style="flex:1;color:var(--slate2);font-size:11.5px;padding:0 8px">'+esc(e.reason)+'</span>'
    +'<span class="xp-amt '+(e.amount>=0?'pos':'neg')+'">'+(e.amount>=0?'+':'')+e.amount+' XP</span>'
    +'</div>').join('');
}

// GEMINI
const BRIEFING_CACHE_KEY = 'nx_briefing_cache';
const BRIEFING_MIN_INTERVAL = 5 * 60 * 1000; // 5 min between auto/API calls
const BRIEFING_MANUAL_COOLDOWN = 20 * 1000;   // 20s between manual refresh clicks

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function callGeminiChat(contents,maxTokens=300,attempt=0){
  const resp=await fetch(GEMINI_URL,{
    method:'POST',
    headers:{'Content-Type':'application/json','x-goog-api-key':GEMINI_KEY},
    body:JSON.stringify({contents,generationConfig:{maxOutputTokens:maxTokens,temperature:1.0,topP:0.95}})
  });
  const data=await resp.json();
  if(data.error){
    const retryable = resp.status===503 || resp.status===429;
    if (retryable && attempt<2) {
      await sleep(1000*Math.pow(2,attempt));
      return callGeminiChat(contents,maxTokens,attempt+1);
    }
    throw new Error(data.error.message);
  }
  return data.candidates?.[0]?.content?.parts?.[0]?.text||'';
}

async function callGemini(prompt,maxTokens=200,attempt=0,temperature=0.9){
  const resp=await fetch(GEMINI_URL,{
    method:'POST',
    headers:{'Content-Type':'application/json','x-goog-api-key':GEMINI_KEY},
    body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:maxTokens,temperature,topP:0.95}})
  });
  const data=await resp.json();
  if(data.error){
    // Transient errors (model overloaded / rate-limited) - retry with backoff.
    const retryable = resp.status===503 || resp.status===429;
    if (retryable && attempt<2) {
      await sleep(1000*Math.pow(2,attempt)); // 1s, then 2s
      return callGemini(prompt,maxTokens,attempt+1,temperature);
    }
    throw new Error(data.error.message);
  }
  return data.candidates?.[0]?.content?.parts?.[0]?.text||'';
}

function readBriefingCache(){
  try { return JSON.parse(localStorage.getItem(BRIEFING_CACHE_KEY+':'+currentUid)||'null'); } catch(e){ return null; }
}
function writeBriefingCache(text){
  try { localStorage.setItem(BRIEFING_CACHE_KEY+':'+currentUid, JSON.stringify({text, ts:Date.now()})); } catch(e){}
}

async function generateAIBriefing(force=false){
  const e=document.getElementById('aiBriefing');
  const cache=readBriefingCache();
  const age=cache ? Date.now()-cache.ts : Infinity;

  // Show cached briefing immediately if we have one.
  if (cache && e) e.textContent=cache.text;

  // Manual refresh cooldown - avoid hammering the API on repeated clicks.
  if (force && cache && age < BRIEFING_MANUAL_COOLDOWN) {
    toast('Briefing was just refreshed - try again in a few seconds.', 'error');
    return;
  }

  // Auto (non-forced) calls only hit the API if the cache is stale.
  if (!force && cache && age < BRIEFING_MIN_INTERVAL) return;

  if (e) e.textContent = cache ? cache.text : 'Generating...';

  const now=new Date();
  const pending=tasks.filter(t=>t.status!=='done');
  const overdue=pending.filter(t=>t.deadline&&new Date(t.deadline)<now);
  const dueSoon=pending.filter(t=>t.deadline&&!overdue.includes(t)&&(new Date(t.deadline)-now)<6*3600*1000);
  const league=getLeague(player.xp||0);
  const topTask=pending[0];

  const prompt=
    'You are a sharp, no-fluff productivity coach writing ONE short briefing (2 sentences, under 40 words total) for a dashboard widget.\n\n'
    +'HARD RULES:\n'
    +'- Name at least one specific task by its exact title in quotes.\n'
    +'- Reference a real number from the data below (count of overdue, due-soon, or XP).\n'
    +'- NEVER use these banned filler phrases or anything equivalent: "you can do it", "you got this", "keep grinding", "stay focused", "great job", "let\'s level up".\n'
    +'- Do not restate this previous briefing verbatim, vary your wording: "'+(readBriefingCache()?.text||'')+'"\n\n'
    +'DATA:\n'
    +'- Time: '+now.toLocaleString()+'\n'
    +'- Pending tasks ('+pending.length+'): '+(pending.slice(0,6).map(t=>'"'+t.title+'" ['+t.priority+', due '+(t.deadline?new Date(t.deadline).toLocaleString():'no deadline')+']').join('; ')||'none')+'\n'
    +'- Overdue ('+overdue.length+'): '+(overdue.map(t=>'"'+t.title+'"').join(', ')||'none')+'\n'
    +'- Due within 6h ('+dueSoon.length+'): '+(dueSoon.map(t=>'"'+t.title+'"').join(', ')||'none')+'\n'
    +'- League: '+league.name+', '+(player.xp||0)+' XP\n'
    +(topTask?('- Top priority task right now: "'+topTask.title+'" ['+topTask.priority+']\n'):'');

  try {
    const text=await callGemini(prompt,160,0,1.0);
    const finalText=text||('Start with "'+(topTask?.title||'your top task')+'" - '+overdue.length+' task(s) are already overdue.');
    if(e) e.textContent=finalText;
    writeBriefingCache(finalText);
  } catch(err) {
    const fallback=overdue.length
      ? overdue.length+' task(s) overdue, including "'+overdue[0].title+'". Clear that before anything else.'
      : (topTask ? 'Next up: "'+topTask.title+'" ['+topTask.priority+']. '+pending.length+' tasks remain in your queue.' : 'No pending tasks right now - add one to keep your '+league.name+' streak moving.');
    if(e) e.textContent=fallback;
    // Cache the fallback too, briefly, so a 429 burst doesn't keep retrying every load.
    if (!cache) writeBriefingCache(fallback);
  }
}

window.generateAIBriefing=function(){ generateAIBriefing(true); };

let chatInFlight=false;
let chatHistory=[]; // {role:'user'|'model', text}

window.sendChat=async function(){
  if (chatInFlight) return;
  const input=document.getElementById('chatInput');
  const msg=input.value.trim();
  if(!msg) return;
  input.value='';
  appendChat('user',msg);
  chatHistory.push({role:'user',text:msg});
  const typing=appendChat('ai','...',true);
  chatInFlight=true;

  const now=new Date();
  const pending=tasks.filter(t=>t.status!=='done');
  const overdue=pending.filter(t=>t.deadline&&new Date(t.deadline)<now);
  const doneToday=tasks.filter(t=>t.status==='done'&&t.completedAt&&new Date(t.completedAt).toDateString()===now.toDateString());
  const atRiskHabits=habits.filter(h=>!h.history?.some(d=>new Date(d).toDateString()===now.toDateString()));
  const league=getLeague(player.xp||0);
  const userEmail=(auth?.currentUser?.email)||'the user';

  const contextBlock =
    'CURRENT CONTEXT (use this to give specific, personalized advice referencing actual task/habit names - never generic filler):\n'
    +'- Time: '+now.toLocaleString()+' ('+['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()]+')\n'
    +'- User: '+userEmail+', league "'+league.name+'", '+(player.xp||0)+' XP, '+(player.totalXP||0)+' total XP earned\n'
    +'- Pending tasks ('+pending.length+'): '+(pending.slice(0,8).map(t=>'"'+t.title+'" ['+t.priority+', due '+(t.deadline?new Date(t.deadline).toLocaleString():'no deadline')+']').join('; ')||'none')+'\n'
    +'- Overdue right now ('+overdue.length+'): '+(overdue.map(t=>'"'+t.title+'"').join(', ')||'none')+'\n'
    +'- Completed today: '+(doneToday.map(t=>'"'+t.title+'"').join(', ')||'nothing yet')+'\n'
    +'- Habits: '+(habits.map(h=>'"'+h.name+'" ('+h.streak+'-day streak'+(atRiskHabits.includes(h)?', NOT done today':', done today')+')').join('; ')||'none tracked')+'\n';

  const systemPrompt='You are the Aeris AI Coach, embedded in a gamified productivity app. '
    +'Be warm but direct, like a coach who actually knows this person\'s day. '
    +'Always ground your reply in specifics from the context below (real task names, real numbers, real streaks) instead of generic motivational phrases. '
    +'Directly answer what the user actually asked or said - do not deflect into generic pep talk if they asked something concrete. '
    +'NEVER use these banned filler phrases or close equivalents: "you can do it", "you got this", "keep grinding", "stay focused", "great job", "let\'s level up", "believe in yourself". '
    +'Keep replies to 2-4 sentences. Do not repeat the same phrasing or structure you used earlier in this conversation.\n\n'
    +contextBlock;

  // Build conversation contents: system context as first user turn, then real history.
  const contents=[
    {role:'user',parts:[{text:systemPrompt+'\n\nAcknowledge briefly that you have this context, then wait for my message.'}]},
    {role:'model',parts:[{text:'Got it — I can see your tasks, habits and progress. What\'s up?'}]},
    ...chatHistory.slice(-10).map(h=>({role:h.role==='user'?'user':'model',parts:[{text:h.text}]}))
  ];

  try {
    const text=await callGeminiChat(contents,300);
    typing.remove();
    const reply=text||"Let's focus on \""+(pending[0]?.title||'your next task')+"\" - that's your top priority right now.";
    appendChat('ai',reply);
    chatHistory.push({role:'model',text:reply});
  } catch(err) {
    typing.remove();
    const fallback=overdue.length
      ? overdue.length+' task(s) overdue, including "'+overdue[0].title+'". Let\'s tackle that first.'
      : 'Focus on "'+(pending[0]?.title||'your top task')+'" for the next 25 minutes, then take a 5 min break.';
    appendChat('ai',fallback);
    chatHistory.push({role:'model',text:fallback});
  } finally {
    chatInFlight=false;
  }
};

window.quickChat=function(msg){
  document.getElementById('chatInput').value=msg;
  window.sendChat();
};

function appendChat(role,text,isTyping=false){
  const c=document.getElementById('chatMessages');
  if(!c) return null;
  const div=document.createElement('div');
  div.className='chat-msg '+role+(isTyping?' chat-typing':'');
  div.innerHTML='<div class="chat-avatar">'+(role==='ai'?'A':'U')+'</div><div class="chat-bubble">'+esc(text)+'</div>';
  c.appendChild(div);
  c.scrollTop=c.scrollHeight;
  return div;
}

// GOOGLE CALENDAR
function loadGoogleApi(){
  const s1=document.createElement('script');
  s1.src='https://accounts.google.com/gsi/client';
  s1.onload=()=>{
    tokenClient=google.accounts.oauth2.initTokenClient({
      client_id:GCAL_CLIENT_ID, scope:GCAL_SCOPE, callback:handleGCalToken
    });
  };
  document.head.appendChild(s1);
  const s2=document.createElement('script');
  s2.src='https://apis.google.com/js/api.js';
  s2.onload=()=>gapi.load('client',async()=>{
    await gapi.client.init({apiKey:GCAL_API_KEY,discoveryDocs:['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest']});
  });
  document.head.appendChild(s2);
}

window.connectGoogleCalendar=function(){
  if(tokenClient) tokenClient.requestAccessToken({prompt:'consent'});
  else toast('Google API still loading, try again','error');
};

function handleGCalToken(resp){
  if(resp.error){ toast('Calendar auth failed','error'); return; }
  accessToken=resp.access_token;
  gcalConnected=true;
  const btn=document.getElementById('gcalBtn');
  if(btn){ btn.textContent='Calendar Connected'; btn.classList.add('connected'); }
  const st=document.getElementById('gcalStatus');
  if(st){ st.textContent='Sync active'; st.classList.remove('hidden'); }
  updateGcalBadge();
  toast('Google Calendar connected','success');
}

async function addToGCal(task){
  if(!gcalConnected||!accessToken) return;
  const start=new Date(task.deadline);
  const end=new Date(start.getTime()+3600000);
  const event={
    summary:task.title,
    description:(task.desc||'')+'\n\nPriority: '+task.priority+' | XP: '+XP_VALUES[task.priority]+' | Aeris App',
    start:{dateTime:start.toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone},
    end:{dateTime:end.toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone},
    reminders:{useDefault:false,overrides:[{method:'popup',minutes:30},{method:'email',minutes:60}]},
    colorId:{critical:'11',high:'6',medium:'9',low:'2'}[task.priority]||'9'
  };
  try {
    const r=await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events',{
      method:'POST',headers:{'Authorization':'Bearer '+accessToken,'Content-Type':'application/json'},body:JSON.stringify(event)
    });
    const d=await r.json();
    if(d.id) toast('Added to Google Calendar','success');
  } catch(e){ toast('Calendar sync failed','error'); }
}

function updateGcalBadge(){
  const b=document.getElementById('gcalBadge');
  if(!b) return;
  if(gcalConnected){ b.textContent='Connected'; b.className='badge-gcal ok'; }
  else { b.textContent='Not connected'; b.className='badge-gcal'; }
}

// NAV
function setupNav(){
  const titles={dashboard:'Dashboard',tasks:'My Tasks',calendar:'Calendar',habits:'Habits & Goals',leaderboard:'League & XP','ai-coach':'AI Coach'};
  const subs={dashboard:"Here's what needs your attention",tasks:'Manage and track all tasks',calendar:'Your schedule at a glance',habits:'Build consistency daily',leaderboard:'Climb the ranks, earn glory','ai-coach':'Your personal Gemini AI coach'};
  document.querySelectorAll('.nav-item').forEach(navEl=>{
    navEl.addEventListener('click',e=>{
      e.preventDefault();
      const view=navEl.dataset.view;
      document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
      navEl.classList.add('active');
      document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
      const viewEl=document.getElementById('view-'+view);
      if(viewEl) viewEl.classList.add('active');
      el('viewTitle',titles[view]||view);
      el('viewSubtitle',subs[view]||'');
      if(view==='calendar') renderCalendar();
      if(view==='habits')   renderHabits();
      if(view==='tasks')    renderAllTasks();
      if(view==='leaderboard'){ renderLeaderboard(); renderXPLog(); }
    });
  });
}

// MODAL
window.openModal =function(id){ const e=document.getElementById(id); if(e) e.classList.add('open'); };
window.closeModal=function(id){ const e=document.getElementById(id); if(e) e.classList.remove('open'); };

// TOAST
function toast(msg,type=''){
  const e=document.getElementById('toast');
  if(!e) return;
  e.textContent=msg; e.className='toast '+type+' show';
  setTimeout(()=>{ e.className='toast'; },3000);
}
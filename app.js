import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, updateProfile, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, deleteDoc, getDocs, query, where, orderBy, onSnapshot, setDoc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD1LtTOBsbEoeg6OJzb9hCN2HfsxOGTV4I",
  authDomain: "monify-3c055.firebaseapp.com",
  projectId: "monify-3c055",
  storageBucket: "monify-3c055.firebasestorage.app",
  messagingSenderId: "295735096915",
  appId: "1:295735096915:web:2f9cbdd92fd561afa8f8a6"
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

// Sesión persistente — no cierra aunque cierres la app
setPersistence(auth, browserLocalPersistence);

// ── CATS ──────────────────────────────────────────────
const CATS = [
  {id:'comida',    label:'Comida',     emoji:'🍔'},
  {id:'transporte',label:'Transporte', emoji:'🚌'},
  {id:'escuela',   label:'Escuela',    emoji:'🎓'},
  {id:'papeleria', label:'Papelería',  emoji:'📋'},
  {id:'ropa',      label:'Ropa',       emoji:'👕'},
  {id:'pareja',    label:'Pareja',     emoji:'💑'},
  {id:'salidas',   label:'Salidas',    emoji:'🗺️'},
  {id:'otro',      label:'Otro',       emoji:'📦'},
];
const CAT_COLORS = {comida:'#e0a8c0',transporte:'#7ecfcf',escuela:'#e8c97a',papeleria:'#85c9a0',ropa:'#b5a8e0',pareja:'#f0a0c0',salidas:'#a8d8e0',otro:'#a09dba'};

// ── STATE ─────────────────────────────────────────────
let currentUser = null;
let quincenas = [];
let movimientos = [];
let currentQuincenaId = null;
let currentType = 'gasto';
let currentDestino = 'ahorro';
let selectedCat = 'otro';
let currentTab = 'movimientos';
let resumenTab = 'general';
let unsubMovs = null;
let unsubQs = null;

// ── UTILS ─────────────────────────────────────────────
const fmt = n => '$' + Math.abs(n).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtDate = s => { const [y,mo,d]=s.split('-'); const ms=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']; return `${parseInt(d)} ${ms[parseInt(mo)-1]}`; };
const today = () => new Date().toISOString().split('T')[0];
const quincenaLabel = q => q ? `${fmtDate(q.inicio)} – ${fmtDate(q.fin)}` : '--';
const getInitials = n => n ? n.trim().split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) : '?';

function showToast(msg, dur=2800) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
window.openModal = openModal;
window.closeModal = closeModal;

document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => { if(e.target===o) o.classList.remove('open'); });
});

// ── AUTH MODE ─────────────────────────────────────────
window.switchAuthMode = mode => {
  document.getElementById('login-fields').style.display = mode==='login'?'block':'none';
  document.getElementById('register-fields').style.display = mode==='register'?'block':'none';
  document.getElementById('verify-banner').style.display = 'none';
  document.getElementById('tab-login').className = 'auth-tab-btn '+(mode==='login'?'active-tab':'inactive-tab');
  document.getElementById('tab-register').className = 'auth-tab-btn '+(mode==='register'?'active-tab':'inactive-tab');
};

document.getElementById('reg-pass').addEventListener('input', function() {
  const v=this.value, hasS=/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(v), has6=v.length>=6;
  const h=document.getElementById('pass-hint');
  if(!v){h.textContent='';return;}
  if(!has6){h.style.color='var(--red)';h.textContent='✗ Mínimo 6 caracteres';}
  else if(!hasS){h.style.color='var(--amber)';h.textContent='⚠ Agrega al menos 1 especial (!@#$...)';}
  else{h.style.color='var(--green)';h.textContent='✓ Contraseña válida';}
});

// ── GOOGLE ────────────────────────────────────────────
window.loginGoogle = async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch(e) { showToast('Error al iniciar con Google 😕'); }
};

// ── EMAIL LOGIN ───────────────────────────────────────
window.loginEmail = async () => {
  const email=document.getElementById('auth-email').value.trim();
  const pass=document.getElementById('auth-pass').value;
  if(!email||!pass){showToast('Completa correo y contraseña');return;}
  try {
    const cred = await signInWithEmailAndPassword(auth,email,pass);
    if(!cred.user.emailVerified){
      await signOut(auth);
      const b=document.getElementById('verify-banner');
      b.style.display='block';
      b.textContent='📧 Aún no verificas tu correo. Revisa tu bandeja de entrada.';
    }
  } catch(e) { showToast(e.code==='auth/invalid-credential'?'Correo o contraseña incorrectos':'Error al iniciar sesión'); }
};

// ── REGISTER ─────────────────────────────────────────
window.registerEmail = async () => {
  const username=document.getElementById('reg-username').value.trim();
  const email=document.getElementById('reg-email').value.trim();
  const pass=document.getElementById('reg-pass').value;
  if(!username){showToast('Ingresa un nombre de usuario');return;}
  if(!email){showToast('Ingresa tu correo');return;}
  if(pass.length<6){showToast('Mínimo 6 caracteres en la contraseña');return;}
  if(!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pass)){showToast('Agrega al menos 1 carácter especial');return;}
  try {
    const cred=await createUserWithEmailAndPassword(auth,email,pass);
    await updateProfile(cred.user,{displayName:username});
    await setDoc(doc(db,'users',cred.user.uid),{username,email,createdAt:Date.now()});
    await sendEmailVerification(cred.user);
    await signOut(auth);
    ['reg-username','reg-email','reg-pass'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('pass-hint').textContent='';
    switchAuthMode('login');
    const b=document.getElementById('verify-banner');
    b.style.display='block';
    b.textContent='✅ ¡Cuenta creada! Revisa tu correo y confírmalo para poder entrar.';
  } catch(e) {
    showToast(e.code==='auth/email-already-in-use'?'Ya existe una cuenta con ese correo':'Error: '+e.message);
  }
};

window.resetPass = async () => {
  const email=document.getElementById('auth-email').value.trim();
  if(!email){showToast('Escribe tu correo primero');return;}
  try { await sendPasswordResetEmail(auth,email); showToast('Correo de recuperación enviado 📧'); }
  catch(e){ showToast('Error al enviar correo'); }
};

// ── CONFIRM LOGOUT ────────────────────────────────────
window.confirmLogout = () => {
  showConfirm('¿Cerrar sesión?','Tendrás que volver a iniciar sesión la próxima vez.','↩️',async()=>{
    if(unsubMovs)unsubMovs(); if(unsubQs)unsubQs();
    closeModal('modal-perfil');
    await signOut(auth);
  },'btn-danger');
};

// ── AUTH STATE ────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  document.getElementById('loader').style.display='none';
  if(user && user.emailVerified){
    currentUser=user;
    const snap=await getDoc(doc(db,'users',user.uid));
    const username=snap.exists()?snap.data().username:(user.displayName||user.email.split('@')[0]);
    setUserUI(username, user.email);
    document.getElementById('auth-screen').style.display='none';
    const am=document.getElementById('app-main');
    am.style.display='flex'; am.style.flexDirection='column';
    startListeners();
  } else {
    if(user && !user.emailVerified) await signOut(auth);
    currentUser=null; quincenas=[]; movimientos=[]; currentQuincenaId=null;
    document.getElementById('app-main').style.display='none';
    document.getElementById('auth-screen').style.display='flex';
  }
});

function setUserUI(username, email){
  const initials=getInitials(username);
  document.getElementById('user-name-label').textContent=username;
  document.getElementById('avatar-btn').textContent=initials;
  document.getElementById('perfil-avatar').textContent=initials;
  document.getElementById('perfil-name').textContent=username;
  document.getElementById('perfil-email').textContent=email;
  document.getElementById('perfil-username-input').value=username;
  document.getElementById('perfil-email-input').value=email;
}

// ── PROFILE ───────────────────────────────────────────
window.saveProfile = async () => {
  const newName=document.getElementById('perfil-username-input').value.trim();
  if(!newName){showToast('El nombre no puede estar vacío');return;}
  try {
    await updateProfile(currentUser,{displayName:newName});
    await updateDoc(doc(db,'users',currentUser.uid),{username:newName});
    setUserUI(newName,currentUser.email);
    const ind=document.getElementById('save-indicator');
    ind.style.opacity='1';
    setTimeout(()=>ind.style.opacity='0',2500);
    showToast('Perfil actualizado ✅');
  } catch(e){showToast('Error al guardar perfil');}
};

// ── CONFIRM HELPER ────────────────────────────────────
function showConfirm(msg, sub, icon, onOk, btnClass='btn-danger'){
  document.getElementById('confirm-msg').textContent=msg;
  document.getElementById('confirm-sub').textContent=sub;
  document.getElementById('confirm-icon').textContent=icon;
  const btn=document.getElementById('confirm-ok-btn');
  btn.className=btnClass;
  btn.onclick=()=>{ closeModal('modal-confirm'); onOk(); };
  openModal('modal-confirm');
}

// ── FIRESTORE LISTENERS ────────────────────────────────
function startListeners(){
  if(unsubQs)unsubQs(); if(unsubMovs)unsubMovs();
  const uid=currentUser.uid;
  unsubQs=onSnapshot(
    query(collection(db,'quincenas'),where('uid','==',uid),orderBy('inicio','desc')),
    snap=>{
      quincenas=snap.docs.map(d=>({id:d.id,...d.data()}));
      if(!currentQuincenaId && quincenas.length>0) currentQuincenaId=quincenas[0].id;
      startMovsListener();
      render();
    }
  );
}

function startMovsListener(){
  if(unsubMovs)unsubMovs();
  if(!currentQuincenaId){movimientos=[];render();return;}
  unsubMovs=onSnapshot(
    query(collection(db,'movimientos'),where('uid','==',currentUser.uid),where('quincenaId','==',currentQuincenaId),orderBy('fecha','desc')),
    snap=>{movimientos=snap.docs.map(d=>({id:d.id,...d.data()}));render();}
  );
}

// ── QUINCENAS ─────────────────────────────────────────
window.createQuincena = async () => {
  const inicio=document.getElementById('q-inicio').value;
  const fin=document.getElementById('q-fin').value;
  const saldo=parseFloat(document.getElementById('q-saldo').value);
  if(!inicio||!fin||isNaN(saldo)||saldo<0){showToast('Completa todos los campos');return;}
  // Detectar duplicado
  const dup=quincenas.find(q=>q.inicio===inicio && q.fin===fin);
  if(dup){showToast('⚠️ Ya tienes una quincena con esas fechas');return;}
  try {
    const ref=await addDoc(collection(db,'quincenas'),{uid:currentUser.uid,inicio,fin,saldo,createdAt:Date.now()});
    currentQuincenaId=ref.id;
    closeModal('modal-quincena');
    showToast('🎉 ¡Quincena creada exitosamente!');
  } catch(e){showToast('Error al guardar');}
};

window.selectQuincena = id => {
  currentQuincenaId=id; startMovsListener(); closeModal('modal-quincena'); render();
};

window.openEditQuincena = id => {
  const q=quincenas.find(x=>x.id===id); if(!q)return;
  document.getElementById('edit-q-id').value=id;
  document.getElementById('edit-q-inicio').value=q.inicio;
  document.getElementById('edit-q-fin').value=q.fin;
  document.getElementById('edit-q-saldo').value=q.saldo;
  closeModal('modal-quincena');
  openModal('modal-edit-q');
};

window.confirmEditQuincena = () => {
  const id=document.getElementById('edit-q-id').value;
  const inicio=document.getElementById('edit-q-inicio').value;
  const fin=document.getElementById('edit-q-fin').value;
  const saldo=parseFloat(document.getElementById('edit-q-saldo').value);
  if(!inicio||!fin||isNaN(saldo)){showToast('Completa todos los campos');return;}
  showConfirm('¿Guardar cambios en esta quincena?','Los saldos se recalcularán con el nuevo monto inicial.','✏️',async()=>{
    try {
      await updateDoc(doc(db,'quincenas',id),{inicio,fin,saldo});
      closeModal('modal-edit-q');
      showToast('✅ Quincena actualizada');
    } catch(e){showToast('Error al actualizar');}
  },'btn-warn');
};

window.confirmDeleteQuincena = id => {
  const q=quincenas.find(x=>x.id===id); if(!q)return;
  showConfirm(
    `¿Eliminar quincena ${quincenaLabel(q)}?`,
    'Se eliminarán también todos sus movimientos. Esta acción no se puede deshacer.',
    '🗑️',
    async()=>{
      try {
        // Delete all movimientos of this quincena
        const snap=await getDocs(query(collection(db,'movimientos'),where('quincenaId','==',id)));
        const batch=snap.docs.map(d=>deleteDoc(d.ref));
        await Promise.all(batch);
        await deleteDoc(doc(db,'quincenas',id));
        if(currentQuincenaId===id){
          currentQuincenaId=null;
          if(unsubMovs)unsubMovs();
          movimientos=[];
        }
        showToast('🗑️ Quincena eliminada');
      } catch(e){showToast('Error al eliminar');}
    }
  );
};

function renderQuincenaList(){
  const el=document.getElementById('quincena-list');
  if(quincenas.length===0){el.innerHTML='<div style="color:var(--text3);font-size:13px;margin-bottom:16px">Sin quincenas aún.</div>';return;}
  el.innerHTML=quincenas.map(q=>{
    const isActive=q.id===currentQuincenaId;
    const gastos=movimientos.filter(m=>m.quincenaId===q.id&&m.type==='gasto').reduce((a,m)=>a+m.monto,0);
    return `<div class="quincena-item ${isActive?'active-q':''}">
      <div style="flex:1;cursor:pointer" onclick="selectQuincena('${q.id}')">
        <div class="quincena-item-title">${quincenaLabel(q)} ${isActive?'<span style="color:var(--teal);font-size:12px">✓ activa</span>':''}</div>
        <div class="quincena-item-sub">Inicio: ${fmt(q.saldo)} · Gastado: ${fmt(gastos)}</div>
      </div>
      <div class="quincena-actions">
        <button class="q-action-btn" onclick="openEditQuincena('${q.id}')" title="Editar">✏️</button>
        <button class="q-action-btn" onclick="confirmDeleteQuincena('${q.id}')" title="Eliminar">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

// ── MOVIMIENTOS ───────────────────────────────────────
window.saveMovimiento = async () => {
  const monto=parseFloat(document.getElementById('input-monto').value);
  if(isNaN(monto)||monto<=0){showToast('Ingresa un monto válido');return;}
  const desc=document.getElementById('input-desc').value.trim();
  const fecha=document.getElementById('input-fecha').value||today();
  const destino=currentType==='ingreso'?currentDestino:'gasto';
  try {
    await addDoc(collection(db,'movimientos'),{
      uid:currentUser.uid, quincenaId:currentQuincenaId,
      monto, desc, fecha, cat:selectedCat,
      type:currentType, destino, createdAt:Date.now()
    });
    closeModal('modal-add');
    if(currentType==='gasto') showToast('💸 Gasto registrado');
    else if(destino==='ahorro') showToast('🌱 Extra guardado en tu ahorro');
    else showToast('💰 Extra sumado a tu disponible');
  } catch(e){showToast('Error al guardar');}
};

window.showDetail = id => {
  const m=movimientos.find(x=>x.id===id); if(!m)return;
  const cat=CATS.find(c=>c.id===m.cat)||CATS[7];
  const isAhorro=m.type==='ingreso'&&m.destino==='ahorro';
  const isDisp=m.type==='ingreso'&&m.destino==='disponible';
  document.getElementById('detail-title').textContent=m.desc||cat.label;
  document.getElementById('detail-content').innerHTML=`
    <div style="text-align:center;padding:12px 0 20px">
      <div style="font-size:48px;margin-bottom:8px">${cat.emoji}</div>
      <div style="font-size:32px;font-weight:600;color:${m.type==='gasto'?'var(--red)':isAhorro?'var(--teal)':'var(--green)'}">${m.type==='gasto'?'-':'+'}${fmt(m.monto)}</div>
      <div style="font-size:13px;color:var(--text3);margin-top:6px">${cat.label} · ${fmtDate(m.fecha)}</div>
      ${m.type==='ingreso'?`<div style="font-size:12px;margin-top:4px;color:${isAhorro?'var(--teal)':'var(--green)'}">${isAhorro?'🌱 Fue al ahorro':'💰 Fue al disponible'}</div>`:''}
      ${m.desc?`<div style="font-size:14px;color:var(--text2);margin-top:8px">${m.desc}</div>`:''}
    </div>`;
  document.getElementById('detail-delete-btn').onclick=()=>{
    showConfirm('¿Eliminar este movimiento?','','🗑️',async()=>{
      await deleteDoc(doc(db,'movimientos',id));
      closeModal('modal-detail');
      showToast('Movimiento eliminado');
    });
  };
  openModal('modal-detail');
};

// ── RENDER ────────────────────────────────────────────
function getCurrentQ(){return quincenas.find(q=>q.id===currentQuincenaId)||null;}

function updateHeader(){
  const q=getCurrentQ();
  document.getElementById('current-quincena-label').textContent=q?quincenaLabel(q):'Sin quincena';
  const gastos=movimientos.filter(m=>m.type==='gasto').reduce((a,m)=>a+m.monto,0);
  const extrasDisp=movimientos.filter(m=>m.type==='ingreso'&&m.destino==='disponible').reduce((a,m)=>a+m.monto,0);
  const ahorrado=movimientos.filter(m=>m.type==='ingreso'&&m.destino==='ahorro').reduce((a,m)=>a+m.monto,0);
  const inicial=q?q.saldo:0;
  const disponible=inicial-gastos+extrasDisp;
  document.getElementById('saldo-inicial-display').textContent=fmt(inicial);
  document.getElementById('saldo-actual-display').textContent=fmt(disponible);
  document.getElementById('total-gastado-display').textContent=fmt(gastos);
  document.getElementById('total-ahorrado-display').textContent=fmt(ahorrado);
  const pct=inicial>0?Math.min(100,Math.round((gastos/inicial)*100)):0;
  document.getElementById('progress-pct').textContent=pct+'%';
  const fill=document.getElementById('progress-fill');
  fill.style.width=pct+'%';
  fill.className='progress-bar-fill'+(pct>75?' danger':'');
  document.getElementById('savings-text').innerHTML=inicial>0
    ?`💡 Si apartas <strong>${fmt(inicial*0.2)}</strong> (20%) desde el inicio, ahorras sin sentirlo.`
    :'Crea una quincena para ver tu sugerencia de ahorro.';
}

function renderMovimientos(){
  const content=document.getElementById('main-content');
  const q=getCurrentQ();
  if(!q){content.innerHTML='<div class="empty-state"><div class="empty-state-icon">📅</div><p>No tienes ninguna quincena.<br>Toca el botón de fecha arriba.</p></div>';return;}
  if(movimientos.length===0){content.innerHTML='<div class="empty-state"><div class="empty-state-icon">💸</div><p>Sin movimientos aún.<br>Toca el botón de abajo.</p></div>';return;}
  const byDay={};
  movimientos.forEach(m=>{if(!byDay[m.fecha])byDay[m.fecha]=[];byDay[m.fecha].push(m);});
  let html='';
  Object.keys(byDay).sort((a,b)=>b.localeCompare(a)).forEach(fecha=>{
    html+=`<div class="day-group"><div class="day-label">${fecha===today()?'🟢 Hoy · ':''}${fmtDate(fecha)}</div>`;
    byDay[fecha].forEach(m=>{
      const cat=CATS.find(c=>c.id===m.cat)||CATS[7];
      const isAhorro=m.type==='ingreso'&&m.destino==='ahorro';
      const isDisp=m.type==='ingreso'&&m.destino==='disponible';
      const amtClass=m.type==='gasto'?'':isAhorro?'ingreso-ahorro':'ingreso-disp';
      html+=`<div class="gasto-item" onclick="showDetail('${m.id}')">
        <div class="gasto-icon">${cat.emoji}</div>
        <div class="gasto-info">
          <div class="gasto-desc">${m.desc||cat.label}</div>
          <div class="gasto-cat">${cat.label}${isAhorro?' · 🌱 Ahorro':isDisp?' · 💰 Extra':''}</div>
        </div>
        <div class="gasto-amount ${amtClass}">${m.type==='gasto'?'-':'+'}${fmt(m.monto)}</div>
      </div>`;
    });
    html+='</div>';
  });
  content.innerHTML=html;
}

function renderResumen(){
  const content=document.getElementById('main-content');
  const q=getCurrentQ();
  if(!q){content.innerHTML='<div class="empty-state"><p>Crea una quincena primero.</p></div>';return;}
  const gastos=movimientos.filter(m=>m.type==='gasto');
  const total=gastos.reduce((a,m)=>a+m.monto,0);
  const byCat={};
  CATS.forEach(c=>{byCat[c.id]=[];});
  gastos.forEach(m=>{if(!byCat[m.cat])byCat[m.cat]=[];byCat[m.cat].push(m);});
  const tabs=`<div class="resumen-tabs">
    <div class="resumen-tab ${resumenTab==='general'?'active':''}" onclick="switchResumenTab('general')">General</div>
    <div class="resumen-tab ${resumenTab==='categoria'?'active':''}" onclick="switchResumenTab('categoria')">Por categoría</div>
  </div>`;
  if(resumenTab==='general'){
    const sorted=CATS.filter(c=>byCat[c.id].length>0).sort((a,b)=>byCat[b.id].reduce((x,m)=>x+m.monto,0)-byCat[a.id].reduce((x,m)=>x+m.monto,0));
    let rows=sorted.map(c=>{
      const t=byCat[c.id].reduce((a,m)=>a+m.monto,0);
      const pct=total>0?Math.round((t/total)*100):0;
      return `<div class="resumen-row">
        <div class="resumen-row-label"><div class="cat-dot" style="background:${CAT_COLORS[c.id]}"></div>${c.emoji} ${c.label}</div>
        <div style="font-size:13px;font-weight:500;color:${CAT_COLORS[c.id]}">${fmt(t)} <span style="color:var(--text3);font-size:11px">${pct}%</span></div>
      </div>`;
    }).join('');
    if(!rows)rows='<div style="color:var(--text3);font-size:13px;text-align:center;padding:20px">Sin gastos registrados</div>';
    content.innerHTML=tabs+`
      <div class="resumen-card"><div class="resumen-title">Gastos por categoría</div>${rows}</div>
      <div class="resumen-card">
        <div class="resumen-title">Total gastado</div>
        <div style="font-size:28px;font-weight:600;color:var(--red);text-align:center;padding:10px 0">${fmt(total)}</div>
        <div style="font-size:12px;color:var(--text3);text-align:center">${gastos.length} movimiento${gastos.length!==1?'s':''}</div>
      </div>`;
  } else {
    const catCards=CATS.filter(c=>byCat[c.id].length>0).map(c=>{
      const movs=byCat[c.id].sort((a,b)=>b.fecha.localeCompare(a.fecha));
      const t=movs.reduce((a,m)=>a+m.monto,0);
      const items=movs.map(m=>`<div class="cat-mov-item">
        <div>
          <div style="font-size:13px;color:var(--text)">${m.desc||c.label}</div>
          <div style="font-size:11px;color:var(--text3)">${fmtDate(m.fecha)}</div>
        </div>
        <div style="font-size:13px;font-weight:600;color:var(--red)">-${fmt(m.monto)}</div>
      </div>`).join('');
      return `<div class="cat-detail-card">
        <div class="cat-detail-header">
          <div class="cat-detail-emoji">${c.emoji}</div>
          <div><div class="cat-detail-name">${c.label}</div><div class="cat-detail-total">${fmt(t)} total · ${movs.length} movimiento${movs.length!==1?'s':''}</div></div>
        </div>
        ${items}
      </div>`;
    }).join('');
    content.innerHTML=tabs+(catCards||'<div class="empty-state"><p>Sin gastos registrados</p></div>');
  }
}

window.switchResumenTab = tab => { resumenTab=tab; renderResumen(); };

function renderAhorro(){
  const q=getCurrentQ();
  const content=document.getElementById('main-content');
  const inicial=q?q.saldo:0;
  const gastos=movimientos.filter(m=>m.type==='gasto').reduce((a,m)=>a+m.monto,0);
  const extrasDisp=movimientos.filter(m=>m.type==='ingreso'&&m.destino==='disponible').reduce((a,m)=>a+m.monto,0);
  const ahorradoTotal=movimientos.filter(m=>m.type==='ingreso'&&m.destino==='ahorro').reduce((a,m)=>a+m.monto,0);
  const disponible=Math.max(0,inicial-gastos+extrasDisp);
  const sugerido=Math.round(inicial*0.2);
  const dash=Math.PI*2*68;
  const ahorroMovs=movimientos.filter(m=>m.type==='ingreso'&&m.destino==='ahorro').sort((a,b)=>b.fecha.localeCompare(a.fecha));
  const histHTML=ahorroMovs.length>0?ahorroMovs.map(m=>`
    <div class="ahorro-hist-item">
      <div><div style="font-size:13px;color:var(--text)">${m.desc||'Ahorro'}</div><div style="font-size:11px;color:var(--text3)">${fmtDate(m.fecha)}</div></div>
      <div style="font-size:13px;font-weight:600;color:var(--green)">+${fmt(m.monto)}</div>
    </div>`).join('')
    :'<div style="color:var(--text3);font-size:13px;text-align:center;padding:16px 0">Aún no tienes ahorros registrados 🌱</div>';

  content.innerHTML=`
    <div class="ahorro-saved-card">
      <div class="ahorro-saved-label">💰 Total ahorrado esta quincena</div>
      <div class="ahorro-saved-amount">${fmt(ahorradoTotal)}</div>
      <div class="ahorro-saved-sub">${ahorroMovs.length} depósito${ahorroMovs.length!==1?'s':''} al ahorro</div>
    </div>
    <div style="text-align:center;padding:10px 0 16px">
      <div style="width:140px;height:140px;border-radius:50%;border:3px solid var(--bg3);display:flex;align-items:center;justify-content:center;flex-direction:column;margin:0 auto 16px;position:relative;">
        <svg width="146" height="146" style="position:absolute;top:-3px;left:-3px;transform:rotate(-90deg)">
          <circle cx="73" cy="73" r="68" fill="none" stroke="var(--bg4)" stroke-width="6"/>
          <circle cx="73" cy="73" r="68" fill="none" stroke="var(--teal)" stroke-width="6"
            stroke-dasharray="${dash}" stroke-dashoffset="${dash*0.8}" stroke-linecap="round" id="ring-circle"/>
        </svg>
        <div style="position:relative;text-align:center">
          <div style="font-size:28px;font-weight:600;color:var(--teal)" id="ring-pct">20%</div>
          <div style="font-size:11px;color:var(--text3)">sugerido</div>
        </div>
      </div>
    </div>
    <div class="ahorro-tip">🎯 <strong>Meta sugerida:</strong> apartar <strong>${fmt(sugerido)}</strong> por quincena (20%). En 12 meses tendrías aprox. <strong>${fmt(sugerido*24)}</strong>.</div>
    <div class="ahorro-tip" style="border-color:rgba(126,207,207,0.2)">💳 <strong>Disponible hoy:</strong> podrías guardar hasta <strong style="color:var(--teal)">${fmt(disponible)}</strong>.</div>
    <div class="section-title">Ajusta tu meta</div>
    <div style="padding:0 2px">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text3);margin-bottom:8px">
        <span>Porcentaje a ahorrar</span>
        <span id="slider-pct-label" style="color:var(--teal);font-weight:600">20%</span>
      </div>
      <input type="range" min="5" max="50" step="5" value="20" id="ahorro-slider">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text3)">
        <span id="slider-amount-label">${fmt(sugerido)} / quincena</span>
        <span id="slider-anual-label">${fmt(sugerido*24)} / año</span>
      </div>
    </div>
    <div class="section-title">Historial de ahorro</div>
    <div class="resumen-card">${histHTML}</div>`;

  document.getElementById('ahorro-slider').addEventListener('input',function(){
    const pct=parseInt(this.value), amt=Math.round(inicial*pct/100);
    document.getElementById('slider-pct-label').textContent=pct+'%';
    document.getElementById('ring-pct').textContent=pct+'%';
    document.getElementById('slider-amount-label').textContent=fmt(amt)+' / quincena';
    document.getElementById('slider-anual-label').textContent=fmt(amt*24)+' / año';
  });
}

function render(){
  updateHeader();
  if(currentTab==='movimientos')renderMovimientos();
  else if(currentTab==='resumen')renderResumen();
  else renderAhorro();
}

// ── NAV TABS ──────────────────────────────────────────
document.querySelectorAll('.nav-tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    currentTab=tab.dataset.tab;
    render();
  });
});

// ── FAB ───────────────────────────────────────────────
document.getElementById('fab-btn').addEventListener('click',()=>{
  const q=getCurrentQ();
  if(!q){renderQuincenaList();openModal('modal-quincena');return;}
  currentType='gasto'; currentDestino='ahorro'; selectedCat='otro';
  document.getElementById('input-monto').value='';
  document.getElementById('input-desc').value='';
  document.getElementById('input-fecha').value=today();
  document.getElementById('destino-wrap').style.display='none';
  document.getElementById('cat-wrap').style.display='block';
  renderTypeToggle(); renderCatGrid();
  openModal('modal-add');
});

document.getElementById('quincena-badge-btn').addEventListener('click',()=>{
  renderQuincenaList();
  const d=new Date(),day=d.getDate();
  let inicio,fin;
  if(day<=15){
    inicio=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
    fin=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-15`;
  } else {
    const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
    inicio=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-16`;
    fin=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${last}`;
  }
  document.getElementById('q-inicio').value=inicio;
  document.getElementById('q-fin').value=fin;
  document.getElementById('q-saldo').value='';
  openModal('modal-quincena');
});

// ── HELPERS ───────────────────────────────────────────
function renderTypeToggle(){
  document.getElementById('type-gasto').className='type-btn'+(currentType==='gasto'?' active-gasto':'');
  document.getElementById('type-ingreso').className='type-btn'+(currentType==='ingreso'?' active-ingreso':'');
}
function renderDestinoToggle(){
  document.getElementById('dest-ahorro').className='destino-btn'+(currentDestino==='ahorro'?' active-ahorro':'');
  document.getElementById('dest-disp').className='destino-btn'+(currentDestino==='disponible'?' active-disp':'');
}
function renderCatGrid(){
  document.getElementById('cat-grid').innerHTML=CATS.map(c=>
    `<div class="cat-btn ${selectedCat===c.id?'selected':''}" onclick="selectCat('${c.id}')">
      <span class="cat-emoji">${c.emoji}</span>${c.label}
    </div>`
  ).join('');
}

window.setType = t => {
  currentType=t; renderTypeToggle();
  document.getElementById('destino-wrap').style.display=t==='ingreso'?'block':'none';
  document.getElementById('cat-wrap').style.display=t==='gasto'?'block':'none';
};
window.setDestino = d => { currentDestino=d; renderDestinoToggle(); };
window.selectCat = id => { selectedCat=id; renderCatGrid(); };

renderCatGrid();
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
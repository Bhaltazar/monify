import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, updateProfile, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
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
setPersistence(auth, browserLocalPersistence);

const CATS = [
  {id:'comida',    label:'Comida',     emoji:'🍔'},
  {id:'transporte',label:'Transporte', emoji:'🚌'},
  {id:'escuela',   label:'Escuela',    emoji:'🎓'},
  {id:'papeleria', label:'Papelería',  emoji:'📋'},
  {id:'moto',      label:'Moto',       emoji:'🏍️'},
  {id:'pareja',    label:'Pareja',     emoji:'💑'},
  {id:'salidas',   label:'Salidas',    emoji:'🗺️'},
  {id:'otro',      label:'Otro',       emoji:'📦'},
];
const CAT_COLORS = {comida:'#e0a8c0',transporte:'#7ecfcf',escuela:'#e8c97a',papeleria:'#85c9a0',moto:'#b5a8e0',pareja:'#f0a0c0',salidas:'#a8d8e0',otro:'#a09dba'};

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
let unsubPrestamos = null;
let prestamos = [];
let currentPrestamoId = null;
let editingMovId = null;

const fmt = n => '$' + Math.abs(n).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtDate = s => { const [y,mo,d]=s.split('-'); const ms=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']; return `${parseInt(d)} ${ms[parseInt(mo)-1]}`; };
const today = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
};
const quincenaLabel = q => q ? `${fmtDate(q.inicio)} – ${fmtDate(q.fin)}` : '--';
const getInitials = n => n ? n.trim().split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) : '?';

function showToast(msg, dur=2800) {
  const t = document.getElementById('toast');
  t.classList.remove('show');
  t.textContent = msg;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), dur);
  }));
}
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
window.openModal = openModal;
window.closeModal = closeModal;

document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => { if(e.target===o) o.classList.remove('open'); });
});

// ── AUTH ──────────────────────────────────────────────
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

window.confirmLogout = () => {
  closeModal('modal-perfil');
  setTimeout(() => {
    showConfirm('¿Cerrar sesión?','Tendrás que volver a iniciar sesión la próxima vez.','↩️',async()=>{
      if(unsubMovs)unsubMovs(); if(unsubQs)unsubQs(); if(unsubPrestamos)unsubPrestamos();
      await signOut(auth);
    },'btn-danger');
  }, 350);
};

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

function showConfirm(msg, sub, icon, onOk, btnClass='btn-danger'){
  document.getElementById('confirm-msg').textContent=msg;
  document.getElementById('confirm-sub').textContent=sub;
  document.getElementById('confirm-icon').textContent=icon;
  const btn=document.getElementById('confirm-ok-btn');
  btn.className=btnClass;
  btn.onclick=()=>{ closeModal('modal-confirm'); onOk(); };
  openModal('modal-confirm');
}

// ── LISTENERS ─────────────────────────────────────────
function startListeners(){
  if(unsubQs)unsubQs(); if(unsubMovs)unsubMovs(); if(unsubPrestamos)unsubPrestamos();
  startPrestamosListener();
  unsubQs=onSnapshot(
    query(collection(db,'quincenas'),where('uid','==',currentUser.uid),orderBy('inicio','desc')),
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
  // Solo orderBy fecha — sin doble orderBy para evitar índice extra
  unsubMovs=onSnapshot(
    query(collection(db,'movimientos'),where('uid','==',currentUser.uid),where('quincenaId','==',currentQuincenaId),orderBy('fecha','desc')),
    snap=>{
      // Ordenar por fecha desc, luego createdAt desc dentro del mismo día
      const docs=snap.docs.map(d=>({id:d.id,...d.data()}));
      docs.sort((a,b)=>{
        if(b.fecha!==a.fecha) return b.fecha.localeCompare(a.fecha);
        return (b.createdAt||0)-(a.createdAt||0);
      });
      movimientos=docs;
      render();
    }
  );
}

// ── QUINCENAS ─────────────────────────────────────────
window.createQuincena = async () => {
  const inicio=document.getElementById('q-inicio').value;
  const fin=document.getElementById('q-fin').value;
  const saldo=parseFloat(document.getElementById('q-saldo').value);
  if(!inicio||!fin||isNaN(saldo)||saldo<0){showToast('Completa todos los campos');return;}
  const dup=quincenas.find(q=>q.inicio===inicio&&q.fin===fin);
  if(dup){showToast('⚠️ Ya tienes una quincena con esas fechas');return;}
  try {
    const ref=await addDoc(collection(db,'quincenas'),{uid:currentUser.uid,inicio,fin,saldo,createdAt:Date.now()});
    currentQuincenaId=ref.id;
    closeModal('modal-quincena');
    showToast('✅ ¡Quincena creada exitosamente!');
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
  closeModal('modal-edit-q');
  setTimeout(()=>{
    showConfirm('¿Guardar cambios en esta quincena?','Los saldos se recalcularán con el nuevo monto inicial.','✏️',async()=>{
      try { await updateDoc(doc(db,'quincenas',id),{inicio,fin,saldo}); showToast('✅ Quincena actualizada'); }
      catch(e){showToast('Error al actualizar');}
    },'btn-warn');
  },350);
};

window.confirmDeleteQuincena = id => {
  const q=quincenas.find(x=>x.id===id); if(!q)return;
  closeModal('modal-quincena');
  setTimeout(()=>{
    showConfirm(
      `¿Eliminar quincena ${quincenaLabel(q)}?`,
      'Se eliminarán también todos sus movimientos. Esta acción no se puede deshacer.',
      '🗑️',
      async()=>{
        try {
          const snap=await getDocs(query(collection(db,'movimientos'),where('quincenaId','==',id)));
          await Promise.all(snap.docs.map(d=>deleteDoc(d.ref)));
          await deleteDoc(doc(db,'quincenas',id));
          if(currentQuincenaId===id){currentQuincenaId=null;if(unsubMovs)unsubMovs();movimientos=[];}
          showToast('🗑️ Quincena eliminada');
        } catch(e){showToast('Error al eliminar');}
      }
    );
  },350);
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
        <button class="q-action-btn" onclick="openEditQuincena('${q.id}')">✏️</button>
        <button class="q-action-btn" onclick="confirmDeleteQuincena('${q.id}')">🗑️</button>
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
    if(editingMovId){
      await updateDoc(doc(db,'movimientos',editingMovId),{monto,desc,fecha,cat:selectedCat,type:currentType,destino});
      editingMovId=null;
      document.getElementById('modal-add-title').textContent='Nuevo movimiento';
      closeModal('modal-add');
      showToast('✅ Movimiento actualizado');
    } else {
      await addDoc(collection(db,'movimientos'),{
        uid:currentUser.uid,quincenaId:currentQuincenaId,
        monto,desc,fecha,cat:selectedCat,type:currentType,destino,createdAt:Date.now()
      });
      closeModal('modal-add');
      if(currentType==='gasto') showToast('💸 Gasto registrado');
      else if(destino==='ahorro') showToast('🌱 Extra guardado en tu ahorro');
      else showToast('💰 Extra sumado a tu disponible');
    }
  } catch(e){showToast('Error al guardar');}
};

window.showDetail = id => {
  const m=movimientos.find(x=>x.id===id); if(!m)return;
  const cat=CATS.find(c=>c.id===m.cat)||CATS[7];
  const isAhorro=m.type==='ingreso'&&m.destino==='ahorro';
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
    closeModal('modal-detail');
    setTimeout(()=>{
      showConfirm('¿Eliminar este movimiento?','Esta acción no se puede deshacer.','🗑️',async()=>{
        try { await deleteDoc(doc(db,'movimientos',id)); showToast('🗑️ Movimiento eliminado'); }
        catch(e){showToast('Error al eliminar');}
      });
    },350);
  };
  document.getElementById('detail-edit-btn').onclick=()=>openEditMovimiento(id);
  openModal('modal-detail');
};

window.openEditMovimiento = id => {
  const m=movimientos.find(x=>x.id===id); if(!m)return;
  editingMovId=id;
  currentType=m.type;
  currentDestino=(m.destino==='gasto')?'ahorro':m.destino;
  selectedCat=m.cat||'otro';
  document.getElementById('input-monto').value=m.monto;
  document.getElementById('input-desc').value=m.desc||'';
  document.getElementById('input-fecha').value=m.fecha;
  document.getElementById('modal-add-title').textContent='Editar movimiento';
  document.getElementById('destino-wrap').style.display=m.type==='ingreso'?'block':'none';
  document.getElementById('cat-wrap').style.display=m.type==='gasto'?'block':'none';
  renderTypeToggle(); renderDestinoToggle(); renderCatGrid();
  closeModal('modal-detail');
  openModal('modal-add');
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
        <div style="font-size:13px;font-weight:600;color:${CAT_COLORS[c.id]}">${fmt(t)} <span style="color:var(--text3);font-size:11px">${pct}%</span></div>
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
      const pctCat=total>0?Math.round((t/total)*100):0;
      const items=movs.map(m=>`<div class="cat-mov-item">
        <div><div style="font-size:13px;color:var(--text)">${m.desc||c.label}</div><div style="font-size:11px;color:var(--text3)">${fmtDate(m.fecha)}</div></div>
        <div style="font-size:13px;font-weight:600;color:var(--red)">-${fmt(m.monto)}</div>
      </div>`).join('');
      return `<div class="cat-detail-card">
        <div class="cat-detail-header">
          <div class="cat-detail-emoji">${c.emoji}</div>
          <div style="flex:1">
            <div class="cat-detail-name">${c.label}</div>
            <div class="cat-detail-total">${movs.length} movimiento${movs.length!==1?'s':''}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:18px;font-weight:700;color:${CAT_COLORS[c.id]}">${fmt(t)}</div>
            <div style="font-size:11px;color:var(--text3)">${pctCat}% del total</div>
          </div>
        </div>${items}
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
            stroke-dasharray="${dash}" stroke-dashoffset="${dash*0.8}" stroke-linecap="round"/>
        </svg>
        <div style="position:relative;text-align:center">
          <div style="font-size:28px;font-weight:600;color:var(--teal)" id="ring-pct">20%</div>
          <div style="font-size:11px;color:var(--text3)">sugerido</div>
        </div>
      </div>
    </div>
    <div class="ahorro-tip">🎯 <strong>Meta sugerida:</strong> apartar <strong>${fmt(sugerido)}</strong> por quincena (20%). En 12 meses tendrías aprox. <strong>${fmt(sugerido*24)}</strong>.</div>
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
    const pct=parseInt(this.value),amt=Math.round(inicial*pct/100);
    document.getElementById('slider-pct-label').textContent=pct+'%';
    document.getElementById('ring-pct').textContent=pct+'%';
    document.getElementById('slider-amount-label').textContent=fmt(amt)+' / quincena';
    document.getElementById('slider-anual-label').textContent=fmt(amt*24)+' / año';
  });
}

// ── PRÉSTAMOS ─────────────────────────────────────────
function startPrestamosListener(){
  if(unsubPrestamos)unsubPrestamos();
  unsubPrestamos=onSnapshot(
    query(collection(db,'prestamos'),where('uid','==',currentUser.uid),orderBy('createdAt','desc')),
    snap=>{ prestamos=snap.docs.map(d=>({id:d.id,...d.data()})); if(currentTab==='prestamos')renderPrestamos(); }
  );
}

// ganancia = interés cobrado por quincena
// quincenal = ganancia (solo el interés, el capital es aparte)
// mensual = quincenal * 2
// anual = quincenal * 24
function calcPrestamo(capital, interes){
  const ganancia=capital*(interes/100);
  const quincenal=ganancia;
  return {total:capital+ganancia, ganancia, quincenal, mensual:quincenal*2, anual:quincenal*24};
}

function updatePrestamoPreview(){
  const capital=parseFloat(document.getElementById('p-capital').value);
  const interes=parseFloat(document.getElementById('p-interes').value)||0;
  const preview=document.getElementById('p-preview');
  if(!capital||capital<=0){preview.style.display='none';return;}
  preview.style.display='block';
  const c=calcPrestamo(capital,interes);
  document.getElementById('prev-total').textContent=fmt(c.total);
  document.getElementById('prev-ganancia').textContent=fmt(c.ganancia);
  document.getElementById('prev-quincenal').textContent=fmt(c.quincenal);
  document.getElementById('prev-mensual').textContent=fmt(c.mensual);
}

window.savePrestamo = async () => {
  const nombre=document.getElementById('p-nombre').value.trim();
  const capital=parseFloat(document.getElementById('p-capital').value);
  const interes=parseFloat(document.getElementById('p-interes').value)||0;
  const fecha=document.getElementById('p-fecha').value||today();
  const notas=document.getElementById('p-notas').value.trim();
  const editId=document.getElementById('prestamo-edit-id').value;
  if(!nombre){showToast('Ingresa el nombre del deudor');return;}
  if(!capital||capital<=0){showToast('Ingresa el capital prestado');return;}
  const calc=calcPrestamo(capital,interes);
  const data={uid:currentUser.uid,nombre,capital,interes,fecha,notas,
    totalACobrar:calc.total,ganancia:calc.ganancia,quincenal:calc.quincenal,mensual:calc.mensual,
    pagado:0,status:'activo',...(!editId&&{createdAt:Date.now()})};
  try {
    if(editId){await updateDoc(doc(db,'prestamos',editId),data);showToast('✅ Préstamo actualizado');}
    else{await addDoc(collection(db,'prestamos'),data);showToast('💸 Préstamo registrado');}
    closeModal('modal-prestamo');
    clearPrestamoForm();
  } catch(e){showToast('Error al guardar');}
};

function clearPrestamoForm(){
  ['p-nombre','p-capital','p-interes','p-notas'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('p-fecha').value=today();
  document.getElementById('p-preview').style.display='none';
  document.getElementById('prestamo-edit-id').value='';
  document.getElementById('modal-prestamo-title').textContent='Nuevo préstamo';
}

window.showPrestamoDetail = async id => {
  currentPrestamoId=id;
  const p=prestamos.find(x=>x.id===id); if(!p)return;
  let registros=[];
  try {
    const snap=await getDocs(query(collection(db,'pagos'),where('prestamoId','==',id),orderBy('fecha','desc')));
    registros=snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch(e){}
  const intereses=registros.filter(r=>r.tipoRegistro==='interes');
  const abonos=registros.filter(r=>r.tipoRegistro!=='interes');
  const totalIntereses=intereses.reduce((a,r)=>a+r.monto,0);
  const totalAbonado=abonos.reduce((a,r)=>a+r.monto,0);
  const pendiente=Math.max(0,parseFloat((p.capital-totalAbonado).toFixed(2)));
  const pct=p.capital>0?Math.min(100,Math.floor((totalAbonado/p.capital)*100)):0;
  const histHTML=registros.length>0?registros.map(r=>{
    const esInteres=r.tipoRegistro==='interes';
    return `<div class="pago-item">
      <div>
        <div style="font-size:13px;color:var(--text)">${r.nota||(esInteres?'Interés cobrado':'Abono al capital')}</div>
        <div style="font-size:11px;margin-top:2px">
          <span style="background:${esInteres?'rgba(232,201,122,0.15)':'rgba(63,232,216,0.12)'};color:${esInteres?'var(--amber)':'var(--teal)'};border-radius:4px;padding:1px 6px;font-size:10px">${esInteres?'🔄 Interés':'💵 Abono'}</span>
          <span style="color:var(--text3);margin-left:6px">${fmtDate(r.fecha)}</span>
        </div>
      </div>
      <div style="font-size:13px;font-weight:600;color:${esInteres?'var(--amber)':'var(--green)'}">+${fmt(r.monto)}</div>
    </div>`;
  }).join(''):'<div style="color:var(--text3);font-size:13px;padding:12px 0;text-align:center">Sin registros aún</div>';

  document.getElementById('detail-prestamo-nombre').textContent=p.nombre;
  document.getElementById('detail-prestamo-content').innerHTML=`
    <div class="prestamo-grid" style="margin-bottom:12px">
      <div class="prestamo-stat"><div class="prestamo-stat-label">CAPITAL</div><div class="prestamo-stat-value v-accent">${fmt(p.capital)}</div></div>
      <div class="prestamo-stat"><div class="prestamo-stat-label">INTERÉS</div><div class="prestamo-stat-value v-amber">${p.interes}%</div></div>
      <div class="prestamo-stat"><div class="prestamo-stat-label">COBRO QUINCENAL</div><div class="prestamo-stat-value v-teal">${fmt(p.quincenal)}</div></div>
      <div class="prestamo-stat"><div class="prestamo-stat-label">COBRO MENSUAL</div><div class="prestamo-stat-value" style="color:var(--pink)">${fmt(p.mensual)}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div style="background:rgba(232,201,122,0.08);border:1px solid rgba(232,201,122,0.2);border-radius:var(--radius-sm);padding:12px;text-align:center">
        <div style="font-size:10px;color:var(--text3);margin-bottom:4px;letter-spacing:0.5px">INTERESES COBRADOS</div>
        <div style="font-size:18px;font-weight:700;color:var(--amber)">${fmt(totalIntereses)}</div>
      </div>
      <div style="background:rgba(63,232,216,0.08);border:1px solid rgba(63,232,216,0.15);border-radius:var(--radius-sm);padding:12px;text-align:center">
        <div style="font-size:10px;color:var(--text3);margin-bottom:4px;letter-spacing:0.5px">CAPITAL PENDIENTE</div>
        <div style="font-size:18px;font-weight:700;color:${pendiente<=0?'var(--green)':'var(--teal)'}">${pendiente<=0?'✅ Pagado':fmt(pendiente)}</div>
      </div>
    </div>
    <div class="prestamo-progress-wrap">
      <div class="prestamo-progress-label"><span>Abonado: ${fmt(totalAbonado)}</span><span>Pendiente: ${fmt(pendiente)}</span></div>
      <div class="prestamo-progress-track"><div class="prestamo-progress-fill" style="width:${pct}%"></div></div>
      <div style="font-size:11px;color:var(--text3);text-align:right;margin-top:3px">${pct}% del capital recuperado</div>
    </div>
    ${p.notas?`<div style="font-size:13px;color:var(--text2);background:var(--bg3);border-radius:var(--radius-sm);padding:10px;margin-bottom:12px">📝 ${p.notas}</div>`:''}
    <div class="section-title">Historial de registros</div>
    <div class="resumen-card" style="margin-bottom:12px">${histHTML}</div>`;

  const isLiquidado=p.status==='liquidado';
  document.getElementById('btn-registrar-interes').style.display=isLiquidado?'none':'block';
  document.getElementById('btn-registrar-pago').style.display=isLiquidado?'none':'block';
  document.getElementById('btn-liquidar-prestamo').style.display=isLiquidado?'none':'block';
  document.getElementById('btn-liquidar-prestamo').onclick=()=>{
    closeModal('modal-prestamo-detail');
    setTimeout(()=>{
      showConfirm('¿Marcar como liquidado?','Esto cerrará el préstamo como pagado en su totalidad.','✅',async()=>{
        await updateDoc(doc(db,'prestamos',id),{status:'liquidado'});
        showToast('✅ Préstamo liquidado');
      },'btn-primary');
    },350);
  };
  document.getElementById('btn-delete-prestamo').onclick=()=>{
    closeModal('modal-prestamo-detail');
    setTimeout(()=>{
      showConfirm('¿Eliminar este préstamo?','Se eliminarán también todos sus registros.','🗑️',async()=>{
        try {
          const ps=await getDocs(query(collection(db,'pagos'),where('prestamoId','==',id)));
          await Promise.all(ps.docs.map(d=>deleteDoc(d.ref)));
          await deleteDoc(doc(db,'prestamos',id));
          showToast('🗑️ Préstamo eliminado');
        } catch(e){showToast('Error al eliminar');}
      });
    },350);
  };
  openModal('modal-prestamo-detail');
};

window.openEditPrestamo=()=>{
  const p=prestamos.find(x=>x.id===currentPrestamoId); if(!p)return;
  closeModal('modal-prestamo-detail');
  document.getElementById('prestamo-edit-id').value=p.id;
  document.getElementById('modal-prestamo-title').textContent='Editar préstamo';
  document.getElementById('p-nombre').value=p.nombre;
  document.getElementById('p-capital').value=p.capital;
  document.getElementById('p-interes').value=p.interes;
  document.getElementById('p-fecha').value=p.fecha;
  document.getElementById('p-notas').value=p.notas||'';
  updatePrestamoPreview();
  openModal('modal-prestamo');
};

window.openRegistrarInteres=()=>{
  const p=prestamos.find(x=>x.id===currentPrestamoId); if(!p)return;
  document.getElementById('pago-prestamo-id').value=currentPrestamoId;
  document.getElementById('pago-tipo').value='interes';
  document.getElementById('pago-monto').value=p.quincenal;
  document.getElementById('pago-fecha').value=today();
  document.getElementById('pago-nota').value='';
  document.getElementById('modal-pago-title').textContent='Registrar interés cobrado';
  document.getElementById('pago-monto-label').textContent='INTERÉS COBRADO *';
  closeModal('modal-prestamo-detail');
  openModal('modal-pago');
};

window.openRegistrarPago=()=>{
  document.getElementById('pago-prestamo-id').value=currentPrestamoId;
  document.getElementById('pago-tipo').value='abono';
  document.getElementById('pago-monto').value='';
  document.getElementById('pago-fecha').value=today();
  document.getElementById('pago-nota').value='';
  document.getElementById('modal-pago-title').textContent='Registrar abono al capital';
  document.getElementById('pago-monto-label').textContent='MONTO ABONADO *';
  closeModal('modal-prestamo-detail');
  openModal('modal-pago');
};

window.savePago=async()=>{
  const prestamoId=document.getElementById('pago-prestamo-id').value;
  const tipoRegistro=document.getElementById('pago-tipo').value||'abono';
  const monto=parseFloat(document.getElementById('pago-monto').value);
  const fecha=document.getElementById('pago-fecha').value||today();
  const nota=document.getElementById('pago-nota').value.trim();
  if(!monto||monto<=0){showToast('Ingresa el monto');return;}
  try {
    await addDoc(collection(db,'pagos'),{uid:currentUser.uid,prestamoId,monto,fecha,nota,tipoRegistro,createdAt:Date.now()});
    closeModal('modal-pago');
    showToast(tipoRegistro==='interes'?'🔄 Interés registrado':'💵 Abono registrado');
  } catch(e){showToast('Error al guardar');}
};

function renderPrestamos(){
  const content=document.getElementById('main-content');
  const activos=prestamos.filter(p=>p.status==='activo');
  const totalCapital=activos.reduce((a,p)=>a+p.capital,0);
  const totalGanancia=activos.reduce((a,p)=>a+p.ganancia,0);
  const totalQuincenal=activos.reduce((a,p)=>a+p.quincenal,0);
  const summaryHTML=prestamos.length>0?`
    <div class="prestamos-summary">
      <div class="prestamos-summary-title">Resumen activos</div>
      <div class="prestamos-summary-grid">
        <div class="ps-item"><div class="ps-label">Capital total</div><div class="ps-value v-accent">${fmt(totalCapital)}</div></div>
        <div class="ps-item"><div class="ps-label">Ganancia total</div><div class="ps-value v-green">${fmt(totalGanancia)}</div></div>
        <div class="ps-item"><div class="ps-label">Cobro quincenal</div><div class="ps-value v-teal">${fmt(totalQuincenal)}</div></div>
      </div>
    </div>`:'';
  const prestamosHTML=prestamos.length===0
    ?'<div class="empty-state"><div class="empty-state-icon">🤝</div><p>Sin préstamos registrados.<br>Toca el botón de abajo para agregar uno.</p></div>'
    :prestamos.map(p=>`
      <div class="prestamo-card" onclick="showPrestamoDetail('${p.id}')">
        <div class="prestamo-card-header">
          <div class="prestamo-nombre">🤝 ${p.nombre}</div>
          <div class="prestamo-status ${p.status==='liquidado'?'liquidado':'activo'}">${p.status==='liquidado'?'✅ Liquidado':'🟢 Activo'}</div>
        </div>
        <div class="prestamo-grid">
          <div class="prestamo-stat"><div class="prestamo-stat-label">CAPITAL</div><div class="prestamo-stat-value v-accent">${fmt(p.capital)}</div></div>
          <div class="prestamo-stat"><div class="prestamo-stat-label">INTERÉS</div><div class="prestamo-stat-value v-amber">${p.interes}%</div></div>
          <div class="prestamo-stat"><div class="prestamo-stat-label">COBRO QUINCENAL</div><div class="prestamo-stat-value v-teal">${fmt(p.quincenal)}</div></div>
          <div class="prestamo-stat"><div class="prestamo-stat-label">COBRO MENSUAL</div><div class="prestamo-stat-value" style="color:var(--pink)">${fmt(p.mensual)}</div></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text3)">
          <span>Fecha: <strong style="color:var(--text2)">${fmtDate(p.fecha)}</strong></span>
          <span>Año: <strong style="color:var(--amber)">${fmt(p.mensual*12)}</strong></span>
        </div>
      </div>`).join('');
  content.innerHTML=summaryHTML+prestamosHTML;
}

// ── MAIN RENDER ───────────────────────────────────────
function render(){
  document.getElementById('fab-btn').textContent=currentTab==='prestamos'?'＋ Nuevo préstamo':'＋ Agregar movimiento';
  updateHeader();
  if(currentTab==='movimientos')renderMovimientos();
  else if(currentTab==='resumen')renderResumen();
  else if(currentTab==='ahorro')renderAhorro();
  else if(currentTab==='prestamos')renderPrestamos();
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
  if(currentTab==='prestamos'){clearPrestamoForm();openModal('modal-prestamo');return;}
  const q=getCurrentQ();
  if(!q){renderQuincenaList();openModal('modal-quincena');return;}
  editingMovId=null;
  document.getElementById('modal-add-title').textContent='Nuevo movimiento';
  currentType='gasto';currentDestino='ahorro';selectedCat='otro';
  document.getElementById('input-monto').value='';
  document.getElementById('input-desc').value='';
  document.getElementById('input-fecha').value=today();
  document.getElementById('destino-wrap').style.display='none';
  document.getElementById('cat-wrap').style.display='block';
  renderTypeToggle();renderDestinoToggle();renderCatGrid();
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
window.setType=t=>{
  currentType=t;renderTypeToggle();
  document.getElementById('destino-wrap').style.display=t==='ingreso'?'block':'none';
  document.getElementById('cat-wrap').style.display=(t==='gasto'||(t==='ingreso'&&currentDestino==='disponible'))?'block':'none';
};
window.setDestino=d=>{
  currentDestino=d;renderDestinoToggle();
  document.getElementById('cat-wrap').style.display=d==='disponible'?'block':'none';
};
window.selectCat=id=>{selectedCat=id;renderCatGrid();};

['p-capital','p-interes'].forEach(id=>{
  const el=document.getElementById(id);
  if(el)el.addEventListener('input',updatePrestamoPreview);
});

renderCatGrid();
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});

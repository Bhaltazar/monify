import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, updateProfile, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, deleteDoc, getDocs, query, where, orderBy, limit, onSnapshot, setDoc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

// Categorías default al hacer setup (sin "otro", se agrega automáticamente al final)
const DEFAULT_CATS = [
  {id:'comida',     label:'Comida',     emoji:'🍔'},
  {id:'transporte', label:'Transporte', emoji:'🚌'},
  {id:'escuela',    label:'Escuela',    emoji:'🎓'},
  {id:'servicios',  label:'Servicios',  emoji:'💡'},
];
const CAT_OTRO = {id:'otro', label:'Otro', emoji:'📦'};

// CATS y CAT_COLORS se construyen dinámicamente desde la config del usuario
let CATS = [...DEFAULT_CATS, CAT_OTRO];
const CAT_COLORS = {};
const CAT_COLOR_POOL = ['#e0a8c0','#7ecfcf','#e8c97a','#85c9a0','#b5a8e0','#f0a0c0','#a8d8e0','#f0c070','#c0e085','#e0c0a8'];

// Config del usuario (cargada desde Firestore)
let userConfig = null; // {cats:[...], sections:{ahorro:bool, prestamos:bool}}

// Setup state
let setupCats = [...DEFAULT_CATS]; // sin "otro"
let setupDragIdx = null;
let setupDragOverIdx = null;

// Multi-cuenta: guardadas en localStorage
let savedAccounts = []; // [{uid, email, displayName}]

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

window.togglePass = (inputId, btnId) => {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if(!input) return;
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.textContent = isHidden ? '🙈' : '👁️';
};

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

const _toastQueue = [];
let _toastActive = false;

function _getToastClass(msg) {
  if (/✅/.test(msg)) return 'toast-success';
  if (/⚠️/.test(msg)) return 'toast-warning';
  if (/🗑️/.test(msg)) return 'toast-danger';
  return 'toast-info';
}

function _runToastQueue() {
  if (_toastActive || _toastQueue.length === 0) return;
  _toastActive = true;
  const { msg, dur } = _toastQueue.shift();
  const t = document.getElementById('toast');
  // Limpiar clases de color anteriores
  t.classList.remove('toast-success', 'toast-warning', 'toast-danger', 'toast-info');
  t.classList.add(_getToastClass(msg));
  t.textContent = msg;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    t.classList.add('show');
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => {
        _toastActive = false;
        _runToastQueue();
      }, 350); // esperar que termine la animación de salida
    }, dur);
  }));
}

function showToast(msg, dur=2800) {
  _toastQueue.push({ msg, dur });
  _runToastQueue();
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
  const isSwitching = window._switchingToEmail && window._switchingToEmail===email;
  try {
    // Mostrar splash ANTES del login si es cambio de cuenta
    if(isSwitching){
      const overlay=document.getElementById('setup-saving-overlay');
      const splashMsg=document.getElementById('splash-msg');
      if(splashMsg) splashMsg.textContent='Cambiando de cuenta...';
      overlay.style.display='flex';
    }
    const cred = await signInWithEmailAndPassword(auth,email,pass);
    if(!cred.user.emailVerified){
      // Ocultar splash si había aparecido
      document.getElementById('setup-saving-overlay').style.display='none';
      await signOut(auth);
      const b=document.getElementById('verify-banner');
      b.style.display='block';
      b.textContent='📧 Aún no verificas tu correo. Revisa tu bandeja de entrada.';
      return;
    }
    if(isSwitching){
      window._switchingToEmail=null;
      const authEmail=document.getElementById('auth-email');
      if(authEmail) authEmail.readOnly=false;
      // Mantener splash visible mínimo 1.5s para que se lea
      await new Promise(r=>setTimeout(r,1500));
      document.getElementById('setup-saving-overlay').style.display='none';
    }
  } catch(e) {
    document.getElementById('setup-saving-overlay').style.display='none';
    showToast(e.code==='auth/invalid-credential'?'Correo o contraseña incorrectos':'Error al iniciar sesión');
  }
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
    b.textContent='✅ ¡Cuenta creada! Revisa tu correo y confírmalo para poder entrar. Si no lo ves, revisa tu carpeta de spam.';
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
  if(!user && window._switchingToEmail){
    // Venimos de un cambio de cuenta: mostrar login con email prellenado y bloqueado
    const emailToFill=window._switchingToEmail;
    // NO limpiamos _switchingToEmail aún; lo usará loginEmail para el splash
    const authEmail=document.getElementById('auth-email');
    if(authEmail){ authEmail.value=emailToFill; authEmail.readOnly=true; }
    const authPass=document.getElementById('auth-pass');
    if(authPass){ authPass.value=''; }
    // Mostrar solo el tab de login
    switchAuthMode('login');
    document.getElementById('app-main').style.display='none';
    document.getElementById('setup-screen').style.display='none';
    document.getElementById('auth-screen').style.display='flex';
    return;
  }
  if(user && user.emailVerified){
    currentUser=user;
    const snap=await getDoc(doc(db,'users',user.uid));
    const userData=snap.exists()?snap.data():{};
    const username=userData.username||(user.displayName||user.email.split('@')[0]);
    setUserUI(username, user.email);
    // Guardar cuenta en lista local
    saveAccountLocally(user.uid, username, user.email);
    loadSavedAccounts();
    // Cargar config del usuario
    const cfgSnap=await getDoc(doc(db,'userConfig',user.uid));
    if(cfgSnap.exists()){
      // Ya tiene config, cargar y entrar a la app
      userConfig=cfgSnap.data();
      applyUserConfig();
      document.getElementById('auth-screen').style.display='none';
      document.getElementById('setup-screen').style.display='none';
      const am=document.getElementById('app-main');
      am.style.display='flex'; am.style.flexDirection='column';
      startListeners();
    } else {
      // Sin userConfig: puede ser cuenta nueva O cuenta vieja sin config
      // Si ya tiene quincenas, es cuenta vieja -> crear config por defecto y entrar
      const qCheck = await getDocs(query(collection(db,'quincenas'), where('uid','==',user.uid), limit(1)));
      if(!qCheck.empty){
        // Cuenta existente sin config: intentar recuperar cats reales desde movimientos
        let recoveredCats = [...DEFAULT_CATS];
        try {
          const movsSnap = await getDocs(query(collection(db,'movimientos'), where('uid','==',user.uid)));
          const catMap = {};
          movsSnap.docs.forEach(d => {
            const m = d.data();
            if(m.cat && m.cat !== 'otro' && !catMap[m.cat]) catMap[m.cat] = true;
          });
          const catIds = Object.keys(catMap);
          if(catIds.length > 0){
            const defaultMap = {};
            DEFAULT_CATS.forEach(c => defaultMap[c.id] = c);
            recoveredCats = catIds.map((id, i) => {
              if(defaultMap[id]) return defaultMap[id];
              return { id, label: id.charAt(0).toUpperCase()+id.slice(1), emoji: '📁', color: CAT_COLOR_POOL[i % CAT_COLOR_POOL.length] };
            });
          }
        } catch(e){ /* si falla, usamos defaults */ }
        userConfig = { cats: recoveredCats, sections: { ahorro: true, prestamos: true } };
        await setDoc(doc(db,'userConfig',user.uid), userConfig);
        applyUserConfig();
        document.getElementById('auth-screen').style.display='none';
        document.getElementById('setup-screen').style.display='none';
        const am=document.getElementById('app-main');
        am.style.display='flex'; am.style.flexDirection='column';
        startListeners();
      } else {
        // Cuenta realmente nueva: mostrar setup
        document.getElementById('auth-screen').style.display='none';
        document.getElementById('app-main').style.display='none';
        showSetupScreen();
      }
    }
  } else {
    if(user && !user.emailVerified) await signOut(auth);
    currentUser=null; quincenas=[]; movimientos=[]; currentQuincenaId=null;
    document.getElementById('app-main').style.display='none';
    document.getElementById('setup-screen').style.display='none';
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
      // Si el ID activo no pertenece a este usuario, resetear al más reciente
      if(!currentQuincenaId || !quincenas.find(q=>q.id===currentQuincenaId)){
        currentQuincenaId=quincenas.length>0 ? quincenas[0].id : null;
      }
      startMovsListener();
      render();
      // Launch tutorial if flagged (only first time)
      if(localStorage.getItem('monify_show_tutorial')==='1'){
        setTimeout(startTutorial, 800);
      }
    }
  );
}

function startMovsListener(){
  if(unsubMovs)unsubMovs();
  if(!currentQuincenaId){movimientos=[];render();return;}
  unsubMovs=onSnapshot(
    query(collection(db,'movimientos'),where('uid','==',currentUser.uid),where('quincenaId','==',currentQuincenaId),orderBy('fecha','desc'),limit(200)),
    snap=>{
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
    },'btn-save');
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
          const snapMovs=await getDocs(query(collection(db,'movimientos'),where('quincenaId','==',id)));
          await Promise.all(snapMovs.docs.map(d=>deleteDoc(d.ref)));
          await deleteDoc(doc(db,'quincenas',id));
          if(currentQuincenaId===id){currentQuincenaId=null;if(unsubMovs)unsubMovs();movimientos=[];}
          showToast('🗑️ Quincena eliminada');
        } catch(e){showToast('Error al eliminar');}
      }
    );
  },350);
};

async function renderQuincenaList(){
  const el=document.getElementById('quincena-list');
  if(quincenas.length===0){el.innerHTML='<div style="color:var(--text3);font-size:13px;margin-bottom:16px">Sin quincenas aún.</div>';return;}
  // Bug 2 fix: traer gastos reales de todas las quincenas desde Firestore
  el.innerHTML='<div style="color:var(--text3);font-size:13px;margin-bottom:16px;text-align:center">Cargando...</div>';
  const gastosMap={};
  try {
    const snap=await getDocs(query(collection(db,'movimientos'),where('uid','==',currentUser.uid),where('type','==','gasto')));
    snap.docs.forEach(d=>{
      const m=d.data();
      if(!gastosMap[m.quincenaId])gastosMap[m.quincenaId]=0;
      gastosMap[m.quincenaId]+=m.monto;
    });
  } catch(e){ showToast('⚠️ Error al cargar los registros'); }
  el.innerHTML=quincenas.map(q=>{
    const isActive=q.id===currentQuincenaId;
    const gastos=gastosMap[q.id]||0;
    return `<div class="quincena-item ${isActive?'active-q':''}">
      <div style="flex:1;cursor:pointer" onclick="selectQuincena('${q.id}')">
        <div class="quincena-item-title">${quincenaLabel(q)} ${isActive?'<span style="color:var(--teal);font-size:12px">\u2713 activa</span>':''}</div>
        <div class="quincena-item-sub">Inicio: ${fmt(q.saldo)} · Gastado: ${fmt(gastos)}</div>
      </div>
      <div class="quincena-actions">
        <button class="q-action-btn" onclick="openEditQuincena('${q.id}')">&#x270F;&#xFE0F;</button>
        <button class="q-action-btn" onclick="confirmDeleteQuincena('${q.id}')">&#x1F5D1;&#xFE0F;</button>
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
  const isAhorroTransfer=currentType==='ahorro-transfer';
  // ahorro-transfer se guarda como type='ahorro-transfer', destino='ahorro', cat='otro'
  const type=isAhorroTransfer?'ahorro-transfer':currentType;
  const destino=isAhorroTransfer?'ahorro':(currentType==='ingreso'?currentDestino:'gasto');
  const cat=isAhorroTransfer?'otro':selectedCat;
  try {
    if(editingMovId){
      await updateDoc(doc(db,'movimientos',editingMovId),{monto,desc,fecha,cat,type,destino});
      editingMovId=null;
      document.getElementById('modal-add-title').textContent='Nuevo movimiento';
      closeModal('modal-add');
      showToast('✅ Movimiento actualizado');
    } else {
      await addDoc(collection(db,'movimientos'),{
        uid:currentUser.uid,quincenaId:currentQuincenaId,
        monto,desc,fecha,cat,type,destino,createdAt:Date.now()
      });
      closeModal('modal-add');
      if(type==='gasto') showToast('💸 Gasto registrado');
      else if(type==='ahorro-transfer') showToast('💰 Movido al ahorro');
      else if(destino==='ahorro') showToast('💰 Extra guardado en tu ahorro');
      else showToast('💲 Extra sumado a tu disponible');
    }
  } catch(e){showToast('Error al guardar');}
};

window.showDetail = id => {
  const m=movimientos.find(x=>x.id===id); if(!m)return;
  const cat=CATS.find(c=>c.id===m.cat)||CAT_OTRO;
  const isAhorro=m.type==='ingreso'&&m.destino==='ahorro';
  const isAhorroTransfer=m.type==='ahorro-transfer';
  const emoji=isAhorroTransfer?'💰':isAhorro?'💰':(m.type==='ingreso'&&m.destino==='disponible')?'💲':cat.emoji;
  const label=isAhorroTransfer?'Al ahorro':isAhorro?'Ahorro':(m.type==='ingreso'&&m.destino==='disponible')?'Extra':cat.label;
  const color=isAhorroTransfer?'var(--teal)':m.type==='gasto'?'var(--red)':isAhorro?'var(--teal)':'var(--green)';
  const sign=(m.type==='gasto'||isAhorroTransfer)?'-':'+';
  document.getElementById('detail-title').textContent=m.desc||label;
  document.getElementById('detail-content').innerHTML=`
    <div style="text-align:center;padding:12px 0 20px">
      <div style="font-size:48px;margin-bottom:8px">${emoji}</div>
      <div style="font-size:32px;font-weight:600;color:${color}">${sign}${fmt(m.monto)}</div>
      <div style="font-size:13px;color:var(--text3);margin-top:6px">${label} · ${fmtDate(m.fecha)}</div>
      ${isAhorroTransfer?`<div style="font-size:12px;margin-top:4px;color:var(--teal)">💰 Movido de disponible al ahorro</div>`:''}
      ${m.type==='ingreso'?`<div style="font-size:12px;margin-top:4px;color:${isAhorro?'var(--teal)':'var(--green)'}">${isAhorro?'💰 Fue al ahorro':'💲 Fue al disponible'}</div>`:''}
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
  currentDestino=m.type==='ingreso'?(m.destino==='disponible'?'disponible':'ahorro'):'ahorro';
  selectedCat=m.cat||'otro';
  document.getElementById('input-monto').value=m.monto;
  document.getElementById('input-desc').value=m.desc||'';
  document.getElementById('input-fecha').value=m.fecha;
  document.getElementById('modal-add-title').textContent='Editar movimiento';
  const isAhorroTransfer=m.type==='ahorro-transfer';
  const isIngreso=m.type==='ingreso';
  document.getElementById('destino-wrap').style.display=isIngreso?'block':'none';
  document.getElementById('ahorro-transfer-hint').style.display=isAhorroTransfer?'block':'none';
  document.getElementById('cat-wrap').style.display=(isAhorroTransfer||isIngreso)?'none':'block';
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
  const ahorroTransfers=movimientos.filter(m=>m.type==='ahorro-transfer').reduce((a,m)=>a+m.monto,0);
  const extrasDisp=movimientos.filter(m=>m.type==='ingreso'&&m.destino==='disponible').reduce((a,m)=>a+m.monto,0);
  const ahorrado=movimientos.filter(m=>(m.type==='ingreso'&&m.destino==='ahorro')||m.type==='ahorro-transfer').reduce((a,m)=>a+m.monto,0);
  const inicial=q?q.saldo:0;
  const disponible=inicial-gastos-ahorroTransfers+extrasDisp;
  document.getElementById('saldo-inicial-display').textContent=fmt(inicial);
  document.getElementById('saldo-actual-display').textContent=fmt(disponible);
  document.getElementById('total-gastado-display').textContent=fmt(gastos);
  document.getElementById('total-ahorrado-display').textContent=fmt(ahorrado);
  const pct=(inicial+extrasDisp)>0?Math.min(100,Math.round((gastos/(inicial+extrasDisp))*100)):0;
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
      const cat=CATS.find(c=>c.id===m.cat)||CAT_OTRO;
      const isAhorro=m.type==='ingreso'&&m.destino==='ahorro';
      const isDisp=m.type==='ingreso'&&m.destino==='disponible';
      const isAhorroTransfer=m.type==='ahorro-transfer';
      const emoji=isAhorroTransfer?'💰':isAhorro?'💰':isDisp?'💲':cat.emoji;
      const label=isAhorroTransfer?'Al ahorro':isAhorro?'Ahorro':isDisp?'Extra':cat.label;
      const amtClass=isAhorroTransfer?'ingreso-ahorro':m.type==='gasto'?'':isAhorro?'ingreso-ahorro':'ingreso-disp';
      const sign=(m.type==='gasto'||isAhorroTransfer)?'-':'+';
      html+=`<div class="gasto-item" onclick="showDetail('${m.id}')">
        <div class="gasto-icon">${emoji}</div>
        <div class="gasto-info">
          <div class="gasto-desc">${m.desc||label}</div>
          <div class="gasto-cat">${label}</div>
        </div>
        <div class="gasto-amount ${amtClass}">${sign}${fmt(m.monto)}</div>
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

// ── AHORRO (SIMPLIFICADO) ─────────────────────────────
function renderAhorro(){
  const content=document.getElementById('main-content');
  const ahorroMovs=movimientos.filter(m=>(m.type==='ingreso'&&m.destino==='ahorro')||m.type==='ahorro-transfer').sort((a,b)=>{
    if(b.fecha!==a.fecha) return b.fecha.localeCompare(a.fecha);
    return (b.createdAt||0)-(a.createdAt||0);
  });
  const ahorradoTotal=ahorroMovs.reduce((a,m)=>a+m.monto,0);

  const histHTML=ahorroMovs.length>0
    ? ahorroMovs.map(m=>{
        const isTransfer=m.type==='ahorro-transfer';
        const cat=CATS.find(c=>c.id===m.cat)||CAT_OTRO;
        const emoji=isTransfer?'💰':'💰';
        const label=isTransfer?'Al ahorro':'Ahorro';
        return `<div class="gasto-item" onclick="showAhorroDetail('${m.id}')">
          <div class="gasto-icon">${emoji}</div>
          <div class="gasto-info">
            <div class="gasto-desc">${m.desc||label}</div>
            <div class="gasto-cat">${label} · ${fmtDate(m.fecha)}</div>
          </div>
          <div class="gasto-amount ingreso-ahorro">+${fmt(m.monto)}</div>
        </div>`;
      }).join('')
    : '<div style="color:var(--text3);font-size:13px;text-align:center;padding:16px 0">Aún no tienes ahorros registrados 💰</div>';

  content.innerHTML=`
    <div class="ahorro-saved-card">
      <div class="ahorro-saved-label">💰 Total ahorrado esta quincena</div>
      <div class="ahorro-saved-amount">${fmt(ahorradoTotal)}</div>
      <div class="ahorro-saved-sub">${ahorroMovs.length} depósito${ahorroMovs.length!==1?'s':''} al ahorro</div>
    </div>
    <div class="section-title">Historial de ahorro</div>
    <div class="resumen-card">${histHTML}</div>`;
}

// Detalle/editar desde ahorro
window.showAhorroDetail = id => {
  const m=movimientos.find(x=>x.id===id); if(!m)return;
  const isTransfer=m.type==='ahorro-transfer';
  const cat=CATS.find(c=>c.id===m.cat)||CAT_OTRO;
  const emoji=isTransfer?'💰':'💰';
  const label=isTransfer?'Al ahorro':'Ahorro';
  document.getElementById('detail-title').textContent=m.desc||label;
  document.getElementById('detail-content').innerHTML=`
    <div style="text-align:center;padding:12px 0 20px">
      <div style="font-size:48px;margin-bottom:8px">${emoji}</div>
      <div style="font-size:32px;font-weight:600;color:var(--teal)">+${fmt(m.monto)}</div>
      <div style="font-size:13px;color:var(--text3);margin-top:6px">${label} · ${fmtDate(m.fecha)}</div>
      <div style="font-size:12px;margin-top:4px;color:var(--teal)">${isTransfer?'💰 Movido de disponible al ahorro':'💰 Fue al ahorro'}</div>
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

// ── PRÉSTAMOS ─────────────────────────────────────────
function startPrestamosListener(){
  if(unsubPrestamos)unsubPrestamos();
  unsubPrestamos=onSnapshot(
    query(collection(db,'prestamos'),where('uid','==',currentUser.uid),orderBy('createdAt','desc')),
    snap=>{ prestamos=snap.docs.map(d=>({id:d.id,...d.data()})); if(currentTab==='prestamos')renderPrestamos(); }
  );
}

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
    ...(!editId&&{pagado:0,status:'activo',createdAt:Date.now()})};
  try {
    if(editId){
      await updateDoc(doc(db,'prestamos',editId),data);
      showToast('✅ Préstamo actualizado');
      closeModal('modal-prestamo');
      clearPrestamoForm();
      // Volver a abrir el detail del préstamo
      setTimeout(()=>showPrestamoDetail(editId),300);
    }
    else{await addDoc(collection(db,'prestamos'),data);showToast('💸 Préstamo registrado');
    closeModal('modal-prestamo');
    clearPrestamoForm();}
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
  } catch(e){ showToast('⚠️ Error al cargar los registros'); }
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
        <div style="font-size:10px;color:var(--text3);margin-top:4px">Proyectado: ${fmt(p.ganancia)} / quincena</div>
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
      },'btn-liquidar');
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
    // Bug 3 fix: actualizar acumulado en el préstamo para mostrarlo en el listado sin re-consultar pagos
    const p=prestamos.find(x=>x.id===prestamoId);
    if(p){
      if(tipoRegistro==='interes'){
        const nuevoTotal=(p.totalInteresesCobrados||0)+monto;
        await updateDoc(doc(db,'prestamos',prestamoId),{totalInteresesCobrados:nuevoTotal});
      } else {
        const nuevoAbonado=(p.totalAbonado||0)+monto;
        await updateDoc(doc(db,'prestamos',prestamoId),{totalAbonado:nuevoAbonado});
      }
    }
    closeModal('modal-pago');
    showToast(tipoRegistro==='interes'?'🔄 Interés registrado':'💵 Abono registrado');
    // Volver a abrir el detail del préstamo
    setTimeout(()=>showPrestamoDetail(prestamoId),300);
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
          <span>Cobrado: <strong style="color:var(--amber)">${fmt(p.totalInteresesCobrados||0)}</strong></span>
        </div>
      </div>`).join('');
  content.innerHTML=summaryHTML+prestamosHTML;
}

// ── MAIN RENDER ───────────────────────────────────────
function render(){
  document.getElementById('fab-btn').textContent=currentTab==='prestamos'?'＋ Nuevo préstamo':'＋ Agregar movimiento';
  updateHeader();
  rebuildNavTabs();
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
document.getElementById('fab-btn').addEventListener('click',async()=>{
  if(currentTab==='prestamos'){clearPrestamoForm();openModal('modal-prestamo');return;}
  const q=getCurrentQ();
  if(!q){await renderQuincenaList();openModal('modal-quincena');return;}
  editingMovId=null;
  document.getElementById('modal-add-title').textContent='Nuevo movimiento';
  currentType='gasto';currentDestino='ahorro';selectedCat='otro';
  document.getElementById('input-monto').value='';
  document.getElementById('input-desc').value='';
  document.getElementById('input-fecha').value=today();
  document.getElementById('destino-wrap').style.display='none';
  document.getElementById('ahorro-transfer-hint').style.display='none';
  document.getElementById('cat-wrap').style.display='block';
  renderTypeToggle();renderDestinoToggle();renderCatGrid();
  openModal('modal-add');
});

document.getElementById('quincena-badge-btn').addEventListener('click',async()=>{
  await renderQuincenaList();
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
  document.getElementById('type-ahorro-transfer').className='type-btn'+(currentType==='ahorro-transfer'?' active-ahorro':'');
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

// CAMBIO: al ahorro también muestra categorías; solo se ocultan si… nada, siempre visibles
window.setType=t=>{
  if(t === 'ahorro-transfer' && userConfig?.sections?.ahorro === false){
    showToast('💰 Activa la sección Ahorro en ⚙️ Config. para usarla');
    return;
  }
  currentType=t;renderTypeToggle();
  const isIngreso=t==='ingreso';
  const isAhorroTransfer=t==='ahorro-transfer';
  document.getElementById('destino-wrap').style.display=isIngreso?'block':'none';
  document.getElementById('ahorro-transfer-hint').style.display=isAhorroTransfer?'block':'none';
  // Ocultar categorías para ahorro-transfer e ingreso
  document.getElementById('cat-wrap').style.display=(isAhorroTransfer||isIngreso)?'none':'block';
};
window.setDestino=d=>{
  currentDestino=d;renderDestinoToggle();
  document.getElementById('cat-wrap').style.display=(currentType==='ingreso'||currentType==='ahorro-transfer')?'none':'block';
};
window.selectCat=id=>{selectedCat=id;renderCatGrid();};

['p-capital','p-interes'].forEach(id=>{
  const el=document.getElementById(id);
  if(el)el.addEventListener('input',updatePrestamoPreview);
});

// ── NAV TABS: respetar secciones activas ──────────────
function getActiveTabs(){
  const tabs=['movimientos','resumen'];
  if(!userConfig||userConfig.sections?.ahorro!==false) tabs.push('ahorro');
  if(!userConfig||userConfig.sections?.prestamos!==false) tabs.push('prestamos');
  return tabs;
}

function rebuildNavTabs(){
  const tabs=getActiveTabs();
  const labels={movimientos:'Movimientos',resumen:'Resumen',ahorro:'Ahorro',prestamos:'Préstamos'};
  const nav=document.querySelector('.nav-tabs');
  if(!nav)return;
  nav.innerHTML=tabs.map(t=>`<div class="nav-tab${t===currentTab?' active':''}" data-tab="${t}">${labels[t]}</div>`).join('');
  nav.querySelectorAll('.nav-tab').forEach(tab=>{
    tab.addEventListener('click',()=>{
      nav.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      currentTab=tab.dataset.tab;
      render();
    });
  });
  if(!tabs.includes(currentTab)) currentTab='movimientos';
}

// ── USER CONFIG ────────────────────────────────────────
function applyUserConfig(){
  if(!userConfig) return;
  // Aplicar categorías
  if(userConfig.cats && userConfig.cats.length>0){
    CATS=[...userConfig.cats, CAT_OTRO];
    // Rebuilding CAT_COLORS
    userConfig.cats.forEach((c,i)=>{
      CAT_COLORS[c.id]=c.color||CAT_COLOR_POOL[i%CAT_COLOR_POOL.length];
    });
    CAT_COLORS['otro']='#a09dba';
  }
  rebuildNavTabs();
}

// ── SETUP SCREEN ───────────────────────────────────────

// ── SETUP STEPS ───────────────────────────────────────
let setupCurrentStep = 1;

window.setupGoStep = step => {
  if(step > setupCurrentStep && setupCurrentStep === 1){
    if(setupCats.length < 3){ showToast("Necesitas al menos 3 categorías"); return; }
  }
  setupCurrentStep = step;
  [1,2,3].forEach(s => {
    const el = document.getElementById("setup-step-"+s);
    if(el) el.style.display = s === step ? "block" : "none";
  });
  document.querySelectorAll(".setup-step-item").forEach(item => {
    const s = parseInt(item.dataset.step);
    item.classList.remove("active","done");
    if(s === step) item.classList.add("active");
    else if(s < step) item.classList.add("done");
  });
  document.querySelectorAll(".setup-step-line").forEach((line, i) => {
    line.classList.toggle("done", i + 1 < step);
  });
  if(step === 3){
    const d = new Date(), day = d.getDate();
    let ini, fin;
    if(day <= 15){
      ini = d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-01";
      fin = d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-15";
    } else {
      const last = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
      ini = d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-16";
      fin = d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+last;
    }
    if(!document.getElementById("setup-q-inicio").value) document.getElementById("setup-q-inicio").value = ini;
    if(!document.getElementById("setup-q-fin").value) document.getElementById("setup-q-fin").value = fin;
  }
  document.getElementById("setup-screen").scrollTo({top:0, behavior:"smooth"});
};

function showSetupScreen(){
  setupCats=[...DEFAULT_CATS];
  setupCurrentStep=1;
  document.getElementById('setup-screen').style.display='flex';
  // Show only step 1
  [1,2,3].forEach(s=>{
    const el=document.getElementById('setup-step-'+s);
    if(el) el.style.display=s===1?'block':'none';
  });
  document.querySelectorAll('.setup-step-item').forEach(item=>{
    item.classList.remove('active','done');
    if(parseInt(item.dataset.step)===1) item.classList.add('active');
  });
  document.querySelectorAll('.setup-step-line').forEach(l=>l.classList.remove('done'));
  renderSetupCatList();
  renderSetupPreview();
}

function renderSetupCatList(){
  const list=document.getElementById('setup-cat-list');
  // draggable items (without "otro")
  list.innerHTML=setupCats.map((c,i)=>`
    <div class="setup-cat-item" draggable="true" data-idx="${i}" 
         ondragstart="onDragStart(event,${i})"
         ondragover="onDragOver(event,${i})"
         ondragend="onDragEnd(event)"
         ondrop="onDrop(event,${i})">
      <div class="drag-handle">⠿</div>
      <div class="setup-cat-emoji-badge">${c.emoji}</div>
      <div class="setup-cat-name">${c.label}</div>
      <div class="setup-cat-actions">
        <button class="setup-cat-action edit" onclick="openEditCat(${i})">✏️</button>
        <button class="setup-cat-action del" onclick="tryDeleteSetupCat(${i})">🗑️</button>
      </div>
    </div>`).join('')+
    `<div class="setup-cat-item fixed-item">
      <div class="drag-handle" style="opacity:0.3">⠿</div>
      <div class="setup-cat-emoji-badge">📦</div>
      <div class="setup-cat-name">Otro</div>
      <div style="font-size:11px;color:var(--text3)">Fija</div>
    </div>`;
  // Mobile touch drag support
  addTouchDragToList();
}

function renderSetupPreview(){
  const grid=document.getElementById('setup-cat-preview');
  const allCats=[...setupCats,CAT_OTRO];
  grid.innerHTML=allCats.map(c=>`
    <div class="cat-btn ${c.id==='otro'?'selected':''}" style="pointer-events:none">
      <span class="cat-emoji">${c.emoji}</span>${c.label}
    </div>`).join('');
}

// ── DRAG & DROP ────────────────────────────────────────
window.onDragStart=(e,idx)=>{
  setupDragIdx=idx;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed='move';
};
window.onDragOver=(e,idx)=>{
  e.preventDefault();
  e.dataTransfer.dropEffect='move';
  document.querySelectorAll('.setup-cat-item').forEach(el=>el.classList.remove('drag-over'));
  if(idx!==setupDragIdx){
    e.currentTarget.classList.add('drag-over');
    setupDragOverIdx=idx;
  }
};
window.onDragEnd=(e)=>{
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.setup-cat-item').forEach(el=>el.classList.remove('drag-over'));
};
window.onDrop=(e,idx)=>{
  e.preventDefault();
  if(setupDragIdx===null||setupDragIdx===idx) return;
  const moved=setupCats.splice(setupDragIdx,1)[0];
  setupCats.splice(idx,0,moved);
  setupDragIdx=null;
  renderSetupCatList();
  renderSetupPreview();
};

// Touch drag for mobile — solo se activa desde el drag-handle (⠿)
function addTouchDragToList(){
  const items=[...document.querySelectorAll('#setup-cat-list .setup-cat-item:not(.fixed-item)')];
  items.forEach((item,idx)=>{
    const handle=item.querySelector('.drag-handle');
    if(!handle) return;

    handle.addEventListener('touchstart',e=>{
      e.preventDefault(); // evitar scroll cuando se toca el handle
      setupDragIdx=parseInt(item.dataset.idx);
      item.classList.add('dragging');
    },{passive:false});

    handle.addEventListener('touchmove',e=>{
      if(setupDragIdx===null) return;
      e.preventDefault();
      const y=e.touches[0].clientY;
      const allItems=[...document.querySelectorAll('#setup-cat-list .setup-cat-item:not(.fixed-item)')];
      allItems.forEach((el,i)=>{
        const rect=el.getBoundingClientRect();
        if(y>=rect.top&&y<=rect.bottom&&i!==setupDragIdx){
          el.classList.add('drag-over');
          setupDragOverIdx=i;
        } else {
          el.classList.remove('drag-over');
        }
      });
    },{passive:false});

    handle.addEventListener('touchend',e=>{
      if(setupDragIdx===null) return;
      item.classList.remove('dragging');
      document.querySelectorAll('.setup-cat-item').forEach(el=>el.classList.remove('drag-over'));
      if(setupDragOverIdx!==null&&setupDragOverIdx!==setupDragIdx){
        const moved=setupCats.splice(setupDragIdx,1)[0];
        setupCats.splice(setupDragOverIdx,0,moved);
      }
      setupDragIdx=null; setupDragOverIdx=null;
      renderSetupCatList();
      renderSetupPreview();
    });
  });
}

window.showAddCatForm=()=>{
  if(setupCats.length>=7){showToast('Máximo 7 categorías');return;}
  document.getElementById('setup-add-cat-form').style.display='block';
  document.getElementById('setup-add-cat-btn').style.display='none';
  document.getElementById('new-cat-emoji').value='';
  document.getElementById('new-cat-name').value='';
};
window.cancelAddCat=()=>{
  document.getElementById('setup-add-cat-form').style.display='none';
  document.getElementById('setup-add-cat-btn').style.display='block';
};
window.addSetupCat=()=>{
  const emoji=document.getElementById('new-cat-emoji').value.trim();
  const name=document.getElementById('new-cat-name').value.trim();
  if(!emoji){showToast('Pon un emoji');return;}
  if(!name){showToast('Pon un nombre');return;}
  if(setupCats.length>=7){showToast('Máximo 7 categorías');return;}
  if(/^[a-zA-Z0-9]/.test(emoji)){showToast('⚠️ Pon un emoji, no letras');return;}
  const dupName=setupCats.find(c=>c.label.toLowerCase()===name.toLowerCase());
  if(dupName){showToast(`⚠️ Ya tienes una categoría llamada "${name}"`);return;}
  const dupEmoji=setupCats.find(c=>c.emoji===emoji);
  if(dupEmoji){showToast(`⚠️ El emoji ${emoji} ya lo usa "${dupEmoji.label}"`);return;}
  const id='cat_'+Date.now();
  setupCats.push({id,label:name,emoji,color:CAT_COLOR_POOL[setupCats.length%CAT_COLOR_POOL.length]});
  cancelAddCat();
  renderSetupCatList();
  renderSetupPreview();
};

window.tryDeleteSetupCat=i=>{
  if(setupCats.length<=3){showToast('Mínimo 3 categorías');return;}
  const catId=setupCats[i].id;
  const inUse=movimientos.some(m=>m.cat===catId);
  if(inUse){showToast('⚠️ Esta categoría está en uso, no puedes eliminarla');return;}
  showConfirm(`¿Eliminar "${setupCats[i].label}"?`,'Esta categoría se quitará de tu lista.','🗑️',()=>{
    setupCats.splice(i,1);
    renderSetupCatList();
    renderSetupPreview();
  });
};

window.openEditCat=i=>{
  document.getElementById('edit-cat-idx').value=i;
  document.getElementById('edit-cat-emoji').value=setupCats[i].emoji;
  document.getElementById('edit-cat-name').value=setupCats[i].label;
  openModal('modal-edit-cat');
};
window.saveEditCat=()=>{
  const i=parseInt(document.getElementById('edit-cat-idx').value);
  const emoji=document.getElementById('edit-cat-emoji').value.trim();
  const name=document.getElementById('edit-cat-name').value.trim();
  if(!emoji||!name){showToast('Emoji y nombre son obligatorios');return;}
  // Validate emoji (must be emoji character, not letters)
  if(/^[a-zA-Z0-9]/.test(emoji)){showToast('⚠️ Pon un emoji, no letras');return;}
  // Duplicate name check (excluding self)
  const dupName=setupCats.find((c,idx)=>idx!==i&&c.label.toLowerCase()===name.toLowerCase());
  if(dupName){showToast(`⚠️ Ya tienes una categoría llamada "${name}"`);return;}
  // Duplicate emoji check (excluding self)
  const dupEmoji=setupCats.find((c,idx)=>idx!==i&&c.emoji===emoji);
  if(dupEmoji){showToast(`⚠️ El emoji ${emoji} ya lo usa "${dupEmoji.label}"`);return;}
  setupCats[i]={...setupCats[i],emoji,label:name};
  const origin=document.getElementById('modal-edit-cat').dataset.origin||'setup';
  closeModal('modal-edit-cat');
  renderSetupCatList();
  renderSetupPreview();
  renderSettingsCatList();
  renderSettingsCatPreview();
  if(origin==='settings'){
    // Persistir inmediatamente en Firestore y actualizar CATS en memoria
    const cats=setupCats.map((c,idx)=>({...c,color:c.color||CAT_COLOR_POOL[idx%CAT_COLOR_POOL.length]}));
    userConfig={...userConfig,cats};
    setDoc(doc(db,'userConfig',currentUser.uid),userConfig).catch(()=>showToast('Error al guardar'));
    applyUserConfig();
    render();
    showToast('✅ Categoría actualizada');
    setTimeout(()=>openModal('modal-settings'),200);
  }
};

window.saveSetup=async()=>{
  if(setupCats.length<3){showToast('Necesitas al menos 3 categorías');return;}
  // Validar quincena del paso 3
  const qInicio=document.getElementById('setup-q-inicio').value;
  const qFin=document.getElementById('setup-q-fin').value;
  const qSaldo=parseFloat(document.getElementById('setup-q-saldo').value);
  if(!qInicio||!qFin||isNaN(qSaldo)||qSaldo<0){showToast('Completa los datos de tu quincena');return;}
  // Mostrar overlay de carga
  const overlay=document.getElementById('setup-saving-overlay');
  const splashMsg=document.getElementById('splash-msg');
  if(splashMsg) splashMsg.textContent='Personalizando tu perfil...';
  overlay.style.display='flex';
  try {
    const cats=setupCats.map((c,i)=>({...c,color:c.color||CAT_COLOR_POOL[i%CAT_COLOR_POOL.length]}));
    const sections={
      ahorro:document.getElementById('setup-switch-ahorro').checked,
      prestamos:document.getElementById('setup-switch-prestamos').checked
    };
    userConfig={cats,sections};
    await setDoc(doc(db,'userConfig',currentUser.uid),userConfig);
    applyUserConfig();
    // Crear primera quincena
    const ref=await addDoc(collection(db,'quincenas'),{uid:currentUser.uid,inicio:qInicio,fin:qFin,saldo:qSaldo,createdAt:Date.now()});
    currentQuincenaId=ref.id;
    await new Promise(r=>setTimeout(r,1800));
    overlay.style.display='none';
    document.getElementById('setup-screen').style.display='none';
    const am=document.getElementById('app-main');
    am.style.display='flex'; am.style.flexDirection='column';
    startListeners();
    // Marcar tutorial para mostrar
    if(!localStorage.getItem('monify_tutorial_done')) localStorage.setItem('monify_show_tutorial','1');
  } catch(e){
    overlay.style.display='none';
    showToast('Error al guardar configuración');
  }
};

// ── SETTINGS (volver a config desde perfil) ────────────
window.openSettings=()=>{
  closeModal('modal-perfil');
  // Cerrar subpaneles por si quedaron abiertos
  const panelCats=document.getElementById('settings-subpanel-cats');
  if(panelCats) panelCats.classList.remove('open');
  const panelSec=document.getElementById('settings-subpanel-sections');
  if(panelSec) panelSec.classList.remove('open');
  // Cargar config actual en el modal de settings
  if(userConfig&&userConfig.cats) setupCats=userConfig.cats.map(c=>({...c}));
  else setupCats=[...DEFAULT_CATS];
  document.getElementById('settings-switch-ahorro').checked=userConfig?.sections?.ahorro||false;
  document.getElementById('settings-switch-prestamos').checked=userConfig?.sections?.prestamos||false;
  renderSettingsCatList();
  renderSettingsCatPreview();
  openModal('modal-settings');
};

window.saveSettings=async()=>{
  if(setupCats.length<3){showToast('Necesitas al menos 3 categorías');return;}
  const overlay=document.getElementById('setup-saving-overlay');
  const splashMsg=document.getElementById('splash-msg');
  if(splashMsg) splashMsg.textContent='Guardando configuración...';
  overlay.style.display='flex';
  try {
    const cats=setupCats.map((c,i)=>({...c,color:c.color||CAT_COLOR_POOL[i%CAT_COLOR_POOL.length]}));
    const ahorroChecked=document.getElementById('settings-switch-ahorro').checked;
    const prestamosChecked=document.getElementById('settings-switch-prestamos').checked;
    // Detect if sections were just enabled (for tutorial)
    const ahorroJustEnabled = ahorroChecked && userConfig?.sections?.ahorro===false;
    const prestamosJustEnabled = prestamosChecked && userConfig?.sections?.prestamos===false;
    const sections={ahorro:ahorroChecked,prestamos:prestamosChecked};
    userConfig={cats,sections};
    await setDoc(doc(db,'userConfig',currentUser.uid),userConfig);
    applyUserConfig();
    await new Promise(r=>setTimeout(r,900));
    overlay.style.display='none';
    closeModal('modal-settings');
    render();
    showToast('✅ Configuración guardada');
    // Tutorial para secciones recién activadas
    if(ahorroJustEnabled && !localStorage.getItem('monify_tutorial_ahorro')){
      currentTab='ahorro'; render();
      setTimeout(()=>startSectionTutorial('ahorro'), 500);
    } else if(prestamosJustEnabled && !localStorage.getItem('monify_tutorial_prestamos')){
      currentTab='prestamos'; render();
      setTimeout(()=>startSectionTutorial('prestamos'), 500);
    }
  } catch(e){
    overlay.style.display='none';
    showToast('Error al guardar');
  }
};

function renderSettingsCatList(){
  const list=document.getElementById('settings-cat-list');
  if(!list) return;
  list.innerHTML=setupCats.map((c,i)=>`
    <div class="setup-cat-item" draggable="true" data-idx="${i}"
         ondragstart="onDragStart(event,${i})"
         ondragover="onDragOver(event,${i})"
         ondragend="onDragEnd(event)"
         ondrop="onDrop(event,${i})">
      <div class="drag-handle">⠿</div>
      <div class="setup-cat-emoji-badge">${c.emoji}</div>
      <div class="setup-cat-name">${c.label}</div>
      <div class="setup-cat-actions">
        <button class="setup-cat-action edit" onclick="openEditSettingsCat(${i})">✏️</button>
        <button class="setup-cat-action del" onclick="tryDeleteSettingsCat(${i})">🗑️</button>
      </div>
    </div>`).join('')+
    `<div class="setup-cat-item fixed-item">
      <div class="drag-handle" style="opacity:0.3">⠿</div>
      <div class="setup-cat-emoji-badge">📦</div>
      <div class="setup-cat-name">Otro</div>
      <div style="font-size:11px;color:var(--text3)">Fija</div>
    </div>`;
}

function renderSettingsCatPreview(){
  const grid=document.getElementById('settings-cat-preview');
  if(!grid) return;
  const allCats=[...setupCats,CAT_OTRO];
  grid.innerHTML=allCats.map(c=>`
    <div class="cat-btn ${c.id==='otro'?'selected':''}" style="pointer-events:none">
      <span class="cat-emoji">${c.emoji}</span>${c.label}
    </div>`).join('');
}

// Helpers para settings cats (reusan setupCats igual que el setup)
window.openEditSettingsCat=i=>{
  document.getElementById('edit-cat-idx').value=i;
  document.getElementById('edit-cat-emoji').value=setupCats[i].emoji;
  document.getElementById('edit-cat-name').value=setupCats[i].label;
  document.getElementById('modal-edit-cat').dataset.origin='settings';
  closeModal('modal-settings');
  setTimeout(()=>openModal('modal-edit-cat'),200);
};

window.tryDeleteSettingsCat=i=>{
  if(setupCats.length<=3){showToast('Mínimo 3 categorías');return;}
  const catId=setupCats[i].id;
  const inUse=movimientos.some(m=>m.cat===catId);
  if(inUse){showToast('⚠️ Esta categoría está en uso, no puedes eliminarla');return;}
  // Cerrar settings primero para que el confirm no quede detrás
  closeModal('modal-settings');
  setTimeout(()=>{
    showConfirm(`¿Eliminar "${setupCats[i].label}"?`,'Esta categoría se quitará de tu lista.','🗑️',()=>{
      setupCats.splice(i,1);
      renderSettingsCatList();
      renderSettingsCatPreview();
      showToast('🗑️ Categoría eliminada');
      // Regresar al modal de settings y abrir directo el subpanel de cats
      setTimeout(()=>{
        openModal('modal-settings');
        setTimeout(()=>openSettingsCats(),50);
      },200);
    });
  },350);
};

// ── Subpanel Categorías (deslizable) ──
window.openSettingsCats=()=>{
  const panel=document.getElementById('settings-subpanel-cats');
  if(panel) panel.classList.add('open');
};
window.closeSettingsCats=()=>{
  const panel=document.getElementById('settings-subpanel-cats');
  if(panel) panel.classList.remove('open');
};

// ── Subpanel Secciones (deslizable) ──
window.openSettingsSections=()=>{
  const panel=document.getElementById('settings-subpanel-sections');
  if(panel) panel.classList.add('open');
};
window.closeSettingsSections=()=>{
  const panel=document.getElementById('settings-subpanel-sections');
  if(panel) panel.classList.remove('open');
};

// Also hook the drag-drop callbacks to refresh settings preview
const _origOnDrop=window.onDrop;
window.onDrop=(e,idx)=>{
  _origOnDrop(e,idx);
  renderSettingsCatPreview();
  renderSettingsCatList();
};

// Override saveSetup para modo edición (sabe si ya tiene config)
// La función saveSetup ya guarda correctamente en ambos casos.

// ── MULTI-CUENTA ────────────────────────────────────────
function saveAccountLocally(uid,displayName,email){
  try {
    let accounts=JSON.parse(localStorage.getItem('monify_accounts')||'[]');
    const existing=accounts.findIndex(a=>a.uid===uid);
    const entry={uid,displayName,email};
    if(existing>=0) accounts[existing]=entry;
    else accounts.push(entry);
    // Máximo 2 cuentas
    if(accounts.length>2) accounts=accounts.slice(-2);
    localStorage.setItem('monify_accounts',JSON.stringify(accounts));
  } catch(e){}
}

function loadSavedAccounts(){
  try {
    savedAccounts=JSON.parse(localStorage.getItem('monify_accounts')||'[]');
  } catch(e){ savedAccounts=[]; }
}

window.openAccountsModal=async()=>{
  closeModal('modal-perfil');
  loadSavedAccounts();
  renderAccountsList();
  openModal('modal-accounts');
};

function renderAccountsList(){
  const list=document.getElementById('accounts-list');
  const addBtn=document.getElementById('add-account-btn');
  list.innerHTML=savedAccounts.map(a=>{
    const isActive=currentUser&&a.uid===currentUser.uid;
    const onclick=isActive?'':'onclick="switchToAccount(\''+a.uid+'\',\''+a.email+'\')"';
    return '<div class="account-item '+(isActive?'active-account':'')+'" '+onclick+'>'
      +'<div class="account-avatar">'+getInitials(a.displayName)+'</div>'
      +'<div class="account-info">'
      +'<div class="account-name">'+a.displayName+'</div>'
      +'<div class="account-email">'+a.email+'</div>'
      +'</div>'
      +(isActive?'<div class="account-active-badge">Activa</div>':'')
      +'</div>';
  }).join('');
  // Solo mostrar botón agregar si hay menos de 2 cuentas
  addBtn.style.display=savedAccounts.length>=2?'none':'block';
}

window.switchToAccount=async(uid,email)=>{
  closeModal('modal-accounts');
  // Guardamos el email destino: loginEmail lo usará para mostrar el splash al autenticar
  window._switchingToEmail=email;
  if(unsubMovs)unsubMovs(); if(unsubQs)unsubQs(); if(unsubPrestamos)unsubPrestamos();
  await signOut(auth);
  // onAuthStateChanged mostrará el form con el email prellenado
};

window.startAddAccount=()=>{
  closeModal('modal-accounts');
  setTimeout(()=>{
    if(unsubMovs)unsubMovs(); if(unsubQs)unsubQs(); if(unsubPrestamos)unsubPrestamos();
    signOut(auth).then(()=>showToast('Inicia sesión con la segunda cuenta'));
  },350);
};

// ── CONFIGURACIÓN DE SECCIONES (desde settings ya guardado) ──
// Override del switch en settings: avisar si hay datos activos
async function checkSectionDisable(section,isChecked){
  if(isChecked) return; // activando, sin problema
  if(section==='ahorro'){
    // Check across ALL quincenas in Firestore, not just current period
    let hasAhorro = movimientos.some(m=>(m.type==='ingreso'&&m.destino==='ahorro')||m.type==='ahorro-transfer');
    if(!hasAhorro && currentUser){
      try {
        const snap = await getDocs(query(
          collection(db,'movimientos'),
          where('uid','==',currentUser.uid),
          where('type','in',['ahorro-transfer','ingreso'])
        ));
        hasAhorro = snap.docs.some(d=>{
          const m=d.data();
          return m.type==='ahorro-transfer'||(m.type==='ingreso'&&m.destino==='ahorro');
        });
      } catch(e){}
    }
    if(hasAhorro) showToast('⚠️ Tienes ahorros registrados en esta u otra quincena. Se guardarán y se ocultará la sección.', 4500);
  }
  if(section==='prestamos'){
    const hasActive=prestamos.some(p=>p.status==='activo');
    if(hasActive) showToast('⚠️ Tienes préstamos activos en esta u otra quincena. Se guardarán y se ocultará la sección.', 4500);
  }
}

document.getElementById('setup-switch-ahorro').addEventListener('change',e=>{
  checkSectionDisable('ahorro',e.target.checked);
});
document.getElementById('setup-switch-prestamos').addEventListener('change',e=>{
  checkSectionDisable('prestamos',e.target.checked);
});

renderCatGrid();
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});

// ── TUTORIAL ──────────────────────────────────────────
const TUTORIAL_STEPS_BASE = [
  {
    selector: '.balance-card',
    text: '💰 Aquí ves tu resumen financiero: saldo inicial, lo disponible, cuánto has gastado y cuánto has ahorrado en esta quincena.',
    position: 'bottom'
  },
  {
    selector: '.quincena-badge',
    text: '📅 Aquí aparece tu quincena activa. Tócala para cambiar de quincena, crear una nueva o editar la actual.',
    position: 'bottom'
  },
  {
    selector: '.nav-tabs',
    text: '🗂️ Estas pestañas te llevan a tus movimientos, resumen por categoría, ahorro y préstamos.',
    position: 'bottom'
  },
  {
    selector: '.fab',
    text: '➕ Este botón es para agregar un movimiento. ¡Toca Siguiente para ver cómo funciona!',
    position: 'top',
    action: 'open-modal-add'
  },
  // Steps 4–6 are the modal sub-steps (injected dynamically at runtime)
  // Step: avatar
  {
    selector: '.avatar-btn',
    text: '👤 Tu perfil: cambia tu nombre, gestiona cuentas o ajusta la configuración de secciones.',
    position: 'bottom'
  }
];

// Modal sub-steps (inserted after FAB step)
const TUTORIAL_MODAL_STEPS = [
  {
    selector: '#type-gasto',
    text: '🛍️ "Gasto" para registrar cualquier cosa que gastes: comida, transporte, servicios...',
    position: 'bottom',
    modalOpen: true
  },
  {
    selector: '#type-ahorro-transfer',
    text: '💰 "Ahorro" para mover dinero de tu disponible a tu ahorro personal.',
    position: 'bottom',
    modalOpen: true
  },
  {
    selector: '#type-ingreso',
    text: '💲 "Extra" para registrar ingresos adicionales: bonos, regalos, ventas...',
    position: 'bottom',
    modalOpen: true,
    action: 'close-modal-add'
  }
];

// Section steps (appended if sections active from setup)
const TUTORIAL_AHORRO_STEPS = [
  { selector: '.nav-tab[data-tab="ahorro"]', text: '💰 Esta es la pestaña de Ahorro. Aquí verás el total que has guardado en la quincena.', position: 'bottom', action: 'switch-tab-ahorro' },
  { selector: '.ahorro-saved-card', text: '💰 Aquí ves el total ahorrado esta quincena. Cada depósito al ahorro se suma aquí.', position: 'bottom' },
  { selector: '.fab', text: '➕ Para guardar ahorro, toca este botón, selecciona "Ahorro" y listo.', position: 'top' }
];
const TUTORIAL_PRESTAMOS_STEPS = [
  { selector: '.nav-tab[data-tab="prestamos"]', text: '🤝 Esta es la pestaña de Préstamos. Registra y controla lo que prestas.', position: 'bottom', action: 'switch-tab-prestamos' },
  { selector: '.fab', text: '➕ Toca aquí para registrar un nuevo préstamo. Puedes poner interés, fecha y notas.', position: 'top' }
];

let TUTORIAL_STEPS = [...TUTORIAL_STEPS_BASE];
let tutorialStep = 0;
let tutorialActive = false;
let tutorialAnimFrame = null;

function buildTutorialSteps(){
  // Base: balance, quincena, nav, fab
  const base = TUTORIAL_STEPS_BASE.slice(0, 4); // up to FAB
  const modalSteps = TUTORIAL_MODAL_STEPS;
  const avatar = TUTORIAL_STEPS_BASE[4];
  let steps = [...base, ...modalSteps];
  // Append section steps if active from setup
  if(userConfig?.sections?.ahorro !== false){
    steps = steps.concat(TUTORIAL_AHORRO_STEPS);
  }
  if(userConfig?.sections?.prestamos !== false){
    steps = steps.concat(TUTORIAL_PRESTAMOS_STEPS);
  }
  steps.push(avatar);
  TUTORIAL_STEPS = steps;
}

function startTutorial(){
  buildTutorialSteps();
  tutorialStep = 0;
  tutorialActive = true;
  document.getElementById('tutorial-overlay').style.display = 'block';
  renderTutorialStep();
}

async function renderTutorialStep(){
  if(tutorialStep >= TUTORIAL_STEPS.length){ endTutorial(); return; }
  const step = TUTORIAL_STEPS[tutorialStep];

  // Handle actions before rendering
  if(step.action === 'open-modal-add'){
    // open the add modal
    _origOpenModal('modal-add');
    await new Promise(r => setTimeout(r, 350));
  } else if(step.action === 'close-modal-add'){
    // will close after user clicks next; handled in next-btn handler
  } else if(step.action === 'switch-tab-ahorro'){
    currentTab = 'ahorro';
    render();
    await new Promise(r => setTimeout(r, 300));
  } else if(step.action === 'switch-tab-prestamos'){
    currentTab = 'prestamos';
    render();
    await new Promise(r => setTimeout(r, 300));
  }

  const target = document.querySelector(step.selector);
  const badge = document.getElementById('tutorial-step-badge');
  const text = document.getElementById('tutorial-text');
  const nextBtn = document.getElementById('tutorial-next-btn');

  badge.textContent = `Paso ${tutorialStep+1} de ${TUTORIAL_STEPS.length}`;
  text.textContent = step.text;
  nextBtn.textContent = tutorialStep === TUTORIAL_STEPS.length - 1 ? '¡Listo! ✓' : 'Siguiente →';

  drawTutorialCanvas(target);
  positionTutorialTooltip(target, step.position);
}

function drawTutorialCanvas(target){
  const canvas = document.getElementById('tutorial-canvas');
  const overlay = document.getElementById('tutorial-overlay');
  canvas.width = overlay.offsetWidth;
  canvas.height = overlay.offsetHeight;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  if(target){
    const r = target.getBoundingClientRect();
    const pad = 8;
    const x = r.left - pad, y = r.top - pad;
    const w = r.width + pad*2, h = r.height + pad*2;
    const radius = 12;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(x+radius, y);
    ctx.lineTo(x+w-radius, y);
    ctx.arcTo(x+w,y, x+w,y+radius, radius);
    ctx.lineTo(x+w, y+h-radius);
    ctx.arcTo(x+w,y+h, x+w-radius,y+h, radius);
    ctx.lineTo(x+radius, y+h);
    ctx.arcTo(x,y+h, x,y+h-radius, radius);
    ctx.lineTo(x, y+radius);
    ctx.arcTo(x,y, x+radius,y, radius);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function positionTutorialTooltip(target, position){
  const tooltip = document.getElementById('tutorial-tooltip');
  const overlay = document.getElementById('tutorial-overlay');
  const ow = overlay.offsetWidth, oh = overlay.offsetHeight;
  const tw = tooltip.offsetWidth || 280;
  const th = tooltip.offsetHeight || 120;
  let top, left;

  if(target){
    const r = target.getBoundingClientRect();
    left = Math.min(Math.max(r.left, 16), ow - tw - 16);
    if(position === 'bottom'){
      top = r.bottom + 16;
      if(top + th > oh - 16) top = r.top - th - 16;
    } else {
      top = r.top - th - 16;
      if(top < 16) top = r.bottom + 16;
    }
  } else {
    left = (ow - tw) / 2;
    top = (oh - th) / 2;
  }

  tooltip.style.top = top + 'px';
  tooltip.style.left = left + 'px';
}

function endTutorial(){
  tutorialActive = false;
  // Close modal-add if it was opened during tutorial
  document.getElementById('modal-add')?.classList.remove('open');
  document.getElementById('tutorial-overlay').style.display = 'none';
  localStorage.removeItem('monify_show_tutorial');
  localStorage.setItem('monify_tutorial_done','1');
  // Mark section tutorials as done if they were included
  if(userConfig?.sections?.ahorro !== false) localStorage.setItem('monify_tutorial_ahorro','1');
  if(userConfig?.sections?.prestamos !== false) localStorage.setItem('monify_tutorial_prestamos','1');
  // Return to movimientos tab
  currentTab = 'movimientos';
  render();
}

document.getElementById('tutorial-next-btn').addEventListener('click', async ()=>{
  const prevStep = TUTORIAL_STEPS[tutorialStep];
  // If leaving the last modal sub-step, close the modal first
  if(prevStep?.action === 'close-modal-add'){
    document.getElementById('modal-add')?.classList.remove('open');
    await new Promise(r => setTimeout(r, 300));
  }
  tutorialStep++;
  renderTutorialStep();
});
document.getElementById('tutorial-skip-btn').addEventListener('click', endTutorial);

// Redraw on resize
window.addEventListener('resize', ()=>{ if(tutorialActive) renderTutorialStep(); });

// ── AHORRO BUTTON DISABLE LOGIC ────────────────────────
function updateAhorroBtn(){
  const ahorroEnabled = userConfig?.sections?.ahorro !== false;
  const btnAhorro = document.getElementById('dest-ahorro');
  if(btnAhorro){
    if(ahorroEnabled){
      btnAhorro.classList.remove('disabled-section');
      btnAhorro.title = '';
    } else {
      btnAhorro.classList.add('disabled-section');
      btnAhorro.title = 'Activa la sección Ahorro en Configuración para usarla';
      if(currentDestino === 'ahorro'){
        currentDestino = 'disponible';
        renderDestinoToggle();
      }
    }
  }
  // Also block the "Ahorro" type button (ahorro-transfer)
  const btnTypeAhorro = document.getElementById('type-ahorro-transfer');
  if(btnTypeAhorro){
    if(ahorroEnabled){
      btnTypeAhorro.classList.remove('disabled-section');
      btnTypeAhorro.title = '';
    } else {
      btnTypeAhorro.classList.add('disabled-section');
      btnTypeAhorro.title = 'Activa la sección Ahorro en Configuración para usarla';
      if(currentType === 'ahorro-transfer'){
        currentType = 'gasto';
        renderTypeToggle();
        document.getElementById('destino-wrap').style.display='none';
        document.getElementById('ahorro-transfer-hint').style.display='none';
        document.getElementById('cat-wrap').style.display='block';
      }
    }
  }
}

// Override setDestino to check if ahorro is enabled
const _origSetDestino = window.setDestino;
window.setDestino = d => {
  if(d === 'ahorro' && userConfig?.sections?.ahorro === false){
    showToast('💰 Activa la sección Ahorro en ⚙️ Config. para usarla');
    return;
  }
  _origSetDestino(d);
  updateAhorroBtn();
};

// Hook into openModal for modal-add to refresh button state
const _origOpenModal = window.openModal;
window.openModal = id => {
  _origOpenModal(id);
  if(id === 'modal-add') setTimeout(updateAhorroBtn, 50);
};

// Hook into FAB click to also check after renderDestinoToggle
const fabBtn = document.getElementById('fab-btn');
fabBtn.addEventListener('click', ()=>{ setTimeout(updateAhorroBtn, 60); }, true);


// ── SECTION TUTORIALS ────────────────────────────────
// TUTORIAL_AHORRO and TUTORIAL_PRESTAMOS now defined above as TUTORIAL_AHORRO_STEPS / TUTORIAL_PRESTAMOS_STEPS
const TUTORIAL_AHORRO = TUTORIAL_AHORRO_STEPS;
const TUTORIAL_PRESTAMOS = TUTORIAL_PRESTAMOS_STEPS;

function startSectionTutorial(section){
  const steps = section==='ahorro' ? TUTORIAL_AHORRO : TUTORIAL_PRESTAMOS;
  const doneKey = section==='ahorro' ? 'monify_tutorial_ahorro' : 'monify_tutorial_prestamos';
  let step = 0;
  tutorialActive = true;
  document.getElementById('tutorial-overlay').style.display = 'block';

  const badge = document.getElementById('tutorial-step-badge');
  const text = document.getElementById('tutorial-text');
  const nextBtn = document.getElementById('tutorial-next-btn');
  const skipBtn = document.getElementById('tutorial-skip-btn');

  function showStep(){
    if(step >= steps.length){ endSectionTutorial(doneKey); return; }
    const s = steps[step];
    badge.textContent = `${section==='ahorro'?'Ahorro':'Préstamos'} · Paso ${step+1} de ${steps.length}`;
    text.textContent = s.text;
    nextBtn.textContent = step === steps.length-1 ? '¡Listo! ✓' : 'Siguiente →';
    const target = document.querySelector(s.selector);
    drawTutorialCanvas(target);
    positionTutorialTooltip(target, s.position);
  }

  // Override next button temporarily
  const origNext = nextBtn.onclick;
  nextBtn.onclick = ()=>{ step++; showStep(); };
  const origSkip = skipBtn.onclick;
  skipBtn.onclick = ()=>endSectionTutorial(doneKey);

  showStep();

  function endSectionTutorial(key){
    tutorialActive = false;
    document.getElementById('tutorial-overlay').style.display = 'none';
    localStorage.setItem(key,'1');
    nextBtn.onclick = origNext;
    skipBtn.onclick = origSkip;
  }
}

// Tutorial for ahorro/prestamos tab on first visit (if section was active from setup)
const _tabClickOrig = {};
function hookTabTutorial(){
  document.querySelectorAll('.nav-tab').forEach(tab=>{
    tab.addEventListener('click', ()=>{
      const t = tab.dataset.tab;
      if(t==='ahorro' && !localStorage.getItem('monify_tutorial_ahorro')){
        setTimeout(()=>startSectionTutorial('ahorro'), 600);
      } else if(t==='prestamos' && !localStorage.getItem('monify_tutorial_prestamos')){
        setTimeout(()=>startSectionTutorial('prestamos'), 600);
      }
    });
  });
}
// ── SETTINGS MODAL CAT HELPERS ────────────────────────
window.showAddSettingsCatForm=()=>{
  if(setupCats.length>=7){showToast('Máximo 7 categorías');return;}
  document.getElementById('settings-add-cat-form').style.display='block';
  document.getElementById('settings-add-cat-btn').style.display='none';
  document.getElementById('settings-new-cat-emoji').value='';
  document.getElementById('settings-new-cat-name').value='';
};
window.cancelAddSettingsCat=()=>{
  document.getElementById('settings-add-cat-form').style.display='none';
  document.getElementById('settings-add-cat-btn').style.display='block';
};
window.addSettingsCat=()=>{
  const emoji=document.getElementById('settings-new-cat-emoji').value.trim();
  const name=document.getElementById('settings-new-cat-name').value.trim();
  if(!emoji){showToast('Pon un emoji');return;}
  if(!name){showToast('Pon un nombre');return;}
  if(setupCats.length>=7){showToast('Máximo 7 categorías');return;}
  if(/^[a-zA-Z0-9]/.test(emoji)){showToast('⚠️ Pon un emoji, no letras');return;}
  const dupName=setupCats.find(c=>c.label.toLowerCase()===name.toLowerCase());
  if(dupName){showToast(`⚠️ Ya tienes una categoría llamada "${name}"`);return;}
  const dupEmoji=setupCats.find(c=>c.emoji===emoji);
  if(dupEmoji){showToast(`⚠️ El emoji ${emoji} ya lo usa "${dupEmoji.label}"`);return;}
  const id='cat_'+Date.now();
  setupCats.push({id,label:name,emoji,color:CAT_COLOR_POOL[setupCats.length%CAT_COLOR_POOL.length]});
  cancelAddSettingsCat();
  renderSettingsCatList();
  renderSettingsCatPreview();
};

// Hook section switches in settings modal for warnings
document.getElementById('settings-switch-ahorro')?.addEventListener('change',e=>{
  checkSectionDisable('ahorro',e.target.checked);
});
document.getElementById('settings-switch-prestamos')?.addEventListener('change',e=>{
  checkSectionDisable('prestamos',e.target.checked);
});

// Hook tab clicks for section tutorials
document.addEventListener('DOMContentLoaded',()=>{ hookTabTutorial(); });
// Also call after rebuildNavTabs since tabs are rebuilt dynamically
const _origRebuildNavTabsHook = window.rebuildNavTabs;
window.rebuildNavTabs = function(){
  _origRebuildNavTabsHook();
  hookTabTutorial();
};

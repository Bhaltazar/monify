// ── MOTO.JS ───────────────────────────────────────────
// Módulo independiente para la sección "Kms" (control de gasolina de la moto).
// Vive aparte de app.js para no seguir engordando ese archivo.
//
// LÓGICA:
// Cada quincena te dan un presupuesto fijo de $150 para gasolina. No siempre lo
// gastas todo en una sola cargada, así que puedes registrar varias cargas dentro
// de la misma quincena; lo que sobra del presupuesto es tu "ahorro de gas".
//
// Cada vez que cargas gas, anotas el kilometraje actual de la moto. Los km
// recorridos se calculan automáticamente como la diferencia contra tu ÚLTIMA
// carga registrada, sin importar si fue en esta quincena o en la anterior —
// así el conteo de kilómetros nunca se corta entre quincenas.
//
// Modelo de datos (Firestore, colección "motoCargas"):
//   { uid, quincenaId, fecha:'YYYY-MM-DD', monto, litros (opcional),
//     km, kmAnterior (snapshot al guardar, o null si es la primera carga),
//     kmRecorridos (km - kmAnterior, o null si es la primera carga), createdAt }

import {
  collection, addDoc, query, where, orderBy, limit, onSnapshot, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  db, fmt, fmtDate, today, showToast, openModal, closeModal,
  currentUser, currentQuincenaId, currentTab
} from './app.js';

const PRESUPUESTO_GAS = 150;

let motoCargas = [];       // cargas de la quincena actualmente seleccionada
let lastGlobalCarga = null; // carga más reciente del usuario, sin importar la quincena (referencia para el km encadenado)
let unsubMotoQuincena = null;
let unsubMotoGlobal = null;

// ── LISTENERS ──────────────────────────────────────────
export function startMotoListener(){
  stopMotoListener();
  if(!currentUser) return;

  // Carga más reciente en general (para encadenar km entre quincenas)
  unsubMotoGlobal = onSnapshot(
    query(
      collection(db,'motoCargas'),
      where('uid','==',currentUser.uid),
      orderBy('createdAt','desc'),
      limit(1)
    ),
    snap=>{
      lastGlobalCarga = snap.empty ? null : {id:snap.docs[0].id, ...snap.docs[0].data()};
      if(currentTab==='kms') renderKms();
    },
    err=>console.error('Error en listener global de Kms (moto.js):', err)
  );

  if(!currentQuincenaId){
    motoCargas=[];
    if(currentTab==='kms') renderKms();
    return;
  }

  // Cargas de la quincena que se está viendo
  unsubMotoQuincena = onSnapshot(
    query(
      collection(db,'motoCargas'),
      where('uid','==',currentUser.uid),
      where('quincenaId','==',currentQuincenaId),
      orderBy('createdAt','desc')
    ),
    snap=>{
      motoCargas = snap.docs.map(d=>({id:d.id,...d.data()}));
      if(currentTab==='kms') renderKms();
    },
    err=>{
      console.error('Error en listener de Kms (moto.js):', err);
      showToast('⚠️ Error al cargar Kms: '+(err.message||err.code||'revisa la consola'), 5000);
    }
  );
}

export function stopMotoListener(){
  if(unsubMotoQuincena){ unsubMotoQuincena(); unsubMotoQuincena=null; }
  if(unsubMotoGlobal){ unsubMotoGlobal(); unsubMotoGlobal=null; }
  motoCargas=[]; lastGlobalCarga=null;
}

// ── MODAL: abrir ───────────────────────────────────────
window.openGasModal = () => {
  if(!currentQuincenaId){ showToast('⚠️ Primero crea o selecciona una quincena'); return; }
  document.getElementById('gas-fecha').value = today();
  document.getElementById('gas-monto').value = '';
  document.getElementById('gas-litros').value = '';
  document.getElementById('gas-km').value = '';
  const hint = document.getElementById('gas-km-hint');
  if(hint){
    hint.textContent = lastGlobalCarga
      ? `Último km registrado: ${lastGlobalCarga.km.toLocaleString('es-MX')}`
      : 'Aún no tienes ningún km registrado';
  }
  openModal('modal-gas');
};

// ── GUARDAR CARGA ────────────────────────────────────────
window.saveGasRegistro = async () => {
  const fecha = document.getElementById('gas-fecha').value;
  const monto = parseFloat(document.getElementById('gas-monto').value);
  const litrosRaw = document.getElementById('gas-litros').value;
  const litros = litrosRaw ? parseFloat(litrosRaw) : null;
  const km = parseFloat(document.getElementById('gas-km').value);

  if(!fecha || isNaN(monto) || monto<=0){ showToast('Ingresa un monto válido'); return; }
  if(isNaN(km) || km<=0){ showToast('Ingresa el kilometraje actual'); return; }

  const kmAnterior = lastGlobalCarga ? lastGlobalCarga.km : null;
  if(kmAnterior!=null && km<=kmAnterior){
    showToast(`El km debe ser mayor al anterior (${kmAnterior.toLocaleString('es-MX')})`);
    return;
  }
  const kmRecorridos = kmAnterior!=null ? (km-kmAnterior) : null;

  try {
    await addDoc(collection(db,'motoCargas'), {
      uid: currentUser.uid, quincenaId: currentQuincenaId,
      fecha, monto, litros, km, kmAnterior, kmRecorridos, createdAt: Date.now()
    });
    closeModal('modal-gas');
    showToast('⛽ Carga registrada');
  } catch(e){ showToast('Error al guardar'); }
};

// ── RENDER ────────────────────────────────────────────
export function renderKms(){
  const content = document.getElementById('main-content');
  if(!content) return;

  if(!currentQuincenaId){
    content.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🏍️</div><p>No tienes ninguna quincena activa.<br>Toca el botón de fecha arriba.</p></div>';
    return;
  }

  const actionsHTML = `
    <div class="kms-actions">
      <button class="btn-secondary kms-action-btn" onclick="openGasModal()">⛽ Registrar carga de gas</button>
    </div>`;

  const cargas = motoCargas.slice().sort((a,b)=>b.createdAt-a.createdAt);
  const gastado = cargas.reduce((a,c)=>a+(c.monto||0),0);
  const restante = PRESUPUESTO_GAS - gastado;
  const litrosTotal = cargas.reduce((a,c)=>a+(c.litros||0),0);
  const kmRecorridos = cargas.reduce((a,c)=>a+(c.kmRecorridos||0),0);
  const rendimientoLabel = (litrosTotal>0 && kmRecorridos>0)
    ? (kmRecorridos/litrosTotal).toFixed(1)+' km/L'
    : '--';

  const summaryHTML = `
    <div class="kms-summary">
      <div class="kms-summary-title">Resumen de esta quincena</div>
      <div class="kms-summary-grid">
        <div class="ps-item"><div class="ps-label">Gastado</div><div class="ps-value v-red">${fmt(gastado)}</div></div>
        <div class="ps-item"><div class="ps-label">Restante</div><div class="ps-value v-teal">${fmt(restante)}</div></div>
        <div class="ps-item"><div class="ps-label">KM recorridos</div><div class="ps-value v-accent">${kmRecorridos.toLocaleString('es-MX')}</div></div>
        <div class="ps-item"><div class="ps-label">Rendimiento</div><div class="ps-value v-green">${rendimientoLabel}</div></div>
      </div>
    </div>`;

  if(cargas.length===0){
    content.innerHTML = actionsHTML + summaryHTML + '<div class="empty-state"><div class="empty-state-icon">🏍️</div><p>Aún no registras ninguna carga en esta quincena.<br>Toca el botón de arriba para agregar la primera.</p></div>';
    return;
  }

  const byDay = {};
  cargas.forEach(c=>{ if(!byDay[c.fecha]) byDay[c.fecha]=[]; byDay[c.fecha].push(c); });
  let historyHTML = '';
  Object.keys(byDay).sort((a,b)=>b.localeCompare(a)).forEach(fecha=>{
    historyHTML += `<div class="day-group"><div class="day-label">${fecha===today()?'🟢 Hoy · ':''}${fmtDate(fecha)}</div>`;
    byDay[fecha].forEach(c=>{
      const desc = 'Cargaste '+fmt(c.monto)+(c.litros?' · '+c.litros+' L':'');
      historyHTML += `<div class="gasto-item">
        <div class="gasto-icon">⛽</div>
        <div class="gasto-info">
          <div class="gasto-desc">${desc}</div>
          <div class="gasto-cat">Km: ${c.km.toLocaleString('es-MX')}</div>
        </div>
        <div class="gasto-amount">-${fmt(c.monto)}</div>
      </div>`;
    });
    historyHTML += '</div>';
  });

  content.innerHTML = actionsHTML + summaryHTML + historyHTML;
}

// ── MOTO.JS ───────────────────────────────────────────
// Módulo independiente para la sección "Kms" (gasolina + kilómetros de la moto).
// Vive aparte de app.js para no seguir engordando ese archivo.
//
// Modelo de datos (Firestore, colección "motoRegistros"):
//   { uid, quincenaId, tipo:'km'|'gas', fecha:'YYYY-MM-DD',
//     km (solo tipo 'km'), monto (solo tipo 'gas'), litros (opcional, tipo 'gas'),
//     createdAt }
//
// Cada quincena guarda además un campo opcional "kmInicio" (número) en su propio
// documento de /quincenas — es el kilometraje de referencia con el que arrancó esa
// quincena (tomado del último registro real, sea de esta quincena o de una anterior).
// Así "km recorridos" siempre se calcula bien aunque la vista esté limpia por quincena.

import {
  collection, doc, addDoc, updateDoc, query, where, orderBy, limit, onSnapshot, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  db, fmt, fmtDate, today, showToast, openModal, closeModal,
  currentUser, currentQuincenaId, quincenas, currentTab
} from './app.js';

let motoRegistros = [];   // registros (km + gas) de la quincena actual
let unsubMoto = null;
let lastGlobalKm = null;  // último registro de km global, cuando la quincena actual está vacía

// ── LISTENER ──────────────────────────────────────────
export function startMotoListener(){
  if(unsubMoto){ unsubMoto(); unsubMoto=null; }
  if(!currentUser || !currentQuincenaId){
    motoRegistros=[]; lastGlobalKm=null;
    if(currentTab==='kms') renderKms();
    return;
  }
  unsubMoto = onSnapshot(
    query(
      collection(db,'motoRegistros'),
      where('uid','==',currentUser.uid),
      where('quincenaId','==',currentQuincenaId),
      orderBy('createdAt','desc')
    ),
    async snap=>{
      motoRegistros = snap.docs.map(d=>({id:d.id,...d.data()}));
      const hasKm = motoRegistros.some(r=>r.tipo==='km');
      lastGlobalKm = hasKm ? null : await fetchLastGlobalKm();
      if(currentTab==='kms') renderKms();
    },
    ()=>{ /* si falla el listener (p.ej. falta índice en Firestore), no truena la app */ }
  );
}

export function stopMotoListener(){
  if(unsubMoto){ unsubMoto(); unsubMoto=null; }
  motoRegistros=[]; lastGlobalKm=null;
}

async function fetchLastGlobalKm(){
  if(!currentUser) return null;
  try {
    const snap = await getDocs(query(
      collection(db,'motoRegistros'),
      where('uid','==',currentUser.uid),
      where('tipo','==','km'),
      orderBy('fecha','desc'),
      limit(1)
    ));
    if(snap.empty) return null;
    const d=snap.docs[0];
    return {id:d.id,...d.data()};
  } catch(e){ return null; }
}

// ── MODALES: abrir ───────────────────────────────────
window.openKmModal = () => {
  if(!currentQuincenaId){ showToast('⚠️ Primero crea o selecciona una quincena'); return; }
  document.getElementById('km-fecha').value = today();
  document.getElementById('km-valor').value = '';
  openModal('modal-km');
};

window.openGasModal = () => {
  if(!currentQuincenaId){ showToast('⚠️ Primero crea o selecciona una quincena'); return; }
  document.getElementById('gas-fecha').value = today();
  document.getElementById('gas-monto').value = '';
  document.getElementById('gas-litros').value = '';
  openModal('modal-gas');
};

// ── GUARDAR REGISTROS ─────────────────────────────────
window.saveKmRegistro = async () => {
  const fecha = document.getElementById('km-fecha').value;
  const kmValor = parseFloat(document.getElementById('km-valor').value);
  if(!fecha || isNaN(kmValor) || kmValor<=0){ showToast('Ingresa un kilometraje válido'); return; }
  try {
    const q = quincenas.find(x=>x.id===currentQuincenaId);
    if(q && (q.kmInicio===undefined || q.kmInicio===null)){
      const baseline = lastGlobalKm ? lastGlobalKm.km : kmValor;
      await updateDoc(doc(db,'quincenas',currentQuincenaId), {kmInicio: baseline});
    }
    await addDoc(collection(db,'motoRegistros'), {
      uid: currentUser.uid, quincenaId: currentQuincenaId,
      tipo:'km', fecha, km:kmValor, createdAt: Date.now()
    });
    closeModal('modal-km');
    showToast('📏 Kilometraje registrado');
  } catch(e){ showToast('Error al guardar'); }
};

window.saveGasRegistro = async () => {
  const fecha = document.getElementById('gas-fecha').value;
  const monto = parseFloat(document.getElementById('gas-monto').value);
  const litrosRaw = document.getElementById('gas-litros').value;
  const litros = litrosRaw ? parseFloat(litrosRaw) : null;
  if(!fecha || isNaN(monto) || monto<=0){ showToast('Ingresa un monto válido'); return; }
  try {
    await addDoc(collection(db,'motoRegistros'), {
      uid: currentUser.uid, quincenaId: currentQuincenaId,
      tipo:'gas', fecha, monto, litros, createdAt: Date.now()
    });
    closeModal('modal-gas');
    showToast('⛽ Carga de gasolina registrada');
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
      <button class="btn-secondary kms-action-btn" onclick="openKmModal()">📏 Registrar KM</button>
      <button class="btn-secondary kms-action-btn" onclick="openGasModal()">⛽ Cargar gasolina</button>
    </div>`;

  const q = quincenas.find(x=>x.id===currentQuincenaId);
  const kmRecs = motoRegistros.filter(r=>r.tipo==='km').slice().sort((a,b)=>a.fecha.localeCompare(b.fecha));
  const gasRecs = motoRegistros.filter(r=>r.tipo==='gas');
  const lastKm = kmRecs.length ? kmRecs[kmRecs.length-1] : null;
  const gastoGas = gasRecs.reduce((a,r)=>a+(r.monto||0),0);
  const litrosTotal = gasRecs.reduce((a,r)=>a+(r.litros||0),0);

  // Sin ningún registro en esta quincena todavía
  if(motoRegistros.length===0){
    let ghostHTML='';
    if(lastGlobalKm){
      ghostHTML = `
        <div class="kms-summary kms-summary-ghost">
          <div class="kms-summary-title">Referencia · quincena anterior</div>
          <div class="kms-summary-grid">
            <div class="ps-item"><div class="ps-label">Último KM</div><div class="ps-value">${lastGlobalKm.km.toLocaleString('es-MX')}</div></div>
            <div class="ps-item"><div class="ps-label">Fecha</div><div class="ps-value">${fmtDate(lastGlobalKm.fecha)}</div></div>
            <div class="ps-item"><div class="ps-label">Estado</div><div class="ps-value">Sin registros aquí</div></div>
          </div>
        </div>`;
    }
    content.innerHTML = actionsHTML + ghostHTML + `<div class="empty-state"><div class="empty-state-icon">🏍️</div><p>Aún no registras nada en esta quincena.<br>Registra tu KM del día o una carga de gas.</p></div>`;
    return;
  }

  const baseline = (q && q.kmInicio!=null) ? q.kmInicio : null;
  const kmRecorridos = (lastKm && baseline!=null) ? Math.max(0, lastKm.km-baseline) : 0;
  let rendimientoLabel = '--';
  if(litrosTotal>0 && kmRecorridos>0) rendimientoLabel = (kmRecorridos/litrosTotal).toFixed(1)+' km/L';
  else if(gastoGas>0 && kmRecorridos>0) rendimientoLabel = '$'+(gastoGas/kmRecorridos).toFixed(2)+'/km';

  const summaryHTML = `
    <div class="kms-summary">
      <div class="kms-summary-title">Resumen de esta quincena</div>
      <div class="kms-summary-grid">
        <div class="ps-item"><div class="ps-label">Último KM</div><div class="ps-value v-accent">${lastKm?lastKm.km.toLocaleString('es-MX'):'--'}</div></div>
        <div class="ps-item"><div class="ps-label">KM recorridos</div><div class="ps-value v-teal">${kmRecorridos.toLocaleString('es-MX')}</div></div>
        <div class="ps-item"><div class="ps-label">Gasto en gas</div><div class="ps-value v-red">${fmt(gastoGas)}</div></div>
        <div class="ps-item"><div class="ps-label">Rendimiento</div><div class="ps-value v-green">${rendimientoLabel}</div></div>
      </div>
    </div>`;

  const historyHTML = motoRegistros.slice().sort((a,b)=>b.createdAt-a.createdAt).map(r=>{
    if(r.tipo==='km'){
      return `<div class="kms-history-item">
        <div class="kms-history-icon">📏</div>
        <div class="kms-history-info">
          <div class="kms-history-label">Kilometraje: ${r.km.toLocaleString('es-MX')}</div>
          <div class="kms-history-date">${fmtDate(r.fecha)}</div>
        </div>
      </div>`;
    }
    return `<div class="kms-history-item">
      <div class="kms-history-icon">⛽</div>
      <div class="kms-history-info">
        <div class="kms-history-label">Carga de gas: ${fmt(r.monto)}${r.litros?' · '+r.litros+' L':''}</div>
        <div class="kms-history-date">${fmtDate(r.fecha)}</div>
      </div>
    </div>`;
  }).join('');

  content.innerHTML = actionsHTML + summaryHTML + historyHTML;
}

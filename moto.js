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
  collection, addDoc, updateDoc, deleteDoc, doc, query, where, orderBy, limit, onSnapshot, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  db, fmt, fmtDate, today, showToast, showConfirm, openModal, closeModal,
  currentUser, currentQuincenaId, currentTab, quincenas
} from './app.js';

const PRESUPUESTO_GAS = 150;
const DEFAULT_PRECIO_GAS = 23.99;

// Precio de gas vigente para la quincena actual: si ella no tiene precio propio,
// hereda el de la quincena más reciente (hacia atrás en el tiempo) que sí lo tenga.
// `quincenas` viene ordenada desc por 'inicio' (más nueva primero).
function getPrecioGasActivo(){
  const idx = quincenas.findIndex(q=>q.id===currentQuincenaId);
  if(idx===-1) return DEFAULT_PRECIO_GAS;
  for(let i=idx;i<quincenas.length;i++){
    if(quincenas[i].precioGas!=null) return quincenas[i].precioGas;
  }
  return DEFAULT_PRECIO_GAS;
}

let motoCargas = [];       // cargas de la quincena actualmente seleccionada
let lastGlobalCarga = null; // carga más reciente del usuario, sin importar la quincena (referencia para el km encadenado)
let editingCargaId = null; // id de la carga que se está editando, o null si es una nueva
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
  editingCargaId = null;
  document.getElementById('gas-modal-title').textContent = '⛽ Registrar carga de gasolina';
  document.getElementById('gas-fecha').value = today();
  document.getElementById('gas-monto').value = '';
  document.getElementById('gas-litros').value = '';
  document.getElementById('gas-km').value = '';
  const litrosWarn = document.getElementById('gas-litros-warning');
  if(litrosWarn) litrosWarn.textContent = '';
  const hint = document.getElementById('gas-km-hint');
  if(hint){
    hint.textContent = lastGlobalCarga
      ? `Último km registrado: ${lastGlobalCarga.km.toLocaleString('es-MX')}`
      : 'Aún no tienes ningún km registrado';
  }
  openModal('modal-gas');
};

window.openEditCarga = id => {
  const c = motoCargas.find(x=>x.id===id); if(!c) return;
  editingCargaId = id;
  document.getElementById('gas-modal-title').textContent = '⛽ Editar carga de gasolina';
  document.getElementById('gas-fecha').value = c.fecha;
  document.getElementById('gas-monto').value = c.monto;
  document.getElementById('gas-litros').value = c.litros || '';
  document.getElementById('gas-km').value = c.km;
  const litrosWarn = document.getElementById('gas-litros-warning');
  if(litrosWarn) litrosWarn.textContent = '';
  const hint = document.getElementById('gas-km-hint');
  if(hint) hint.textContent = 'Editando esta carga — ajusta con cuidado, el km afecta las cargas antes y después de esta.';
  closeModal('modal-detail');
  openModal('modal-gas');
};

// ── PRECIO DE GAS (por quincena) ───────────────────────
window.toggleGasPriceChip = () => {
  const chip = document.getElementById('gas-price-chip');
  if(!chip) return;
  if(chip.classList.contains('expanded')){
    window.openGasPriceModal();
  } else {
    chip.classList.add('expanded');
  }
};

function collapseGasPriceChip(){
  const chip = document.getElementById('gas-price-chip');
  if(chip) chip.classList.remove('expanded');
}

window.openGasPriceModal = () => {
  if(!currentQuincenaId){ showToast('⚠️ Primero crea o selecciona una quincena'); return; }
  document.getElementById('gas-precio-input').value = getPrecioGasActivo();
  openModal('modal-gas-precio');
};

window.closeGasPriceModal = () => {
  closeModal('modal-gas-precio');
  collapseGasPriceChip();
};

window.saveGasPrecio = async () => {
  const val = parseFloat(document.getElementById('gas-precio-input').value);
  if(isNaN(val) || val<=0){ showToast('Ingresa un precio válido'); return; }
  if(!currentQuincenaId){ showToast('⚠️ No hay quincena activa'); return; }
  try {
    await updateDoc(doc(db,'quincenas',currentQuincenaId), {precioGas: val});
    window.closeGasPriceModal();
    showToast('⛽ Precio actualizado');
  } catch(e){ console.error('Error al guardar precio de gas (moto.js):', e); showToast('Error al guardar: '+(e.message||e.code||'revisa la consola'), 5000); }
};

// ── LITROS: cálculo/validación en vivo ─────────────────
function checkLitrosMismatch(){
  const warnEl = document.getElementById('gas-litros-warning');
  if(!warnEl) return;
  const litrosRaw = document.getElementById('gas-litros').value;
  const monto = parseFloat(document.getElementById('gas-monto').value);
  if(!litrosRaw || isNaN(monto) || monto<=0){ warnEl.textContent=''; return; }
  const litros = parseFloat(litrosRaw);
  if(isNaN(litros)){ warnEl.textContent=''; return; }
  const precio = getPrecioGasActivo();
  if(!precio){ warnEl.textContent=''; return; }
  const esperado = Math.round((monto/precio)*10)/10;
  const puesto = Math.round(litros*10)/10;
  warnEl.textContent = Math.abs(esperado-puesto)>0.05
    ? `⚠️ No cuadra: con ${fmt(monto)} a ${fmt(precio)}/L serían ~${esperado.toFixed(1)} L`
    : '';
}
document.getElementById('gas-monto')?.addEventListener('input', checkLitrosMismatch);
document.getElementById('gas-litros')?.addEventListener('input', checkLitrosMismatch);

// Trae todas las cargas del usuario ordenadas cronológicamente (para reparar la cadena de km al editar/eliminar)
async function fetchAllCargasOrdenadas(){
  const snap = await getDocs(query(
    collection(db,'motoCargas'),
    where('uid','==',currentUser.uid),
    orderBy('createdAt','asc')
  ));
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}

// ── GUARDAR / ACTUALIZAR CARGA ────────────────────────────────────────
window.saveGasRegistro = async () => {
  const fecha = document.getElementById('gas-fecha').value;
  const monto = parseFloat(document.getElementById('gas-monto').value);
  const litrosRaw = document.getElementById('gas-litros').value;
  const km = parseFloat(document.getElementById('gas-km').value);

  if(!fecha || isNaN(monto) || monto<=0){ showToast('Ingresa un monto válido'); return; }
  if(isNaN(km) || km<=0){ showToast('Ingresa el kilometraje actual'); return; }

  // Si no se capturaron litros, se calculan solos con el precio vigente de la quincena
  let litros = litrosRaw ? parseFloat(litrosRaw) : null;
  if(litros==null){
    const precio = getPrecioGasActivo();
    if(precio>0) litros = +(monto/precio).toFixed(2);
  }

  try {
    if(editingCargaId){
      // Edición: recalcular la cadena de km contra el vecino anterior y siguiente
      const todas = await fetchAllCargasOrdenadas();
      const idx = todas.findIndex(c=>c.id===editingCargaId);
      if(idx===-1){ showToast('No se encontró la carga'); return; }
      const prev = idx>0 ? todas[idx-1] : null;
      const next = idx<todas.length-1 ? todas[idx+1] : null;

      if(prev && km<=prev.km){ showToast(`El km debe ser mayor al de la carga anterior (${prev.km.toLocaleString('es-MX')})`); return; }
      if(next && km>=next.km){ showToast(`El km debe ser menor al de la carga siguiente (${next.km.toLocaleString('es-MX')})`); return; }

      const kmAnterior = prev ? prev.km : null;
      const kmRecorridos = kmAnterior!=null ? (km-kmAnterior) : null;
      await updateDoc(doc(db,'motoCargas',editingCargaId), {fecha, monto, litros, km, kmAnterior, kmRecorridos});

      if(next){
        await updateDoc(doc(db,'motoCargas',next.id), {kmAnterior: km, kmRecorridos: next.km-km});
      }

      editingCargaId = null;
      closeModal('modal-gas');
      showToast('✅ Carga actualizada');
    } else {
      const kmAnterior = lastGlobalCarga ? lastGlobalCarga.km : null;
      if(kmAnterior!=null && km<=kmAnterior){
        showToast(`El km debe ser mayor al anterior (${kmAnterior.toLocaleString('es-MX')})`);
        return;
      }
      const kmRecorridos = kmAnterior!=null ? (km-kmAnterior) : null;
      await addDoc(collection(db,'motoCargas'), {
        uid: currentUser.uid, quincenaId: currentQuincenaId,
        fecha, monto, litros, km, kmAnterior, kmRecorridos, createdAt: Date.now()
      });
      closeModal('modal-gas');
      showToast('⛽ Carga registrada');
    }
  } catch(e){ console.error('Error al guardar carga (moto.js):', e); showToast('Error al guardar: '+(e.message||e.code||'revisa la consola'), 5000); }
};

// ── DETALLE / ELIMINAR ────────────────────────────────────────
window.showCargaDetail = id => {
  const c = motoCargas.find(x=>x.id===id); if(!c) return;
  document.getElementById('detail-title').textContent = 'Carga de gasolina';
  document.getElementById('detail-content').innerHTML = `
    <div style="text-align:center;padding:12px 0 20px">
      <div style="font-size:48px;margin-bottom:8px">⛽</div>
      <div style="font-size:32px;font-weight:600;color:var(--red)">-${fmt(c.monto)}</div>
      <div style="font-size:13px;color:var(--text3);margin-top:6px">${fmtDate(c.fecha)}${c.litros?' · '+c.litros+' L':''}</div>
      <div style="font-size:14px;color:var(--text2);margin-top:8px">Km registrado: ${c.km.toLocaleString('es-MX')}</div>
      ${c.kmRecorridos!=null?`<div style="font-size:12px;margin-top:4px;color:var(--accent)">${c.kmRecorridos.toLocaleString('es-MX')} km desde la carga anterior</div>`:''}
    </div>`;
  document.getElementById('detail-delete-btn').onclick = ()=>{
    closeModal('modal-detail');
    setTimeout(()=>{
      showConfirm('¿Eliminar esta carga?','Esta acción no se puede deshacer.','🗑️',async()=>{
        try {
          const todas = await fetchAllCargasOrdenadas();
          const idx = todas.findIndex(x=>x.id===id);
          const prev = idx>0 ? todas[idx-1] : null;
          const next = idx<todas.length-1 ? todas[idx+1] : null;
          await deleteDoc(doc(db,'motoCargas',id));
          if(next){
            const kmAnterior = prev ? prev.km : null;
            const kmRecorridos = kmAnterior!=null ? (next.km-kmAnterior) : null;
            await updateDoc(doc(db,'motoCargas',next.id), {kmAnterior, kmRecorridos});
          }
          showToast('🗑️ Carga eliminada');
        } catch(e){ console.error('Error al eliminar carga (moto.js):', e); showToast('Error al eliminar: '+(e.message||e.code||'revisa la consola'), 5000); }
      });
    },350);
  };
  document.getElementById('detail-edit-btn').onclick = ()=>window.openEditCarga(id);
  openModal('modal-detail');
};

// ── RENDER ────────────────────────────────────────────
const KMS_BALANCE_IDS = ['saldo-inicial-display','saldo-actual-display','total-gastado-display','total-ahorrado-display'];
// Gastado=rojo, Restante=verde, KM recorridos=accent, Rendimiento=teal
const KMS_BALANCE_CLASSES = ['v-red','v-green','v-accent','v-teal'];

function updateKmsHeader(gastado, restante, kmRecorridos, rendimientoLabel){
  const labels = ['Gastado','Restante','KM recorridos','Rendimiento'];
  labels.forEach((label,i)=>{
    const el=document.getElementById('bal-label-'+(i+1));
    if(el) el.textContent=label;
  });
  KMS_BALANCE_IDS.forEach((id,i)=>{
    const el=document.getElementById(id);
    if(el) el.className='balance-item-value '+KMS_BALANCE_CLASSES[i];
  });
  const set=(id,val)=>{ const el=document.getElementById(id); if(el) el.textContent=val; };
  set('saldo-inicial-display', fmt(gastado));
  set('saldo-actual-display', fmt(restante));
  set('total-gastado-display', kmRecorridos.toLocaleString('es-MX'));
  set('total-ahorrado-display', rendimientoLabel);

  const priceEl = document.getElementById('gas-price-display');
  if(priceEl) priceEl.textContent = fmt(getPrecioGasActivo())+'/L';
}

export function renderKms(){
  const content = document.getElementById('main-content');
  if(!content) return;

  if(!currentQuincenaId){
    updateKmsHeader(0, PRESUPUESTO_GAS, 0, '--');
    content.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🏍️</div><p>No tienes ninguna quincena activa.<br>Toca el botón de fecha arriba.</p></div>';
    return;
  }

  const cargas = motoCargas.slice().sort((a,b)=>b.createdAt-a.createdAt);
  const gastado = cargas.reduce((a,c)=>a+(c.monto||0),0);
  const restante = PRESUPUESTO_GAS - gastado;
  const litrosTotal = cargas.reduce((a,c)=>a+(c.litros||0),0);
  const kmRecorridos = cargas.reduce((a,c)=>a+(c.kmRecorridos||0),0);
  const rendimientoLabel = (litrosTotal>0 && kmRecorridos>0)
    ? (kmRecorridos/litrosTotal).toFixed(1)+' km/L'
    : '--';

  updateKmsHeader(gastado, restante, kmRecorridos, rendimientoLabel);

  if(cargas.length===0){
    content.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🏍️</div><p>Aún no registras ninguna carga en esta quincena.<br>Toca el botón de abajo para agregar la primera.</p></div>';
    return;
  }

  const byDay = {};
  cargas.forEach(c=>{ if(!byDay[c.fecha]) byDay[c.fecha]=[]; byDay[c.fecha].push(c); });
  let historyHTML = '';
  Object.keys(byDay).sort((a,b)=>b.localeCompare(a)).forEach(fecha=>{
    historyHTML += `<div class="day-group"><div class="day-label">${fecha===today()?'🟢 Hoy · ':''}${fmtDate(fecha)}</div>`;
    byDay[fecha].forEach(c=>{
      const desc = 'Cargaste '+fmt(c.monto)+(c.litros?' · '+c.litros+' L':'');
      historyHTML += `<div class="gasto-item" onclick="showCargaDetail('${c.id}')">
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

  content.innerHTML = historyHTML;
}

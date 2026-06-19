import { auth, db } from './firebase-config.js';
import { RUNES_PER_SPIN, PRIZES, pickWeightedPrize } from './prizes.js';

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

import {
  doc, getDoc, setDoc, runTransaction, serverTimestamp, increment,
  arrayUnion, collection, addDoc, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

/* ---------- Estado ---------- */
let unsubUser = null;
let unsubPrizes = null;
let currentSpinsAvailable = 0;
let spinning = false;

/* ---------- Helpers de pantalla ---------- */
function showScreen(name) {
  ['loading', 'auth', 'app'].forEach((n) => {
    document.getElementById('screen-' + n).classList.toggle('hidden', n !== name);
  });
}
function showToast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch])
  );
}
function friendlyAuthError(err) {
  const c = err.code || '';
  if (c.includes('email-already-in-use')) return 'Ese correo ya tiene una cuenta. Iniciá sesión.';
  if (c.includes('invalid-email')) return 'Ese correo no es válido.';
  if (c.includes('weak-password')) return 'La contraseña necesita al menos 6 caracteres.';
  if (c.includes('user-not-found') || c.includes('wrong-password') || c.includes('invalid-credential'))
    return 'Correo o contraseña incorrectos.';
  if (c.includes('too-many-requests')) return 'Demasiados intentos. Esperá un momento.';
  return 'Algo salió mal. Intentá de nuevo.';
}

/* ---------- Cuenta de usuario ---------- */
async function ensureUserDoc(uid, email) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { email, createdAt: serverTimestamp(), totalRunes: 0, spinsUsed: 0, redeemedCodes: [] });
  }
}
function listenUser(uid) {
  unsubUser = onSnapshot(doc(db, 'users', uid), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    renderRuneCircle(data.totalRunes || 0);
    renderSpinBanner(data);
  });
  unsubPrizes = onSnapshot(query(collection(db, 'prizes'), where('uid', '==', uid)), (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (b.wonAt?.toMillis?.() || 0) - (a.wonAt?.toMillis?.() || 0));
    renderHistory(list);
  });
}
function stopListening() {
  unsubUser?.(); unsubPrizes?.();
  unsubUser = null; unsubPrizes = null;
}

/* ---------- Círculo de runas ---------- */
function renderRuneCircle(total) {
  const inCycle = total % RUNES_PER_SPIN;
  document.getElementById('rune-count').textContent = inCycle;
  const nodes = document.querySelectorAll('.rune-node');
  nodes.forEach((node, i) => {
    const shouldFill = i < inCycle;
    const wasFilled = node.classList.contains('filled');
    node.classList.toggle('filled', shouldFill);
    if (shouldFill && !wasFilled) {
      node.classList.add('pop');
      setTimeout(() => node.classList.remove('pop'), 500);
    }
  });
}
function renderSpinBanner(data) {
  const available = Math.floor((data.totalRunes || 0) / RUNES_PER_SPIN) - (data.spinsUsed || 0);
  currentSpinsAvailable = available;
  const banner = document.getElementById('spin-banner');
  if (available > 0) {
    banner.classList.remove('hidden');
    document.getElementById('spins-count').textContent = available;
  } else {
    banner.classList.add('hidden');
  }
}
function renderHistory(list) {
  const container = document.getElementById('history-list');
  if (!list.length) {
    container.innerHTML = '<p class="empty-note">Todavía no tenés premios — juntá 6 runas y girá la ruleta.</p>';
    return;
  }
  container.innerHTML = list.map((p) => {
    const date = p.wonAt?.toDate
      ? p.wonAt.toDate().toLocaleDateString('es-SV', { day:'2-digit', month:'short', year:'numeric' })
      : '';
    const badge = p.fulfilled
      ? '<span class="badge badge-done">Entregado</span>'
      : '<span class="badge badge-pending">Pendiente</span>';
    return `<div class="history-item"><div><span class="label">${escapeHtml(p.prizeLabel || p.prizeKey)}</span><span class="date">${date}</span></div>${badge}</div>`;
  }).join('');
}

/* ---------- Canje de código ---------- */
async function redeemCode(rawCode) {
  const code = (rawCode || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(code)) throw new Error('El código debe tener 10 letras o números.');
  const uid = auth.currentUser.uid;
  const codeRef = doc(db, 'codes', code);
  const userRef = doc(db, 'users', uid);
  await runTransaction(db, async (tx) => {
    const codeSnap = await tx.get(codeRef);
    if (!codeSnap.exists()) throw new Error('Ese código no existe. Revisalo bien.');
    if (codeSnap.data().status !== 'unused') throw new Error('Ese código ya fue usado.');
    tx.update(codeRef, { status: 'used', usedBy: uid, usedAt: serverTimestamp() });
    tx.update(userRef, { totalRunes: increment(1), redeemedCodes: arrayUnion(code) });
  });
}

/* ---------- Transacción de giro ---------- */
async function spinTransaction() {
  const uid = auth.currentUser.uid;
  const userRef = doc(db, 'users', uid);
  let chosen = null;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.data();
    const available = Math.floor((data.totalRunes || 0) / RUNES_PER_SPIN) - (data.spinsUsed || 0);
    if (available <= 0) throw new Error('Todavía no tenés giros disponibles.');
    chosen = pickWeightedPrize();
    tx.update(userRef, { spinsUsed: increment(1) });
  });
  await addDoc(collection(db, 'prizes'), {
    uid, email: auth.currentUser.email,
    prizeKey: chosen.key, prizeLabel: chosen.label,
    wonAt: serverTimestamp(), fulfilled: false
  });
  return chosen;
}

/* ================================================================
   MÁQUINA DE SLOT
   ================================================================ */

// Estilos visuales por premio
const SLOT_STYLE = {
  descuento:            { bg:'#4a2e0a', border:'#E8811A', text:'#ffd76a' },
  accesorio_dorado:     { bg:'#5a3200', border:'#f6a030', text:'#ffd76a' },
  accesorio_plateado:   { bg:'#1e2026', border:'#9ea3ad', text:'#d4d6db' },
  envio_gratis:         { bg:'#1a0d40', border:'#7C3AED', text:'#c4aaff' },
  prenda_basica:        { bg:'#130c28', border:'#4a2e9c', text:'#9a80d8' },
  prenda_catalogo:      { bg:'#3a2c00', border:'#f6b94a', text:'#ffd76a' },
  prenda_personalizada: { bg:'#2e2400', border:'#ffd76a', text:'#fff8e0' }
};

// Etiquetas cortas para las tarjetas (dos líneas)
const SLOT_LABELS = {
  descuento:            ['DESCUENTO', '16%'],
  accesorio_dorado:     ['ACCESORIO', 'DORADO'],
  accesorio_plateado:   ['ACCESORIO', 'PLATEADO'],
  envio_gratis:         ['ENVÍO', 'GRATIS'],
  prenda_basica:        ['PRENDA', 'BÁSICA'],
  prenda_catalogo:      ['PRENDA', 'CATÁLOGO'],
  prenda_personalizada: ['PRENDA', 'PERSO ★']
};

// Distribución proporcional al porcentaje (base 100 piezas)
const SLOT_COUNTS = {
  descuento: 16, accesorio_dorado: 17, accesorio_plateado: 17,
  envio_gratis: 36, prenda_basica: 10, prenda_catalogo: 3, prenda_personalizada: 1
};

const SLOT_W     = 100; // ancho de cada tarjeta (px)
const SLOT_GAP   = 12;  // espacio entre tarjetas
const SLOT_TOTAL = SLOT_W + SLOT_GAP; // 112 px por posición
const SLOT_PRE   = 35;  // tarjetas ANTES del ganador en la cinta

// Construye un pool aleatorio de 100 tarjetas (proporcional a probabilidades)
function buildPool() {
  const pool = [];
  for (const [key, count] of Object.entries(SLOT_COUNTS)) {
    const p = PRIZES.find((pr) => pr.key === key);
    for (let i = 0; i < count; i++) pool.push(p);
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

// Construye la cinta completa: PRE tarjetas aleatorias + ganador + 8 más
function buildTape(winnerKey) {
  const pool = buildPool();
  const tape = [];
  for (let i = 0; i < SLOT_PRE; i++) tape.push(pool[i % pool.length]);
  tape.push(PRIZES.find((p) => p.key === winnerKey));
  for (let i = 0; i < 8; i++) tape.push(pool[(SLOT_PRE + 1 + i) % pool.length]);
  return tape;
}

// Renderiza las tarjetas en el DOM
function renderSlotTape(tape) {
  const el = document.getElementById('slot-tape');
  el.innerHTML = tape.map((prize) => {
    const s = SLOT_STYLE[prize.key];
    const [l1, l2] = SLOT_LABELS[prize.key];
    return `<div class="slot-card" data-key="${prize.key}" style="background:${s.bg};border-color:${s.border};color:${s.text}"><span class="slot-l1">${l1}</span><span class="slot-l2">${l2}</span></div>`;
  }).join('');
}

// Calcula el translateX para centrar la tarjeta `index` en el viewport
function slotOffset(index, vpWidth) {
  return -(index * SLOT_TOTAL) + vpWidth / 2 - SLOT_W / 2;
}

// Prepara la cinta en posición inicial (tarjeta 8 centrada), sin animación
function initSlotPosition() {
  const vp = document.querySelector('.slot-viewport');
  const vpW = vp ? vp.offsetWidth : 340;
  const el = document.getElementById('slot-tape');
  el.style.transition = 'none';
  el.style.transform = `translateX(${slotOffset(8, vpW)}px)`;
  return vpW;
}

// Lanza la animación hasta el ganador (tarjeta SLOT_PRE)
function runSlotAnimation(vpW, onDone) {
  const el = document.getElementById('slot-tape');
  void el.offsetWidth; // fuerza reflow para que 'none' se aplique antes
  el.style.transition = 'transform 4.4s cubic-bezier(0.04, 0.82, 0.1, 1)';
  el.style.transform = `translateX(${slotOffset(SLOT_PRE, vpW)}px)`;
  setTimeout(() => {
    const cards = el.querySelectorAll('.slot-card');
    if (cards[SLOT_PRE]) cards[SLOT_PRE].classList.add('slot-winner');
    setTimeout(onDone, 700);
  }, 4500);
}

// Renderiza la lista de premios sin porcentajes
function renderPrizeLegend() {
  const el = document.getElementById('wheel-legend');
  if (!el) return;
  el.innerHTML = PRIZES.map((p) => {
    const s = SLOT_STYLE[p.key];
    return `<div class="legend-row"><span class="legend-dot" style="background:${s.border}"></span><span>${p.label}</span></div>`;
  }).join('');
}

/* ---------- Modal de resultado ---------- */
function showResult(prize) {
  document.getElementById('result-prize-name').textContent = prize.label;
  document.getElementById('modal-result').classList.remove('hidden');
}

/* ================================================================
   EVENTOS
   ================================================================ */

// Tabs de auth
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const which = tab.dataset.tab;
    document.getElementById('form-login').classList.toggle('hidden', which !== 'login');
    document.getElementById('form-register').classList.toggle('hidden', which !== 'register');
  });
});

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    await signInWithEmailAndPassword(auth,
      document.getElementById('login-email').value.trim(),
      document.getElementById('login-password').value
    );
  } catch (err) { errEl.textContent = friendlyAuthError(err); }
});

document.getElementById('form-register').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('register-error');
  errEl.textContent = '';
  try {
    await createUserWithEmailAndPassword(auth,
      document.getElementById('register-email').value.trim(),
      document.getElementById('register-password').value
    );
  } catch (err) { errEl.textContent = friendlyAuthError(err); }
});

document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));

document.getElementById('code-input').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
document.getElementById('code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-redeem').click();
});

document.getElementById('btn-redeem').addEventListener('click', async () => {
  const input = document.getElementById('code-input');
  const btn = document.getElementById('btn-redeem');
  btn.disabled = true;
  try {
    await redeemCode(input.value);
    input.value = '';
    showToast('¡Runa obtenida!', 'success');
  } catch (err) {
    showToast(err.message || 'No se pudo canjear el código.', 'error');
  } finally { btn.disabled = false; }
});

// Abrir / cerrar pantalla de slot
document.getElementById('btn-open-wheel').addEventListener('click', () => {
  renderPrizeLegend();
  document.getElementById('slot-tape').innerHTML = ''; // limpia cinta anterior
  document.getElementById('screen-wheel').classList.remove('hidden');
});
document.getElementById('btn-close-wheel').addEventListener('click', () => {
  document.getElementById('screen-wheel').classList.add('hidden');
});

// Girar
document.getElementById('btn-spin').addEventListener('click', async () => {
  if (spinning) return;
  if (currentSpinsAvailable <= 0) {
    showToast('Todavía no tenés giros disponibles.', 'error');
    return;
  }
  spinning = true;
  const spinBtn = document.getElementById('btn-spin');
  spinBtn.disabled = true;
  spinBtn.textContent = 'Girando…';

  try {
    const prize = await spinTransaction();
    renderSlotTape(buildTape(prize.key));
    const vpW = initSlotPosition();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        runSlotAnimation(vpW, () => {
          spinning = false;
          spinBtn.disabled = false;
          spinBtn.textContent = 'Girar';
          showResult(prize);
        });
      });
    });
  } catch (err) {
    spinning = false;
    spinBtn.disabled = false;
    spinBtn.textContent = 'Girar';
    showToast(err.message || 'No se pudo girar.', 'error');
  }
});

document.getElementById('btn-close-result').addEventListener('click', () => {
  document.getElementById('modal-result').classList.add('hidden');
  document.getElementById('screen-wheel').classList.add('hidden');
});

/* ---------- Arranque ---------- */
showScreen('loading');
renderPrizeLegend();

onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      await ensureUserDoc(user.uid, user.email);
      listenUser(user.uid);
      showScreen('app');
    } catch (err) {
      showToast('No se pudo cargar tu cuenta. Revisá tu conexión.', 'error');
      showScreen('auth');
    }
  } else {
    stopListening();
    showScreen('auth');
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}

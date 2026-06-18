import { auth, db } from './firebase-config.js';
import { RUNES_PER_SPIN, buildSegments, pickWeightedPrize } from './prizes.js';

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

/* ---------- Colores de cada premio en la ruleta ---------- */
const SEGMENT_COLORS = {
  descuento: '#8a5a1d',
  accesorio_dorado: '#E8811A',
  accesorio_plateado: '#b9bcc2',
  envio_gratis: '#7C3AED',
  prenda_basica: '#3c2570',
  prenda_catalogo: '#f6b94a',
  prenda_personalizada: '#ffd76a'
};

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
  return String(str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function friendlyAuthError(err) {
  const code = err.code || '';
  if (code.includes('email-already-in-use')) return 'Ese correo ya tiene una cuenta. Iniciá sesión.';
  if (code.includes('invalid-email')) return 'Ese correo no es válido.';
  if (code.includes('weak-password')) return 'La contraseña necesita al menos 6 caracteres.';
  if (code.includes('user-not-found') || code.includes('wrong-password') || code.includes('invalid-credential')) {
    return 'Correo o contraseña incorrectos.';
  }
  if (code.includes('too-many-requests')) return 'Demasiados intentos. Esperá un momento.';
  return 'Algo salió mal. Intentá de nuevo.';
}

/* ---------- Cuenta de usuario ---------- */
async function ensureUserDoc(uid, email) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      email,
      createdAt: serverTimestamp(),
      totalRunes: 0,
      spinsUsed: 0,
      redeemedCodes: []
    });
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
  unsubUser?.();
  unsubPrizes?.();
  unsubUser = null;
  unsubPrizes = null;
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
    const date = p.wonAt?.toDate ? p.wonAt.toDate().toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    const badge = p.fulfilled
      ? '<span class="badge badge-done">Entregado</span>'
      : '<span class="badge badge-pending">Pendiente</span>';
    return `<div class="history-item"><div><span class="label">${escapeHtml(p.prizeLabel || p.prizeKey)}</span><span class="date">${date}</span></div>${badge}</div>`;
  }).join('');
}

/* ---------- Canje de código ---------- */
async function redeemCode(rawCode) {
  const code = (rawCode || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(code)) {
    throw new Error('El código debe tener 10 letras o números.');
  }
  const uid = auth.currentUser.uid;
  const codeRef = doc(db, 'codes', code);
  const userRef = doc(db, 'users', uid);

  await runTransaction(db, async (tx) => {
    const codeSnap = await tx.get(codeRef);
    if (!codeSnap.exists()) throw new Error('Ese código no existe. Revisalo bien.');
    const data = codeSnap.data();
    if (data.status !== 'unused') throw new Error('Ese código ya fue usado.');
    tx.update(codeRef, { status: 'used', usedBy: uid, usedAt: serverTimestamp() });
    tx.update(userRef, { totalRunes: increment(1), redeemedCodes: arrayUnion(code) });
  });
}

/* ---------- Ruleta — dibujo ---------- */
function polarToCartesian(cx, cy, r, angleDeg) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${cx} ${cy} L ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`;
}

function drawWheel() {
  const segments = buildSegments();
  const svg = document.getElementById('wheel-svg');
  const cx = 150, cy = 150, r = 145;
  const paths = segments.map((seg) => {
    const d = describeArc(cx, cy, r, seg.startAngle, seg.startAngle + seg.sweep);
    return `<path d="${d}" fill="${SEGMENT_COLORS[seg.key]}" stroke="#0b0a08" stroke-width="2"></path>`;
  }).join('');
  const hub = `<circle cx="${cx}" cy="${cy}" r="36" fill="#161210" stroke="#33271a" stroke-width="2"/>
    <image href="assets/runa.png" x="${cx - 22}" y="${cy - 22}" width="44" height="44"/>`;
  svg.innerHTML = paths + hub;
}

function drawLegend() {
  const segments = buildSegments();
  const legend = document.getElementById('wheel-legend');
  legend.innerHTML = segments.map((seg) => {
    const pct = Math.round(seg.prob * 1000) / 10;
    return `<div class="legend-row"><span class="legend-dot" style="background:${SEGMENT_COLORS[seg.key]}"></span>${seg.label}<span class="pct">${pct}%</span></div>`;
  }).join('');
}

/* ---------- Ruleta — giro ---------- */
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
    uid,
    email: auth.currentUser.email,
    prizeKey: chosen.key,
    prizeLabel: chosen.label,
    wonAt: serverTimestamp(),
    fulfilled: false
  });

  return chosen;
}

function animateWheelTo(prize, onDone) {
  const segments = buildSegments();
  const seg = segments.find((s) => s.key === prize.key);
  const jitter = seg.sweep * (0.15 + Math.random() * 0.7);
  const targetAngle = seg.startAngle + jitter;
  const svg = document.getElementById('wheel-svg');

  svg.style.transition = 'none';
  svg.style.transform = 'rotate(0deg)';
  void svg.offsetWidth;

  requestAnimationFrame(() => {
    svg.style.transition = 'transform 4.2s cubic-bezier(.12,.7,.1,1)';
    const finalDeg = 5 * 360 + (360 - targetAngle);
    svg.style.transform = `rotate(${finalDeg}deg)`;
  });

  svg.addEventListener('transitionend', function handler() {
    svg.removeEventListener('transitionend', handler);
    onDone();
  }, { once: true });
}

function showResult(prize) {
  document.getElementById('result-prize-name').textContent = prize.label;
  document.getElementById('modal-result').classList.remove('hidden');
}

/* ---------- Wiring de eventos ---------- */
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
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    errEl.textContent = friendlyAuthError(err);
  }
});

document.getElementById('form-register').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('register-email').value.trim();
  const pass = document.getElementById('register-password').value;
  const errEl = document.getElementById('register-error');
  errEl.textContent = '';
  try {
    await createUserWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    errEl.textContent = friendlyAuthError(err);
  }
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
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('btn-open-wheel').addEventListener('click', () => {
  document.getElementById('screen-wheel').classList.remove('hidden');
});
document.getElementById('btn-close-wheel').addEventListener('click', () => {
  document.getElementById('screen-wheel').classList.add('hidden');
});

document.getElementById('btn-spin').addEventListener('click', async () => {
  if (spinning) return;
  if (currentSpinsAvailable <= 0) {
    showToast('Todavía no tenés giros disponibles.', 'error');
    return;
  }
  spinning = true;
  document.getElementById('btn-spin').disabled = true;
  try {
    const prize = await spinTransaction();
    animateWheelTo(prize, () => {
      spinning = false;
      document.getElementById('btn-spin').disabled = false;
      showResult(prize);
    });
  } catch (err) {
    spinning = false;
    document.getElementById('btn-spin').disabled = false;
    showToast(err.message || 'No se pudo girar.', 'error');
  }
});

document.getElementById('btn-close-result').addEventListener('click', () => {
  document.getElementById('modal-result').classList.add('hidden');
  document.getElementById('screen-wheel').classList.add('hidden');
});

/* ---------- Arranque ---------- */
showScreen('loading');
drawWheel();
drawLegend();

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
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

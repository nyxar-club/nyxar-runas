import { auth, db, ADMIN_EMAIL } from './firebase-config.js';
import { RUNES_PER_SPIN } from './prizes.js';

import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

import {
  collection, doc, getDoc, setDoc, updateDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin I, L, O, 0, 1 para evitar confusión
const CODE_LENGTH = 10;

let unsubCodes = null;
let unsubPrizes = null;
let unsubUsers = null;

/* ---------- Helpers ---------- */
function showAdminScreen(name) {
  ['loading', 'login', 'unauthorized', 'dashboard'].forEach((n) => {
    document.getElementById('admin-' + n).classList.toggle('hidden', n !== name);
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

function cleanupListeners() {
  unsubCodes?.();
  unsubPrizes?.();
  unsubUsers?.();
  unsubCodes = null;
  unsubPrizes = null;
  unsubUsers = null;
}

/* ---------- Generar código ---------- */
function randomCode() {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return s;
}

async function createUniqueCode() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const ref = doc(db, 'codes', code);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { status: 'unused', createdAt: serverTimestamp() });
      return code;
    }
  }
  throw new Error('No se pudo generar un código único, intentá de nuevo.');
}

document.getElementById('btn-generate-code').addEventListener('click', async () => {
  const btn = document.getElementById('btn-generate-code');
  btn.disabled = true;
  try {
    const code = await createUniqueCode();
    const display = document.getElementById('new-code-display');
    display.innerHTML = `<div class="code-display">${code}</div><button class="btn btn-ghost" id="btn-copy-code" type="button">Copiar código</button>`;
    document.getElementById('btn-copy-code').addEventListener('click', () => {
      navigator.clipboard.writeText(code).then(() => showToast('Código copiado', 'success'));
    });
  } catch (err) {
    showToast(err.message || 'No se pudo generar el código.', 'error');
  } finally {
    btn.disabled = false;
  }
});

/* ---------- Listas en vivo ---------- */
function renderCodesList(snap) {
  const container = document.getElementById('codes-list');
  if (snap.empty) {
    container.innerHTML = '<p class="empty-note">Todavía no generaste códigos.</p>';
    return;
  }
  container.innerHTML = snap.docs.map((d) => {
    const data = d.data();
    const status = data.status === 'used'
      ? '<span class="badge badge-done">Usado</span>'
      : '<span class="badge badge-pending">Disponible</span>';
    return `<div class="row"><span style="font-family:var(--mono)">${d.id}</span>${status}</div>`;
  }).join('');
}

function renderPendingPrizes(list) {
  const body = document.getElementById('pending-prizes-body');
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="4" class="empty-note">No hay premios pendientes.</td></tr>';
    return;
  }
  body.innerHTML = list.map((p) => {
    const date = p.wonAt?.toDate ? p.wonAt.toDate().toLocaleDateString('es-SV') : '';
    return `<tr>
      <td>${escapeHtml(p.email || '')}</td>
      <td>${escapeHtml(p.prizeLabel || p.prizeKey || '')}</td>
      <td>${date}</td>
      <td><button class="mini-btn" data-id="${p.id}" type="button">Marcar entregado</button></td>
    </tr>`;
  }).join('');
  body.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await updateDoc(doc(db, 'prizes', btn.dataset.id), { fulfilled: true, fulfilledAt: serverTimestamp() });
      } catch (err) {
        showToast('No se pudo marcar como entregado.', 'error');
        btn.disabled = false;
      }
    });
  });
}

function renderCustomers(list) {
  const body = document.getElementById('customers-body');
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="3" class="empty-note">Todavía no hay clientes registrados.</td></tr>';
    return;
  }
  body.innerHTML = list.map((u) => {
    const total = u.totalRunes || 0;
    const available = Math.floor(total / RUNES_PER_SPIN) - (u.spinsUsed || 0);
    return `<tr><td>${escapeHtml(u.email || '')}</td><td>${total}</td><td>${available}</td></tr>`;
  }).join('');
}

function attachAdminListeners() {
  unsubCodes = onSnapshot(
    query(collection(db, 'codes'), orderBy('createdAt', 'desc'), limit(25)),
    renderCodesList
  );

  unsubPrizes = onSnapshot(
    query(collection(db, 'prizes'), where('fulfilled', '==', false)),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (b.wonAt?.toMillis?.() || 0) - (a.wonAt?.toMillis?.() || 0));
      renderPendingPrizes(list);
    }
  );

  unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (b.totalRunes || 0) - (a.totalRunes || 0));
    renderCustomers(list);
  });
}

/* ---------- Login ---------- */
document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('admin-email').value.trim();
  const pass = document.getElementById('admin-password').value;
  const errEl = document.getElementById('admin-login-error');
  errEl.textContent = '';
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    errEl.textContent = 'Correo o contraseña incorrectos.';
  }
});

document.getElementById('btn-admin-logout').addEventListener('click', () => signOut(auth));
document.getElementById('btn-dash-logout').addEventListener('click', () => signOut(auth));

/* ---------- Arranque ---------- */
showAdminScreen('loading');

onAuthStateChanged(auth, (user) => {
  cleanupListeners();
  if (!user) {
    showAdminScreen('login');
    return;
  }
  if (user.email !== ADMIN_EMAIL) {
    showAdminScreen('unauthorized');
    return;
  }
  showAdminScreen('dashboard');
  attachAdminListeners();
});

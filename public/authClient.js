import { setAuditUser } from './auditStore.js';

export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    location.replace(`/login.html?next=${next}`);
    return null;
  }
  setAuditUser(user);
  return user;
}

export async function getCurrentUser() {
  const response = await fetch('/api/auth/me', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' }
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return payload.user || null;
}

export function renderAuthUser(user, container) {
  if (!container || !user) return;
  container.innerHTML = `
    <span class="auth-user">${escapeHtml(user.name)} · ${escapeHtml(user.email)}</span>
    <button id="logoutButton" class="nav-link button-link" type="button">Logout</button>
  `;
  container.querySelector('#logoutButton').addEventListener('click', logout);
}

export async function logout() {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin'
  });
  sessionStorage.removeItem('cohort-lens.auditUser.v1');
  location.replace('/login.html');
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

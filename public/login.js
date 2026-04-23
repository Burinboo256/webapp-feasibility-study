import { getCurrentUser } from './authClient.js';
import { setAuditUser } from './auditStore.js';

const form = document.getElementById('loginForm');
const status = document.getElementById('loginStatus');
const signupForm = document.getElementById('signupForm');
const signupOtpForm = document.getElementById('signupOtpForm');
const signupStatus = document.getElementById('signupStatus');
const forgotForm = document.getElementById('forgotForm');
const forgotOtpForm = document.getElementById('forgotOtpForm');
const forgotStatus = document.getElementById('forgotStatus');
const next = new URLSearchParams(location.search).get('next') || '/';

document.addEventListener('DOMContentLoaded', async () => {
  bindAuthTabs();
  const user = await getCurrentUser();
  if (user) {
    setAuditUser(user);
    location.replace(next);
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = 'Checking credentials...';

  const response = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: document.getElementById('email').value,
      password: document.getElementById('password').value
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    status.textContent = payload.error || 'Login failed.';
    return;
  }

  setAuditUser(payload.user);
  location.replace(next);
});

signupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  signupStatus.textContent = 'Sending OTP...';
  const response = await postJson('/api/auth/signup/request', {
    name: document.getElementById('signupName').value,
    email: document.getElementById('signupEmail').value,
    password: document.getElementById('signupPassword').value
  });

  if (!response.ok) {
    signupStatus.textContent = response.payload.error || 'Unable to request OTP.';
    return;
  }

  signupOtpForm.hidden = false;
  signupStatus.textContent = response.payload.message || 'OTP sent. Check email.';
});

signupOtpForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  signupStatus.textContent = 'Confirming OTP...';
  const response = await postJson('/api/auth/signup/confirm', {
    email: document.getElementById('signupEmail').value,
    otp: document.getElementById('signupOtp').value
  });

  if (!response.ok) {
    signupStatus.textContent = response.payload.error || 'Unable to create user.';
    return;
  }

  setAuditUser(response.payload.user);
  location.replace(next);
});

forgotForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  forgotStatus.textContent = 'Sending OTP...';
  const response = await postJson('/api/auth/password/request', {
    email: document.getElementById('forgotEmail').value
  });

  if (!response.ok) {
    forgotStatus.textContent = response.payload.error || 'Unable to request OTP.';
    return;
  }

  forgotOtpForm.hidden = false;
  forgotStatus.textContent = response.payload.message || 'OTP sent if account exists.';
});

forgotOtpForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  forgotStatus.textContent = 'Resetting password...';
  const response = await postJson('/api/auth/password/confirm', {
    email: document.getElementById('forgotEmail').value,
    otp: document.getElementById('forgotOtp').value,
    password: document.getElementById('forgotPassword').value
  });

  if (!response.ok) {
    forgotStatus.textContent = response.payload.error || 'Unable to reset password.';
    return;
  }

  forgotOtpForm.hidden = true;
  forgotStatus.textContent = response.payload.message || 'Password updated. You can now sign in.';
  showAuthPanel('loginPanel');
});

function bindAuthTabs() {
  document.querySelectorAll('[data-auth-panel]').forEach((button) => {
    button.addEventListener('click', () => showAuthPanel(button.dataset.authPanel));
  });
}

function showAuthPanel(panelId) {
  document.querySelectorAll('.auth-panel').forEach((panel) => {
    panel.hidden = panel.id !== panelId;
  });
  document.querySelectorAll('[data-auth-panel]').forEach((button) => {
    button.classList.toggle('active', button.dataset.authPanel === panelId);
  });
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return {
    ok: response.ok,
    status: response.status,
    payload: await response.json().catch(() => ({}))
  };
}

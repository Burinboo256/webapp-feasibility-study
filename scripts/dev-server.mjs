import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createFeasibilityService } from '../src/server/createFeasibilityService.js';
import { createAppStorageService } from '../src/server/createAppStorageService.js';
import { loadServerConfig } from '../src/server/config.js';
import { createOtpDeliveryService } from '../src/server/otpDelivery.js';

const root = resolve(process.cwd());
const appConfig = await loadServerConfig({ root });
const host = appConfig.server.host;
const port = appConfig.server.port;
const publicRoot = join(root, 'public');
const sessionCookieName = appConfig.auth.session.cookieName;
const oauthStateCookieName = appConfig.auth.oauthState.cookieName;
const otpTtlMs = appConfig.auth.otp.ttlMinutes * 60 * 1000;
const maxOtpAttempts = appConfig.auth.otp.maxAttempts;
const feasibilityService = createFeasibilityService({ root, config: appConfig });
const appStorage = createAppStorageService({ root, config: appConfig });
const otpDelivery = createOtpDeliveryService({
  smtp: appConfig.smtp,
  allowConsoleFallbackOnSmtpFailure: isLocalDevSmtpFallbackEnabled(appConfig)
});

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function resolveRequestPath(url) {
  const pathname = decodeURIComponent(new URL(url, `http://localhost:${port}`).pathname);
  const rawPath = pathname === '/' ? '/index.html' : pathname;
  const candidate = normalize(join(publicRoot, rawPath));
  if (!candidate.startsWith(publicRoot)) return null;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;

  const sourceCandidate = normalize(join(root, rawPath));
  if (sourceCandidate.startsWith(root) && existsSync(sourceCandidate) && statSync(sourceCandidate).isFile()) {
    return sourceCandidate;
  }

  return null;
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/auth/me') {
    const user = await getSessionUser(request);
    if (!user) return sendJson(response, 401, { error: 'Not authenticated' });
    return sendJson(response, 200, { user });
  }

  if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
    const user = await getSessionUser(request);
    if (!user) return sendJson(response, 401, { error: 'Not authenticated' });
    try {
      const bootstrap = await feasibilityService.getBootstrap();
      return sendJson(response, 200, {
        ...bootstrap,
        appStorage: appConfig.appStorage
      });
    } catch (error) {
      return sendJson(response, 500, { error: error.message || 'Unable to load bootstrap data.' });
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/feasibility/run') {
    const user = await getSessionUser(request);
    if (!user) return sendJson(response, 401, { error: 'Not authenticated' });
    try {
      const body = await readJsonBody(request);
      return sendJson(response, 200, await feasibilityService.runFeasibility(body.config || {}));
    } catch (error) {
      return sendJson(response, 500, { error: error.message || 'Unable to run feasibility query.' });
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/audit/session') {
    const user = await getSessionUser(request);
    if (!user) return sendJson(response, 401, { error: 'Not authenticated' });
    const sessionId = getCookie(request, sessionCookieName);
    const session = await appStorage.touchAuditSession({
      id: sessionId,
      user,
      userAgent: request.headers['user-agent'] || ''
    });
    return sendJson(response, 200, { session });
  }

  if (request.method === 'POST' && url.pathname === '/api/audit/run') {
    const user = await getSessionUser(request);
    if (!user) return sendJson(response, 401, { error: 'Not authenticated' });
    const body = await readJsonBody(request);
    const run = await appStorage.createRunLog({
      id: body.id || randomUUID(),
      sessionId: getCookie(request, sessionCookieName),
      user,
      createdAt: new Date().toISOString(),
      question: body.question || '',
      indexEligibleCount: Number(body.indexEligibleCount || 0),
      finalCount: Number(body.finalCount || 0),
      excludedCount: Number(body.excludedCount || 0),
      attrition: body.attrition || [],
      selectedConcepts: body.selectedConcepts || {},
      config: body.config || {},
      sql: body.sql || '',
      dataSource: appConfig.clinicalDataSource
    });
    return sendJson(response, 201, { run });
  }

  if (request.method === 'GET' && url.pathname === '/api/logs') {
    const user = await getSessionUser(request);
    if (!user) return sendJson(response, 401, { error: 'Not authenticated' });
    const [sessions, runs] = await Promise.all([
      appStorage.listAuditSessions(user.id),
      appStorage.listRunLogs(user.id)
    ]);
    return sendJson(response, 200, { sessions, runs, appStorage: appConfig.appStorage });
  }

  if (request.method === 'DELETE' && url.pathname === '/api/logs') {
    const user = await getSessionUser(request);
    if (!user) return sendJson(response, 401, { error: 'Not authenticated' });
    await appStorage.clearAuditLogs(user.id);
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === 'GET' && url.pathname === '/api/cohorts') {
    const user = await getSessionUser(request);
    if (!user) return sendJson(response, 401, { error: 'Not authenticated' });
    const cohorts = await appStorage.listSavedCohorts(user.id);
    return sendJson(response, 200, { cohorts });
  }

  if (request.method === 'POST' && url.pathname === '/api/cohorts') {
    const user = await getSessionUser(request);
    if (!user) return sendJson(response, 401, { error: 'Not authenticated' });
    const body = await readJsonBody(request);
    const cohort = await appStorage.createSavedCohort({
      id: body.id,
      userId: user.id,
      name: body.name,
      config: body.config
    });
    return sendJson(response, 201, { cohort });
  }

  if (request.method === 'DELETE' && url.pathname.startsWith('/api/cohorts/')) {
    const user = await getSessionUser(request);
    if (!user) return sendJson(response, 401, { error: 'Not authenticated' });
    const cohortId = url.pathname.split('/').pop();
    await appStorage.deleteSavedCohort(user.id, cohortId);
    response.writeHead(204, { 'cache-control': 'no-store' });
    return response.end();
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    return handleCredentialsLogin(request, response);
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/signup/request') {
    return handleSignupRequest(request, response);
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/signup/confirm') {
    return handleSignupConfirm(request, response);
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/password/request') {
    return handlePasswordResetRequest(request, response);
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/password/confirm') {
    return handlePasswordResetConfirm(request, response);
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    const sessionId = getCookie(request, sessionCookieName);
    if (sessionId) await appStorage.deleteSession(sessionId);
    response.writeHead(204, {
      'set-cookie': expiredCookie(sessionCookieName),
      'cache-control': 'no-store'
    });
    return response.end();
  }

  if (request.method === 'GET' && url.pathname === '/api/auth/google') {
    return redirectToGoogle(response);
  }

  if (request.method === 'GET' && url.pathname === '/api/auth/google/callback') {
    return handleGoogleCallback(request, response, url);
  }

  return sendJson(response, 404, { error: 'API route not found' });
}

async function handleCredentialsLogin(request, response) {
  const body = await readJsonBody(request);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const user = await appStorage.getUserByEmail(email);

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return sendJson(response, 401, { error: 'Invalid email or password' });
  }

  const updated = await appStorage.updateUser({
    ...user,
    lastLoginAt: new Date().toISOString()
  });
  const publicUser = createPublicUser(updated, 'credentials');
  await issueSession(response, publicUser, request, []);
  return sendJson(response, 200, { user: publicUser });
}

async function handleSignupRequest(request, response) {
  const body = await readJsonBody(request);
  const email = normalizeEmail(body.email);
  const name = String(body.name || '').trim();
  const password = String(body.password || '');

  if (!isValidEmail(email) || !name || password.length < 8) {
    return sendJson(response, 400, { error: 'Name, valid email, and password with at least 8 characters are required.' });
  }

  if (await appStorage.getUserByEmail(email)) {
    return sendJson(response, 409, { error: 'A user with this email already exists.' });
  }

  const otp = createOtp();
  await appStorage.createPendingOtp({
    purpose: 'signup',
    email,
    otpHash: await bcrypt.hash(otp, 10),
    attempts: 0,
    expiresAt: new Date(Date.now() + otpTtlMs).toISOString(),
    payload: {
      name,
      passwordHash: await bcrypt.hash(password, 12)
    }
  });
  const delivery = await otpDelivery.sendOtpEmail({
    to: email,
    subject: 'Cohort Lens account verification',
    otp,
    intro: 'Use this OTP to finish creating your Cohort Lens account.',
    ttlMinutes: appConfig.auth.otp.ttlMinutes
  });
  return sendJson(response, 200, { message: signupOtpMessage(delivery) });
}

async function handleSignupConfirm(request, response) {
  const body = await readJsonBody(request);
  const email = normalizeEmail(body.email);
  const otp = String(body.otp || '').trim();
  const pending = await appStorage.getPendingOtp('signup', email);
  const validation = await validatePendingOtp(pending, otp);
  if (!validation.ok) return sendJson(response, validation.status, { error: validation.error });

  if (await appStorage.getUserByEmail(email)) {
    await appStorage.deletePendingOtp('signup', email);
    return sendJson(response, 409, { error: 'A user with this email already exists.' });
  }

  const user = await appStorage.createUser({
    id: `user-${randomBytes(8).toString('hex')}`,
    email,
    name: pending.payload?.name,
    role: 'researcher',
    provider: 'credentials',
    passwordHash: pending.payload?.passwordHash,
    active: true
  });
  await appStorage.deletePendingOtp('signup', email);
  const publicUser = createPublicUser(user, 'credentials');
  await issueSession(response, publicUser, request, []);
  return sendJson(response, 201, { user: publicUser });
}

async function handlePasswordResetRequest(request, response) {
  const body = await readJsonBody(request);
  const email = normalizeEmail(body.email);
  const user = await appStorage.getUserByEmail(email);

  if (user) {
    const otp = createOtp();
    await appStorage.createPendingOtp({
      purpose: 'password',
      email,
      userId: user.id,
      otpHash: await bcrypt.hash(otp, 10),
      attempts: 0,
      expiresAt: new Date(Date.now() + otpTtlMs).toISOString(),
      payload: {}
    });
    const delivery = await otpDelivery.sendOtpEmail({
      to: email,
      subject: 'Cohort Lens password reset OTP',
      otp,
      intro: 'Use this OTP to reset your Cohort Lens password.',
      ttlMinutes: appConfig.auth.otp.ttlMinutes
    });
    if (delivery.mode === 'console') {
      console.warn('[PASSWORD RESET OTP] SMTP delivery was unavailable; OTP was written to the server console.');
    }
  }

  return sendJson(response, 200, { message: 'If the email exists, an OTP has been sent.' });
}

async function handlePasswordResetConfirm(request, response) {
  const body = await readJsonBody(request);
  const email = normalizeEmail(body.email);
  const otp = String(body.otp || '').trim();
  const password = String(body.password || '');
  if (password.length < 8) {
    return sendJson(response, 400, { error: 'Password must be at least 8 characters.' });
  }

  const pending = await appStorage.getPendingOtp('password', email);
  const validation = await validatePendingOtp(pending, otp);
  if (!validation.ok) return sendJson(response, validation.status, { error: validation.error });

  const user = await appStorage.getUserByEmail(email);
  if (!user) {
    await appStorage.deletePendingOtp('password', email);
    return sendJson(response, 404, { error: 'User not found.' });
  }

  await appStorage.updateUser({
    ...user,
    passwordHash: await bcrypt.hash(password, 12),
    passwordUpdatedAt: new Date().toISOString()
  });
  await appStorage.deletePendingOtp('password', email);
  return sendJson(response, 200, { message: 'Password updated. You can now sign in.' });
}

function redirectToGoogle(response) {
  const clientId = appConfig.auth.google.clientId;
  const redirectUri = googleRedirectUri();
  if (!clientId) {
    return sendHtml(response, 500, 'Google OAuth is not configured. Update auth.google in config/app.config.json.');
  }

  const state = randomId();
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('prompt', 'select_account');

  response.writeHead(302, {
    location: authUrl.toString(),
    'set-cookie': cookie(oauthStateCookieName, state, { maxAge: appConfig.auth.oauthState.maxAgeSeconds }),
    'cache-control': 'no-store'
  });
  response.end();
}

async function handleGoogleCallback(request, response, url) {
  const expectedState = getCookie(request, oauthStateCookieName);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!expectedState || !state || expectedState !== state || !code) {
    return sendHtml(response, 400, 'Invalid Google OAuth callback state.');
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: appConfig.auth.google.clientId,
      client_secret: appConfig.auth.google.clientSecret,
      redirect_uri: googleRedirectUri(),
      grant_type: 'authorization_code'
    })
  });

  if (!tokenResponse.ok) {
    return sendHtml(response, 502, 'Google token exchange failed.');
  }

  const token = await tokenResponse.json();
  const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { authorization: `Bearer ${token.access_token}` }
  });

  if (!profileResponse.ok) {
    return sendHtml(response, 502, 'Google user profile request failed.');
  }

  const profile = await profileResponse.json();
  if (!profile.email_verified) {
    return sendHtml(response, 403, 'Google email must be verified.');
  }

  const allowedEmails = allowedGoogleEmails();
  if (allowedEmails.length > 0 && !allowedEmails.includes(String(profile.email).toLowerCase())) {
    return sendHtml(response, 403, 'Google account is not allowed for this app.');
  }

  const storedUser = await appStorage.upsertGoogleUser({
    googleSub: profile.sub,
    email: profile.email,
    name: profile.name || profile.email
  });
  const user = createPublicUser(storedUser, 'google');
  await issueSession(response, user, request, [expiredCookie(oauthStateCookieName)]);
  response.writeHead(302, { location: '/', 'cache-control': 'no-store' });
  response.end();
}

async function issueSession(response, user, request, extraCookies = []) {
  const sessionId = randomId();
  const expiresAt = new Date(Date.now() + appConfig.auth.session.maxAgeSeconds * 1000).toISOString();
  await appStorage.createSession({
    sessionId,
    userId: user.id,
    expiresAt,
    userAgent: request.headers['user-agent'] || '',
    ipAddress: request.socket.remoteAddress || ''
  });
  response.setHeader('set-cookie', [cookie(sessionCookieName, sessionId, { maxAge: appConfig.auth.session.maxAgeSeconds }), ...extraCookies]);
}

async function getSessionUser(request) {
  const sessionId = getCookie(request, sessionCookieName);
  if (!sessionId) return null;
  const session = await appStorage.getSession(sessionId);
  return session?.user || null;
}

function createPublicUser(user, provider) {
  return {
    id: user.id,
    email: user.email,
    name: user.name || user.email,
    provider,
    role: user.role || 'researcher'
  };
}

function readJsonBody(request) {
  return new Promise((resolveBody) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) request.destroy();
    });
    request.on('end', () => {
      try {
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch {
        resolveBody({});
      }
    });
  });
}

async function validatePendingOtp(pending, otp) {
  if (!pending) return { ok: false, status: 400, error: 'OTP request not found or expired.' };
  if (Date.now() > new Date(pending.expiresAt).getTime()) {
    return { ok: false, status: 400, error: 'OTP expired. Request a new OTP.' };
  }
  if (pending.attempts >= maxOtpAttempts) {
    return { ok: false, status: 429, error: 'Too many OTP attempts. Request a new OTP.' };
  }

  pending.attempts += 1;
  const valid = await bcrypt.compare(otp, pending.otpHash);
  await appStorage.updatePendingOtp(pending);
  if (!valid) return { ok: false, status: 401, error: 'Invalid OTP.' };
  return { ok: true };
}

function createOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(body));
}

function sendHtml(response, status, message) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'text/html; charset=utf-8'
  });
  response.end(`<p>${escapeHtml(message)}</p><p><a href="/login.html">Back to login</a></p>`);
}

function cookie(name, value, options = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (options.maxAge) parts.push(`Max-Age=${options.maxAge}`);
  if (appConfig.server.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

function expiredCookie(name) {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function getCookie(request, name) {
  const raw = request.headers.cookie || '';
  return raw
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function googleRedirectUri() {
  return appConfig.auth.google.redirectUri;
}

function allowedGoogleEmails() {
  return appConfig.auth.google.allowedEmails;
}

function randomId() {
  return randomBytes(32).toString('base64url');
}

function signupOtpMessage(delivery) {
  if (delivery.mode === 'console') {
    return delivery.warning || 'OTP delivery is using the server console for local testing.';
  }
  return 'OTP sent to email. Confirm OTP to create the user.';
}

function isLocalDevSmtpFallbackEnabled(config) {
  return ['127.0.0.1', 'localhost', '::1'].includes(String(config.server.host || '').toLowerCase())
    || config.appStorage === 'local';
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${host}:${port}`);
  if (url.pathname.startsWith('/api/')) {
    await handleApi(request, response, url);
    return;
  }

  const filePath = resolveRequestPath(request.url || '/');

  if (!filePath) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': contentTypes[extname(filePath)] || 'application/octet-stream'
  });
  createReadStream(filePath).pipe(response);
}).listen(port, host, () => {
  console.log(`Cohort feasibility app: http://${host}:${port}`);
});

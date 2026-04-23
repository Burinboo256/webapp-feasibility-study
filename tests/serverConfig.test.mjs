import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function importModule(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  url.searchParams.set('v', `${Date.now()}-${Math.random()}`);
  return import(url.href);
}

function getExport(module, names) {
  for (const candidate of [module, module.default]) {
    if (!candidate) continue;
    for (const name of names) {
      if (typeof candidate[name] === 'function') {
        return candidate[name];
      }
    }
  }

  throw new Error(`Missing expected export. Tried: ${names.join(', ')}`);
}

async function loadServerConfig(options = {}) {
  const module = await importModule('../src/server/config.js');
  const loadConfig = getExport(module, [
    'loadServerConfig',
    'createServerConfig',
    'bootstrapServerConfig'
  ]);

  return loadConfig(options);
}

async function createFeasibilityService(options = {}) {
  const module = await importModule('../src/server/createFeasibilityService.js');
  const createService = getExport(module, [
    'createFeasibilityService',
    'buildFeasibilityService',
    'createServerFeasibilityService'
  ]);

  return createService(options);
}

test('server config loader reads one central config file and returns structured settings', async () => {
  const config = await loadServerConfig();

  assert.match(config.configPath, /config[\\/]+app\.config(?:\.example)?\.json$/);
  assert.equal(config.server.host, '127.0.0.1');
  assert.equal(config.server.port, 4173);
  assert.equal(config.server.cookieSecure, false);
  assert.equal(config.auth.session.cookieName, 'cohort_lens_session');
  assert.equal(config.auth.session.maxAgeSeconds, 28800);
  assert.equal(config.auth.oauthState.cookieName, 'cohort_lens_oauth_state');
  assert.equal(config.auth.oauthState.maxAgeSeconds, 600);
  assert.equal(config.auth.otp.ttlMinutes, 10);
  assert.equal(config.auth.otp.maxAttempts, 5);
  assert.equal(config.auth.google.clientId, '');
  assert.equal(config.auth.google.clientSecret, '');
  assert.equal(config.auth.google.redirectUri, 'http://127.0.0.1:4173/api/auth/google/callback');
  assert.deepEqual(config.auth.google.allowedEmails, []);
  assert.equal(config.smtp.host, '');
  assert.equal(config.smtp.port, 587);
  assert.equal(config.smtp.secure, false);
  assert.equal(config.smtp.user, '');
  assert.equal(config.smtp.pass, '');
  assert.equal(config.smtp.from, '');
  assert.equal(config.clinicalDataSource, 'json');
  assert.equal(config.dataSource, 'json');
  assert.equal(config.appStorage, 'local');
  assert.equal(config.sqlServer.server, '');
  assert.equal(config.sqlServer.port, 1433);
  assert.equal(config.sqlServer.options.encrypt, true);
  assert.equal(config.sqlServer.options.trustServerCertificate, false);
});

test('server config loader falls back to app.config.example.json when the local config file is absent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webapp-config-example-'));
  const configDir = path.join(root, 'config');
  await mkdir(configDir, { recursive: true });
  await writeFile(
    path.join(configDir, 'app.config.example.json'),
    JSON.stringify({
      server: {
        host: '0.0.0.0',
        port: 5090,
        cookieSecure: true
      },
      auth: {
        session: {
          cookieName: 'demo_session',
          maxAgeSeconds: 900
        },
        oauthState: {
          cookieName: 'demo_oauth_state',
          maxAgeSeconds: 120
        },
        otp: {
          ttlMinutes: 15,
          maxAttempts: 3
        },
        google: {
          clientId: '',
          clientSecret: '',
          redirectUri: '',
          allowedEmails: []
        }
      },
      smtp: {
        host: '',
        port: 587,
        secure: false,
        user: '',
        pass: '',
        from: ''
      },
      clinicalDataSource: 'json',
      appStorage: 'local',
      sqlServer: {
        server: '',
        port: 1433,
        database: '',
        user: '',
        password: '',
        options: {
          encrypt: true,
          trustServerCertificate: false
        }
      }
    }, null, 2),
    'utf8'
  );

  const config = await loadServerConfig({ root, env: {} });

  assert.match(config.configPath, /config[\\/]+app\.config\.example\.json$/);
  assert.equal(config.server.host, '0.0.0.0');
  assert.equal(config.server.port, 5090);
  assert.equal(config.server.cookieSecure, true);
  assert.equal(config.auth.google.redirectUri, 'http://0.0.0.0:5090/api/auth/google/callback');
});

test('server config loader lets env overrides win for PORT and DATA_SOURCE', async () => {
  const config = await loadServerConfig({
    CLINICAL_DATA_SOURCE: 'sqlserver',
    APP_STORAGE: 'sqlserver',
    PORT: '4173'
  });

  assert.equal(config.server.port, 4173);
  assert.equal(config.clinicalDataSource, 'sqlserver');
  assert.equal(config.dataSource, 'sqlserver');
  assert.equal(config.appStorage, 'sqlserver');
});

test('server config loader rejects invalid DATA_SOURCE values with a clear error', async () => {
  await assert.rejects(
    loadServerConfig({ CLINICAL_DATA_SOURCE: 'postgres' }),
    (error) => {
      assert.match(error.message, /DATA_SOURCE/i);
      assert.match(error.message, /postgres/i);
      assert.match(error.message, /json/i);
      assert.match(error.message, /sqlserver/i);
      return true;
    }
  );
});

test('feasibility service factory can be driven from the centralized config object', async () => {
  const centralConfig = await loadServerConfig({
    CLINICAL_DATA_SOURCE: 'sqlserver',
    APP_STORAGE: 'sqlserver',
    PORT: '4173'
  });
  const repository = {
    async run() {
      return { finalCount: 0, rows: [] };
    }
  };

  const service = await createFeasibilityService({
    config: centralConfig,
    repository
  });

  assert.equal(service.dataSource, 'sqlserver');
});

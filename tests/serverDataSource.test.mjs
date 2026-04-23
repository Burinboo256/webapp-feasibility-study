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

async function loadServerConfig() {
  const module = await importModule('../src/server/config.js');
  const loadConfig = getExport(module, [
    'loadServerConfig',
    'createServerConfig',
    'bootstrapServerConfig'
  ]);

  return loadConfig();
}

async function createJsonRepository(rootDir) {
  const module = await importModule('../src/server/jsonRepository.js');
  const createRepository = getExport(module, [
    'createJsonRepository',
    'createSyntheticDataRepository',
    'createDataRepository'
  ]);

  for (const args of [[{ rootDir }], [{ baseDir: rootDir }], [rootDir]]) {
    try {
      return createRepository(...args);
    } catch {
      // Try the next supported constructor shape.
    }
  }

  return createRepository({ rootDir });
}

async function createFeasibilityService(repository) {
  const module = await importModule('../src/server/feasibilityService.js');
  const createService = getExport(module, [
    'createFeasibilityService',
    'buildFeasibilityService',
    'createServerFeasibilityService'
  ]);

  for (const args of [[repository], [{ repository }], [{ repo: repository }]]) {
    try {
      return createService(...args);
    } catch {
      // Try the next supported constructor shape.
    }
  }

  return createService(repository);
}

async function createSqlServerRepository(config) {
  const module = await importModule('../src/server/sqlServerRepository.js');
  const createRepository = getExport(module, [
    'createSqlServerRepository',
    'createSqlRepository',
    'createMssqlRepository'
  ]);

  for (const args of [[config], [{ config }], [{ options: config }]]) {
    try {
      return createRepository(...args);
    } catch {
      // Try the next supported constructor shape.
    }
  }

  return createRepository(config);
}

async function makeDatasetRoot({ localData, exampleData, includeLocal = true }) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'webapp-feasibility-study-'));
  const dataDir = path.join(rootDir, 'public', 'data');
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    path.join(dataDir, 'synthetic-clinical-data_example.json'),
    JSON.stringify(exampleData, null, 2),
    'utf8'
  );

  if (includeLocal) {
    await writeFile(
      path.join(dataDir, 'synthetic-clinical-data.json'),
      JSON.stringify(localData, null, 2),
      'utf8'
    );
  }

  return rootDir;
}

test('server config defaults DATA_SOURCE to json when unset', async () => {
  const previous = process.env.DATA_SOURCE;
  delete process.env.DATA_SOURCE;

  try {
    const config = await loadServerConfig();
    assert.equal(config.dataSource, 'json');
    assert.match(config.configPath, /config[\\/]+app\.config\.json$/);
  } finally {
    if (previous === undefined) {
      delete process.env.DATA_SOURCE;
    } else {
      process.env.DATA_SOURCE = previous;
    }
  }
});

test('server config loads server, auth, smtp, and data-source settings from one file', async () => {
  const config = await loadServerConfig();

  assert.equal(config.server.host, '127.0.0.1');
  assert.equal(config.server.port, 4173);
  assert.equal(config.server.cookieSecure, false);
  assert.equal(config.auth.session.cookieName, 'cohort_lens_session');
  assert.equal(config.auth.session.maxAgeSeconds, 28800);
  assert.equal(config.auth.oauthState.cookieName, 'cohort_lens_oauth_state');
  assert.equal(config.auth.otp.ttlMinutes, 10);
  assert.equal(config.auth.otp.maxAttempts, 5);
  assert.equal(typeof config.auth.google.redirectUri, 'string');
  assert.equal(config.smtp.host, 'mumail.mahidol.ac.th');
  assert.equal(config.smtp.port, 25);
  assert.equal(config.dataSource, 'json');
  assert.equal(config.sqlServer.port, 1433);
});

test('server config rejects invalid DATA_SOURCE values with a clear error', async () => {
  const previous = process.env.DATA_SOURCE;
  process.env.DATA_SOURCE = 'postgres';

  try {
    await assert.rejects(loadServerConfig(), (error) => {
      assert.match(error.message, /DATA_SOURCE/i);
      assert.match(error.message, /postgres/i);
      assert.match(error.message, /json/i);
      assert.match(error.message, /sqlserver/i);
      return true;
    });
  } finally {
    if (previous === undefined) {
      delete process.env.DATA_SOURCE;
    } else {
      process.env.DATA_SOURCE = previous;
    }
  }
});

test('server config lets env override file values for DATA_SOURCE and PORT', async () => {
  const previousDataSource = process.env.DATA_SOURCE;
  const previousPort = process.env.PORT;
  process.env.DATA_SOURCE = 'sqlserver';
  process.env.PORT = '5099';

  try {
    const config = await loadServerConfig();
    assert.equal(config.dataSource, 'sqlserver');
    assert.equal(config.server.port, 5099);
  } finally {
    if (previousDataSource === undefined) {
      delete process.env.DATA_SOURCE;
    } else {
      process.env.DATA_SOURCE = previousDataSource;
    }
    if (previousPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previousPort;
    }
  }
});

test('json repository loads the local synthetic dataset before the example fallback', async () => {
  const localData = {
    source: 'local',
    patient_master: [{ hn: 'LOCAL-1' }]
  };
  const exampleData = {
    source: 'example',
    patient_master: [{ hn: 'EXAMPLE-1' }]
  };

  const localRoot = await makeDatasetRoot({ localData, exampleData, includeLocal: true });
  const localRepository = await createJsonRepository(localRoot);
  const localLoad = getExport(localRepository, [
    'loadSyntheticClinicalData',
    'loadSyntheticDataset',
    'loadData'
  ]);
  const localLoaded = await localLoad();
  assert.deepEqual(localLoaded, localData);

  const fallbackRoot = await makeDatasetRoot({ localData, exampleData, includeLocal: false });
  const fallbackRepository = await createJsonRepository(fallbackRoot);
  const fallbackLoad = getExport(fallbackRepository, [
    'loadSyntheticClinicalData',
    'loadSyntheticDataset',
    'loadData'
  ]);
  const fallbackLoaded = await fallbackLoad();
  assert.deepEqual(fallbackLoaded, exampleData);
});

test('feasibility service calls repository config and run APIs and returns normalized metadata', async () => {
  const calls = [];
  const repository = {
    config() {
      calls.push('config');
      return { dataSource: 'sqlserver', name: 'sqlserver' };
    },
    async run(input) {
      calls.push(['run', input]);
      return {
        finalCount: 12,
        rows: [{ hn: 'P1' }]
      };
    }
  };

  const service = await createFeasibilityService(repository);
  const runService = getExport(service, ['run', 'execute', 'runFeasibility']);
  const result = await runService({ question: 'Can this cohort be recruited?' });

  assert.ok(calls.includes('config'));
  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === 'run'));
  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[1]?.question === 'Can this cohort be recruited?'));

  const normalizedData = result.data ?? result.result ?? result.output;
  assert.deepEqual(normalizedData, {
    finalCount: 12,
    rows: [{ hn: 'P1' }]
  });

  const normalizedMetadata = result.metadata ?? result.meta ?? {};
  assert.equal(normalizedMetadata.dataSource ?? normalizedMetadata.activeDataSource, 'sqlserver');
});

test('sql server repository is constructible from config without a live database', async () => {
  const repository = await createSqlServerRepository({
    dataSource: 'sqlserver',
    connection: {
      server: 'example-host',
      database: 'feasibility',
      user: 'sa',
      password: 'not-used-in-unit-tests'
    }
  });

  assert.equal(typeof repository.config, 'function');
  assert.equal(typeof repository.run, 'function');
});

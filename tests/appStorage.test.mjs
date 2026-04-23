import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
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
      if (typeof candidate[name] === 'function') return candidate[name];
    }
  }
  throw new Error(`Missing expected export. Tried: ${names.join(', ')}`);
}

test('app storage factory supports local and sqlserver modes', async () => {
  const module = await importModule('../src/server/createAppStorageService.js');
  const createAppStorageService = getExport(module, ['createAppStorageService']);

  const local = createAppStorageService({ config: { appStorage: 'local' }, root: process.cwd() });
  const sqlserver = createAppStorageService({ config: { appStorage: 'sqlserver', sqlServer: {} }, root: process.cwd() });

  assert.equal(local.config().appStorage, 'local');
  assert.equal(sqlserver.config().appStorage, 'sqlserver');
});

test('local app storage can save and list cohorts and run logs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webapp-local-storage-'));
  const module = await importModule('../src/server/localAppStorage.js');
  const LocalAppStorage = getExport(module, ['LocalAppStorage']);
  const storage = new LocalAppStorage({ root });

  await storage.createSavedCohort({
    userId: 'user-1',
    name: 'Test Cohort',
    config: { question: 'q1' }
  });
  await storage.createRunLog({
    id: 'run-1',
    sessionId: 'session-1',
    user: { id: 'user-1', email: 'researcher@example.com' },
    question: 'q1',
    indexEligibleCount: 10,
    finalCount: 5,
    excludedCount: 5,
    attrition: [],
    selectedConcepts: {},
    config: { question: 'q1' },
    sql: 'SELECT 1',
    dataSource: 'json'
  });

  const cohorts = await storage.listSavedCohorts('user-1');
  const runs = await storage.listRunLogs('user-1');

  assert.equal(cohorts.length, 1);
  assert.equal(cohorts[0].name, 'Test Cohort');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].finalCount, 5);
});

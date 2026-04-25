import assert from 'node:assert/strict';
import test from 'node:test';
import { dictionaryStats, filterDictionaryEntries } from '../src/masterDictionary.js';

const conceptCatalog = {
  diagnosis: [
    { code: 'E11.9', name: 'Type 2 diabetes mellitus without complications', groupName: '', count: 12 },
    { code: 'I63.9', name: 'Cerebral infarction unspecified', groupName: '', count: 5 }
  ],
  lab: [
    { code: 'HBA1C', name: 'HbA1c', groupName: 'Chemistry', count: 18 }
  ],
  drug: [
    { code: 'MET500', name: 'Metformin 500 mg tablet', groupName: 'Biguanides', count: 22 }
  ]
};

test('filterDictionaryEntries searches across all domains by default', () => {
  const results = filterDictionaryEntries(conceptCatalog, { query: 'metformin' });

  assert.equal(results.length, 1);
  assert.equal(results[0].domain, 'drug');
  assert.equal(results[0].code, 'MET500');
});

test('filterDictionaryEntries can scope to a single domain', () => {
  const results = filterDictionaryEntries(conceptCatalog, { domain: 'diagnosis', query: 'diabetes' });

  assert.equal(results.length, 1);
  assert.equal(results[0].domain, 'diagnosis');
  assert.equal(results[0].code, 'E11.9');
});

test('dictionaryStats returns per-domain and total counts', () => {
  assert.deepEqual(dictionaryStats(conceptCatalog), {
    diagnosis: 2,
    lab: 1,
    drug: 1,
    all: 4
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REMOTE_DICTIONARY_SOURCES,
  fetchRemoteDictionary,
  googleSheetCsvUrl,
  normalizeSourceRows,
  parseCsv
} from '../src/remoteDictionary.js';

test('parseCsv supports quoted commas and returns row objects', () => {
  const rows = parseCsv('icd_code,disease_name\nA000,"Cholera due to Vibrio cholerae 01, biovar cholerae"\n');

  assert.deepEqual(rows, [
    {
      icd_code: 'A000',
      disease_name: 'Cholera due to Vibrio cholerae 01, biovar cholerae'
    }
  ]);
});

test('normalizeSourceRows maps lab and drug sources into dictionary entries', () => {
  const [icd10, icd9, lab, drug] = REMOTE_DICTIONARY_SOURCES;

  assert.deepEqual(normalizeSourceRows(icd10, [{ icd_code: 'A00', disease_name: 'Cholera' }])[0], {
    code: 'A00',
    name: 'Cholera',
    groupName: 'ICD-10',
    count: null
  });
  assert.deepEqual(normalizeSourceRows(icd9, [{ icdcm_code: '0001', icdcm_desc: 'Therapeutic ultrasound' }])[0], {
    code: '0001',
    name: 'Therapeutic ultrasound',
    groupName: 'ICD-9',
    count: null
  });
  assert.deepEqual(normalizeSourceRows(lab, [{ group_name: '(1020) HEMATOLOGY', lab_code: '(1061) Platelet count' }])[0], {
    code: '1061',
    name: 'Platelet count',
    groupName: '(1020) HEMATOLOGY',
    count: null
  });
  assert.deepEqual(normalizeSourceRows(drug, [{
    nlem_cls1: '1 Gastro',
    nlem_cls2: '1.1 Antacids',
    generic_id: '81',
    generic_name: 'Alginic acid and Antacids',
    number_of_drugs: '4'
  }])[0], {
    code: '81',
    name: 'Alginic acid and Antacids',
    groupName: '1 Gastro / 1.1 Antacids',
    count: 4
  });
});

test('googleSheetCsvUrl builds the export URL for a source', () => {
  assert.equal(
    googleSheetCsvUrl(REMOTE_DICTIONARY_SOURCES[0]),
    'https://docs.google.com/spreadsheets/d/1LUkz2iFHE34DK2MLXuZl5EXvWgn3Xikl/export?format=csv&gid=582609863'
  );
});

test('fetchRemoteDictionary merges source rows into domain concept catalogs', async () => {
  const responses = new Map([
    [googleSheetCsvUrl(REMOTE_DICTIONARY_SOURCES[0]), 'icd_code,disease_name\nA00,Cholera\n'],
    [googleSheetCsvUrl(REMOTE_DICTIONARY_SOURCES[1]), 'icdcm_code,icdcm_desc\n0001,Therapeutic ultrasound\n'],
    [googleSheetCsvUrl(REMOTE_DICTIONARY_SOURCES[2]), 'GROUP_NAME,LAB_CODE\n(1020) HEMATOLOGY,(1061) Platelet count\n'],
    [googleSheetCsvUrl(REMOTE_DICTIONARY_SOURCES[3]), 'nlem_cls1,nlem_cls2,GENERIC_ID,GENERIC_NAME,Number of Drugs\n1 Gastro,1.1 Antacids,81,Alginic acid and Antacids,4\n']
  ]);

  const result = await fetchRemoteDictionary({
    fetchImpl: async (url) => ({
      ok: true,
      async text() {
        return responses.get(url) || '';
      }
    })
  });

  assert.equal(result.conceptCatalog.diagnosis.length, 2);
  assert.equal(result.conceptCatalog.lab[0].code, '1061');
  assert.equal(result.conceptCatalog.drug[0].code, '81');
  assert.equal(result.sources.length, 4);
});

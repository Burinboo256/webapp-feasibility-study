import assert from 'node:assert/strict';
import test from 'node:test';
import { diabetesPresetConfig } from '../src/cohortEngine.js';
import { buildSql } from '../src/sqlBuilder.js';

test('buildSql creates CTE-based MSSQL for selected cohort criteria', () => {
  const { sql, summary } = buildSql(diabetesPresetConfig());

  assert.match(sql, /^WITH /);
  assert.match(sql, /FROM Patient_Info p/);
  assert.match(sql, /FROM Diagnosis d/);
  assert.match(sql, /FROM Laboratory l/);
  assert.match(sql, /FROM Medication m/);
  assert.match(sql, /d\.ICD_CODE IN \('E11\.9', 'E11\.65', 'E11\.22'\)/);
  assert.match(sql, /d\.VISIT_DATE BETWEEN '2023-01-01' AND '2025-12-31'/);
  assert.match(sql, /DATEDIFF\(YEAR, p\.BIRTH_DATE, GETDATE\(\)\) >= 18/);
  assert.match(sql, /EXISTS \(/);
  assert.match(sql, /NOT EXISTS \(/);
  assert.match(sql, /DATEADD\(DAY, 180, p\.T0_DATE\)/);
  assert.equal(summary, 'Criteria: 4 diagnosis · 1 lab · 1 drug · Age >= 18');
});

test('buildSql includes lab value filters and OR joiners', () => {
  const { sql } = buildSql({
    indexEvents: [
      {
        domain: 'diagnosis',
        joiner: 'AND',
        concepts: [{ code: 'I10', name: 'Hypertension' }]
      },
      {
        domain: 'diagnosis',
        joiner: 'OR',
        concepts: [{ code: 'E78.5', name: 'Hyperlipidemia' }]
      }
    ],
    indexWindow: { from: '2023-01-01', to: '2025-12-31' },
    demographics: { minAge: 18, maxAge: '', sex: 'Any' },
    inclusionCriteria: [
      {
        domain: 'lab',
        joiner: 'AND',
        concepts: [{ code: 'HBA1C', name: 'HbA1c' }],
        operator: '>=',
        value: 7,
        timing: 'after',
        daysAfter: 90
      }
    ],
    exclusionCriteria: []
  });

  assert.match(sql, /OR EXISTS \(SELECT 1 FROM DiagIndex2/);
  assert.match(sql, /l\.LAB_VALUE >= 7/);
  assert.match(sql, /DATEADD\(DAY, 90, p\.T0_DATE\)/);
});

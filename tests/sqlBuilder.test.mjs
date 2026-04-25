import assert from 'node:assert/strict';
import test from 'node:test';
import { createCondition, createConditionGroup } from '../src/advancedConditions.js';
import { diabetesPresetConfig } from '../src/cohortEngine.js';
import { buildFeasibilityCountSql, buildSql } from '../src/sqlBuilder.js';

test('buildSql creates CTE-based MSSQL from advanced rule filters', () => {
  const { sql, summary } = buildSql(diabetesPresetConfig());

  assert.match(sql, /^WITH /);
  assert.match(sql, /AllEvents AS \(/);
  assert.match(sql, /FROM Diagnosis d/);
  assert.match(sql, /FROM Laboratory l/);
  assert.match(sql, /FROM Medication m/);
  assert.match(sql, /COALESCE\(CAST\(e\.DOMAIN AS NVARCHAR\(100\)\), ''\) = 'diagnosis'/);
  assert.match(sql, /COALESCE\(CAST\(e\.CODE AS NVARCHAR\(MAX\)\), ''\) = 'E11\.9'/);
  assert.match(sql, /e\.EVENT_DATE BETWEEN '2023-01-01' AND '2025-12-31'/);
  assert.match(sql, /DATEDIFF\(YEAR, p\.BIRTH_DATE, GETDATE\(\)\) >= 18/);
  assert.match(sql, /DATEDIFF\(DAY, p\.T0_DATE, e\.EVENT_DATE\) >= 0/);
  assert.match(sql, /DATEDIFF\(DAY, p\.T0_DATE, e\.EVENT_DATE\) <= 180/);
  assert.equal(summary, 'Criteria: 1 T0 rule · 2 inclusion rules · 1 exclusion rule · E11.9, E11.65, E11.22, HBA1C · Age >= 18');
});

test('buildSql supports nested groups and numeric comparisons', () => {
  const { sql } = buildSql({
    indexEvents: [
      {
        joiner: 'AND',
        filter: createConditionGroup({
          logic: 'AND',
          children: [
            createCondition({ field: 'domain', operator: 'is', value: 'lab' }),
            createConditionGroup({
              logic: 'OR',
              children: [
                createCondition({ field: 'code', operator: 'is', value: 'HBA1C' }),
                createCondition({ field: 'name', operator: 'contains', value: 'glucose' })
              ]
            }),
            createCondition({ field: 'numericValue', operator: 'greater_than_or_equal', value: '7' })
          ]
        })
      }
    ],
    indexWindow: { from: '2023-01-01', to: '2025-12-31' },
    demographics: { minAge: '', maxAge: '', sex: 'Any' },
    inclusionCriteria: [],
    exclusionCriteria: []
  });

  assert.match(sql, /\(COALESCE\(CAST\(e\.CODE AS NVARCHAR\(MAX\)\), ''\) = 'HBA1C' OR COALESCE\(CAST\(e\.NAME AS NVARCHAR\(MAX\)\), ''\) LIKE '%glucose%'\)/);
  assert.match(sql, /e\.NUMERIC_VALUE >= 7/);
});

test('buildFeasibilityCountSql returns staged count aliases for SQL-backed feasibility runs', () => {
  const sql = buildFeasibilityCountSql(diabetesPresetConfig());

  assert.match(sql, /^WITH /);
  assert.match(sql, /AS totalPatients/);
  assert.match(sql, /AS indexEligibleCount/);
  assert.match(sql, /AS demographicCount/);
  assert.match(sql, /AS inclusionCount/);
  assert.match(sql, /AS finalCount/);
  assert.match(sql, /FROM AllEvents e/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FILTER_FIELDSETS,
  conditionValuesFromTree,
  createCondition,
  createConditionGroup,
  evaluateConditionGroup,
  normalizeRule,
  validateConditionGroup
} from '../src/advancedConditions.js';

test('validates operators against field types and whitelist', () => {
  const errors = validateConditionGroup(
    createConditionGroup({
      logic: 'AND',
      children: [
        createCondition({ field: 'code', operator: 'contains', value: 'E11' }),
        createCondition({ field: 'daysFromT0', operator: 'contains', value: '10' })
      ]
    }),
    { allowedFields: FILTER_FIELDSETS.index }
  );

  assert.match(errors[0], /field "daysFromT0" is not allowed/);
});

test('evaluates nested groups for text, number, date, and select fields', () => {
  const group = createConditionGroup({
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
      createCondition({ field: 'numericValue', operator: 'between', value: { from: '7', to: '9' } }),
      createCondition({ field: 'eventDate', operator: 'on_or_after', value: '2024-01-01' })
    ]
  });

  assert.equal(evaluateConditionGroup(group, {
    domain: 'lab',
    code: 'HBA1C',
    name: 'HbA1c',
    numericValue: 8.2,
    eventDate: '2024-01-05'
  }, { allowedFields: FILTER_FIELDSETS.criteria }), true);
});

test('normalizeRule migrates legacy timing and query fields', () => {
  const normalized = normalizeRule({
    domain: 'diagnosis',
    query: 'E11',
    timing: 'within',
    daysBefore: 90,
    daysAfter: 30
  }, {
    allowedFields: FILTER_FIELDSETS.criteria,
    legacyMode: 'criteria'
  });

  const errors = validateConditionGroup(normalized.filter, { allowedFields: FILTER_FIELDSETS.criteria });
  assert.deepEqual(errors, []);
  assert.equal(evaluateConditionGroup(normalized.filter, {
    domain: 'diagnosis',
    code: 'E11.9',
    name: 'Type 2 diabetes mellitus without complications',
    groupName: '',
    daysFromT0: 10
  }, { allowedFields: FILTER_FIELDSETS.criteria }), true);
});

test('conditionValuesFromTree includes value-bearing text operators for code and name', () => {
  const values = conditionValuesFromTree(createConditionGroup({
    logic: 'AND',
    children: [
      createCondition({ field: 'code', operator: 'starts_with', value: 'E11' }),
      createCondition({ field: 'name', operator: 'contains', value: 'diabetes' }),
      createCondition({ field: 'code', operator: 'is_empty', value: null })
    ]
  }));

  assert.deepEqual(values, [
    { field: 'code', operator: 'starts_with', value: 'E11' },
    { field: 'name', operator: 'contains', value: 'diabetes' }
  ]);
});

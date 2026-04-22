import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultConfig, diabetesPresetConfig, evaluateCohort } from '../src/cohortEngine.js';

const data = {
  patient_master: [
    { hn: 'P1', sex_name: 'Female' },
    { hn: 'P2', sex_name: 'Male' },
    { hn: 'P3', sex_name: 'Female' },
    { hn: 'P4', sex_name: 'Female' },
    { hn: 'P5', sex_name: 'Male' },
    { hn: 'P6', sex_name: 'Female' },
    { hn: 'P7', sex_name: 'Male' }
  ],
  diagnosis_record: [
    { hn: 'P1', service_date: '2024-01-01', icd_code: 'E11.9', disease_name: 'Type 2 diabetes mellitus without complications', age_at_visit: 58 },
    { hn: 'P2', service_date: '2024-01-01', icd_code: 'E11.9', disease_name: 'Type 2 diabetes mellitus without complications', age_at_visit: 64 },
    { hn: 'P3', service_date: '2024-01-01', icd_code: 'N18.3', disease_name: 'Chronic kidney disease stage 3', age_at_visit: 62 },
    { hn: 'P3', service_date: '2024-02-01', icd_code: 'E11.65', disease_name: 'Type 2 diabetes mellitus with hyperglycemia', age_at_visit: 62 },
    { hn: 'P4', service_date: '2024-03-01', icd_code: 'J45.9', disease_name: 'Asthma unspecified', age_at_visit: 36 },
    { hn: 'P5', service_date: '2024-04-01', icd_code: 'I63.9', disease_name: 'Cerebral infarction unspecified', age_at_visit: 72 },
    { hn: 'P6', service_date: '2024-05-01', icd_code: 'C50.9', disease_name: 'Malignant neoplasm of breast', age_at_visit: 61 },
    { hn: 'P7', service_date: '2024-06-01', icd_code: 'E11.22', disease_name: 'Type 2 diabetes mellitus with diabetic chronic kidney disease', age_at_visit: 51 }
  ],
  prescription_order: [
    { hn: 'P1', order_date: '2024-01-10', drug_code: 'MET500', drug_name: 'Metformin 500 mg tablet', drug_group_name: 'Biguanides' },
    { hn: 'P3', order_date: '2024-02-10', drug_code: 'MET500', drug_name: 'Metformin 500 mg tablet', drug_group_name: 'Biguanides' },
    { hn: 'P5', order_date: '2024-04-05', drug_code: 'ASP81', drug_name: 'Aspirin 81 mg tablet', drug_group_name: 'Antiplatelets' },
    { hn: 'P7', order_date: '2024-06-05', drug_code: 'MET500', drug_name: 'Metformin 500 mg tablet', drug_group_name: 'Biguanides' }
  ],
  lab_result: [
    { hn: 'P1', test_date: '2024-01-05', test_code: 'HBA1C', test_name: 'HbA1c', result_value: '8.2', age_at_test: 58 },
    { hn: 'P2', test_date: '2024-01-05', test_code: 'HBA1C', test_name: 'HbA1c', result_value: '6.5', age_at_test: 64 },
    { hn: 'P3', test_date: '2024-02-05', test_code: 'HBA1C', test_name: 'HbA1c', result_value: '7.2', age_at_test: 62 },
    { hn: 'P7', test_date: '2024-06-05', test_code: 'HBA1C', test_name: 'HbA1c', result_value: '9.0', age_at_test: 51 }
  ]
};

test('default config starts blank without selected concepts', () => {
  const result = evaluateCohort(defaultConfig(), data);

  assert.equal(result.totalPatients, 7);
  assert.equal(result.indexEligibleCount, 0);
  assert.equal(result.finalCount, 0);
  assert.deepEqual(defaultConfig().indexEvents[0].concepts, []);
});

test('diabetes preset feasibility cohort applies T0, lab, drug, and exclusion rules', () => {
  const result = evaluateCohort(diabetesPresetConfig(), data);

  assert.equal(result.totalPatients, 7);
  assert.equal(result.indexEligibleCount, 4);
  assert.equal(result.finalCount, 2);
  assert.deepEqual(
    result.included.map((row) => row.patient.hn).sort(),
    ['P1', 'P7']
  );
});

test('lab-first cohort supports numeric lab threshold at T0', () => {
  const result = evaluateCohort({
    ...diabetesPresetConfig(),
    indexEvents: [{ domain: 'lab', query: 'HbA1c', labOperator: '>=', labValue: 8 }],
    inclusionCriteria: [
      {
        id: 'diabetes-around-lab',
        domain: 'diagnosis',
        label: 'Diabetes diagnosis within 90 days of lab T0',
        operator: 'any',
        query: 'E11',
        timing: 'within',
        daysBefore: 90,
        daysAfter: 90,
        value: ''
      }
    ],
    exclusionCriteria: []
  }, data);

  assert.equal(result.indexEligibleCount, 2);
  assert.equal(result.finalCount, 2);
});

test('drug release timing can be evaluated after diagnosis T0', () => {
  const result = evaluateCohort({
    ...diabetesPresetConfig(),
    indexEvents: [{ domain: 'diagnosis', query: 'I63', labOperator: '>=', labValue: '' }],
    demographics: { minAge: 18, maxAge: '', sex: 'Any' },
    inclusionCriteria: [
      {
        id: 'aspirin-after-stroke',
        domain: 'drug',
        label: 'Aspirin released within 14 days after T0',
        operator: 'any',
        query: 'aspirin',
        timing: 'after',
        daysBefore: 0,
        daysAfter: 14,
        value: ''
      }
    ],
    exclusionCriteria: []
  }, data);

  assert.equal(result.finalCount, 1);
  assert.equal(result.included[0].patient.hn, 'P5');
});

test('cohort engine supports multiple exact code/name concept selections', () => {
  const result = evaluateCohort({
    ...diabetesPresetConfig(),
    indexEvents: [
      {
        domain: 'diagnosis',
        query: '',
        concepts: [
          { code: 'J45.9', name: 'Asthma unspecified' },
          { code: 'C50.9', name: 'Malignant neoplasm of breast' }
        ],
        labOperator: '>=',
        labValue: ''
      }
    ],
    demographics: { minAge: '', maxAge: '', sex: 'Any' },
    inclusionCriteria: [],
    exclusionCriteria: []
  }, data);

  assert.equal(result.indexEligibleCount, 2);
  assert.deepEqual(
    result.included.map((row) => row.patient.hn).sort(),
    ['P4', 'P6']
  );
});

test('multiple T0 index conditions are required together', () => {
  const result = evaluateCohort({
    ...diabetesPresetConfig(),
    indexEvents: [
      {
        id: 'idx-diabetes',
        domain: 'diagnosis',
        label: 'Diabetes diagnosis at T0',
        query: '',
        concepts: [
          { code: 'E11.9', name: 'Type 2 diabetes mellitus without complications' },
          { code: 'E11.65', name: 'Type 2 diabetes mellitus with hyperglycemia' },
          { code: 'E11.22', name: 'Type 2 diabetes mellitus with diabetic chronic kidney disease' }
        ],
        labOperator: '>=',
        labValue: ''
      },
      {
        id: 'idx-hba1c',
        domain: 'lab',
        label: 'HbA1c measured at index eligibility',
        query: '',
        concepts: [{ code: 'HBA1C', name: 'HbA1c' }],
        labOperator: '>=',
        labValue: 7
      }
    ],
    inclusionCriteria: [],
    exclusionCriteria: []
  }, data);

  assert.equal(result.indexEligibleCount, 3);
  assert.deepEqual(
    result.included.map((row) => row.patient.hn).sort(),
    ['P1', 'P3', 'P7']
  );
});

test('T0 condition joiners can use OR logic', () => {
  const result = evaluateCohort({
    ...diabetesPresetConfig(),
    indexEvents: [
      {
        id: 'idx-asthma',
        domain: 'diagnosis',
        label: 'Asthma diagnosis',
        query: '',
        concepts: [{ code: 'J45.9', name: 'Asthma unspecified' }],
        labOperator: '>=',
        labValue: ''
      },
      {
        id: 'idx-stroke',
        joiner: 'OR',
        domain: 'diagnosis',
        label: 'Stroke diagnosis',
        query: '',
        concepts: [{ code: 'I63.9', name: 'Cerebral infarction unspecified' }],
        labOperator: '>=',
        labValue: ''
      }
    ],
    demographics: { minAge: '', maxAge: '', sex: 'Any' },
    inclusionCriteria: [],
    exclusionCriteria: []
  }, data);

  assert.equal(result.indexEligibleCount, 2);
  assert.deepEqual(
    result.included.map((row) => row.patient.hn).sort(),
    ['P4', 'P5']
  );
});

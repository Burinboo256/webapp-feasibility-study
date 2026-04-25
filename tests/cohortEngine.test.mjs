import assert from 'node:assert/strict';
import test from 'node:test';
import { createCondition, createConditionGroup } from '../src/advancedConditions.js';
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
    { hn: 'P1', service_date: '2024-01-01', icd_code: 'E11.9', disease_name: 'Type 2 diabetes mellitus without complications', age_at_visit: 58, patient_category: 'OPD' },
    { hn: 'P2', service_date: '2024-01-01', icd_code: 'E11.9', disease_name: 'Type 2 diabetes mellitus without complications', age_at_visit: 64, patient_category: 'OPD' },
    { hn: 'P3', service_date: '2024-01-01', icd_code: 'N18.3', disease_name: 'Chronic kidney disease stage 3', age_at_visit: 62, patient_category: 'OPD' },
    { hn: 'P3', service_date: '2024-02-01', icd_code: 'E11.65', disease_name: 'Type 2 diabetes mellitus with hyperglycemia', age_at_visit: 62, patient_category: 'OPD' },
    { hn: 'P4', service_date: '2024-03-01', icd_code: 'J45.9', disease_name: 'Asthma unspecified', age_at_visit: 36, patient_category: 'OPD' },
    { hn: 'P5', service_date: '2024-04-01', icd_code: 'I63.9', disease_name: 'Cerebral infarction unspecified', age_at_visit: 72, patient_category: 'IPD' },
    { hn: 'P6', service_date: '2024-05-01', icd_code: 'C50.9', disease_name: 'Malignant neoplasm of breast', age_at_visit: 61, patient_category: 'OPD' },
    { hn: 'P7', service_date: '2024-06-01', icd_code: 'E11.22', disease_name: 'Type 2 diabetes mellitus with diabetic chronic kidney disease', age_at_visit: 51, patient_category: 'OPD' }
  ],
  prescription_order: [
    { hn: 'P1', order_date: '2024-01-10', drug_code: 'MET500', drug_name: 'Metformin 500 mg tablet', drug_group_name: 'Biguanides', service_type: 'OPD' },
    { hn: 'P3', order_date: '2024-02-10', drug_code: 'MET500', drug_name: 'Metformin 500 mg tablet', drug_group_name: 'Biguanides', service_type: 'OPD' },
    { hn: 'P5', order_date: '2024-04-05', drug_code: 'ASP81', drug_name: 'Aspirin 81 mg tablet', drug_group_name: 'Antiplatelets', service_type: 'IPD' },
    { hn: 'P7', order_date: '2024-06-05', drug_code: 'MET500', drug_name: 'Metformin 500 mg tablet', drug_group_name: 'Biguanides', service_type: 'OPD' }
  ],
  lab_result: [
    { hn: 'P1', test_date: '2024-01-05', test_code: 'HBA1C', test_name: 'HbA1c', result_value: '8.2', age_at_test: 58, patient_category: 'OPD' },
    { hn: 'P2', test_date: '2024-01-05', test_code: 'HBA1C', test_name: 'HbA1c', result_value: '6.5', age_at_test: 64, patient_category: 'OPD' },
    { hn: 'P3', test_date: '2024-02-05', test_code: 'HBA1C', test_name: 'HbA1c', result_value: '7.2', age_at_test: 62, patient_category: 'OPD' },
    { hn: 'P7', test_date: '2024-06-05', test_code: 'HBA1C', test_name: 'HbA1c', result_value: '9.0', age_at_test: 51, patient_category: 'OPD' }
  ]
};

test('default config starts blank without active T0 filters', () => {
  const config = defaultConfig();
  const result = evaluateCohort(config, data);

  assert.equal(result.totalPatients, 7);
  assert.equal(result.indexEligibleCount, 0);
  assert.equal(result.finalCount, 0);
  assert.deepEqual(config.indexEvents[0].filter.children, []);
});

test('diabetes preset feasibility cohort applies T0, inclusion, and exclusion rules', () => {
  const result = evaluateCohort(diabetesPresetConfig(), data);

  assert.equal(result.totalPatients, 7);
  assert.equal(result.indexEligibleCount, 4);
  assert.equal(result.finalCount, 2);
  assert.deepEqual(
    result.included.map((row) => row.patient.hn).sort(),
    ['P1', 'P7']
  );
});

test('nested OR groups can be used inside a single inclusion rule', () => {
  const result = evaluateCohort({
    ...diabetesPresetConfig(),
    inclusionCriteria: [
      {
        id: 'inc-nested',
        joiner: 'AND',
        filter: createConditionGroup({
          logic: 'AND',
          children: [
            createCondition({ field: 'domain', operator: 'is', value: 'drug' }),
            createConditionGroup({
              logic: 'OR',
              children: [
                createCondition({ field: 'code', operator: 'is', value: 'MET500' }),
                createCondition({ field: 'name', operator: 'contains', value: 'aspirin' })
              ]
            }),
            createCondition({ field: 'daysFromT0', operator: 'between', value: { from: '0', to: '90' } })
          ]
        })
      }
    ],
    exclusionCriteria: []
  }, data);

  assert.equal(result.finalCount, 3);
  assert.deepEqual(
    result.included.map((row) => row.patient.hn).sort(),
    ['P1', 'P3', 'P7']
  );
});

test('legacy flat config still migrates into advanced filters', () => {
  const result = evaluateCohort({
    question: 'legacy',
    indexEvents: [
      { domain: 'lab', query: 'HbA1c', labOperator: '>=', labValue: 8 }
    ],
    indexWindow: {},
    demographics: { minAge: '', maxAge: '', sex: 'Any' },
    inclusionCriteria: [
      {
        domain: 'diagnosis',
        query: 'E11',
        timing: 'within',
        daysBefore: 90,
        daysAfter: 90
      }
    ],
    exclusionCriteria: []
  }, data);

  assert.equal(result.indexEligibleCount, 2);
  assert.equal(result.finalCount, 2);
});

test('multiple T0 condition rules remain combinable with AND or OR', () => {
  const base = {
    ...diabetesPresetConfig(),
    demographics: { minAge: '', maxAge: '', sex: 'Any' },
    inclusionCriteria: [],
    exclusionCriteria: []
  };

  const andResult = evaluateCohort({
    ...base,
    indexEvents: [
      {
        id: 'idx-diabetes',
        joiner: 'AND',
        filter: createConditionGroup({
          logic: 'AND',
          children: [
            createCondition({ field: 'domain', operator: 'is', value: 'diagnosis' }),
            createConditionGroup({
              logic: 'OR',
              children: [
                createCondition({ field: 'code', operator: 'is', value: 'E11.9' }),
                createCondition({ field: 'code', operator: 'is', value: 'E11.65' }),
                createCondition({ field: 'code', operator: 'is', value: 'E11.22' })
              ]
            })
          ]
        })
      },
      {
        id: 'idx-hba1c',
        joiner: 'AND',
        filter: createConditionGroup({
          logic: 'AND',
          children: [
            createCondition({ field: 'domain', operator: 'is', value: 'lab' }),
            createCondition({ field: 'code', operator: 'is', value: 'HBA1C' }),
            createCondition({ field: 'numericValue', operator: 'greater_than_or_equal', value: '7' })
          ]
        })
      }
    ]
  }, data);

  assert.equal(andResult.indexEligibleCount, 3);

  const orResult = evaluateCohort({
    ...base,
    indexEvents: [
      {
        id: 'idx-asthma',
        joiner: 'AND',
        filter: filter('diagnosis', 'J45.9')
      },
      {
        id: 'idx-stroke',
        joiner: 'OR',
        filter: filter('diagnosis', 'I63.9')
      }
    ]
  }, data);

  assert.equal(orResult.indexEligibleCount, 2);
  assert.deepEqual(
    orResult.included.map((row) => row.patient.hn).sort(),
    ['P4', 'P5']
  );
});

function filter(domain, code) {
  return createConditionGroup({
    logic: 'AND',
    children: [
      createCondition({ field: 'domain', operator: 'is', value: domain }),
      createCondition({ field: 'code', operator: 'is', value: code })
    ]
  });
}

import {
  FILTER_FIELDSETS,
  createCondition,
  createConditionGroup,
  evaluateConditionGroup,
  isConditionGroupActive,
  normalizeRule
} from './advancedConditions.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function evaluateCohort(config, data) {
  const normalizedConfig = normalizeCohortConfig(config);
  const patients = data.patient_master || [];
  const indexes = buildIndexes(data);
  const rows = [];
  const attrition = [];

  for (const patient of patients) {
    const patientEvents = getPatientEvents(patient.hn, indexes);
    const indexMatch = findIndexMatch(normalizedConfig, patientEvents);
    const indexEvent = indexMatch?.indexEvent || null;

    if (!indexEvent) {
      rows.push({
        patient,
        status: 'No index event',
        indexEvent: null,
        indexMatches: [],
        reasons: ['No matching T0 event']
      });
      continue;
    }

    const context = buildContext({ patient, indexEvent, patientEvents });
    const demographicReasons = evaluateDemographics(normalizedConfig.demographics, context);
    const inclusionReasons = evaluateCriteria(normalizedConfig.inclusionCriteria, context, 'inclusion');
    const exclusionReasons = evaluateCriteria(normalizedConfig.exclusionCriteria, context, 'exclusion');
    const reasons = [...demographicReasons, ...inclusionReasons, ...exclusionReasons];
    const status = reasons.length === 0 ? 'Included' : reasons[0];

    rows.push({
      patient,
      status,
      indexEvent,
      indexMatches: indexMatch.matches,
      reasons,
      ageAtIndex: context.ageAtIndex
    });
  }

  const indexEligibleRows = rows.filter((row) => row.indexEvent);
  attrition.push({ label: 'Has index event (T0)', count: indexEligibleRows.length });

  let running = indexEligibleRows;
  const demographicExcluded = running.filter((row) => row.reasons.some((reason) => reason.startsWith('Demographic:')));
  running = running.filter((row) => !row.reasons.some((reason) => reason.startsWith('Demographic:')));
  attrition.push({ label: 'After demographic filters', count: running.length, removed: demographicExcluded.length });

  const beforeInclusion = running.length;
  running = running.filter((row) => evaluateCriterionExpression(normalizedConfig.inclusionCriteria, rowToContext(row, indexes), 'AND'));
  attrition.push({ label: 'After inclusion condition logic', count: running.length, removed: beforeInclusion - running.length });

  const beforeExclusion = running.length;
  running = running.filter((row) => !evaluateCriterionExpression(normalizedConfig.exclusionCriteria, rowToContext(row, indexes), 'OR'));
  attrition.push({ label: 'After exclusion condition logic', count: running.length, removed: beforeExclusion - running.length });

  const included = rows.filter((row) => row.status === 'Included');

  return {
    attrition,
    conceptSummary: summarizeConcepts(included, indexes),
    excludedCount: indexEligibleRows.length - included.length,
    finalCount: included.length,
    included,
    indexEligibleCount: indexEligibleRows.length,
    rows,
    totalPatients: patients.length
  };
}

export function defaultConfig() {
  return {
    question: '',
    indexEvents: [
      {
        id: 'idx-blank',
        label: '',
        joiner: 'AND',
        filter: createConditionGroup()
      }
    ],
    indexWindow: {
      from: '',
      to: ''
    },
    demographics: {
      minAge: '',
      maxAge: '',
      sex: 'Any'
    },
    inclusionCriteria: [],
    exclusionCriteria: []
  };
}

export function diabetesPresetConfig() {
  return {
    question: 'Adult patients with diabetes and HbA1c monitoring who received metformin after T0.',
    indexEvents: [
      {
        id: 'idx-diabetes',
        label: 'Diabetes diagnosis at T0',
        joiner: 'AND',
        filter: ruleFilter([
          equals('domain', 'diagnosis'),
          anyOf('code', ['E11.9', 'E11.65', 'E11.22'])
        ])
      }
    ],
    indexWindow: {
      from: '2023-01-01',
      to: '2025-12-31'
    },
    demographics: {
      minAge: 18,
      maxAge: '',
      sex: 'Any'
    },
    inclusionCriteria: [
      {
        id: 'inc-lab-a1c',
        label: 'HbA1c result within 180 days after T0',
        joiner: 'AND',
        filter: ruleFilter([
          equals('domain', 'lab'),
          equals('code', 'HBA1C'),
          range('daysFromT0', '0', '180')
        ])
      },
      {
        id: 'inc-drug-metformin',
        label: 'Metformin released within 90 days after T0',
        joiner: 'AND',
        filter: ruleFilter([
          equals('domain', 'drug'),
          equals('code', 'MET500'),
          range('daysFromT0', '0', '90')
        ])
      }
    ],
    exclusionCriteria: [
      {
        id: 'exc-ckd',
        label: 'Exclude chronic kidney disease before T0',
        joiner: 'OR',
        filter: ruleFilter([
          equals('domain', 'diagnosis'),
          equals('code', 'N18.3'),
          range('daysFromT0', '-365', '0')
        ])
      }
    ]
  };
}

export function normalizeCohortConfig(config = {}) {
  return {
    question: config.question || '',
    indexEvents: normalizeRules(config.indexEvents || (config.indexEvent ? [config.indexEvent] : []), FILTER_FIELDSETS.index, 'index', 'AND'),
    indexWindow: config.indexWindow || {},
    demographics: config.demographics || {},
    inclusionCriteria: normalizeRules(config.inclusionCriteria || [], FILTER_FIELDSETS.criteria, 'criteria', 'AND'),
    exclusionCriteria: normalizeRules(config.exclusionCriteria || [], FILTER_FIELDSETS.criteria, 'criteria', 'OR')
  };
}

export function buildIndexes(data) {
  const diagnosis = groupByHn((data.diagnosis_record || []).map((row) => ({
    ...row,
    domain: 'diagnosis',
    eventDate: row.service_date,
    code: row.icd_code,
    name: row.disease_name,
    patientCategory: row.patient_category,
    age: Number(row.age_at_visit)
  })));
  const drug = groupByHn((data.prescription_order || []).map((row) => ({
    ...row,
    domain: 'drug',
    eventDate: row.order_date,
    code: row.drug_code,
    name: row.drug_name,
    groupName: row.drug_group_name,
    patientCategory: row.service_type,
    numericValue: parseNumeric(row.quantity)
  })));
  const lab = groupByHn((data.lab_result || []).map((row) => ({
    ...row,
    domain: 'lab',
    eventDate: row.test_date,
    code: row.test_code,
    name: row.test_name,
    groupName: row.test_group_name,
    numericValue: parseNumeric(row.result_value),
    rawValue: row.result_value,
    patientCategory: row.patient_category,
    unit: row.result_unit,
    age: Number(row.age_at_test)
  })));

  return { diagnosis, drug, lab };
}

export function criterionMatches(criterion, context) {
  return context.filterEvents.some((event) => evaluateConditionGroup(criterion.filter, event, { allowedFields: FILTER_FIELDSETS.criteria }));
}

function normalizeRules(rules, allowedFields, legacyMode, defaultJoiner) {
  return rules
    .map((rule) => normalizeRule(rule, { allowedFields, legacyMode, defaultJoiner }))
    .filter((rule) => isConditionGroupActive(rule.filter));
}

function findIndexMatch(config, patientEvents) {
  const matches = config.indexEvents.map((indexConfig) => ({
    config: indexConfig,
    event: findIndexEvent(indexConfig, patientEvents, config.indexWindow)
  }));

  if (matches.length === 0) return null;
  if (!evaluateBooleanExpression(matches.map((match) => Boolean(match.event)), config.indexEvents, 'AND')) return null;

  return {
    indexEvent: matches.find((match) => match.event)?.event || null,
    matches
  };
}

function rowToContext(row, indexes) {
  const patientEvents = getPatientEvents(row.patient.hn, indexes);
  return buildContext({
    patient: row.patient,
    indexEvent: row.indexEvent,
    patientEvents,
    ageAtIndex: row.ageAtIndex
  });
}

function buildContext({ patient, indexEvent, patientEvents, ageAtIndex }) {
  return {
    patient,
    indexEvent,
    patientEvents,
    filterEvents: normalizePatientEvents(patientEvents, indexEvent?.eventDate || null),
    ageAtIndex: ageAtIndex ?? deriveAgeAtIndex(indexEvent, patientEvents)
  };
}

function deriveAgeAtIndex(indexEvent, patientEvents) {
  if (!indexEvent) return null;
  if (Number.isFinite(indexEvent.age)) return indexEvent.age;
  const datedEvents = [...patientEvents.diagnosis, ...patientEvents.lab]
    .filter((event) => Number.isFinite(event.age))
    .sort((a, b) => Math.abs(daysBetween(a.eventDate, indexEvent.eventDate)) - Math.abs(daysBetween(b.eventDate, indexEvent.eventDate)));
  return datedEvents[0]?.age ?? null;
}

function evaluateCriteria(criteria, context, mode) {
  const reasons = [];
  const matched = evaluateCriterionExpression(criteria, context, mode === 'exclusion' ? 'OR' : 'AND');
  if (mode === 'inclusion' && !matched) {
    reasons.push('Inclusion: condition logic not satisfied');
  }
  if (mode === 'exclusion' && matched) {
    reasons.push('Exclusion: condition logic matched');
  }
  return reasons;
}

function evaluateCriterionExpression(criteria, context, defaultJoiner) {
  if (!criteria.length) return defaultJoiner === 'AND';
  return evaluateBooleanExpression(
    criteria.map((criterion) => criterionMatches(criterion, context)),
    criteria,
    defaultJoiner
  );
}

function evaluateBooleanExpression(values, configs, defaultJoiner) {
  if (!values.length) return defaultJoiner === 'AND';
  return values.slice(1).reduce((result, value, index) => {
    const joiner = (configs[index + 1]?.joiner || defaultJoiner).toUpperCase();
    return joiner === 'OR' ? result || value : result && value;
  }, values[0]);
}

function evaluateDemographics(demographics = {}, context) {
  const reasons = [];
  const age = context.ageAtIndex;
  const minAge = numberOrNull(demographics.minAge);
  const maxAge = numberOrNull(demographics.maxAge);

  if (minAge !== null && (age === null || age < minAge)) reasons.push('Demographic: age below minimum or unknown');
  if (maxAge !== null && (age === null || age > maxAge)) reasons.push('Demographic: age above maximum or unknown');
  if (demographics.sex && demographics.sex !== 'Any' && context.patient.sex_name !== demographics.sex) {
    reasons.push('Demographic: sex does not match');
  }

  return reasons;
}

function findIndexEvent(indexConfig, patientEvents, indexWindow = {}) {
  return normalizePatientEvents(patientEvents, null)
    .filter((event) => evaluateConditionGroup(indexConfig.filter, event, { allowedFields: FILTER_FIELDSETS.index }))
    .filter((event) => isInsideAbsoluteWindow(event.eventDate, indexWindow))
    .sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate))[0] || null;
}

function normalizePatientEvents(patientEvents, indexDate) {
  return [
    ...normalizeDomainEvents(patientEvents.diagnosis || [], indexDate),
    ...normalizeDomainEvents(patientEvents.lab || [], indexDate),
    ...normalizeDomainEvents(patientEvents.drug || [], indexDate)
  ];
}

function normalizeDomainEvents(events, indexDate) {
  return events.map((event) => ({
    ...event,
    domain: event.domain,
    code: event.code || '',
    name: event.name || '',
    groupName: event.groupName || '',
    eventDate: event.eventDate,
    numericValue: Number.isFinite(event.numericValue) ? event.numericValue : null,
    rawValue: event.rawValue || '',
    patientCategory: event.patientCategory || '',
    ageAtEvent: Number.isFinite(event.age) ? event.age : null,
    daysFromT0: indexDate ? daysBetween(event.eventDate, indexDate) : null
  }));
}

function getPatientEvents(hn, indexes) {
  return {
    diagnosis: indexes.diagnosis.get(hn) || [],
    drug: indexes.drug.get(hn) || [],
    lab: indexes.lab.get(hn) || []
  };
}

function groupByHn(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.hn)) map.set(row.hn, []);
    map.get(row.hn).push(row);
  }
  for (const events of map.values()) {
    events.sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate));
  }
  return map;
}

function isInsideAbsoluteWindow(eventDate, window) {
  if (window.from && new Date(eventDate) < new Date(window.from)) return false;
  if (window.to && new Date(eventDate) > new Date(window.to)) return false;
  return true;
}

function summarizeConcepts(included, indexes) {
  const counters = {
    diagnosis: new Map(),
    drug: new Map(),
    lab: new Map()
  };

  for (const row of included) {
    const events = getPatientEvents(row.patient.hn, indexes);
    for (const domain of Object.keys(counters)) {
      const seen = new Set();
      for (const event of events[domain]) {
        const key = `${event.code || ''} ${event.name || ''}`.trim();
        if (!key || seen.has(key)) continue;
        counters[domain].set(key, (counters[domain].get(key) || 0) + 1);
        seen.add(key);
      }
    }
  }

  return Object.fromEntries(
    Object.entries(counters).map(([domain, map]) => [
      domain,
      [...map.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        .slice(0, 8)
    ])
  );
}

function daysBetween(eventDate, indexDate) {
  return Math.round((new Date(eventDate) - new Date(indexDate)) / DAY_MS);
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseNumeric(value) {
  const number = Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? number : null;
}

function ruleFilter(children) {
  return createConditionGroup({ logic: 'AND', children });
}

function equals(field, value) {
  return createCondition({ field, operator: 'is', value });
}

function anyOf(field, values) {
  return createConditionGroup({
    logic: 'OR',
    children: values.map((value) => createCondition({ field, operator: 'is', value }))
  });
}

function range(field, from, to) {
  return createCondition({ field, operator: 'between', value: { from, to } });
}

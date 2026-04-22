const DAY_MS = 24 * 60 * 60 * 1000;

export function evaluateCohort(config, data) {
  const patients = data.patient_master || [];
  const indexes = buildIndexes(data);
  const rows = [];
  const attrition = [];

  for (const patient of patients) {
    const patientEvents = getPatientEvents(patient.hn, indexes);
    const indexMatch = findIndexMatch(config, patientEvents);
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

    const context = {
      patient,
      indexEvent,
      patientEvents,
      ageAtIndex: deriveAgeAtIndex(indexEvent, patientEvents)
    };
    const demographicReasons = evaluateDemographics(config.demographics, context);
    const inclusionReasons = evaluateCriteria(config.inclusionCriteria || [], context, 'inclusion');
    const exclusionReasons = evaluateCriteria(config.exclusionCriteria || [], context, 'exclusion');
    const reasons = [...demographicReasons, ...inclusionReasons, ...exclusionReasons];
    const status = reasons.length === 0 ? 'Included' : reasons[0];

    rows.push({ patient, status, indexEvent, indexMatches: indexMatch.matches, reasons, ageAtIndex: context.ageAtIndex });
  }

  const indexEligibleRows = rows.filter((row) => row.indexEvent);
  attrition.push({ label: 'Has index event (T0)', count: indexEligibleRows.length });

  let running = indexEligibleRows;
  const demographicExcluded = running.filter((row) => row.reasons.some((reason) => reason.startsWith('Demographic:')));
  running = running.filter((row) => !row.reasons.some((reason) => reason.startsWith('Demographic:')));
  attrition.push({ label: 'After demographic filters', count: running.length, removed: demographicExcluded.length });

  const beforeInclusion = running.length;
  running = running.filter((row) => evaluateCriterionExpression(config.inclusionCriteria || [], rowToContext(row, indexes), 'AND'));
  attrition.push({ label: 'After inclusion condition logic', count: running.length, removed: beforeInclusion - running.length });

  const beforeExclusion = running.length;
  running = running.filter((row) => !evaluateCriterionExpression(config.exclusionCriteria || [], rowToContext(row, indexes), 'OR'));
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
        domain: 'diagnosis',
        query: '',
        concepts: [],
        labOperator: '>=',
        labValue: ''
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
        domain: 'diagnosis',
        query: 'E11',
        concepts: [
          { code: 'E11.9', name: 'Type 2 diabetes mellitus without complications' },
          { code: 'E11.65', name: 'Type 2 diabetes mellitus with hyperglycemia' },
          { code: 'E11.22', name: 'Type 2 diabetes mellitus with diabetic chronic kidney disease' }
        ],
        labOperator: '>=',
        labValue: ''
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
        domain: 'lab',
        label: 'HbA1c result within 180 days after T0',
        operator: 'any',
        query: 'HbA1c',
        concepts: [
          { code: 'HBA1C', name: 'HbA1c' }
        ],
        timing: 'after',
        daysBefore: 0,
        daysAfter: 180,
        value: ''
      },
      {
        id: 'inc-drug-metformin',
        domain: 'drug',
        label: 'Metformin released within 90 days after T0',
        operator: 'any',
        query: 'metformin',
        concepts: [
          { code: 'MET500', name: 'Metformin 500 mg tablet' }
        ],
        timing: 'after',
        daysBefore: 0,
        daysAfter: 90,
        value: ''
      }
    ],
    exclusionCriteria: [
      {
        id: 'exc-ckd',
        domain: 'diagnosis',
        label: 'Exclude chronic kidney disease before T0',
        operator: 'any',
        query: 'N18',
        concepts: [
          { code: 'N18.3', name: 'Chronic kidney disease stage 3' }
        ],
        timing: 'before',
        daysBefore: 365,
        daysAfter: 0,
        value: ''
      }
    ]
  };
}

export function buildIndexes(data) {
  const diagnosis = groupByHn((data.diagnosis_record || []).map((row) => ({
    ...row,
    domain: 'diagnosis',
    eventDate: row.service_date,
    code: row.icd_code,
    name: row.disease_name,
    age: Number(row.age_at_visit)
  })));
  const drug = groupByHn((data.prescription_order || []).map((row) => ({
    ...row,
    domain: 'drug',
    eventDate: row.order_date,
    code: row.drug_code,
    name: row.drug_name,
    groupName: row.drug_group_name
  })));
  const lab = groupByHn((data.lab_result || []).map((row) => ({
    ...row,
    domain: 'lab',
    eventDate: row.test_date,
    code: row.test_code,
    name: row.test_name,
    groupName: row.test_group_name,
    numericValue: parseNumeric(row.result_value),
    unit: row.result_unit,
    age: Number(row.age_at_test)
  })));

  return { diagnosis, drug, lab };
}

export function criterionMatches(criterion, context) {
  const events = context.patientEvents[criterion.domain] || [];
  return events.some((event) => eventMatchesCriterion(event, criterion, context.indexEvent.eventDate));
}

function findIndexMatch(config, patientEvents) {
  const indexConfigs = normalizeIndexEvents(config);
  const matches = [];

  for (const indexConfig of indexConfigs) {
    const match = findIndexEvent(indexConfig, patientEvents, config.indexWindow);
    matches.push({ config: indexConfig, event: match });
  }

  if (!evaluateBooleanExpression(matches.map((match) => Boolean(match.event)), indexConfigs, 'AND')) return null;

  return {
    indexEvent: matches.find((match) => match.event)?.event || null,
    matches
  };
}

function normalizeIndexEvents(config) {
  if (Array.isArray(config.indexEvents) && config.indexEvents.length > 0) return config.indexEvents;
  if (config.indexEvent) return [config.indexEvent];
  return [];
}

function rowToContext(row, indexes) {
  const patientEvents = getPatientEvents(row.patient.hn, indexes);
  return {
    patient: row.patient,
    indexEvent: row.indexEvent,
    patientEvents,
    ageAtIndex: row.ageAtIndex
  };
}

function buildEventMatcher(query, labOperator, labValue, concepts = []) {
  return (event) => {
    if (!matchesConceptOrText(event, concepts, query)) return false;
    if (event.domain !== 'lab' || labValue === '' || labValue === null || labValue === undefined) return true;
    return compareNumeric(event.numericValue, labOperator, Number(labValue));
  };
}

function compareNumeric(actual, operator, expected) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  switch (operator) {
    case '>':
      return actual > expected;
    case '>=':
      return actual >= expected;
    case '<':
      return actual < expected;
    case '<=':
      return actual <= expected;
    case '=':
      return actual === expected;
    default:
      return true;
  }
}

function deriveAgeAtIndex(indexEvent, patientEvents) {
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

function eventMatchesCriterion(event, criterion, indexDate) {
  if (!buildEventMatcher(criterion.query, criterion.operator, criterion.value, criterion.concepts)(event)) return false;
  return isInsideWindow(event.eventDate, indexDate, criterion);
}

function findIndexEvent(indexConfig, patientEvents, indexWindow = {}) {
  const events = patientEvents[indexConfig.domain] || [];
  const matcher = buildEventMatcher(indexConfig.query, indexConfig.labOperator, indexConfig.labValue, indexConfig.concepts);
  return events
    .filter((event) => matcher(event))
    .filter((event) => isInsideAbsoluteWindow(event.eventDate, indexWindow))
    .sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate))[0] || null;
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

function isInsideWindow(eventDate, indexDate, criterion) {
  const delta = daysBetween(eventDate, indexDate);
  const before = numberOrNull(criterion.daysBefore) ?? 0;
  const after = numberOrNull(criterion.daysAfter) ?? 0;

  if (criterion.timing === 'before') return delta <= 0 && Math.abs(delta) <= before;
  if (criterion.timing === 'after') return delta >= 0 && delta <= after;
  if (criterion.timing === 'within') return delta >= -before && delta <= after;
  return true;
}

function matchesText(event, query = '') {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [event.code, event.name, event.groupName, event.icd_version, event.patient_category]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return normalized.split(/\s+/).every((part) => haystack.includes(part));
}

function matchesConceptOrText(event, concepts = [], query = '') {
  if (Array.isArray(concepts) && concepts.length > 0) {
    return concepts.some((concept) => matchesConcept(event, concept));
  }
  if (!query.trim()) return false;
  return matchesText(event, query);
}

function matchesConcept(event, concept) {
  const code = typeof concept === 'string' ? concept : concept.code;
  const name = typeof concept === 'string' ? '' : concept.name;
  const eventCode = String(event.code || '').toLowerCase();
  const eventName = String(event.name || '').toLowerCase();
  const conceptCode = String(code || '').toLowerCase();
  const conceptName = String(name || '').toLowerCase();

  if (conceptCode && eventCode === conceptCode) return true;
  if (conceptName && eventName === conceptName) return true;
  return false;
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
  const number = Number.parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? number : null;
}

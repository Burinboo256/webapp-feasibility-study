import {
  FILTER_FIELDS,
  FILTER_FIELDSETS,
  conditionValuesFromTree,
  isConditionGroupActive,
  normalizeRule,
  validateConditionGroup
} from './advancedConditions.js';

const EVENT_META = {
  diagnosis: {
    table: 'Diagnosis',
    alias: 'd',
    eventDate: 'VISIT_DATE',
    code: 'ICD_CODE',
    name: 'DISEASE_NAME',
    groupName: null,
    numericValue: null,
    rawValue: null,
    patientCategory: 'PATIENT_CATEGORY',
    ageAtEvent: 'AGE_AT_VISIT'
  },
  lab: {
    table: 'Laboratory',
    alias: 'l',
    eventDate: 'RESULT_DATE',
    code: 'LAB_CODE',
    name: 'LAB_NAME',
    groupName: 'LAB_GROUP_NAME',
    numericValue: 'LAB_VALUE',
    rawValue: 'LAB_VALUE',
    patientCategory: 'PATIENT_CATEGORY',
    ageAtEvent: 'AGE_AT_TEST'
  },
  drug: {
    table: 'Medication',
    alias: 'm',
    eventDate: 'ORDER_DATE',
    code: 'DRUG_CODE',
    name: 'DRUG_NAME',
    groupName: 'DRUG_GROUP_NAME',
    numericValue: 'QUANTITY',
    rawValue: 'QUANTITY',
    patientCategory: 'SERVICE_TYPE',
    ageAtEvent: null
  }
};

const FIELD_SQL = {
  domain: ({ eventAlias }) => `${eventAlias}.DOMAIN`,
  code: ({ eventAlias }) => `${eventAlias}.CODE`,
  name: ({ eventAlias }) => `${eventAlias}.NAME`,
  groupName: ({ eventAlias }) => `${eventAlias}.GROUP_NAME`,
  eventDate: ({ eventAlias }) => `${eventAlias}.EVENT_DATE`,
  numericValue: ({ eventAlias }) => `${eventAlias}.NUMERIC_VALUE`,
  rawValue: ({ eventAlias }) => `${eventAlias}.RAW_VALUE`,
  patientCategory: ({ eventAlias }) => `${eventAlias}.PATIENT_CATEGORY`,
  ageAtEvent: ({ eventAlias }) => `${eventAlias}.AGE_AT_EVENT`,
  daysFromT0: ({ eventAlias, patientAlias }) => `DATEDIFF(DAY, ${patientAlias}.T0_DATE, ${eventAlias}.EVENT_DATE)`
};

export function buildSql(config) {
  const { ctes, whereClauses, normalized } = buildSqlArtifacts(config);
  const sql = [
    ctes.length ? `WITH ${ctes.join(',\n')}` : '',
    'SELECT p.*',
    'FROM BasePatients p',
    whereClauses.length ? `WHERE ${joinWhereClauses(whereClauses)}` : ''
  ].filter(Boolean).join('\n');

  return {
    sql,
    summary: buildSummary(normalized)
  };
}

export function buildFeasibilityCountSql(config) {
  const { ctes, indexRefs, criterionRefs } = buildSqlArtifacts(config);
  if (indexRefs.length === 0) {
    return [
      'SELECT',
      '  COUNT(*) AS totalPatients,',
      '  CAST(0 AS BIGINT) AS indexEligibleCount,',
      '  CAST(0 AS BIGINT) AS demographicCount,',
      '  CAST(0 AS BIGINT) AS inclusionCount,',
      '  CAST(0 AS BIGINT) AS finalCount',
      'FROM Patient_Info'
    ].join('\n');
  }

  const inclusionWhere = buildFinalWhere(criterionRefs.filter((ref) => !ref.isExclusion));
  const finalWhere = buildFinalWhere(criterionRefs);

  return [
    `WITH ${ctes.join(',\n')}`,
    'SELECT',
    '  (SELECT COUNT(*) FROM Patient_Info) AS totalPatients,',
    '  (SELECT COUNT(*) FROM IndexCohort) AS indexEligibleCount,',
    '  (SELECT COUNT(*) FROM BasePatients) AS demographicCount,',
    `  (SELECT COUNT(*) FROM BasePatients p${inclusionWhere.length ? ` WHERE ${joinWhereClauses(inclusionWhere)}` : ''}) AS inclusionCount,`,
    `  (SELECT COUNT(*) FROM BasePatients p${finalWhere.length ? ` WHERE ${joinWhereClauses(finalWhere)}` : ''}) AS finalCount`
  ].join('\n');
}

function normalizeConfig(config) {
  return {
    indexEvents: normalizeRules(config.indexEvents || (config.indexEvent ? [config.indexEvent] : []), FILTER_FIELDSETS.index, 'index', 'AND'),
    indexWindow: config.indexWindow || {},
    demographics: config.demographics || {},
    inclusionCriteria: normalizeRules(config.inclusionCriteria || [], FILTER_FIELDSETS.criteria, 'criteria', 'AND'),
    exclusionCriteria: normalizeRules(config.exclusionCriteria || [], FILTER_FIELDSETS.criteria, 'criteria', 'OR')
  };
}

function normalizeRules(rules, allowedFields, legacyMode, defaultJoiner) {
  return rules
    .map((rule) => normalizeRule(rule, { allowedFields, legacyMode, defaultJoiner }))
    .filter((rule) => {
      const errors = validateConditionGroup(rule.filter, { allowedFields });
      if (errors.length > 0) {
        throw new Error(errors[0]);
      }
      return isConditionGroupActive(rule.filter);
    });
}

function buildSqlArtifacts(config) {
  const normalized = normalizeConfig(config);
  const ctes = [];
  const criterionRefs = [];
  const indexRefs = [];
  const hasRules = normalized.indexEvents.length > 0 || normalized.inclusionCriteria.length > 0 || normalized.exclusionCriteria.length > 0;

  if (hasRules) {
    ctes.push(buildAllEventsCte());
  }

  for (const [index, condition] of normalized.indexEvents.entries()) {
    const cteName = `IndexRule${index + 1}`;
    ctes.push(buildIndexRuleCte(cteName, condition, normalized.indexWindow));
    indexRefs.push({ cteName, joiner: condition.joiner || 'AND' });
  }

  if (indexRefs.length > 0) {
    ctes.push(buildIndexCohortCte(indexRefs));
  }

  for (const criterion of normalized.inclusionCriteria) {
    criterionRefs.push({ criterion, isExclusion: false });
  }
  for (const criterion of normalized.exclusionCriteria) {
    criterionRefs.push({ criterion, isExclusion: true });
  }

  ctes.push(buildBasePatientsCte(normalized.demographics, indexRefs.length > 0));

  return {
    normalized,
    ctes,
    indexRefs,
    criterionRefs,
    whereClauses: buildFinalWhere(criterionRefs)
  };
}

function buildAllEventsCte() {
  const unions = Object.entries(EVENT_META).map(([domain, meta]) => `
    SELECT
      ${meta.alias}.OH_PID,
      '${domain}' AS DOMAIN,
      ${meta.alias}.${meta.eventDate} AS EVENT_DATE,
      ${meta.alias}.${meta.code} AS CODE,
      ${meta.alias}.${meta.name} AS NAME,
      ${meta.groupName ? `${meta.alias}.${meta.groupName}` : 'CAST(NULL AS NVARCHAR(200))'} AS GROUP_NAME,
      ${meta.numericValue ? `TRY_CONVERT(FLOAT, ${meta.alias}.${meta.numericValue})` : 'CAST(NULL AS FLOAT)'} AS NUMERIC_VALUE,
      ${meta.rawValue ? `CAST(${meta.alias}.${meta.rawValue} AS NVARCHAR(100))` : 'CAST(NULL AS NVARCHAR(100))'} AS RAW_VALUE,
      ${meta.alias}.${meta.patientCategory} AS PATIENT_CATEGORY,
      ${meta.ageAtEvent ? `TRY_CONVERT(FLOAT, ${meta.alias}.${meta.ageAtEvent})` : 'CAST(NULL AS FLOAT)'} AS AGE_AT_EVENT
    FROM ${meta.table} ${meta.alias}
  `.trim()).join('\n    UNION ALL\n');

  return `AllEvents AS (
    ${unions}
)`;
}

function buildIndexRuleCte(cteName, condition, indexWindow = {}) {
  const clauses = [buildGroupSql(condition.filter, { allowedFields: FILTER_FIELDSETS.index })];

  if (indexWindow.from && indexWindow.to) {
    clauses.push(`e.EVENT_DATE BETWEEN ${quote(indexWindow.from)} AND ${quote(indexWindow.to)}`);
  } else if (indexWindow.from) {
    clauses.push(`e.EVENT_DATE >= ${quote(indexWindow.from)}`);
  } else if (indexWindow.to) {
    clauses.push(`e.EVENT_DATE <= ${quote(indexWindow.to)}`);
  }

  return `${cteName} AS (
    SELECT DISTINCT e.OH_PID, e.EVENT_DATE
    FROM AllEvents e
    WHERE ${clauses.join('\n      AND ')}
)`;
}

function buildIndexCohortCte(indexRefs) {
  const union = indexRefs.map((ref) => `SELECT OH_PID, EVENT_DATE FROM ${ref.cteName}`).join('\n        UNION ALL\n        ');
  const logic = indexRefs.map((ref, index) => {
    const exists = `EXISTS (SELECT 1 FROM ${ref.cteName} x WHERE x.OH_PID = p.OH_PID)`;
    return index === 0 ? exists : `${ref.joiner || 'AND'} ${exists}`;
  }).join('\n      ');

  return `IndexCohort AS (
    SELECT p.OH_PID, MIN(i.EVENT_DATE) AS T0_DATE
    FROM Patient_Info p
    JOIN (
        ${union}
    ) i ON i.OH_PID = p.OH_PID
    WHERE ${logic}
    GROUP BY p.OH_PID
  )`;
}

function buildBasePatientsCte(demographics, hasIndexCohort) {
  const joins = hasIndexCohort ? 'JOIN IndexCohort i ON i.OH_PID = p.OH_PID' : '';
  const selectedT0 = hasIndexCohort ? ', i.T0_DATE' : ', CAST(NULL AS DATE) AS T0_DATE';
  const clauses = [];

  if (demographics.minAge !== '' && demographics.minAge !== undefined) {
    clauses.push(`DATEDIFF(YEAR, p.BIRTH_DATE, GETDATE()) >= ${Number(demographics.minAge)}`);
  }
  if (demographics.maxAge !== '' && demographics.maxAge !== undefined) {
    clauses.push(`DATEDIFF(YEAR, p.BIRTH_DATE, GETDATE()) <= ${Number(demographics.maxAge)}`);
  }
  if (demographics.sex && demographics.sex !== 'Any') {
    clauses.push(`p.SEX = ${quote(demographics.sex)}`);
  }

  return `BasePatients AS (
    SELECT p.*${selectedT0}
    FROM Patient_Info p
    ${joins}
    ${clauses.length ? `WHERE ${clauses.join('\n      AND ')}` : ''}
  )`;
}

function buildFinalWhere(criterionRefs) {
  const inclusions = criterionRefs.filter((ref) => !ref.isExclusion);
  const exclusions = criterionRefs.filter((ref) => ref.isExclusion);
  const clauses = [];

  if (inclusions.length > 0) {
    clauses.push(buildExistsExpression(inclusions));
  }
  if (exclusions.length > 0) {
    clauses.push(`NOT ${buildExistsExpression(exclusions)}`);
  }

  return clauses;
}

function buildExistsExpression(refs) {
  const combined = refs.map((ref, index) => {
    const operator = index === 0 ? '' : ` ${(ref.criterion.joiner || 'AND').toUpperCase()} `;
    return `${operator}EXISTS (
      SELECT 1 FROM AllEvents e
      WHERE e.OH_PID = p.OH_PID
        AND ${buildGroupSql(ref.criterion.filter, { allowedFields: FILTER_FIELDSETS.criteria, patientAlias: 'p' })}
    )`;
  }).join('');

  return `(${combined})`;
}

function buildGroupSql(group, options = {}) {
  if (!group.children?.length) return '1 = 1';
  const joiner = group.logic === 'OR' ? ' OR ' : ' AND ';
  return `(${group.children.map((child) => (
    child.type === 'group'
      ? buildGroupSql(child, options)
      : buildConditionSql(child, options)
  )).join(joiner)})`;
}

function buildConditionSql(condition, options = {}) {
  const field = FILTER_FIELDS[condition.field];
  const expression = FIELD_SQL[condition.field]({
    eventAlias: options.eventAlias || 'e',
    patientAlias: options.patientAlias || 'p'
  });
  if (field.type === 'text') return textConditionSql(expression, condition.operator, condition.value);
  if (field.type === 'number') return numberConditionSql(expression, condition.operator, condition.value);
  if (field.type === 'date') return dateConditionSql(expression, condition.operator, condition.value);
  return selectConditionSql(expression, condition.operator, condition.value);
}

function textConditionSql(expression, operator, value) {
  const cast = `COALESCE(CAST(${expression} AS NVARCHAR(MAX)), '')`;
  if (operator === 'contains') return `${cast} LIKE ${quote(`%${escapeLike(value)}%`)}`;
  if (operator === 'does_not_contain') return `${cast} NOT LIKE ${quote(`%${escapeLike(value)}%`)}`;
  if (operator === 'is') return `${cast} = ${quote(value)}`;
  if (operator === 'is_not') return `${cast} <> ${quote(value)}`;
  if (operator === 'is_empty') return `LTRIM(RTRIM(${cast})) = ''`;
  if (operator === 'is_not_empty') return `LTRIM(RTRIM(${cast})) <> ''`;
  if (operator === 'starts_with') return `${cast} LIKE ${quote(`${escapeLike(value)}%`)}`;
  if (operator === 'ends_with') return `${cast} LIKE ${quote(`%${escapeLike(value)}`)}`;
  return '1 = 0';
}

function numberConditionSql(expression, operator, value) {
  if (operator === 'is_empty') return `${expression} IS NULL`;
  if (operator === 'between') {
    const clauses = [];
    if (value?.from !== '') clauses.push(`${expression} >= ${Number(value.from)}`);
    if (value?.to !== '') clauses.push(`${expression} <= ${Number(value.to)}`);
    return clauses.length > 0 ? `(${clauses.join(' AND ')})` : '1 = 0';
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '1 = 0';
  if (operator === 'is') return `${expression} = ${numeric}`;
  if (operator === 'is_not') return `${expression} <> ${numeric}`;
  if (operator === 'greater_than') return `${expression} > ${numeric}`;
  if (operator === 'less_than') return `${expression} < ${numeric}`;
  if (operator === 'greater_than_or_equal') return `${expression} >= ${numeric}`;
  if (operator === 'less_than_or_equal') return `${expression} <= ${numeric}`;
  return '1 = 0';
}

function dateConditionSql(expression, operator, value) {
  const cast = `CAST(${expression} AS DATE)`;
  if (operator === 'today') return `${cast} = CAST(GETDATE() AS DATE)`;
  if (operator === 'this_month') {
    return `YEAR(${cast}) = YEAR(GETDATE()) AND MONTH(${cast}) = MONTH(GETDATE())`;
  }
  if (operator === 'between') {
    const clauses = [];
    if (value?.from) clauses.push(`${cast} >= ${quote(value.from)}`);
    if (value?.to) clauses.push(`${cast} <= ${quote(value.to)}`);
    return clauses.length > 0 ? `(${clauses.join(' AND ')})` : '1 = 0';
  }
  if (!value) return '1 = 0';
  if (operator === 'exact_date') return `${cast} = ${quote(value)}`;
  if (operator === 'before') return `${cast} < ${quote(value)}`;
  if (operator === 'after') return `${cast} > ${quote(value)}`;
  if (operator === 'on_or_before') return `${cast} <= ${quote(value)}`;
  if (operator === 'on_or_after') return `${cast} >= ${quote(value)}`;
  return '1 = 0';
}

function selectConditionSql(expression, operator, value) {
  const cast = `COALESCE(CAST(${expression} AS NVARCHAR(100)), '')`;
  if (operator === 'is_empty') return `LTRIM(RTRIM(${cast})) = ''`;
  if (operator === 'is') return `${cast} = ${quote(value)}`;
  if (operator === 'is_not') return `${cast} <> ${quote(value)}`;
  if (operator === 'is_any_of') return `${cast} IN (${sqlList(value || [])})`;
  if (operator === 'is_none_of') return `${cast} NOT IN (${sqlList(value || [])})`;
  return '1 = 0';
}

function buildSummary(config) {
  const parts = [];
  if (config.indexEvents.length) parts.push(`${config.indexEvents.length} T0 rule${config.indexEvents.length === 1 ? '' : 's'}`);
  if (config.inclusionCriteria.length) parts.push(`${config.inclusionCriteria.length} inclusion rule${config.inclusionCriteria.length === 1 ? '' : 's'}`);
  if (config.exclusionCriteria.length) parts.push(`${config.exclusionCriteria.length} exclusion rule${config.exclusionCriteria.length === 1 ? '' : 's'}`);

  const highlighted = summarizeValues(config);
  if (highlighted.length > 0) parts.push(highlighted.slice(0, 4).join(', '));

  if (config.demographics.minAge !== '' && config.demographics.minAge !== undefined) parts.push(`Age >= ${config.demographics.minAge}`);
  if (config.demographics.maxAge !== '' && config.demographics.maxAge !== undefined) parts.push(`Age <= ${config.demographics.maxAge}`);
  if (config.demographics.sex && config.demographics.sex !== 'Any') parts.push(`Sex = ${config.demographics.sex}`);

  return `Criteria: ${parts.length ? parts.join(' · ') : 'no selected criteria'}`;
}

function summarizeValues(config) {
  return [
    ...config.indexEvents.flatMap((rule) => conditionValuesFromTree(rule.filter)),
    ...config.inclusionCriteria.flatMap((rule) => conditionValuesFromTree(rule.filter)),
    ...config.exclusionCriteria.flatMap((rule) => conditionValuesFromTree(rule.filter))
  ].map((item) => item.value);
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlList(values) {
  return values.map(quote).join(', ');
}

function escapeLike(value) {
  return String(value).replaceAll('[', '[[]').replaceAll('%', '[%]').replaceAll('_', '[_]');
}

function joinWhereClauses(clauses) {
  return clauses.join('\nAND ');
}

const DOMAIN_META = {
  diagnosis: {
    table: 'Diagnosis',
    alias: 'd',
    codeColumn: 'ICD_CODE',
    dateColumn: 'VISIT_DATE',
    ctePrefix: 'Diag'
  },
  lab: {
    table: 'Laboratory',
    alias: 'l',
    codeColumn: 'LAB_CODE',
    dateColumn: 'RESULT_DATE',
    valueColumn: 'LAB_VALUE',
    ctePrefix: 'Lab'
  },
  drug: {
    table: 'Medication',
    alias: 'm',
    codeColumn: 'DRUG_CODE',
    dateColumn: 'ORDER_DATE',
    ctePrefix: 'Drug'
  }
};

export function buildSql(config) {
  const { ctes, whereClauses, normalized } = buildSqlArtifacts(config);
  const sql = [
    ctes.length ? `WITH ${ctes.join(',\n')}` : '',
    'SELECT p.*',
    'FROM BasePatients p',
    whereClauses.length ? `WHERE ${whereClauses.join('\n')}` : ''
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
    `  (SELECT COUNT(*) FROM BasePatients p${inclusionWhere.length ? ` WHERE ${inclusionWhere.join('\n')}` : ''}) AS inclusionCount,`,
    `  (SELECT COUNT(*) FROM BasePatients p${finalWhere.length ? ` WHERE ${finalWhere.join('\n')}` : ''}) AS finalCount`
  ].join('\n');
}

function normalizeConfig(config) {
  return {
    indexEvents: Array.isArray(config.indexEvents) ? config.indexEvents : config.indexEvent ? [config.indexEvent] : [],
    indexWindow: config.indexWindow || {},
    demographics: config.demographics || {},
    inclusionCriteria: config.inclusionCriteria || [],
    exclusionCriteria: config.exclusionCriteria || []
  };
}

function buildSqlArtifacts(config) {
  const normalized = normalizeConfig(config);
  const ctes = [];
  const indexRefs = [];
  const criterionRefs = [];

  for (const [index, condition] of normalized.indexEvents.entries()) {
    if (!hasConcepts(condition)) continue;
    const cteName = `${DOMAIN_META[condition.domain].ctePrefix}Index${index + 1}`;
    ctes.push(buildEventCte(cteName, condition, normalized.indexWindow));
    indexRefs.push({ cteName, joiner: condition.joiner || 'AND' });
  }

  if (indexRefs.length > 0) {
    ctes.push(buildIndexCohortCte(indexRefs));
  }

  for (const [index, criterion] of [...normalized.inclusionCriteria, ...normalized.exclusionCriteria].entries()) {
    if (!hasConcepts(criterion)) continue;
    const cteName = `${DOMAIN_META[criterion.domain].ctePrefix}Criteria${index + 1}`;
    ctes.push(buildEventCte(cteName, criterion));
    criterionRefs.push({
      cteName,
      criterion,
      isExclusion: normalized.exclusionCriteria.includes(criterion)
    });
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

function buildEventCte(cteName, condition, indexWindow = {}) {
  const meta = DOMAIN_META[condition.domain];
  const alias = meta.alias;
  const clauses = [
    `${alias}.${meta.codeColumn} IN (${sqlList(condition.concepts.map((concept) => concept.code))})`
  ];

  const from = indexWindow.from || condition.from;
  const to = indexWindow.to || condition.to;
  if (from && to) {
    clauses.push(`${alias}.${meta.dateColumn} BETWEEN ${quote(from)} AND ${quote(to)}`);
  } else if (from) {
    clauses.push(`${alias}.${meta.dateColumn} >= ${quote(from)}`);
  } else if (to) {
    clauses.push(`${alias}.${meta.dateColumn} <= ${quote(to)}`);
  }

  if (condition.domain === 'lab' && condition.value !== '' && condition.value !== undefined) {
    clauses.push(`${alias}.${meta.valueColumn} ${sqlOperator(condition.operator || condition.labOperator)} ${Number(condition.value)}`);
  }

  if (condition.domain === 'lab' && condition.labValue !== '' && condition.labValue !== undefined) {
    clauses.push(`${alias}.${meta.valueColumn} ${sqlOperator(condition.labOperator)} ${Number(condition.labValue)}`);
  }

  return `${cteName} AS (
    SELECT DISTINCT ${alias}.OH_PID, ${alias}.${meta.dateColumn} AS EVENT_DATE
    FROM ${meta.table} ${alias}
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
  return criterionRefs.map((ref, index) => {
    const operator = index === 0 ? '' : `${ref.criterion.joiner || (ref.isExclusion ? 'OR' : 'AND')} `;
    const exists = `${ref.isExclusion ? 'NOT ' : ''}EXISTS (
    SELECT 1 FROM ${ref.cteName} c
    WHERE c.OH_PID = p.OH_PID${timingClause(ref.criterion)}
)`;
    return `${operator}${exists}`;
  });
}

function timingClause(criterion) {
  const before = Number(criterion.daysBefore || 0);
  const after = Number(criterion.daysAfter || 0);
  if (criterion.timing === 'before') {
    return `
      AND c.EVENT_DATE BETWEEN DATEADD(DAY, -${before}, p.T0_DATE) AND p.T0_DATE`;
  }
  if (criterion.timing === 'after') {
    return `
      AND c.EVENT_DATE BETWEEN p.T0_DATE AND DATEADD(DAY, ${after}, p.T0_DATE)`;
  }
  if (criterion.timing === 'within') {
    return `
      AND c.EVENT_DATE BETWEEN DATEADD(DAY, -${before}, p.T0_DATE) AND DATEADD(DAY, ${after}, p.T0_DATE)`;
  }
  return '';
}

function buildSummary(config) {
  const all = [...config.indexEvents, ...config.inclusionCriteria, ...config.exclusionCriteria];
  const counts = {
    diagnosis: countConcepts(all, 'diagnosis'),
    lab: countConcepts(all, 'lab'),
    drug: countConcepts(all, 'drug')
  };
  const age = [];
  if (config.demographics.minAge !== '' && config.demographics.minAge !== undefined) age.push(`Age >= ${config.demographics.minAge}`);
  if (config.demographics.maxAge !== '' && config.demographics.maxAge !== undefined) age.push(`Age <= ${config.demographics.maxAge}`);
  if (config.demographics.sex && config.demographics.sex !== 'Any') age.push(`Sex = ${config.demographics.sex}`);

  const parts = [];
  if (counts.diagnosis) parts.push(`${counts.diagnosis} diagnosis`);
  if (counts.lab) parts.push(`${counts.lab} lab`);
  if (counts.drug) parts.push(`${counts.drug} drug`);
  parts.push(...age);
  return `Criteria: ${parts.length ? parts.join(' · ') : 'no selected criteria'}`;
}

function countConcepts(rows, domain) {
  return rows
    .filter((row) => row.domain === domain)
    .reduce((sum, row) => sum + (row.concepts?.length || 0), 0);
}

function hasConcepts(condition) {
  return Boolean(condition?.domain && DOMAIN_META[condition.domain] && condition.concepts?.length);
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlList(values) {
  return values.map(quote).join(', ');
}

function sqlOperator(operator) {
  return ['>', '>=', '<', '<=', '='].includes(operator) ? operator : '=';
}

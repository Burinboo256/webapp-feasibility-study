export const AUDIT_USER_KEY = 'cohort-lens.auditUser.v1';

export async function getCurrentSession() {
  const response = await fetch('/api/audit/session', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json' }
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  return payload.session || null;
}

export async function recordFeasibilityRun(config, result, sql) {
  const response = await fetch('/api/audit/run', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      question: config.question || '',
      indexEligibleCount: result.indexEligibleCount,
      finalCount: result.finalCount,
      excludedCount: result.excludedCount,
      attrition: result.attrition,
      selectedConcepts: collectSelectedConcepts(config),
      config,
      sql
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to record feasibility run.');
  }
  return payload.run || null;
}

export async function readAuditLogs() {
  const response = await fetch('/api/logs', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load logs.');
  }
  return {
    sessions: payload.sessions || [],
    runs: payload.runs || [],
    appStorage: payload.appStorage || 'local'
  };
}

export async function clearAuditLogs() {
  const response = await fetch('/api/logs', {
    method: 'DELETE',
    credentials: 'same-origin'
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Unable to clear logs.');
  }
}

export async function listSavedCohorts() {
  const response = await fetch('/api/cohorts', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load saved cohorts.');
  }
  return payload.cohorts || [];
}

export async function saveSavedCohort(cohort) {
  const response = await fetch('/api/cohorts', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cohort)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to save cohort.');
  }
  return payload.cohort || null;
}

export async function deleteSavedCohort(cohortId) {
  const response = await fetch(`/api/cohorts/${encodeURIComponent(cohortId)}`, {
    method: 'DELETE',
    credentials: 'same-origin'
  });
  if (!response.ok && response.status !== 204) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Unable to delete cohort.');
  }
}

export function setAuditUser(user) {
  sessionStorage.setItem(AUDIT_USER_KEY, JSON.stringify({
    id: user.id,
    email: user.email,
    name: user.name,
    provider: user.provider,
    role: user.role
  }));
}

export function getAuditUser() {
  try {
    return JSON.parse(sessionStorage.getItem(AUDIT_USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export function collectSelectedConcepts(config) {
  const summary = {
    diagnosis: [],
    lab: [],
    drug: []
  };

  for (const source of cohortConceptSources(config)) {
    for (const concept of source.concepts || []) {
      const domain = source.domain || 'diagnosis';
      if (!summary[domain]) summary[domain] = [];
      const key = `${source.section}|${concept.code || ''}|${concept.name || ''}`;
      if (summary[domain].some((item) => item.key === key)) continue;
      summary[domain].push({
        key,
        section: source.section,
        code: concept.code || '',
        name: concept.name || ''
      });
    }
  }

  return summary;
}

function cohortConceptSources(config) {
  return [
    ...(config.indexEvents || []).map((item) => ({ ...item, section: 'T0' })),
    ...(config.inclusionCriteria || []).map((item) => ({ ...item, section: 'Inclusion' })),
    ...(config.exclusionCriteria || []).map((item) => ({ ...item, section: 'Exclusion' }))
  ];
}

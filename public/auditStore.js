export const SAVED_COHORTS_KEY = 'cohort-lens.savedCohorts.v1';
export const FEASIBILITY_RUN_LOGS_KEY = 'cohort-lens.feasibilityRunLogs.v1';
export const SESSION_LOGS_KEY = 'cohort-lens.sessionLogs.v1';
export const SESSION_ID_KEY = 'cohort-lens.sessionId.v1';

export function getCurrentSession() {
  const now = new Date().toISOString();
  let sessionId = sessionStorage.getItem(SESSION_ID_KEY);

  if (!sessionId) {
    sessionId = createId('session');
    sessionStorage.setItem(SESSION_ID_KEY, sessionId);
    const session = {
      id: sessionId,
      startedAt: now,
      lastSeenAt: now,
      pageViews: 1,
      runCount: 0,
      userAgent: navigator.userAgent
    };
    writeList(SESSION_LOGS_KEY, [session, ...readList(SESSION_LOGS_KEY)], 200);
    return session;
  }

  const sessions = readList(SESSION_LOGS_KEY);
  const existing = sessions.find((session) => session.id === sessionId);
  if (!existing) {
    const session = {
      id: sessionId,
      startedAt: now,
      lastSeenAt: now,
      pageViews: 1,
      runCount: 0,
      userAgent: navigator.userAgent
    };
    writeList(SESSION_LOGS_KEY, [session, ...sessions], 200);
    return session;
  }

  existing.lastSeenAt = now;
  existing.pageViews = Number(existing.pageViews || 0) + 1;
  writeList(SESSION_LOGS_KEY, sessions, 200);
  return existing;
}

export function recordFeasibilityRun(config, result, sql) {
  const session = getCurrentSession();
  const run = {
    id: createId('run'),
    sessionId: session.id,
    createdAt: new Date().toISOString(),
    question: config.question || '',
    indexEligibleCount: result.indexEligibleCount,
    finalCount: result.finalCount,
    excludedCount: result.excludedCount,
    attrition: result.attrition,
    selectedConcepts: collectSelectedConcepts(config),
    config,
    sql
  };

  writeList(FEASIBILITY_RUN_LOGS_KEY, [run, ...readList(FEASIBILITY_RUN_LOGS_KEY)], 500);
  incrementSessionRunCount(session.id);
  return run;
}

export function readFeasibilityRunLogs() {
  return readList(FEASIBILITY_RUN_LOGS_KEY);
}

export function readSessionLogs() {
  return readList(SESSION_LOGS_KEY);
}

export function clearAuditLogs() {
  localStorage.removeItem(FEASIBILITY_RUN_LOGS_KEY);
  localStorage.removeItem(SESSION_LOGS_KEY);
  sessionStorage.removeItem(SESSION_ID_KEY);
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

export function readList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function writeList(key, items, limit) {
  try {
    localStorage.setItem(key, JSON.stringify(items.slice(0, limit)));
    return true;
  } catch {
    return false;
  }
}

function cohortConceptSources(config) {
  return [
    ...(config.indexEvents || []).map((item) => ({ ...item, section: 'T0' })),
    ...(config.inclusionCriteria || []).map((item) => ({ ...item, section: 'Inclusion' })),
    ...(config.exclusionCriteria || []).map((item) => ({ ...item, section: 'Exclusion' }))
  ];
}

function incrementSessionRunCount(sessionId) {
  const sessions = readList(SESSION_LOGS_KEY);
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return;
  session.runCount = Number(session.runCount || 0) + 1;
  session.lastSeenAt = new Date().toISOString();
  writeList(SESSION_LOGS_KEY, sessions, 200);
}

function createId(prefix) {
  if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

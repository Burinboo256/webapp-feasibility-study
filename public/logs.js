import {
  clearAuditLogs,
  getCurrentSession,
  readFeasibilityRunLogs,
  readSessionLogs
} from './auditStore.js';

const els = {};

document.addEventListener('DOMContentLoaded', () => {
  bindElements();
  getCurrentSession();
  bindEvents();
  renderLogs();
});

function bindElements() {
  for (const id of [
    'sessionCount',
    'runCount',
    'latestFinalCount',
    'exportLogs',
    'clearLogs',
    'logSearch',
    'runLogList',
    'sessionLogRows'
  ]) {
    els[id] = document.getElementById(id);
  }
}

function bindEvents() {
  els.logSearch.addEventListener('input', renderLogs);
  els.exportLogs.addEventListener('click', exportLogs);
  els.clearLogs.addEventListener('click', () => {
    if (!window.confirm('Clear all local session and feasibility run logs?')) return;
    clearAuditLogs();
    getCurrentSession();
    renderLogs();
  });
}

function renderLogs() {
  const sessions = readSessionLogs();
  const runs = readFeasibilityRunLogs();
  const filteredRuns = filterRuns(runs, els.logSearch.value);

  els.sessionCount.textContent = sessions.length;
  els.runCount.textContent = runs.length;
  els.latestFinalCount.textContent = runs[0]?.finalCount ?? 0;
  renderRunLogs(filteredRuns);
  renderSessionLogs(sessions);
}

function filterRuns(runs, query) {
  const term = query.trim().toLowerCase();
  if (!term) return runs;
  return runs.filter((run) => runSearchText(run).includes(term));
}

function renderRunLogs(runs) {
  if (runs.length === 0) {
    els.runLogList.innerHTML = '<p class="helper-text">No feasibility run logs found.</p>';
    return;
  }

  els.runLogList.replaceChildren(
    ...runs.map((run) => {
      const article = document.createElement('article');
      article.className = 'run-log-card';
      article.innerHTML = `
        <div class="run-log-header">
          <div>
            <strong>${escapeHtml(run.question || 'Untitled cohort')}</strong>
            <p>${escapeHtml(formatDate(run.createdAt))} · ${escapeHtml(shortId(run.sessionId))}</p>
          </div>
          <div class="run-log-counts">
            <span>T0 ${run.indexEligibleCount ?? 0}</span>
            <span>Final ${run.finalCount ?? 0}</span>
          </div>
        </div>
        <div class="run-log-concepts">
          ${domainConceptSummary('Diagnosis', run.selectedConcepts?.diagnosis || [])}
          ${domainConceptSummary('Lab', run.selectedConcepts?.lab || [])}
          ${domainConceptSummary('Drug', run.selectedConcepts?.drug || [])}
        </div>
      `;
      return article;
    })
  );
}

function renderSessionLogs(sessions) {
  if (sessions.length === 0) {
    els.sessionLogRows.innerHTML = '<tr><td colspan="5">No session logs found.</td></tr>';
    return;
  }

  els.sessionLogRows.replaceChildren(
    ...sessions.map((session) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${escapeHtml(shortId(session.id))}</td>
        <td>${escapeHtml(formatDate(session.startedAt))}</td>
        <td>${escapeHtml(formatDate(session.lastSeenAt))}</td>
        <td>${Number(session.runCount || 0)}</td>
        <td>${Number(session.pageViews || 0)}</td>
      `;
      return row;
    })
  );
}

function exportLogs() {
  const payload = {
    exportedAt: new Date().toISOString(),
    sessions: readSessionLogs(),
    feasibilityRuns: readFeasibilityRunLogs()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `cohort-lens-audit-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function domainConceptSummary(label, concepts) {
  const count = concepts.length;
  const preview = concepts.slice(0, 6).map((concept) => `${concept.code} ${concept.name}`).join(', ');
  return `
    <section>
      <h3>${escapeHtml(label)} · ${count}</h3>
      <p>${escapeHtml(preview || 'None selected')}${count > 6 ? ' ...' : ''}</p>
    </section>
  `;
}

function runSearchText(run) {
  const concepts = Object.values(run.selectedConcepts || {})
    .flat()
    .map((concept) => `${concept.section} ${concept.code} ${concept.name}`)
    .join(' ');
  return `${run.sessionId || ''} ${run.question || ''} ${concepts}`.toLowerCase();
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown date';
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function shortId(value = '') {
  return value.split('-').slice(0, 2).join('-') || 'unknown';
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

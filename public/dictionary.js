import { dictionaryStats, filterDictionaryEntries } from '../src/masterDictionary.js';
import { renderAuthUser, requireAuth } from './authClient.js';
import { getCurrentSession } from './auditStore.js';

const state = {
  conceptCatalog: {
    diagnosis: [],
    lab: [],
    drug: []
  },
  sources: [],
  mode: 'local-file',
  selectedDomain: 'all'
};

const els = {};

document.addEventListener('DOMContentLoaded', async () => {
  try {
    bindElements();
    const user = await requireAuth();
    if (!user) return;
    renderAuthUser(user, els.authStatus);
    await getCurrentSession();
    await loadDictionary();
    bindEvents();
    renderDictionary();
  } catch (error) {
    reportRuntimeError(error);
  }
});

function bindElements() {
  for (const id of [
    'authStatus',
    'domainTabs',
    'dictionarySearch',
    'dictionaryCount',
    'dictionaryHint',
    'dictionaryResults',
    'dictionaryWarning',
    'dictionarySources'
  ]) {
    els[id] = document.getElementById(id);
  }
}

function bindEvents() {
  els.dictionarySearch.addEventListener('input', renderDictionary);
  els.domainTabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-domain]');
    if (!button) return;
    state.selectedDomain = button.dataset.domain || 'all';
    renderDictionary();
  });
  els.dictionaryResults.addEventListener('click', (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    void copyValue(button.dataset.copy, button);
  });
}

async function loadDictionary() {
  const response = await fetch('/data/master-dictionary.json', { credentials: 'same-origin' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load dictionary data.');
  }
  state.conceptCatalog = payload.conceptCatalog || state.conceptCatalog;
  state.sources = payload.sources || [];
  state.mode = payload.mode || 'local-file';
  els.dictionaryWarning.hidden = true;
  els.dictionaryWarning.textContent = '';
}

function renderDictionary() {
  renderTabs();
  renderSources();
  const entries = filterDictionaryEntries(state.conceptCatalog, {
    domain: state.selectedDomain,
    query: els.dictionarySearch.value,
    limit: 300
  });
  const stats = dictionaryStats(state.conceptCatalog);
  const currentCount = state.selectedDomain === 'all' ? stats.all : stats[state.selectedDomain];
  els.dictionaryCount.textContent = `${entries.length} shown · ${currentCount} available`;
  els.dictionaryHint.textContent = state.selectedDomain === 'all'
    ? 'Showing matches across diagnosis, lab, and drug dictionaries from the local snapshot file.'
    : `Showing ${state.selectedDomain} dictionary entries only from the local snapshot file.`;

  if (entries.length === 0) {
    els.dictionaryResults.innerHTML = '<p class="helper-text">No dictionary entries matched your search.</p>';
    return;
  }

  els.dictionaryResults.replaceChildren(
    ...entries.map((entry) => {
      const article = document.createElement('article');
      article.className = 'dictionary-card';
      article.innerHTML = `
        <div class="dictionary-card-header">
          <span class="dictionary-domain">${escapeHtml(entry.domain)}</span>
          <span class="dictionary-count">n=${Number(entry.count || 0)}</span>
        </div>
        <strong class="dictionary-code">${escapeHtml(entry.code || '-')}</strong>
        <p class="dictionary-name">${escapeHtml(entry.name || '-')}</p>
        <p class="dictionary-group">${escapeHtml(entry.groupName || 'No group name')}</p>
        <div class="dictionary-actions">
          <button type="button" class="small" data-copy="${escapeAttribute(entry.code || '')}">Copy code</button>
          <button type="button" class="small" data-copy="${escapeAttribute(entry.name || '')}">Copy name</button>
        </div>
      `;
      return article;
    })
  );
}

function renderTabs() {
  const stats = dictionaryStats(state.conceptCatalog);
  const domains = [
    { value: 'all', label: 'All', count: stats.all },
    { value: 'diagnosis', label: 'Diagnosis', count: stats.diagnosis },
    { value: 'lab', label: 'Lab', count: stats.lab },
    { value: 'drug', label: 'Drug', count: stats.drug }
  ];

  els.domainTabs.replaceChildren(
    ...domains.map((domain) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `dictionary-tab${state.selectedDomain === domain.value ? ' active' : ''}`;
      button.dataset.domain = domain.value;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(state.selectedDomain === domain.value));
      button.textContent = `${domain.label} · ${domain.count}`;
      return button;
    })
  );
}

function renderSources() {
  if (!state.sources.length) {
    els.dictionarySources.replaceChildren();
    return;
  }

  els.dictionarySources.replaceChildren(
    ...state.sources.map((source) => {
      const link = document.createElement('a');
      link.className = 'dictionary-source';
      link.href = source.link;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = source.label;
      return link;
    })
  );
}

async function copyValue(value, button) {
  if (!value) return;
  await navigator.clipboard.writeText(value);
  const previous = button.textContent;
  button.textContent = 'Copied';
  setTimeout(() => {
    button.textContent = previous;
  }, 1200);
}

function reportRuntimeError(error) {
  console.error(error);
  els.dictionaryResults.innerHTML = `<p class="helper-text">${escapeHtml(error?.message || 'Unable to load dictionary.')}</p>`;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value = '') {
  return escapeHtml(value);
}

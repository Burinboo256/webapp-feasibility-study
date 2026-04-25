import { defaultConfig, diabetesPresetConfig, normalizeCohortConfig } from '../src/cohortEngine.js';
import { buildSql } from '../src/sqlBuilder.js';
import {
  FILTER_FIELDSETS,
  conditionValuesFromTree,
  createCondition,
  createConditionGroup,
  validateConditionGroup
} from '../src/advancedConditions.js';
import {
  deleteSavedCohort,
  getCurrentSession,
  recordFeasibilityRun,
  listSavedCohorts,
  saveSavedCohort
} from './auditStore.js';
import { renderAuthUser, requireAuth } from './authClient.js';
import { createFilterBuilder } from './filterBuilder.js';

const state = {
  dataSource: 'json',
  appStorage: 'local',
  savedCohorts: [],
  config: defaultConfig(),
  currentSql: '',
  currentWorkflowSvg: ''
};

const presets = {
  diabetes: diabetesPresetConfig(),
  lab: {
    ...diabetesPresetConfig(),
    question: 'Patients with HbA1c >= 8.0 and a diabetes diagnosis within 90 days before or after the lab T0.',
    indexEvents: [
      {
        id: 'idx-high-hba1c',
        label: 'High HbA1c lab at T0',
        joiner: 'AND',
        filter: filterGroup([
          equals('domain', 'lab'),
          equals('code', 'HBA1C'),
          createCondition({ field: 'numericValue', operator: 'greater_than_or_equal', value: '8' })
        ])
      }
    ],
    inclusionCriteria: [
      {
        id: 'inc-diabetes-around-lab',
        joiner: 'AND',
        label: 'Diabetes diagnosis within 90 days of lab T0',
        filter: filterGroup([
          equals('domain', 'diagnosis'),
          anyCode(['E11.9', 'E11.65', 'E11.22']),
          createCondition({ field: 'daysFromT0', operator: 'between', value: { from: '-90', to: '90' } })
        ])
      }
    ],
    exclusionCriteria: []
  },
  stroke: {
    ...diabetesPresetConfig(),
    question: 'Inpatient stroke patients with aspirin released after T0.',
    indexEvents: [
      {
        id: 'idx-stroke',
        label: 'Stroke diagnosis at T0',
        joiner: 'AND',
        filter: filterGroup([
          equals('domain', 'diagnosis'),
          equals('code', 'I63.9')
        ])
      }
    ],
    inclusionCriteria: [
      {
        id: 'inc-aspirin-after-stroke',
        label: 'Aspirin released within 14 days after T0',
        joiner: 'AND',
        filter: filterGroup([
          equals('domain', 'drug'),
          equals('code', 'ASP81'),
          createCondition({ field: 'daysFromT0', operator: 'between', value: { from: '0', to: '14' } })
        ])
      }
    ],
    exclusionCriteria: []
  }
};

const els = {};

document.addEventListener('DOMContentLoaded', async () => {
  try {
    bindElements();
    const user = await requireAuth();
    if (!user) return;
    renderAuthUser(user, els.authStatus);
    await getCurrentSession();
    const bootstrap = await loadBootstrap();
    state.dataSource = bootstrap.dataSource || 'json';
    state.appStorage = bootstrap.appStorage || 'local';
    writeConfigToForm(state.config);
    bindEvents();
    await refreshSavedCohorts();
    await run();
  } catch (error) {
    reportRuntimeError(error);
  }
});

async function loadBootstrap() {
  const response = await fetch('/api/bootstrap', { credentials: 'same-origin' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load bootstrap data.');
  }
  return payload;
}

function bindElements() {
  for (const id of [
    'question',
    'cohortForm',
    'addIndexCondition',
    'indexConditionList',
    'indexFrom',
    'indexTo',
    'minAge',
    'maxAge',
    'sex',
    'inclusionList',
    'exclusionList',
    'ruleTemplate',
    'heroCount',
    'heroContext',
    'indexEligible',
    'finalCount',
    'attrition',
    'workflowDiagram',
    'downloadSvg',
    'downloadPng',
    'generatedSql',
    'sqlSummary',
    'copySql',
    'addInclusion',
    'addExclusion',
    'savedCohortName',
    'savedCohortSearch',
    'saveCohort',
    'savedCohortSelect',
    'loadSavedCohort',
    'deleteSavedCohort',
    'savedCohortStatus',
    'authStatus'
  ]) {
    els[id] = document.getElementById(id);
  }
}

function bindEvents() {
  els.cohortForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void run({ logRun: true }).catch(reportRuntimeError);
  });
  els.cohortForm.addEventListener('input', () => {
    void refreshSqlFromForm();
  });
  els.cohortForm.addEventListener('change', () => {
    void refreshSqlFromForm();
  });

  els.addIndexCondition.addEventListener('click', () => addRule('indexConditionList', {}, FILTER_FIELDSETS.index, 'AND'));
  els.addInclusion.addEventListener('click', () => addRule('inclusionList', {}, FILTER_FIELDSETS.criteria, 'AND'));
  els.addExclusion.addEventListener('click', () => addRule('exclusionList', {}, FILTER_FIELDSETS.criteria, 'OR'));
  els.downloadSvg.addEventListener('click', () => downloadSvg());
  els.downloadPng.addEventListener('click', () => downloadPng());
  els.saveCohort.addEventListener('click', () => {
    void saveCurrentCohort().catch(reportRuntimeError);
  });
  els.savedCohortSearch.addEventListener('input', () => renderSavedCohorts(els.savedCohortSelect.value));
  els.loadSavedCohort.addEventListener('click', () => {
    void loadSelectedCohort().catch(reportRuntimeError);
  });
  els.deleteSavedCohort.addEventListener('click', () => {
    void deleteSelectedCohort().catch(reportRuntimeError);
  });
  els.copySql.addEventListener('click', async () => {
    await copyText(state.currentSql);
    els.copySql.textContent = 'Copied';
    setTimeout(() => {
      els.copySql.textContent = 'Copy SQL';
    }, 1200);
  });

  document.querySelectorAll('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      state.config = structuredClone(presets[button.dataset.preset]);
      writeConfigToForm(state.config);
      void run().catch(reportRuntimeError);
    });
  });
}

async function saveCurrentCohort() {
  state.config = readConfigFromForm({ validate: true });
  const name = els.savedCohortName.value.trim() || defaultSavedCohortName(state.config);
  const saved = await saveSavedCohort({
    id: crypto.randomUUID(),
    name,
    config: structuredClone(state.config)
  });

  els.savedCohortName.value = '';
  await refreshSavedCohorts(saved.id);
  void run().catch(reportRuntimeError);
  setSavedCohortStatus(`Saved "${name}".`);
}

async function loadSelectedCohort() {
  const saved = findSelectedSavedCohort();
  if (!saved) {
    setSavedCohortStatus('Select a saved cohort to load.');
    return;
  }

  state.config = structuredClone(saved.config);
  writeConfigToForm(state.config);
  await refreshSavedCohorts(saved.id);
  void run().catch(reportRuntimeError);
  setSavedCohortStatus(`Loaded "${saved.name}".`);
}

async function deleteSelectedCohort() {
  const saved = findSelectedSavedCohort();
  if (!saved) {
    setSavedCohortStatus('Select a saved cohort to delete.');
    return;
  }

  if (!window.confirm(`Delete saved cohort "${saved.name}"?`)) return;

  await deleteSavedCohort(saved.id);
  await refreshSavedCohorts();
  setSavedCohortStatus(`Deleted "${saved.name}".`);
}

function renderSavedCohorts(selectedId = '') {
  const savedCohorts = state.savedCohorts;
  const searchTerm = els.savedCohortSearch.value.trim().toLowerCase();
  const filteredCohorts = searchTerm
    ? savedCohorts.filter((saved) => savedCohortSearchText(saved).includes(searchTerm))
    : savedCohorts;
  const options = filteredCohorts.length > 0
    ? filteredCohorts.map((saved) => {
      const option = document.createElement('option');
      option.value = saved.id;
      option.textContent = `${saved.name} · ${formatSavedAt(saved.savedAt)}`;
      option.selected = saved.id === selectedId;
      return option;
    })
    : [new Option(savedCohorts.length > 0 ? 'No saved cohorts match search' : 'No saved cohorts yet', '')];

  els.savedCohortSelect.replaceChildren(...options);
  const hasFilteredCohorts = filteredCohorts.length > 0;
  els.savedCohortSelect.disabled = !hasFilteredCohorts;
  els.loadSavedCohort.disabled = !hasFilteredCohorts;
  els.deleteSavedCohort.disabled = !hasFilteredCohorts;

  if (savedCohorts.length === 0) {
    setSavedCohortStatus(`No saved cohorts yet. Storage mode: ${state.appStorage}.`);
  } else if (!hasFilteredCohorts) {
    setSavedCohortStatus(`No saved cohorts match "${els.savedCohortSearch.value}".`);
  } else {
    setSavedCohortStatus(`${filteredCohorts.length} of ${savedCohorts.length} saved cohorts shown.`);
  }
}

function findSelectedSavedCohort() {
  const selectedId = els.savedCohortSelect.value;
  return state.savedCohorts.find((saved) => saved.id === selectedId);
}

async function refreshSavedCohorts(selectedId = '') {
  state.savedCohorts = (await listSavedCohorts()).filter((item) => item?.id && item?.config);
  renderSavedCohorts(selectedId);
}

function defaultSavedCohortName(config) {
  const question = (config.question || '').trim();
  if (question) return question.slice(0, 72);
  return `Cohort ${formatSavedAt(new Date().toISOString())}`;
}

function formatSavedAt(value) {
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

function setSavedCohortStatus(message) {
  els.savedCohortStatus.textContent = message;
}

function savedCohortSearchText(saved) {
  const normalized = normalizeCohortConfig(saved.config || {});
  const values = [
    ...normalized.indexEvents.flatMap((rule) => conditionValuesFromTree(rule.filter)),
    ...normalized.inclusionCriteria.flatMap((rule) => conditionValuesFromTree(rule.filter)),
    ...normalized.exclusionCriteria.flatMap((rule) => conditionValuesFromTree(rule.filter))
  ].map((item) => item.value);
  return `${saved.name} ${saved.config.question || ''} ${values.join(' ')}`.toLowerCase();
}

function writeConfigToForm(config) {
  const normalized = normalizeCohortConfig(config);
  els.question.value = config.question || '';
  els.indexFrom.value = config.indexWindow?.from || '';
  els.indexTo.value = config.indexWindow?.to || '';
  els.minAge.value = config.demographics?.minAge ?? '';
  els.maxAge.value = config.demographics?.maxAge ?? '';
  els.sex.value = config.demographics?.sex || 'Any';
  els.indexConditionList.replaceChildren();
  els.inclusionList.replaceChildren();
  els.exclusionList.replaceChildren();

  const indexRules = normalized.indexEvents.length > 0 ? normalized.indexEvents : [defaultIndexRule()];
  for (const rule of indexRules) addRule('indexConditionList', rule, FILTER_FIELDSETS.index, 'AND');
  for (const rule of normalized.inclusionCriteria) addRule('inclusionList', rule, FILTER_FIELDSETS.criteria, 'AND');
  for (const rule of normalized.exclusionCriteria) addRule('exclusionList', rule, FILTER_FIELDSETS.criteria, 'OR');
}

function readConfigFromForm(options = {}) {
  const config = {
    question: els.question.value.trim(),
    indexEvents: readRules(els.indexConditionList, FILTER_FIELDSETS.index),
    indexWindow: {
      from: els.indexFrom.value,
      to: els.indexTo.value
    },
    demographics: {
      minAge: els.minAge.value,
      maxAge: els.maxAge.value,
      sex: els.sex.value
    },
    inclusionCriteria: readRules(els.inclusionList, FILTER_FIELDSETS.criteria),
    exclusionCriteria: readRules(els.exclusionList, FILTER_FIELDSETS.criteria)
  };

  if (options.validate) validateConfig(config);
  return config;
}

function readRules(container, allowedFields) {
  return [...container.querySelectorAll('.advanced-rule')].map((node, index) => ({
    id: node.dataset.id || `rule-${index}`,
    joiner: node.querySelector('[data-field="joiner"]').value,
    label: node.querySelector('[data-field="label"]').value.trim(),
    filter: node.filterBuilder?.getValue() || createConditionGroup()
  }));
}

function validateConfig(config) {
  const sections = [
    ['T0', config.indexEvents, FILTER_FIELDSETS.index],
    ['Inclusion', config.inclusionCriteria, FILTER_FIELDSETS.criteria],
    ['Exclusion', config.exclusionCriteria, FILTER_FIELDSETS.criteria]
  ];

  for (const [label, rules, allowedFields] of sections) {
    for (const rule of rules) {
      const errors = validateConditionGroup(rule.filter, { allowedFields });
      if (errors.length > 0) {
        throw new Error(`${label}: ${errors[0]}`);
      }
    }
  }
}

function addRule(containerId, rule = {}, allowedFields, defaultJoiner) {
  const fragment = els.ruleTemplate.content.cloneNode(true);
  const node = fragment.querySelector('.advanced-rule');
  node.dataset.id = rule.id || crypto.randomUUID();
  node.querySelector('[data-field="joiner"]').value = rule.joiner || defaultJoiner;
  node.querySelector('[data-field="label"]').value = rule.label || '';
  node.querySelector('.remove').addEventListener('click', () => {
    node.remove();
    void refreshSqlFromForm();
  });

  const builderHost = node.querySelector('[data-field="filterBuilder"]');
  node.filterBuilder = createFilterBuilder({
    container: builderHost,
    allowedFields,
    value: rule.filter || createConditionGroup(),
    onChange: () => {
      void refreshSqlFromForm();
    }
  });

  els[containerId].appendChild(fragment);
}

function defaultIndexRule() {
  return {
    id: 'idx-blank',
    joiner: 'AND',
    label: '',
    filter: createConditionGroup()
  };
}

async function run(options = {}) {
  state.config = readConfigFromForm({ validate: true });
  const result = await executeFeasibility(state.config);
  renderResult(result);
  if (options.logRun) {
    await recordFeasibilityRun(state.config, result, state.currentSql);
  }
}

async function executeFeasibility(config) {
  const response = await fetch('/api/feasibility/run', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ config })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to run feasibility query.');
  }
  state.dataSource = payload.dataSource || state.dataSource;
  return payload.result;
}

function reportRuntimeError(error) {
  console.error(error);
  const message = error?.message || 'Unable to complete the requested action.';
  if (els.heroContext) {
    els.heroContext.textContent = message;
  }
}

function renderResult(result) {
  els.heroCount.textContent = result.finalCount;
  els.heroContext.textContent = `${result.indexEligibleCount} patients have a matching T0 index event`;
  els.indexEligible.textContent = result.indexEligibleCount;
  els.finalCount.textContent = result.finalCount;
  renderAttrition(result);
  renderWorkflowDiagram(result);
  void refreshSqlFromForm();
}

async function refreshSqlFromForm() {
  try {
    state.config = readConfigFromForm({ validate: true });
    renderSql();
  } catch (error) {
    state.currentSql = '';
    els.generatedSql.textContent = error.message;
    els.sqlSummary.textContent = 'Criteria: invalid filter configuration';
  }
}

function renderAttrition(result) {
  const displayedSteps = result.attrition.filter((step) => !step.label.startsWith('Synthetic patients'));
  const max = Math.max(...displayedSteps.map((step) => step.count), 1);
  els.attrition.replaceChildren(
    ...displayedSteps.map((step) => {
      const row = document.createElement('div');
      row.className = 'attrition-row';
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(step.label)}</strong>
          <div class="bar"><span style="width:${Math.max(4, (step.count / max) * 100)}%"></span></div>
        </div>
        <strong>${step.count}</strong>
      `;
      return row;
    })
  );
}

function renderWorkflowDiagram(result) {
  const steps = workflowSteps(result);
  const svg = buildWorkflowSvg(steps);
  state.currentWorkflowSvg = svg;
  els.workflowDiagram.innerHTML = svg;
  els.workflowDiagram.querySelectorAll('[data-step-index]').forEach((node) => {
    node.addEventListener('click', () => {
      const step = steps[Number(node.dataset.stepIndex)];
      sendPrompt(`Explain the cohort attrition step "${step.label}" with n=${step.count}. Why did this step include or exclude patients?`);
    });
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });
  });
}

function workflowSteps(result) {
  const attritionCount = (prefix) => result.attrition.find((step) => step.label.startsWith(prefix))?.count ?? 0;
  return [
    { label: 'Has index event (T0)', count: result.indexEligibleCount },
    { label: 'After demographic filters', count: attritionCount('After demographic') },
    { label: 'After inclusion logic', count: attritionCount('After inclusion') },
    { label: 'After exclusion logic', count: attritionCount('After exclusion') },
    { label: 'Final cohort', count: result.finalCount, final: true }
  ];
}

function buildWorkflowSvg(steps) {
  const nodeWidth = 310;
  const nodeHeight = 62;
  const finalWidth = 360;
  const finalHeight = 76;
  const centerX = 340;
  const startY = 34;
  const gap = 105;
  const colors = {
    blue: { fill: '#dbeafe', stroke: '#2563eb', text: '#1e3a8a' },
    amber: { fill: '#fef3c7', stroke: '#d97706', text: '#92400e' },
    teal: { fill: '#ccfbf1', stroke: '#0f766e', text: '#134e4a' }
  };

  const nodes = steps.map((step, index) => {
    const previous = index === 0 ? step.count : steps[index - 1].count;
    const drop = Math.max(0, previous - step.count);
    const palette = step.final ? colors.teal : drop > 0 ? colors.amber : colors.blue;
    const width = step.final ? finalWidth : nodeWidth;
    const height = step.final ? finalHeight : nodeHeight;
    const x = centerX - width / 2;
    const y = startY + index * gap;
    return { ...step, index, drop, palette, width, height, x, y };
  });

  const arrows = nodes.slice(0, -1).map((node, index) => {
    const next = nodes[index + 1];
    const drop = Math.max(0, node.count - next.count);
    const badgeY = node.y + node.height + 18;
    const badgeTextY = badgeY + 16;
    const badge = drop > 0
      ? `<rect x="276" y="${badgeY}" width="128" height="24" rx="12" fill="#fef3c7" stroke="#d97706" stroke-width="0.5"/>
         <text x="340" y="${badgeTextY}" text-anchor="middle" font-size="12" fill="#92400e">▼ -${drop} excluded</text>`
      : `<text x="340" y="${badgeTextY}" text-anchor="middle" font-size="12" fill="#475569">▼ 0 excluded</text>`;
    return `
      <line x1="340" y1="${node.y + node.height}" x2="340" y2="${next.y - 12}" stroke="#64748b" stroke-width="1" marker-end="url(#arrowhead)"/>
      ${badge}
    `;
  }).join('');

  const nodeMarkup = nodes.map((node) => `
    <g class="workflow-node" data-step-index="${node.index}" role="button" tabindex="0" style="cursor:pointer">
      <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="10" fill="${node.palette.fill}" stroke="${node.palette.stroke}" stroke-width="0.5"/>
      <text x="340" y="${node.y + (node.final ? 30 : 25)}" text-anchor="middle" font-size="14" font-weight="700" fill="${node.palette.text}">${escapeSvg(node.label)}</text>
      <text x="340" y="${node.y + (node.final ? 53 : 45)}" text-anchor="middle" font-size="12" fill="${node.palette.text}">n = ${node.count}</text>
    </g>
  `).join('');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 620" role="img" aria-label="Cohort attrition workflow diagram">
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#64748b"></path>
        </marker>
      </defs>
      <rect x="0" y="0" width="680" height="620" fill="#fffaf0"/>
      ${arrows}
      ${nodeMarkup}
      <g aria-label="Legend">
        <rect x="74" y="572" width="16" height="16" fill="${colors.blue.fill}" stroke="${colors.blue.stroke}" stroke-width="0.5"/>
        <text x="98" y="585" font-size="12" fill="#334155">No patient drop</text>
        <rect x="254" y="572" width="16" height="16" fill="${colors.amber.fill}" stroke="${colors.amber.stroke}" stroke-width="0.5"/>
        <text x="278" y="585" font-size="12" fill="#334155">Patient drop</text>
        <rect x="414" y="572" width="16" height="16" fill="${colors.teal.fill}" stroke="${colors.teal.stroke}" stroke-width="0.5"/>
        <text x="438" y="585" font-size="12" fill="#334155">Final cohort</text>
      </g>
    </svg>
  `.trim();
}

function downloadSvg() {
  const svg = serializeWorkflowSvg();
  downloadBlob('cohort-attrition-workflow.svg', 'image/svg+xml;charset=utf-8', `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`);
}

async function downloadPng() {
  const svg = serializeWorkflowSvg();
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = 1360;
    canvas.height = 1240;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fffaf0';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) downloadBlob('cohort-attrition-workflow.png', 'image/png', blob);
    }, 'image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function serializeWorkflowSvg() {
  const rendered = els.workflowDiagram.querySelector('svg')?.outerHTML;
  return rendered || state.currentWorkflowSvg || buildWorkflowSvg([
    { label: 'Has index event (T0)', count: 0 },
    { label: 'After demographic filters', count: 0 },
    { label: 'After inclusion logic', count: 0 },
    { label: 'After exclusion logic', count: 0 },
    { label: 'Final cohort', count: 0, final: true }
  ]);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function downloadBlob(filename, type, content) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sendPrompt(prompt) {
  if (typeof window.sendPrompt === 'function') {
    window.sendPrompt(prompt);
    return;
  }
  window.dispatchEvent(new CustomEvent('cohort:sendPrompt', { detail: { prompt } }));
  console.info(prompt);
}

function renderSql() {
  const generated = buildSql(state.config);
  state.currentSql = generated.sql;
  els.generatedSql.innerHTML = highlightSql(generated.sql);
  els.sqlSummary.textContent = generated.summary;
}

function highlightSql(sql) {
  const escaped = escapeHtml(sql);
  return escaped.replace(
    /\b(WITH|AS|SELECT|DISTINCT|FROM|WHERE|JOIN|ON|AND|OR|EXISTS|NOT|IN|BETWEEN|DATEADD|DATEDIFF|YEAR|MONTH|GETDATE|CAST|NULL|GROUP BY|MIN|UNION ALL|TRY_CONVERT|COALESCE)\b/g,
    '<span class="sql-keyword">$1</span>'
  );
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeSvg(value = '') {
  return escapeHtml(value);
}

function filterGroup(children) {
  return createConditionGroup({ logic: 'AND', children });
}

function equals(field, value) {
  return createCondition({ field, operator: 'is', value });
}

function anyCode(values) {
  return createConditionGroup({
    logic: 'OR',
    children: values.map((value) => equals('code', value))
  });
}

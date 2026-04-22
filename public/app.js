import { defaultConfig, diabetesPresetConfig, evaluateCohort } from '../src/cohortEngine.js';
import { buildSql } from '../src/sqlBuilder.js';

const state = {
  data: null,
  conceptCatalog: {},
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
        domain: 'lab',
        query: 'HbA1c',
        concepts: [{ code: 'HBA1C', name: 'HbA1c' }],
        labOperator: '>=',
        labValue: 8
      }
    ],
    inclusionCriteria: [
      {
        id: 'inc-diabetes-around-lab',
        domain: 'diagnosis',
        label: 'Diabetes diagnosis within 90 days of lab T0',
        operator: 'any',
        query: 'E11',
        concepts: [
          { code: 'E11.9', name: 'Type 2 diabetes mellitus without complications' },
          { code: 'E11.65', name: 'Type 2 diabetes mellitus with hyperglycemia' },
          { code: 'E11.22', name: 'Type 2 diabetes mellitus with diabetic chronic kidney disease' }
        ],
        timing: 'within',
        daysBefore: 90,
        daysAfter: 90,
        value: ''
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
        domain: 'diagnosis',
        query: 'I63',
        concepts: [{ code: 'I63.9', name: 'Cerebral infarction unspecified' }],
        labOperator: '>=',
        labValue: ''
      }
    ],
    inclusionCriteria: [
      {
        id: 'inc-aspirin-after-stroke',
        domain: 'drug',
        label: 'Aspirin released within 14 days after T0',
        operator: 'any',
        query: 'aspirin',
        concepts: [{ code: 'ASP81', name: 'Aspirin 81 mg tablet' }],
        timing: 'after',
        daysBefore: 0,
        daysAfter: 14,
        value: ''
      }
    ],
    exclusionCriteria: []
  }
};

const els = {};

document.addEventListener('DOMContentLoaded', async () => {
  bindElements();
  state.data = await loadSyntheticData();
  state.conceptCatalog = buildConceptCatalog(state.data);
  writeConfigToForm(state.config);
  bindEvents();
  run();
});

async function loadSyntheticData() {
  const localResponse = await fetch('/data/synthetic-clinical-data.json');
  if (localResponse.ok) {
    return localResponse.json();
  }

  const exampleResponse = await fetch('/data/synthetic-clinical-data_example.json');
  if (!exampleResponse.ok) {
    throw new Error('Unable to load synthetic data.');
  }
  return exampleResponse.json();
}

function bindElements() {
  for (const id of [
    'question',
    'cohortForm',
    'addIndexCondition',
    'indexConditionList',
    'indexConditionTemplate',
    'indexFrom',
    'indexTo',
    'minAge',
    'maxAge',
    'sex',
    'inclusionList',
    'exclusionList',
    'criterionTemplate',
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
    'addExclusion'
  ]) {
    els[id] = document.getElementById(id);
  }
}

function bindEvents() {
  els.cohortForm.addEventListener('submit', (event) => {
    event.preventDefault();
    state.config = readConfigFromForm();
    run();
  });
  els.cohortForm.addEventListener('input', refreshSqlFromForm);
  els.cohortForm.addEventListener('change', refreshSqlFromForm);

  els.addIndexCondition.addEventListener('click', () => addIndexCondition());
  els.addInclusion.addEventListener('click', () => addCriterion('inclusionList'));
  els.addExclusion.addEventListener('click', () => addCriterion('exclusionList'));
  els.downloadSvg.addEventListener('click', () => downloadSvg());
  els.downloadPng.addEventListener('click', () => downloadPng());
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
      run();
    });
  });
}

function writeConfigToForm(config) {
  els.question.value = config.question || '';
  els.indexFrom.value = config.indexWindow.from || '';
  els.indexTo.value = config.indexWindow.to || '';
  els.minAge.value = config.demographics.minAge ?? '';
  els.maxAge.value = config.demographics.maxAge ?? '';
  els.sex.value = config.demographics.sex || 'Any';
  els.indexConditionList.replaceChildren();
  for (const indexCondition of normalizeIndexEvents(config)) addIndexCondition(indexCondition);
  els.inclusionList.replaceChildren();
  els.exclusionList.replaceChildren();
  for (const criterion of config.inclusionCriteria || []) addCriterion('inclusionList', criterion);
  for (const criterion of config.exclusionCriteria || []) addCriterion('exclusionList', criterion);
}

function readConfigFromForm() {
  return {
    question: els.question.value.trim(),
    indexEvents: readIndexConditions(),
    indexWindow: {
      from: els.indexFrom.value,
      to: els.indexTo.value
    },
    demographics: {
      minAge: els.minAge.value,
      maxAge: els.maxAge.value,
      sex: els.sex.value
    },
    inclusionCriteria: readCriteria(els.inclusionList),
    exclusionCriteria: readCriteria(els.exclusionList)
  };
}

function normalizeIndexEvents(config) {
  if (Array.isArray(config.indexEvents) && config.indexEvents.length > 0) return config.indexEvents;
  if (config.indexEvent) return [config.indexEvent];
  return [];
}

function readIndexConditions() {
  return [...els.indexConditionList.querySelectorAll('.index-condition')].map((node, index) => {
    const field = (name) => node.querySelector(`[data-field="${name}"]`).value;
    const concepts = readSelectedConcepts(node.querySelector('[data-field="concepts"]'));
    return {
      id: node.dataset.id || `index-${index}`,
      joiner: field('joiner'),
      domain: field('domain'),
      label: field('label') || `T0 ${field('domain')} ${conceptQuery(concepts)}`,
      query: conceptQuery(concepts),
      concepts,
      labOperator: field('labOperator'),
      labValue: field('labValue')
    };
  });
}

function readCriteria(container) {
  return [...container.querySelectorAll('.criterion')].map((criterion, index) => {
    const field = (name) => criterion.querySelector(`[data-field="${name}"]`).value;
    const concepts = readSelectedConcepts(criterion.querySelector('[data-field="concepts"]'));
    return {
      id: criterion.dataset.id || `criterion-${index}`,
      joiner: field('joiner'),
      domain: field('domain'),
      label: field('label') || `${field('domain')} ${conceptQuery(concepts)}`,
      operator: field('operator'),
      query: conceptQuery(concepts),
      concepts,
      timing: field('timing'),
      daysBefore: field('daysBefore'),
      daysAfter: field('daysAfter'),
      value: field('value')
    };
  });
}

function addCriterion(containerId, criterion = {}) {
  const fragment = els.criterionTemplate.content.cloneNode(true);
  const node = fragment.querySelector('.criterion');
  node.dataset.id = criterion.id || crypto.randomUUID();
  setCriterionField(node, 'domain', criterion.domain || 'diagnosis');
  setCriterionField(node, 'joiner', criterion.joiner || (containerId === 'exclusionList' ? 'OR' : 'AND'));
  setCriterionField(node, 'label', criterion.label || '');
  setCriterionField(node, 'operator', criterion.operator || 'any');
  setCriterionField(node, 'value', criterion.value ?? '');
  setCriterionField(node, 'timing', criterion.timing || 'within');
  setCriterionField(node, 'daysBefore', criterion.daysBefore ?? 365);
  setCriterionField(node, 'daysAfter', criterion.daysAfter ?? 365);
  populateCriterionConcepts(node, criterion.concepts || []);
  node.querySelector('[data-field="domain"]').addEventListener('change', () => populateCriterionConcepts(node, []));
  node.querySelector('.remove').addEventListener('click', () => node.remove());
  els[containerId].appendChild(fragment);
}

function addIndexCondition(indexCondition = {}) {
  const fragment = els.indexConditionTemplate.content.cloneNode(true);
  const node = fragment.querySelector('.index-condition');
  node.dataset.id = indexCondition.id || crypto.randomUUID();
  setCriterionField(node, 'domain', indexCondition.domain || 'diagnosis');
  setCriterionField(node, 'joiner', indexCondition.joiner || 'AND');
  setCriterionField(node, 'label', indexCondition.label || '');
  setCriterionField(node, 'labOperator', indexCondition.labOperator || '>=');
  setCriterionField(node, 'labValue', indexCondition.labValue ?? '');
  populateIndexConditionConcepts(node, indexCondition.concepts || []);
  updateIndexConditionLabVisibility(node);
  node.querySelector('[data-field="domain"]').addEventListener('change', () => {
    populateIndexConditionConcepts(node, []);
    updateIndexConditionLabVisibility(node);
  });
  node.querySelector('.remove').addEventListener('click', () => {
    if (els.indexConditionList.querySelectorAll('.index-condition').length > 1) {
      node.remove();
    }
  });
  els.indexConditionList.appendChild(fragment);
}

function setCriterionField(node, field, value) {
  node.querySelector(`[data-field="${field}"]`).value = value;
}

function run() {
  if (!state.data) return;
  const result = evaluateCohort(state.config, state.data);
  renderResult(result);
}

function buildConceptCatalog(data) {
  return {
    diagnosis: summarizeDomainConcepts(data.diagnosis_record || [], 'icd_code', 'disease_name'),
    lab: summarizeDomainConcepts(data.lab_result || [], 'test_code', 'test_name', 'test_group_name'),
    drug: summarizeDomainConcepts(data.prescription_order || [], 'drug_code', 'drug_name', 'drug_group_name')
  };
}

function summarizeDomainConcepts(rows, codeKey, nameKey, groupKey) {
  const concepts = new Map();
  for (const row of rows) {
    const concept = {
      code: row[codeKey],
      name: row[nameKey],
      groupName: groupKey ? row[groupKey] : '',
      count: 1
    };
    const key = encodeConcept(concept);
    if (concepts.has(key)) {
      concepts.get(key).count += 1;
    } else {
      concepts.set(key, concept);
    }
  }
  return [...concepts.values()].sort((a, b) => a.code.localeCompare(b.code));
}

function populateCriterionConcepts(node, selectedConcepts) {
  const domain = node.querySelector('[data-field="domain"]').value;
  const select = node.querySelector('[data-field="concepts"]');
  populateConceptSelect(select, domain, selectedConcepts);
  renderConceptPicker(node.querySelector('[data-field="conceptPicker"]'), select, domain, () => {
    renderCriterionPreview(node);
    refreshSqlFromForm();
  });
  renderCriterionPreview(node);
}

function populateIndexConditionConcepts(node, selectedConcepts) {
  const domain = node.querySelector('[data-field="domain"]').value;
  const select = node.querySelector('[data-field="concepts"]');
  populateConceptSelect(select, domain, selectedConcepts);
  renderConceptPicker(node.querySelector('[data-field="conceptPicker"]'), select, domain, () => {
    renderCriterionPreview(node);
    refreshSqlFromForm();
  });
  renderCriterionPreview(node);
}

function updateIndexConditionLabVisibility(node) {
  const show = node.querySelector('[data-field="domain"]').value === 'lab';
  node.querySelectorAll('.lab-only-condition').forEach((field) => {
    field.style.display = show ? 'grid' : 'none';
  });
}

function populateConceptSelect(select, domain, selectedConcepts = []) {
  const selected = new Set(selectedConcepts.map(encodeConcept));
  select.replaceChildren(
    ...(state.conceptCatalog[domain] || []).map((concept) => {
      const option = document.createElement('option');
      option.value = encodeConcept(concept);
      option.selected = selected.has(option.value);
      option.textContent = `${concept.code} - ${concept.name} (${concept.count})`;
      return option;
    })
  );
}

function readSelectedConcepts(select) {
  return [...select.selectedOptions].map((option) => decodeConcept(option.value));
}

function renderConceptPicker(container, select, domain, onApply) {
  const concepts = state.conceptCatalog[domain] || [];
  const selected = new Set(readSelectedConcepts(select).map(encodeConcept));
  const appliedLabel = selected.size > 0 ? `${selected.size} selected` : `Choose ${domain} concepts`;

  container.innerHTML = `
    <details>
      <summary>${escapeHtml(appliedLabel)}</summary>
      <div class="concept-menu">
        <input class="concept-search" type="search" placeholder="Search code or name">
        <div class="concept-bulk-actions">
          <button type="button" data-action="select-visible">Select visible</button>
          <button type="button" data-action="clear-visible">Clear visible</button>
          <button type="button" data-action="clear-all">Clear all</button>
        </div>
        <p class="concept-match-count"></p>
        <div class="concept-option-list">
          ${concepts.map((concept) => {
            const key = encodeConcept(concept);
            return `
              <label class="concept-option" data-search="${escapeHtml(`${concept.code} ${concept.name} ${concept.groupName || ''}`.toLowerCase())}">
                <input type="checkbox" value="${escapeHtml(key)}" ${selected.has(key) ? 'checked' : ''}>
                <span>
                  <strong>${escapeHtml(concept.code)}</strong>
                  <small>${escapeHtml(concept.name)} · n=${concept.count}</small>
                </span>
              </label>
            `;
          }).join('')}
        </div>
        <button type="button" class="apply-concepts">Apply selection</button>
      </div>
    </details>
  `;

  const search = container.querySelector('.concept-search');
  const matchCount = container.querySelector('.concept-match-count');
  const options = [...container.querySelectorAll('.concept-option')];
  const updateFilter = () => {
    const term = search.value.trim().toLowerCase();
    let visibleCount = 0;
    for (const option of options) {
      const isVisible = !term || option.dataset.search.includes(term);
      option.hidden = !isVisible;
      if (isVisible) visibleCount += 1;
    }
    matchCount.textContent = `${visibleCount} visible of ${options.length} concepts`;
  };
  search.addEventListener('input', () => {
    updateFilter();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });
  container.querySelector('[data-action="select-visible"]').addEventListener('click', () => {
    for (const option of options.filter((item) => !item.hidden)) {
      option.querySelector('input').checked = true;
    }
  });
  container.querySelector('[data-action="clear-visible"]').addEventListener('click', () => {
    for (const option of options.filter((item) => !item.hidden)) {
      option.querySelector('input').checked = false;
    }
  });
  container.querySelector('[data-action="clear-all"]').addEventListener('click', () => {
    for (const option of options) {
      option.querySelector('input').checked = false;
    }
  });
  container.querySelector('.apply-concepts').addEventListener('click', () => {
    const checked = new Set([...container.querySelectorAll('input[type="checkbox"]:checked')].map((checkbox) => checkbox.value));
    for (const option of select.options) {
      option.selected = checked.has(option.value);
    }
    onApply();
    renderConceptPicker(container, select, domain, onApply);
  });
  updateFilter();
}

function renderCriterionPreview(node) {
  const domain = node.querySelector('[data-field="domain"]').value;
  const selected = readSelectedConcepts(node.querySelector('[data-field="concepts"]'));
  renderConceptPreview(node.querySelector('[data-field="conceptPreview"]'), domain, selected);
}

function renderConceptPreview(container, domain, selectedConcepts) {
  const all = state.conceptCatalog[domain] || [];
  const mode = selectedConcepts.length > 0 ? `${selectedConcepts.length} selected` : 'No selection yet';

  container.innerHTML = `
    <strong>${mode} ${domain} concepts</strong>
    <div class="concept-chips">
      <span class="concept-chip muted">${selectedConcepts.length > 0 ? 'Selection applied' : `${all.length} available in dropdown`}</span>
    </div>
  `;
}

function conceptQuery(concepts) {
  return concepts.map((concept) => concept.code).join(' ');
}

function encodeConcept(concept) {
  return `${concept.code || ''}\u001f${concept.name || ''}`;
}

function decodeConcept(value) {
  const [code, name] = value.split('\u001f');
  return { code, name };
}

function renderResult(result) {
  els.heroCount.textContent = result.finalCount;
  els.heroContext.textContent = `${result.indexEligibleCount} patients have a matching T0 index event`;
  els.indexEligible.textContent = result.indexEligibleCount;
  els.finalCount.textContent = result.finalCount;
  renderAttrition(result);
  renderWorkflowDiagram(result);
  renderSql();
}

function refreshSqlFromForm() {
  state.config = readConfigFromForm();
  renderSql();
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
    /\b(WITH|AS|SELECT|DISTINCT|FROM|WHERE|JOIN|ON|AND|OR|EXISTS|NOT|IN|BETWEEN|DATEADD|DATEDIFF|YEAR|GETDATE|CAST|NULL|GROUP BY|MIN|UNION ALL)\b/g,
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

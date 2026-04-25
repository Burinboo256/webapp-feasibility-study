import {
  FILTER_FIELDS,
  createCondition,
  createConditionGroup,
  defaultValueForCondition,
  fieldOptions,
  normalizeConditionGroup,
  operatorsForField,
  validateConditionGroup
} from '/src/advancedConditions.js';
import { shouldRerenderForAction } from '/src/filterBuilderBehavior.js';
import { defaultFieldForNewCondition } from '/src/filterBuilderDefaults.js';

export function createFilterBuilder({ container, allowedFields, value, onChange }) {
  const state = {
    allowedFields,
    tree: normalizeConditionGroup(value || createConditionGroup(), { allowedFields }),
    onChange
  };

  container.addEventListener('click', (event) => handleClick(event, state));
  container.addEventListener('input', (event) => handleInput(event, state));
  container.addEventListener('change', (event) => handleInput(event, state));
  render(container, state);

  return {
    getValue() {
      return structuredClone(state.tree);
    },
    setValue(nextValue) {
      state.tree = normalizeConditionGroup(nextValue || createConditionGroup(), { allowedFields });
      render(container, state);
      state.onChange?.(structuredClone(state.tree));
    }
  };
}

function handleClick(event, state) {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  const path = parsePath(event.target.closest('[data-path]')?.dataset.path || '');

  if (action === 'add-condition') {
    mutateTree(state, path, (node) => {
      node.children.push(createCondition({
        field: defaultFieldForNewCondition({
          allowedFields: state.allowedFields,
          existingChildren: node.children.length
        })
      }));
    });
    return;
  }

  if (action === 'add-group') {
    mutateTree(state, path, (node) => {
      node.children.push(createConditionGroup());
    });
    return;
  }

  if (action === 'delete-group' || action === 'delete-condition') {
    removeAtPath(state, path);
    return;
  }

  if (action === 'multi-toggle') {
    const value = event.target.dataset.optionValue || '';
    mutateTree(state, path, (node) => {
      const values = Array.isArray(node.value) ? [...node.value] : [];
      const index = values.indexOf(value);
      if (index >= 0) {
        values.splice(index, 1);
      } else {
        values.push(value);
      }
      node.value = values;
    });
    return;
  }

}

function handleInput(event, state) {
  const action = event.target.dataset.action;
  if (!action) return;
  const path = parsePath(event.target.closest('[data-path]')?.dataset.path || '');

  if (action === 'group-logic') {
    mutateTree(state, path, (node) => {
      node.logic = event.target.value === 'OR' ? 'OR' : 'AND';
    }, { render: shouldRerenderForAction(action) });
    return;
  }

  if (action === 'condition-field') {
    mutateTree(state, path, (node) => {
      node.field = event.target.value;
      node.operator = operatorsForField(node.field)[0].value;
      node.value = defaultValueForCondition(node.field, node.operator);
    }, { render: shouldRerenderForAction(action) });
    return;
  }

  if (action === 'condition-operator') {
    mutateTree(state, path, (node) => {
      node.operator = event.target.value;
      node.value = defaultValueForCondition(node.field, node.operator);
    }, { render: shouldRerenderForAction(action) });
    return;
  }

  if (action === 'condition-value') {
    mutateTree(state, path, (node) => {
      node.value = event.target.value;
    }, { render: shouldRerenderForAction(action) });
    return;
  }

  if (action === 'condition-range-from' || action === 'condition-range-to') {
    mutateTree(state, path, (node) => {
      node.value = {
        from: node.value?.from ?? '',
        to: node.value?.to ?? ''
      };
      node.value[action === 'condition-range-from' ? 'from' : 'to'] = event.target.value;
    }, { render: shouldRerenderForAction(action) });
  }
}

function mutateTree(state, path, updater, options = {}) {
  const next = structuredClone(state.tree);
  const node = getNode(next, path);
  if (!node) return;
  updater(node, next);
  state.tree = next;
  commitState(state, options);
}

function removeAtPath(state, path) {
  if (path.length === 0) return;
  const next = structuredClone(state.tree);
  const parent = getNode(next, path.slice(0, -1));
  const index = path[path.length - 1];
  if (!parent?.children || index < 0 || index >= parent.children.length) return;
  parent.children.splice(index, 1);
  state.tree = next;
  commitState(state);
}

function commitState(state, options = {}) {
  if (options.render !== false) {
    render(state.container || state.host || null, state);
  }
  state.onChange?.(structuredClone(state.tree));
}

function render(container, state) {
  state.container = container;
  const errors = validateConditionGroup(state.tree, { allowedFields: state.allowedFields });
  container.innerHTML = `
    <div class="filter-builder">
      ${renderGroup(state.tree, state.allowedFields, [], true)}
      ${errors.length > 0 ? `<div class="filter-errors">${errors.map((error) => `<p>${escapeHtml(error)}</p>`).join('')}</div>` : ''}
    </div>
  `;
}

function renderGroup(group, allowedFields, path, isRoot = true, context = {}) {
  const currentPath = stringifyPath(path);
  const emptyState = group.children.length === 0
    ? '<div class="filter-empty">No conditions yet. Add a condition or a nested group.</div>'
    : group.children.map((child, index) => (
      child.type === 'group'
        ? renderGroup(child, allowedFields, [...path, index], false, context)
        : renderCondition(child, allowedFields, [...path, index], context)
    )).join('');

  return `
    <section class="filter-group ${isRoot ? 'filter-group-root' : ''}" data-path="${currentPath}">
      <div class="filter-group-header">
        <div class="filter-group-logic">
          <span>Match</span>
          <select data-action="group-logic" aria-label="Group logic">
            <option value="AND" ${group.logic === 'AND' ? 'selected' : ''}>AND</option>
            <option value="OR" ${group.logic === 'OR' ? 'selected' : ''}>OR</option>
          </select>
          <span>conditions</span>
        </div>
        <div class="filter-group-actions">
          <button type="button" class="small" data-action="add-condition">Add condition</button>
          <button type="button" class="small" data-action="add-group">Add condition group</button>
          ${isRoot ? '' : '<button type="button" class="ghost danger" data-action="delete-group">Delete group</button>'}
        </div>
      </div>
      <div class="filter-group-body">${emptyState}</div>
    </section>
  `;
}

function renderCondition(condition, allowedFields, path, context = {}) {
  const fieldList = availableFieldOptions(allowedFields, context, condition);
  const field = FILTER_FIELDS[condition.field] || fieldList[0];
  const operators = operatorsForField(field.key);
  return `
    <div class="filter-condition" data-path="${stringifyPath(path)}">
      <select data-action="condition-field" aria-label="Field selector">
        ${fieldList.map((item) => `<option value="${item.key}" ${item.key === condition.field ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
      </select>
      <select data-action="condition-operator" aria-label="Operator selector">
        ${operators.map((item) => `<option value="${item.value}" ${item.value === condition.operator ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
      </select>
      <div class="filter-condition-value">
        ${renderValueInput(condition, field)}
      </div>
      <button type="button" class="ghost danger" data-action="delete-condition">Delete condition</button>
    </div>
  `;
}

function renderValueInput(condition, field) {
  const operator = operatorsForField(field.key).find((item) => item.value === condition.operator);
  if (!operator?.needsValue) {
    return '<span class="filter-value-hint">No value</span>';
  }

  if (operator.valueMode === 'range') {
    const type = field.type === 'date' ? 'date' : 'number';
    return `
      <div class="filter-range">
        <input data-action="condition-range-from" type="${type}" value="${escapeAttribute(condition.value?.from || '')}" placeholder="From">
        <span>and</span>
        <input data-action="condition-range-to" type="${type}" value="${escapeAttribute(condition.value?.to || '')}" placeholder="To">
      </div>
    `;
  }

  if (field.type === 'select' && operator.valueMode === 'multi') {
    const values = Array.isArray(condition.value) ? condition.value : [];
    return `
      <div class="filter-multi-select">
        ${field.options.map((option) => `
          <button
            type="button"
            class="filter-option-chip ${values.includes(option.value) ? 'selected' : ''}"
            data-action="multi-toggle"
            data-option-value="${escapeAttribute(option.value)}"
          >${escapeHtml(option.label)}</button>
        `).join('')}
      </div>
    `;
  }

  if (field.type === 'select') {
    return `
      <select data-action="condition-value" aria-label="Value input">
        <option value="">Select...</option>
        ${field.options.map((option) => `<option value="${escapeAttribute(option.value)}" ${option.value === condition.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
      </select>
    `;
  }

  const inputType = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
  const step = field.type === 'number' ? ' step="0.1"' : '';
  return `<input data-action="condition-value" type="${inputType}"${step} value="${escapeAttribute(condition.value || '')}" placeholder="Value">`;
}

function getNode(node, path) {
  return path.reduce((current, index) => current?.children?.[index] || null, node);
}

function parsePath(value) {
  if (!value) return [];
  return value.split('.').map((part) => Number(part));
}

function stringifyPath(path) {
  return path.join('.');
}

function availableFieldOptions(allowedFields, context = {}, condition = null) {
  const keys = availableFieldKeys(allowedFields, context);
  if (condition?.field && !keys.includes(condition.field) && FILTER_FIELDS[condition.field]) {
    keys.unshift(condition.field);
  }
  return keys.map((key) => FILTER_FIELDS[key]).filter(Boolean);
}

function availableFieldKeys(allowedFields, context = {}) {
  return [...allowedFields];
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

const TEXT_OPERATORS = [
  { value: 'contains', label: 'contains', needsValue: true },
  { value: 'does_not_contain', label: 'does not contain', needsValue: true },
  { value: 'is', label: 'is', needsValue: true },
  { value: 'is_not', label: 'is not', needsValue: true },
  { value: 'is_empty', label: 'is empty', needsValue: false },
  { value: 'is_not_empty', label: 'is not empty', needsValue: false },
  { value: 'starts_with', label: 'starts with', needsValue: true },
  { value: 'ends_with', label: 'ends with', needsValue: true }
];

const NUMBER_OPERATORS = [
  { value: 'is', label: 'is', needsValue: true },
  { value: 'is_not', label: 'is not', needsValue: true },
  { value: 'greater_than', label: 'greater than', needsValue: true },
  { value: 'less_than', label: 'less than', needsValue: true },
  { value: 'greater_than_or_equal', label: 'greater than or equal', needsValue: true },
  { value: 'less_than_or_equal', label: 'less than or equal', needsValue: true },
  { value: 'between', label: 'between', needsValue: true, valueMode: 'range' },
  { value: 'is_empty', label: 'is empty', needsValue: false }
];

const DATE_OPERATORS = [
  { value: 'exact_date', label: 'exact date', needsValue: true },
  { value: 'before', label: 'before', needsValue: true },
  { value: 'after', label: 'after', needsValue: true },
  { value: 'on_or_before', label: 'on or before', needsValue: true },
  { value: 'on_or_after', label: 'on or after', needsValue: true },
  { value: 'between', label: 'between', needsValue: true, valueMode: 'range' },
  { value: 'today', label: 'today', needsValue: false },
  { value: 'this_month', label: 'this month', needsValue: false }
];

const SELECT_OPERATORS = [
  { value: 'is', label: 'is', needsValue: true },
  { value: 'is_not', label: 'is not', needsValue: true },
  { value: 'is_any_of', label: 'is any of', needsValue: true, valueMode: 'multi' },
  { value: 'is_none_of', label: 'is none of', needsValue: true, valueMode: 'multi' },
  { value: 'is_empty', label: 'is empty', needsValue: false }
];

export const FIELD_OPERATORS = Object.freeze({
  text: TEXT_OPERATORS,
  number: NUMBER_OPERATORS,
  date: DATE_OPERATORS,
  select: SELECT_OPERATORS
});

export const FILTER_FIELDS = Object.freeze({
  domain: {
    key: 'domain',
    label: 'Domain',
    type: 'select',
    options: [
      { value: 'diagnosis', label: 'Diagnosis' },
      { value: 'lab', label: 'Lab' },
      { value: 'drug', label: 'Drug' }
    ]
  },
  code: {
    key: 'code',
    label: 'Code',
    type: 'text'
  },
  name: {
    key: 'name',
    label: 'Name',
    type: 'text'
  },
  groupName: {
    key: 'groupName',
    label: 'Group name',
    type: 'text'
  },
  eventDate: {
    key: 'eventDate',
    label: 'Event date',
    type: 'date'
  },
  numericValue: {
    key: 'numericValue',
    label: 'Numeric value',
    type: 'number'
  },
  rawValue: {
    key: 'rawValue',
    label: 'Raw value',
    type: 'text'
  },
  patientCategory: {
    key: 'patientCategory',
    label: 'Patient category',
    type: 'select',
    options: [
      { value: 'OPD', label: 'OPD' },
      { value: 'IPD', label: 'IPD' },
      { value: 'eHIS', label: 'eHIS' }
    ]
  },
  ageAtEvent: {
    key: 'ageAtEvent',
    label: 'Age at event',
    type: 'number'
  },
  daysFromT0: {
    key: 'daysFromT0',
    label: 'Days from T0',
    type: 'number'
  }
});

export const FILTER_FIELDSETS = Object.freeze({
  index: ['domain', 'code', 'name', 'groupName', 'eventDate', 'numericValue', 'rawValue', 'patientCategory', 'ageAtEvent'],
  criteria: ['domain', 'code', 'name', 'groupName', 'eventDate', 'numericValue', 'rawValue', 'patientCategory', 'ageAtEvent', 'daysFromT0']
});

export function createCondition(overrides = {}) {
  const field = overrides.field || 'code';
  const operator = overrides.operator || defaultOperatorForField(field);
  return {
    type: 'condition',
    id: overrides.id || cryptoId(),
    field,
    operator,
    value: overrides.value === undefined ? defaultValueForCondition(field, operator) : normalizeConditionValue(overrides.value, field, operator)
  };
}

export function createConditionGroup(overrides = {}) {
  return {
    type: 'group',
    id: overrides.id || cryptoId(),
    logic: normalizeLogic(overrides.logic || 'AND'),
    children: Array.isArray(overrides.children) ? overrides.children.map(normalizeTreeNode).filter(Boolean) : []
  };
}

export function normalizeRule(rule = {}, options = {}) {
  const allowedFields = normalizeAllowedFields(options.allowedFields);
  const legacyMode = options.legacyMode || 'criteria';
  const defaultJoiner = options.defaultJoiner || 'AND';
  const filter = rule.filter
    ? normalizeConditionGroup(rule.filter, { allowedFields })
    : buildLegacyFilter(rule, { allowedFields, legacyMode });

  return {
    id: rule.id || cryptoId(),
    joiner: normalizeLogic(rule.joiner || defaultJoiner),
    label: rule.label || '',
    filter
  };
}

export function normalizeConditionGroup(group, options = {}) {
  const normalized = normalizeTreeNode(group, options);
  if (normalized?.type === 'group') return normalized;
  return createConditionGroup();
}

export function validateConditionGroup(group, options = {}) {
  const allowedFields = normalizeAllowedFields(options.allowedFields);
  const errors = [];
  visitTree(normalizeConditionGroup(group, { allowedFields }), (node, path) => {
    if (node.type === 'group') {
      if (!['AND', 'OR'].includes(node.logic)) {
        errors.push(`${path}: unsupported group logic "${node.logic}"`);
      }
      return;
    }

    const field = FILTER_FIELDS[node.field];
    if (!field || !allowedFields.includes(node.field)) {
      errors.push(`${path}: field "${node.field}" is not allowed`);
      return;
    }

    const operator = operatorDefinition(field.type, node.operator);
    if (!operator) {
      errors.push(`${path}: operator "${node.operator}" is not allowed for ${field.type}`);
      return;
    }

    if (operator.needsValue && !hasValue(node.value, operator.valueMode)) {
      errors.push(`${path}: ${field.label} ${operator.label} requires a value`);
    }
  });
  return errors;
}

export function isConditionGroupActive(group) {
  let active = false;
  visitTree(normalizeConditionGroup(group), (node) => {
    if (node.type !== 'condition') return;
    const field = FILTER_FIELDS[node.field];
    if (!field) return;
    const operator = operatorDefinition(field.type, node.operator);
    if (!operator) return;
    if (!operator.needsValue || hasValue(node.value, operator.valueMode)) {
      active = true;
    }
  });
  return active;
}

export function evaluateConditionGroup(group, record, options = {}) {
  const allowedFields = normalizeAllowedFields(options.allowedFields);
  const errors = validateConditionGroup(group, { allowedFields });
  if (errors.length > 0) {
    throw new Error(`Invalid condition group: ${errors[0]}`);
  }

  return evaluateNode(normalizeConditionGroup(group, { allowedFields }), record, options);
}

export function defaultOperatorForField(fieldKey) {
  const field = FILTER_FIELDS[fieldKey] || FILTER_FIELDS.code;
  return FIELD_OPERATORS[field.type][0].value;
}

export function defaultValueForCondition(fieldKey, operator) {
  const field = FILTER_FIELDS[fieldKey] || FILTER_FIELDS.code;
  const definition = operatorDefinition(field.type, operator) || FIELD_OPERATORS[field.type][0];
  if (!definition.needsValue) return null;
  if (definition.valueMode === 'range') return { from: '', to: '' };
  if (definition.valueMode === 'multi') return [];
  return '';
}

export function operatorsForField(fieldKey) {
  const field = FILTER_FIELDS[fieldKey] || FILTER_FIELDS.code;
  return FIELD_OPERATORS[field.type];
}

export function fieldOptions(allowedFields) {
  return normalizeAllowedFields(allowedFields).map((key) => FILTER_FIELDS[key]).filter(Boolean);
}

export function conditionValuesFromTree(group, fields = ['code', 'name']) {
  const selected = [];
  visitTree(normalizeConditionGroup(group), (node) => {
    if (node.type !== 'condition' || !fields.includes(node.field)) return;
    const field = FILTER_FIELDS[node.field];
    const operator = field ? operatorDefinition(field.type, node.operator) : null;
    if (operator?.needsValue && typeof node.value === 'string' && node.value.trim()) {
      selected.push({ field: node.field, operator: node.operator, value: node.value.trim() });
    }
    if ((node.operator === 'is_any_of' || node.operator === 'is_none_of') && Array.isArray(node.value)) {
      for (const value of node.value) {
        if (String(value).trim()) {
          selected.push({ field: node.field, operator: node.operator, value: String(value).trim() });
        }
      }
    }
  });
  return selected;
}

function buildLegacyFilter(rule, options) {
  const allowedFields = normalizeAllowedFields(options.allowedFields);
  const children = [];

  if (rule.domain && allowedFields.includes('domain')) {
    children.push(createCondition({ field: 'domain', operator: 'is', value: rule.domain }));
  }

  const concepts = Array.isArray(rule.concepts) ? rule.concepts.filter((concept) => concept?.code || concept?.name) : [];
  if (concepts.length > 0) {
    const conceptChildren = concepts.map((concept) => createCondition({
      field: concept.code ? 'code' : 'name',
      operator: 'is',
      value: concept.code || concept.name
    }));
    children.push(createConditionGroup({ logic: 'OR', children: conceptChildren }));
  } else if (rule.query) {
    children.push(createConditionGroup({
      logic: 'OR',
      children: ['code', 'name', 'groupName']
        .filter((field) => allowedFields.includes(field))
        .map((field) => createCondition({ field, operator: 'contains', value: rule.query }))
    }));
  }

  if (rule.labValue !== '' && rule.labValue !== null && rule.labValue !== undefined && allowedFields.includes('numericValue')) {
    children.push(createCondition({
      field: 'numericValue',
      operator: legacyNumericOperator(rule.labOperator),
      value: String(rule.labValue)
    }));
  }

  if (rule.value !== '' && rule.value !== null && rule.value !== undefined && allowedFields.includes('numericValue')) {
    children.push(createCondition({
      field: 'numericValue',
      operator: legacyNumericOperator(rule.operator),
      value: String(rule.value)
    }));
  }

  if (options.legacyMode === 'criteria' && allowedFields.includes('daysFromT0')) {
    const timingGroup = legacyTimingCondition(rule);
    if (timingGroup) children.push(timingGroup);
  }

  return createConditionGroup({ logic: 'AND', children });
}

function legacyTimingCondition(rule) {
  const before = String(rule.daysBefore ?? '');
  const after = String(rule.daysAfter ?? '');
  if (rule.timing === 'before') {
    return createCondition({ field: 'daysFromT0', operator: 'between', value: { from: negateValue(before), to: '0' } });
  }
  if (rule.timing === 'after') {
    return createCondition({ field: 'daysFromT0', operator: 'between', value: { from: '0', to: after || '0' } });
  }
  if (rule.timing === 'within') {
    return createCondition({ field: 'daysFromT0', operator: 'between', value: { from: negateValue(before), to: after || '0' } });
  }
  return null;
}

function negateValue(value) {
  if (value === '' || value === null || value === undefined) return '';
  return String(-Math.abs(Number(value || 0)));
}

function legacyNumericOperator(operator) {
  switch (operator) {
    case '>':
      return 'greater_than';
    case '>=':
      return 'greater_than_or_equal';
    case '<':
      return 'less_than';
    case '<=':
      return 'less_than_or_equal';
    case '=':
      return 'is';
    default:
      return 'is';
  }
}

function normalizeTreeNode(node, options = {}) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'condition') {
    const field = FILTER_FIELDS[node.field] ? node.field : 'code';
    const operator = FILTER_FIELDS[field] ? (node.operator || defaultOperatorForField(field)) : defaultOperatorForField('code');
    return {
      type: 'condition',
      id: node.id || cryptoId(),
      field,
      operator,
      value: normalizeConditionValue(node.value, field, operator)
    };
  }

  const children = Array.isArray(node.children)
    ? node.children.map((child) => normalizeTreeNode(child, options)).filter(Boolean)
    : [];
  return {
    type: 'group',
    id: node.id || cryptoId(),
    logic: normalizeLogic(node.logic || 'AND'),
    children
  };
}

function normalizeConditionValue(value, fieldKey, operator) {
  const field = FILTER_FIELDS[fieldKey] || FILTER_FIELDS.code;
  const definition = operatorDefinition(field.type, operator) || FIELD_OPERATORS[field.type][0];
  if (!definition.needsValue) return null;
  if (definition.valueMode === 'range') {
    return {
      from: value?.from ?? '',
      to: value?.to ?? ''
    };
  }
  if (definition.valueMode === 'multi') {
    return Array.isArray(value) ? value.map(String) : [];
  }
  return value === null || value === undefined ? '' : String(value);
}

function operatorDefinition(type, operator) {
  return (FIELD_OPERATORS[type] || []).find((item) => item.value === operator) || null;
}

function hasValue(value, mode) {
  if (mode === 'range') {
    return Boolean(String(value?.from ?? '').trim() || String(value?.to ?? '').trim());
  }
  if (mode === 'multi') {
    return Array.isArray(value) && value.some((item) => String(item).trim());
  }
  return Boolean(String(value ?? '').trim());
}

function evaluateNode(node, record, options) {
  if (node.type === 'condition') {
    return evaluateCondition(node, record, options);
  }

  if (!node.children.length) return true;
  return node.children
    .map((child) => evaluateNode(child, record, options))
    .reduce((result, value, index) => (index === 0 ? value : node.logic === 'OR' ? result || value : result && value), node.logic === 'AND');
}

function evaluateCondition(node, record, options) {
  const field = FILTER_FIELDS[node.field];
  const actual = record?.[node.field];
  if (field.type === 'text') return evaluateText(actual, node.operator, node.value);
  if (field.type === 'number') return evaluateNumber(actual, node.operator, node.value);
  if (field.type === 'date') return evaluateDate(actual, node.operator, node.value, options.now);
  return evaluateSelect(actual, node.operator, node.value);
}

function evaluateText(actual, operator, value) {
  const normalized = String(actual ?? '').toLowerCase();
  const expected = String(value ?? '').toLowerCase();
  switch (operator) {
    case 'contains':
      return normalized.includes(expected);
    case 'does_not_contain':
      return !normalized.includes(expected);
    case 'is':
      return normalized === expected;
    case 'is_not':
      return normalized !== expected;
    case 'is_empty':
      return normalized.trim() === '';
    case 'is_not_empty':
      return normalized.trim() !== '';
    case 'starts_with':
      return normalized.startsWith(expected);
    case 'ends_with':
      return normalized.endsWith(expected);
    default:
      return false;
  }
}

function evaluateNumber(actual, operator, value) {
  const actualNumber = toNumber(actual);
  if (operator === 'is_empty') return actualNumber === null;
  if (actualNumber === null) return false;
  if (operator === 'between') {
    const from = toNumber(value?.from);
    const to = toNumber(value?.to);
    if (from === null && to === null) return false;
    if (from !== null && actualNumber < from) return false;
    if (to !== null && actualNumber > to) return false;
    return true;
  }

  const expected = toNumber(value);
  if (expected === null) return false;
  switch (operator) {
    case 'is':
      return actualNumber === expected;
    case 'is_not':
      return actualNumber !== expected;
    case 'greater_than':
      return actualNumber > expected;
    case 'less_than':
      return actualNumber < expected;
    case 'greater_than_or_equal':
      return actualNumber >= expected;
    case 'less_than_or_equal':
      return actualNumber <= expected;
    default:
      return false;
  }
}

function evaluateDate(actual, operator, value, now = new Date()) {
  const actualDate = toDateOnly(actual);
  if (!actualDate) return false;
  if (operator === 'today') return actualDate === toDateOnly(now);
  if (operator === 'this_month') return actualDate.slice(0, 7) === toDateOnly(now).slice(0, 7);
  if (operator === 'between') {
    const from = toDateOnly(value?.from);
    const to = toDateOnly(value?.to);
    if (from && actualDate < from) return false;
    if (to && actualDate > to) return false;
    return Boolean(from || to);
  }

  const expected = toDateOnly(value);
  if (!expected) return false;
  switch (operator) {
    case 'exact_date':
      return actualDate === expected;
    case 'before':
      return actualDate < expected;
    case 'after':
      return actualDate > expected;
    case 'on_or_before':
      return actualDate <= expected;
    case 'on_or_after':
      return actualDate >= expected;
    default:
      return false;
  }
}

function evaluateSelect(actual, operator, value) {
  const normalized = String(actual ?? '');
  if (operator === 'is_empty') return normalized.trim() === '';
  if (operator === 'is_any_of') return Array.isArray(value) && value.includes(normalized);
  if (operator === 'is_none_of') return !Array.isArray(value) || !value.includes(normalized);
  if (operator === 'is') return normalized === String(value ?? '');
  if (operator === 'is_not') return normalized !== String(value ?? '');
  return false;
}

function visitTree(node, visitor, path = 'group') {
  visitor(node, path);
  if (node.type !== 'group') return;
  node.children.forEach((child, index) => {
    visitTree(child, visitor, `${path}.${child.type}[${index}]`);
  });
}

function normalizeAllowedFields(allowedFields) {
  return Array.isArray(allowedFields) && allowedFields.length > 0
    ? allowedFields.filter((field) => FILTER_FIELDS[field])
    : FILTER_FIELDSETS.criteria;
}

function normalizeLogic(value) {
  return String(value || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND';
}

function toNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const stringValue = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) return stringValue;
  const date = new Date(stringValue);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function cryptoId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cond-${Math.random().toString(36).slice(2, 10)}`;
}

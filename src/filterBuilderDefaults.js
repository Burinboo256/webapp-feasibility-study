export function defaultFieldForNewCondition({ allowedFields = [], existingChildren = 0 } = {}) {
  const visibleFields = Array.isArray(allowedFields) ? [...allowedFields] : [];

  if (existingChildren > 0 && visibleFields.includes('code')) {
    return 'code';
  }

  if (visibleFields.includes('domain')) {
    return 'domain';
  }

  return visibleFields[0] || 'code';
}

const NON_RENDERING_INPUT_ACTIONS = new Set([
  'condition-value',
  'condition-range-from',
  'condition-range-to'
]);

export function shouldRerenderForAction(action = '') {
  return !NON_RENDERING_INPUT_ACTIONS.has(action);
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldRerenderForAction } from '../src/filterBuilderBehavior.js';

test('keeps value typing actions from rerendering the filter builder', () => {
  assert.equal(shouldRerenderForAction('condition-value'), false);
  assert.equal(shouldRerenderForAction('condition-range-from'), false);
  assert.equal(shouldRerenderForAction('condition-range-to'), false);
});

test('rerenders the filter builder for structural actions', () => {
  assert.equal(shouldRerenderForAction('condition-field'), true);
  assert.equal(shouldRerenderForAction('condition-operator'), true);
  assert.equal(shouldRerenderForAction('group-logic'), true);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultFieldForNewCondition } from '../src/filterBuilderDefaults.js';

test('defaults the first condition to domain when available', () => {
  assert.equal(defaultFieldForNewCondition({
    allowedFields: ['domain', 'code', 'name'],
    existingChildren: 0
  }), 'domain');
});

test('defaults the second and later conditions to code when available', () => {
  assert.equal(defaultFieldForNewCondition({
    allowedFields: ['domain', 'code', 'name'],
    existingChildren: 1
  }), 'code');

  assert.equal(defaultFieldForNewCondition({
    allowedFields: ['domain', 'code', 'name'],
    existingChildren: 4
  }), 'code');
});

test('falls back to the first allowed field when code and domain are unavailable', () => {
  assert.equal(defaultFieldForNewCondition({
    allowedFields: ['eventDate', 'numericValue'],
    existingChildren: 3
  }), 'eventDate');
});

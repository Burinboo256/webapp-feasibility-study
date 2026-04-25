import assert from 'node:assert/strict';
import test from 'node:test';
import { createCohortRequestDeliveryService } from '../src/server/cohortRequestDelivery.js';

function samplePayload() {
  return {
    to: 'requester@example.com',
    requesterName: 'Demo Researcher',
    requestReason: 'Feasibility study for diabetes protocol review',
    question: 'Adults with diabetes and HbA1c monitoring',
    dataSource: 'json',
    indexEligibleCount: 42,
    finalCount: 18,
    excludedCount: 24,
    sqlSummary: 'Criteria: diagnosis, lab, and drug conditions',
    attrition: [
      { label: 'Has index event (T0)', count: 42 },
      { label: 'After exclusion condition logic', count: 18, removed: 24 }
    ],
    sql: 'SELECT 1;',
    workflowSvg: '<svg><rect width="10" height="10"/></svg>'
  };
}

test('cohort request delivery writes to console when smtp host is blank', async () => {
  const messages = [];
  const service = createCohortRequestDeliveryService({
    smtp: { host: '' },
    logger: {
      log(message) {
        messages.push(message);
      }
    }
  });

  const result = await service.sendRequestEmail(samplePayload());

  assert.equal(result.mode, 'console');
  assert.match(result.warning, /server console/i);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /\[DEV COHORT REQUEST\]/);
  assert.match(messages[0], /Demo Researcher/);
});

test('cohort request delivery uses smtp and attaches workflow svg', async () => {
  const sent = [];
  const service = createCohortRequestDeliveryService({
    smtp: {
      host: 'smtp.example.com',
      port: 25,
      secure: false,
      from: 'no-reply@example.com'
    },
    transporterFactory(config) {
      assert.equal(config.host, 'smtp.example.com');
      return {
        async sendMail(message) {
          sent.push(message);
        }
      };
    }
  });

  const result = await service.sendRequestEmail(samplePayload());

  assert.equal(result.mode, 'email');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'requester@example.com');
  assert.match(sent[0].subject, /Cohort request summary/i);
  assert.equal(sent[0].attachments[0].filename, 'cohort-attrition-workflow.svg');
  assert.match(sent[0].html, /Cohort summary/);
});

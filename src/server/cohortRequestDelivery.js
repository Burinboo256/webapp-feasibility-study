import nodemailer from 'nodemailer';

export function createCohortRequestDeliveryService(options = {}) {
  const smtp = options.smtp || {};
  const logger = options.logger || console;
  const transporterFactory = options.transporterFactory || nodemailer.createTransport;
  const allowConsoleFallbackOnSmtpFailure = options.allowConsoleFallbackOnSmtpFailure === true;

  return {
    async sendRequestEmail(payload = {}) {
      const subject = buildSubject(payload.question);
      const text = buildRequestText(payload);
      const html = buildRequestHtml(payload);
      const attachments = buildAttachments(payload);

      if (!smtp.host) {
        logDevRequest(logger, payload.to, subject, text);
        return {
          mode: 'console',
          warning: 'SMTP is not configured. The cohort request email was written to the server console.'
        };
      }

      try {
        const transporter = transporterFactory({
          host: smtp.host,
          port: smtp.port,
          secure: smtp.secure,
          auth: smtp.user ? {
            user: smtp.user,
            pass: smtp.pass
          } : undefined
        });

        await transporter.sendMail({
          from: smtp.from || smtp.user,
          to: payload.to,
          subject,
          text,
          html,
          attachments
        });

        return { mode: 'email' };
      } catch (error) {
        if (!allowConsoleFallbackOnSmtpFailure) throw error;

        logger.warn?.(
          `[COHORT REQUEST SMTP FALLBACK] ${payload.to} | ${subject} | ${error?.message || 'Unknown SMTP error'}`
        );
        logDevRequest(logger, payload.to, subject, text);
        return {
          mode: 'console',
          warning: 'SMTP delivery failed. The cohort request email was written to the server console for local testing.'
        };
      }
    }
  };
}

function buildSubject(question = '') {
  const normalized = String(question || '').trim();
  return normalized
    ? `Cohort request summary: ${normalized.slice(0, 120)}`
    : 'Cohort request summary';
}

function buildRequestText(payload = {}) {
  const attrition = Array.isArray(payload.attrition) ? payload.attrition : [];
  const lines = [
    'Cohort request confirmation',
    '',
    `Requester: ${payload.requesterName || '-'}`,
    `Email: ${payload.to || '-'}`,
    `Reason: ${payload.requestReason || '-'}`,
    '',
    'Cohort summary',
    `Question: ${payload.question || '-'}`,
    `Data source: ${payload.dataSource || '-'}`,
    `Index eligible count: ${Number(payload.indexEligibleCount || 0)}`,
    `Final cohort count: ${Number(payload.finalCount || 0)}`,
    `Excluded count: ${Number(payload.excludedCount || 0)}`,
    payload.sqlSummary ? `SQL summary: ${payload.sqlSummary}` : null,
    '',
    'Attrition',
    ...attrition.map((step) => `- ${step.label}: ${step.count}${Number.isFinite(step.removed) ? ` (removed ${step.removed})` : ''}`),
    '',
    'Generated SQL',
    payload.sql || '-'
  ].filter((line) => line !== null);

  return lines.join('\n');
}

function buildRequestHtml(payload = {}) {
  const attrition = Array.isArray(payload.attrition) ? payload.attrition : [];
  const sqlBlock = payload.sql
    ? `<h2>Generated SQL</h2><pre style="white-space:pre-wrap;background:#12221f;color:#f7ecd8;padding:16px;border-radius:12px;font-size:12px;line-height:1.5;">${escapeHtml(payload.sql)}</pre>`
    : '';

  return `
    <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.6;">
      <h1 style="font-size:20px;margin-bottom:12px;">Cohort request confirmation</h1>
      <p><strong>Requester:</strong> ${escapeHtml(payload.requesterName || '-')}<br>
      <strong>Email:</strong> ${escapeHtml(payload.to || '-')}<br>
      <strong>Reason:</strong> ${escapeHtml(payload.requestReason || '-')}</p>
      <h2 style="font-size:18px;margin-top:24px;">Cohort summary</h2>
      <ul>
        <li><strong>Question:</strong> ${escapeHtml(payload.question || '-')}</li>
        <li><strong>Data source:</strong> ${escapeHtml(payload.dataSource || '-')}</li>
        <li><strong>Index eligible count:</strong> ${Number(payload.indexEligibleCount || 0)}</li>
        <li><strong>Final cohort count:</strong> ${Number(payload.finalCount || 0)}</li>
        <li><strong>Excluded count:</strong> ${Number(payload.excludedCount || 0)}</li>
        ${payload.sqlSummary ? `<li><strong>SQL summary:</strong> ${escapeHtml(payload.sqlSummary)}</li>` : ''}
      </ul>
      <h2 style="font-size:18px;margin-top:24px;">Attrition</h2>
      <ul>
        ${attrition.map((step) => `<li><strong>${escapeHtml(step.label)}:</strong> ${Number(step.count || 0)}${Number.isFinite(step.removed) ? ` (removed ${Number(step.removed)})` : ''}</li>`).join('')}
      </ul>
      <p>The cohort attrition workflow is attached as <strong>cohort-attrition-workflow.svg</strong>.</p>
      ${sqlBlock}
    </div>
  `.trim();
}

function buildAttachments(payload = {}) {
  const attachments = [];
  if (payload.workflowSvg) {
    attachments.push({
      filename: 'cohort-attrition-workflow.svg',
      content: `<?xml version="1.0" encoding="UTF-8"?>\n${String(payload.workflowSvg).trim()}`,
      contentType: 'image/svg+xml'
    });
  }
  return attachments;
}

function logDevRequest(logger, to, subject, text) {
  logger.log?.(`[DEV COHORT REQUEST] ${to} | ${subject}\n${text}`);
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

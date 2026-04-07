'use strict';

const config = require('../config');

const LEVELS = { info: 'INFO', warning: 'WARNING', error: 'ERROR' };

async function sendAlert(message, level = 'info') {
  const webhookUrl = config.slack.webhookUrl;

  if (!webhookUrl) {
    console.warn('[slack] no webhook configured —', message);
    return;
  }

  const payload = {
    text: `[Channel Attribution — ${LEVELS[level] || 'INFO'}]\n${message}\n${new Date().toISOString()}`,
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`[slack] webhook returned ${response.status}`);
    }
  } catch (err) {
    console.error('[slack] failed to send alert:', err.message);
  }
}

module.exports = { sendAlert };

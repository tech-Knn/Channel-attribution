/**
 * Slack Notifier — simple webhook helper for system alerts.
 *
 * Usage:
 *   const { sendAlert } = require('./slackNotifier');
 *   await sendAlert('Channel 42 disapproved', 'warning');
 */

'use strict';

const config = require('../config');

// Level → emoji mapping for visual clarity in Slack
const LEVEL_EMOJI = {
  info:    'ℹ️',
  warning: '⚠️',
  error:   '🚨',
};

/**
 * Send an alert message to the configured Slack webhook.
 *
 * @param {string} message — Human-readable alert text
 * @param {'info'|'warning'|'error'} level — Severity level
 * @returns {Promise<void>}
 */
async function sendAlert(message, level = 'info') {
  const webhookUrl = config.slack.webhookUrl;

  if (!webhookUrl) {
    console.warn('[slack] No SLACK_WEBHOOK_URL configured — skipping alert:', message);
    return;
  }

  const emoji = LEVEL_EMOJI[level] || LEVEL_EMOJI.info;
  const timestamp = new Date().toISOString();

  const payload = {
    text: `${emoji} *[Channel Attribution — ${level.toUpperCase()}]*\n${message}\n_${timestamp}_`,
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[slack] Webhook returned ${response.status}: ${body}`);
    }
  } catch (err) {
    // Slack alerts are best-effort — never let them crash a worker
    console.error('[slack] Failed to send alert:', err.message);
  }
}

module.exports = { sendAlert };

'use strict';

const { Worker } = require('bullmq');
const axios = require('axios');

const QUEUE_NAME = 'scribe-notify';

const defaultCallbackUrl = process.env.SCRIBE_CALLBACK_URL;
const callbackSecret = process.env.CHANNEL_ATTRIBUTION_SECRET || process.env.WEBHOOK_SECRET;

/**
 * Job data shape:
 *   { articleSlug, channelId, domain, callbackUrl? }
 *   channelId present  → assignment (bake into HTML)
 *   channelId null     → expiry (clear from HTML)
 *   callbackUrl        → per-article override; falls back to SCRIBE_CALLBACK_URL
 *                        (lets Scribe and MetaTermux share the same domain pool
 *                         while each receiving its own callbacks).
 */
async function processJob(job) {
  const { articleSlug, channelId, domain, callbackUrl } = job.data;

  const targetBaseUrl = callbackUrl || defaultCallbackUrl;

  if (!targetBaseUrl || !callbackSecret) {
    console.warn('[scribeNotify] callback URL or secret not set — skipping');
    return { status: 'skipped', reason: 'env_not_configured' };
  }

  if (!articleSlug) {
    throw new Error('Job missing required field: articleSlug');
  }

  const action = channelId ? `assign channel ${channelId}` : 'clear channel (expiry)';
  console.log(`[scribeNotify] Notifying ${targetBaseUrl}: ${articleSlug} — ${action} (attempt ${job.attemptsMade + 1})`);

  await axios.post(
    `${targetBaseUrl.replace(/\/$/, '')}/api/channel-assigned`,
    { articleSlug, channelId: channelId || null, domain: domain || 'articlespectrum.com' },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': callbackSecret,
      },
      timeout: 15000,
    },
  );

  console.log(`[scribeNotify] Confirmed: ${articleSlug} — ${action}`);
  return { status: 'ok', articleSlug, channelId };
}

function createScribeNotifyWorker() {
  const worker = new Worker(QUEUE_NAME, processJob, {
    connection: require('../redis/queues').connection,
    concurrency: 3,
  });

  worker.on('completed', (job, result) => {
    console.log(`[scribeNotify] Job ${job.id} done:`, result?.articleSlug);
  });

  worker.on('failed', (job, err) => {
    console.error(
      `[scribeNotify] Job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts?.attempts}): ${err.message}`,
      `— article: ${job?.data?.articleSlug}`,
    );
  });

  worker.on('error', (err) => {
    console.error('[scribeNotify] Worker error:', err.message);
  });

  console.log('[scribeNotify] Worker started — listening on queue:', QUEUE_NAME);
  return worker;
}

module.exports = { createScribeNotifyWorker };

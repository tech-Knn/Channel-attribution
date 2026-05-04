'use strict';

const { Worker } = require('bullmq');
const axios = require('axios');

const QUEUE_NAME = 'scribe-notify';

const scribeCallbackUrl = process.env.SCRIBE_CALLBACK_URL;
const scribeCallbackSecret = process.env.CHANNEL_ATTRIBUTION_SECRET || process.env.WEBHOOK_SECRET;

/**
 * Job data shape:
 *   { articleSlug, channelId, domain }
 *   channelId present  → assignment (bake into HTML)
 *   channelId null     → expiry (clear from HTML)
 */
async function processJob(job) {
  const { articleSlug, channelId, domain } = job.data;

  if (!scribeCallbackUrl || !scribeCallbackSecret) {
    console.warn('[scribeNotify] SCRIBE_CALLBACK_URL or secret not set — skipping');
    return { status: 'skipped', reason: 'env_not_configured' };
  }

  if (!articleSlug) {
    throw new Error('Job missing required field: articleSlug');
  }

  const action = channelId ? `assign channel ${channelId}` : 'clear channel (expiry)';
  console.log(`[scribeNotify] Notifying Scribe: ${articleSlug} — ${action} (attempt ${job.attemptsMade + 1})`);

  const response = await axios.post(
    `${scribeCallbackUrl}/api/channel-assigned`,
    { articleSlug, channelId: channelId || null, domain: domain || 'articlespectrum.com' },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': scribeCallbackSecret,
      },
      timeout: 15000,
    },
  );

  console.log(`[scribeNotify] Scribe confirmed: ${articleSlug} — ${action}`);
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

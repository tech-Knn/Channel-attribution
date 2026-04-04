/**
 * Channel Routes
 *
 * POST   /api/channels             — Register new channel
 * GET    /api/channels             — List with filters & pagination
 * GET    /api/channels/idle        — Get idle queue with positions
 * GET    /api/channels/:id         — Get channel with assignment history
 * PUT    /api/channels/:id/status  — Update status (triggers state job)
 */

'use strict';

const { Router } = require('express');
const queries = require('../../db/queries');
const { queues } = require('../../redis/queues');
const { getIdleQueueSize, getIdleQueueList } = require('../../redis/channelQueue');

const router = Router();

// ── POST /api/channels ─────────────────────────────────────────────────────

router.post('/', async (req, res, next) => {
  try {
    const { id, externalId, status } = req.body;

    if (!id || !externalId) {
      return res.status(400).json({ error: 'id and externalId are required' });
    }

    const validStatuses = ['idle', 'assigned', 'disapproved', 'manual_review'];
    const channelStatus = validStatuses.includes(status) ? status : 'idle';

    const channel = await queries.createChannel({
      id: Number(id),
      externalId,
      status: channelStatus,
    });

    // Log creation event
    await queries.addChannelLog(channel.id, 'idle', null, { reason: 'registered' });

    // Added to Redis idle queue if channel is idle// this m,ake sure to idle channel will get in redish 
    if (channelStatus === 'idle') {
      await queues.channelState.add('state-change', {
        channelId: channel.id,
        previousStatus: null,
        newStatus: 'idle',
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      });
    }

    res.status(201).json({ data: channel });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Channel with this ID or external_id already exists' });
    }
    next(err);
  }
});

// ── GET /api/channels ──────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const { status, limit, offset } = req.query;

    const result = await queries.listChannels({
      status: status || undefined,
      limit: Math.min(parseInt(limit, 10) || 50, 200),
      offset: parseInt(offset, 10) || 0,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/channels/idle — must come before /:id ─────────────────────────

router.get('/idle', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const size = await getIdleQueueSize();
    const list = await getIdleQueueList(limit);

    res.json({
      data: list.map((item, idx) => ({
        position: idx + 1,
        channelId: item.channelId,
        idleSince: new Date(item.idleSince).toISOString(),
        idleDurationMs: Date.now() - item.idleSince,
      })),
      total: size,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/channels/:id ──────────────────────────────────────────────────

router.get('/:id', async (req, res, next) => {
  try {
    const channel = await queries.getChannelById(Number(req.params.id));
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const history = await queries.getChannelAssignmentHistory(channel.id);

    res.json({
      data: {
        ...channel,
        assignmentHistory: history,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/channels/:id/status ───────────────────────────────────────────

router.put('/:id/status', async (req, res, next) => {
  try {
    const channelId = Number(req.params.id);
    const { status } = req.body;

    const validStatuses = ['idle', 'assigned', 'disapproved', 'manual_review'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        error: `status must be one of: ${validStatuses.join(', ')}`,
      });
    }

    // Check channel exists
    const existing = await queries.getChannelById(channelId);
    if (!existing) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Update in PG
    const updated = await queries.updateChannelStatus(channelId, status);

    // Trigger channel-state job for Redis sync & side effects
    await queues.channelState.add('state-change', {
      channelId,
      previousStatus: existing.status,
      newStatus: status,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    });

    // Log the event
    await queries.addChannelLog(channelId, status, null, {
      previousStatus: existing.status,
    });

    res.json({ data: updated, message: `Channel status updated to '${status}'` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

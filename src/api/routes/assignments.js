/**
 * Assignment Routes
 *
 * GET    /api/assignments         — List with filters & pagination
 * GET    /api/assignments/active  — All currently active assignments
 * POST   /api/assignments/manual  — Manual channel→article assignment
 */

'use strict';

const { Router } = require('express');
const queries = require('../../db/queries');
const { queues } = require('../../redis/queues');

const router = Router();

// ── GET /api/assignments/active — must come before parameterized routes ────

router.get('/active', async (req, res, next) => {
  try {
    const assignments = await queries.listActiveAssignments();
    res.json({ data: assignments, total: assignments.length });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/assignments ───────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const { status, limit, offset } = req.query;

    // Validate status filter
    const validStatuses = ['active', 'completed', 'expired'];
    const filterStatus = validStatuses.includes(status) ? status : undefined;

    const result = await queries.listAssignments({
      status: filterStatus,
      limit: Math.min(parseInt(limit, 10) || 50, 200),
      offset: parseInt(offset, 10) || 0,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/assignments/manual ───────────────────────────────────────────

router.post('/manual', async (req, res, next) => {
  try {
    const { articleId, channelId } = req.body;

    if (!articleId || !channelId) {
      return res.status(400).json({ error: 'articleId and channelId are required' });
    }

    const artId = Number(articleId);
    const chId = Number(channelId);

    // Verify both exist
    const article = await queries.getArticleById(artId);
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const channel = await queries.getChannelById(chId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Check for existing active assignment on this channel
    const existingChannelAssignment = await queries.getActiveAssignmentForChannel(chId);
    if (existingChannelAssignment) {
      // Close the existing assignment first
      await queries.closeAssignment(existingChannelAssignment.id, 'completed');
      await queries.addChannelLog(chId, 'unassigned', existingChannelAssignment.article_id, {
        reason: 'manual_override',
      });
    }

    // Check for existing active assignment on this article
    const existingArticleAssignment = await queries.getActiveAssignmentForArticle(artId);
    if (existingArticleAssignment) {
      await queries.closeAssignment(existingArticleAssignment.id, 'completed');
      await queries.addChannelLog(existingArticleAssignment.channel_id, 'unassigned', artId, {
        reason: 'manual_override',
      });
    }

    // Create the new assignment
    const assignment = await queries.createAssignment({ articleId: artId, channelId: chId });

    // Update channel status
    await queries.updateChannelStatus(chId, 'assigned', { assignedTo: artId });

    // Update article status
    await queries.updateArticleStatus(artId, 'assigned');

    // Trigger state sync job
    await queues.channelState.add('manual-assignment', {
      channelId: chId,
      articleId: artId,
      assignmentId: assignment.id,
    });

    // Log the event
    await queries.addChannelLog(chId, 'assigned', artId, { method: 'manual' });

    res.status(201).json({
      data: assignment,
      message: 'Manual assignment created',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

'use strict';

const { Router } = require('express');
const queries = require('../../db/queries');
const { queues } = require('../../redis/queues');

const router = Router();

// must be declared before /:id
router.get('/active', async (req, res, next) => {
  try {
    const assignments = await queries.listActiveAssignments();
    res.json({ data: assignments, total: assignments.length });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { status, limit, offset } = req.query;
    const validStatuses = ['active', 'completed', 'expired'];

    const result = await queries.listAssignments({
      status: validStatuses.includes(status) ? status : undefined,
      limit: Math.min(parseInt(limit, 10) || 50, 200),
      offset: parseInt(offset, 10) || 0,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/manual', async (req, res, next) => {
  try {
    const { articleId, channelId } = req.body;

    if (!articleId || !channelId) {
      return res.status(400).json({ error: 'articleId and channelId are required' });
    }

    const artId = Number(articleId);
    const chId = Number(channelId);

    const [article, channel] = await Promise.all([
      queries.getArticleById(artId),
      queries.getChannelById(chId),
    ]);

    if (!article) return res.status(404).json({ error: 'Article not found' });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const [existingChannel, existingArticle] = await Promise.all([
      queries.getActiveAssignmentForChannel(chId),
      queries.getActiveAssignmentForArticle(artId),
    ]);

    if (existingChannel) {
      await queries.closeAssignment(existingChannel.id, 'completed');
      await queries.addChannelLog(chId, 'unassigned', existingChannel.article_id, { reason: 'manual_override' });
    }

    if (existingArticle) {
      await queries.closeAssignment(existingArticle.id, 'completed');
      await queries.addChannelLog(existingArticle.channel_id, 'unassigned', artId, { reason: 'manual_override' });
    }

    const assignment = await queries.createAssignment({ articleId: artId, channelId: chId });

    await Promise.all([
      queries.updateChannelStatus(chId, 'assigned', { assignedTo: artId }),
      queries.updateArticleStatus(artId, 'assigned', { lastTrafficAt: new Date() }),
      queries.addChannelLog(chId, 'assigned', artId, { method: 'manual' }),
      queues.channelState.add('manual-assignment', { channelId: chId, articleId: artId, assignmentId: assignment.id }),
    ]);

    res.status(201).json({ data: assignment });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

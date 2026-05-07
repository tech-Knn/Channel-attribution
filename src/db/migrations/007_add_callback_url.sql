-- Migration 007: Per-article callback URL
--
-- Different publishing systems (Scribe articles, MetaTermux landing pages, ...)
-- live on the same articlespectrum.com domain and share the same channel pool,
-- but each runs on its own host and needs the channel-assigned callback to
-- arrive at its own /api/channel-assigned route.
--
-- Storing the callback base URL on the article row lets the scribeNotify
-- worker route each notification back to the correct origin. Articles created
-- before this migration (or by callers that don't send callbackUrl) leave the
-- column NULL and the worker falls back to SCRIBE_CALLBACK_URL.

ALTER TABLE articles
    ADD COLUMN IF NOT EXISTS callback_url TEXT;

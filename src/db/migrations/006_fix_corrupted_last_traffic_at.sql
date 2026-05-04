-- Migration 006: Fix corrupted last_traffic_at values
--
-- A bug in track.js was writing last_traffic_at = old_value + 72h instead of NOW().
-- This left active articles with future timestamps (e.g. Apr 27 + 72h = Apr 30).
-- Reset any future last_traffic_at to NOW() so the expiry window is clean.
-- Going forward, track.js and gaMonitor both correctly write NOW() on each visit.

UPDATE articles
SET last_traffic_at = NOW()
WHERE status IN ('assigned', 'active')
  AND last_traffic_at > NOW();

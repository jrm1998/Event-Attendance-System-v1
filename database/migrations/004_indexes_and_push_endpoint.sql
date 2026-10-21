-- Query-driven index fixes.

-- The hourly purge runs DELETE FROM qr_tokens WHERE expires_at < ... . The
-- existing (event_id, expires_at) index leads on event_id, so it cannot serve
-- an expires_at-only range scan.
ALTER TABLE qr_tokens
  ADD KEY idx_qr_tokens_expiry (expires_at);

-- Push endpoints are URLs up to 500 characters. Uniqueness on the first 255
-- characters means two long endpoints sharing a prefix collide, and the
-- ON DUPLICATE KEY UPDATE in upsertSubscription would transfer the existing
-- subscription row to the second user. Enforce uniqueness on the full value.
ALTER TABLE push_subscriptions
  DROP INDEX uq_push_endpoint,
  ADD UNIQUE KEY uq_push_endpoint (endpoint);

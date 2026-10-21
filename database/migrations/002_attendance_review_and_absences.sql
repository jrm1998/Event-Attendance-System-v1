-- Phase 5: review workflow + automated absence finalization.
-- 'auto' marks rows created by the absence finalizer job (no human involved).
ALTER TABLE attendance
  MODIFY verification_status ENUM('qr_gps','manual','flagged','auto') NOT NULL DEFAULT 'qr_gps';

-- Stamp on events so the finalizer only processes each event once.
ALTER TABLE events
  ADD COLUMN absences_finalized_at DATETIME NULL AFTER max_attendance;

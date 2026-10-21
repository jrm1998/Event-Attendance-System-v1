-- Phase 7: event reminders. Set once the reminder notification batch for an
-- event has been sent, so the reminder job never sends twice.
ALTER TABLE events
  ADD COLUMN reminders_sent_at DATETIME NULL AFTER absences_finalized_at;

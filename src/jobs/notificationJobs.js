'use strict';

const eventRepo = require('../repositories/eventRepo');
const attendanceRepo = require('../repositories/attendanceRepo');
const notificationService = require('../services/notificationService');
const settingsService = require('../services/settingsService');
const studentRepo = require('../repositories/studentRepo');
const timeUtils = require('../utils/time');
const logger = require('../utils/logger');

/**
 * Event reminders: every 10 minutes, notify every eligible student who has
 * not checked in about published events starting within the configured
 * reminder horizon (notification.reminder_hours_before, default 24h).
 * events.reminders_sent_at guarantees each event is reminded once.
 */
async function sendReminders() {
  const hours = await settingsService.getNumber('notification.reminder_hours_before', 24);
  const horizon = new Date(Date.now() + hours * 60 * 60 * 1000);
  const events = await eventRepo.listEventsForReminder(horizon);
  let sent = 0;

  for (const event of events) {
    try {
      const studentIds = await attendanceRepo.listEligibleWithoutAttendance(event.id);
      // One lookup for the whole roster instead of one query per student.
      const mappings = studentIds.length
        ? await studentRepo.getUserIdsForStudents(studentIds)
        : [];
      const message =
        `"${event.title}" starts at ${timeUtils.formatDateTime(event.start_at)}. ` +
        `Check-in opens ${timeUtils.formatDateTime(event.checkin_opens_at)} at ${event.venue_name}. ` +
        'Bring your phone for the QR check-in.';
      for (const { userId } of mappings) {
        await notificationService.notifyUser(userId, {
          title: 'Event reminder',
          message,
          type: 'reminder',
          eventId: event.id,
        });
        sent += 1;
      }
      await eventRepo.markRemindersSent(event.id);
      if (studentIds.length) {
        logger.info(`[job] reminders sent for event "${event.title}" to ${studentIds.length} student(s)`);
      }
    } catch (err) {
      logger.error(`[job] reminders failed for event ${event.id}:`, err.message);
    }
  }
  return sent;
}

function register(registerCron) {
  registerCron('*/10 * * * *', 'event reminders', async () => {
    await sendReminders();
  });
  logger.info('[job] reminder job scheduled (every 10 minutes)');
}

module.exports = { register, sendReminders };

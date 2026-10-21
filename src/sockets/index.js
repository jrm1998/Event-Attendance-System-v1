'use strict';

const { Server } = require('socket.io');
const { EventEmitter } = require('events');
const { loadUser } = require('../middleware/authenticate');
const { teacherAssignedToEvent } = require('../middleware/authorize');
const logger = require('../utils/logger');

let io = null;

function stubResponse() {
  const res = new EventEmitter();
  res.headers = {};
  res.setHeader = (k, v) => {
    res.headers[String(k).toLowerCase()] = v;
  };
  res.getHeader = (k) => res.headers[String(k).toLowerCase()];
  res.removeHeader = (k) => {
    delete res.headers[String(k).toLowerCase()];
  };
  res.writeHead = () => res;
  res.end = () => {};
  return res;
}

/**
 * Initializes Socket.IO with the SAME session middleware as Express so the
 * handshake is authenticated via the session cookie. Every authenticated
 * socket joins its personal `user:{id}` room. Event rooms `event:{id}` can
 * only be joined by admins or teachers assigned to that event.
 */
function init(httpServer, sessionMiddleware) {
  io = new Server(httpServer, {
    serveClient: false,
    cors: { origin: false, credentials: false },
  });

  io.use((socket, next) => {
    sessionMiddleware(socket.request, stubResponse(), (err) => {
      if (err) return next(new Error('session error'));
      const userId = socket.request.session && socket.request.session.userId;
      if (!userId) return next(new Error('unauthorized'));
      loadUser(userId)
        .then((user) => {
          if (!user || user.status !== 'active') return next(new Error('unauthorized'));
          socket.user = user;
          next();
        })
        .catch(() => next(new Error('session error')));
    });
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.user.id}`);

    socket.on('event:subscribe', async (payload) => {
      try {
        const eventId = Number.parseInt(payload && payload.eventId, 10);
        if (!Number.isInteger(eventId) || eventId <= 0) return;
        const allowed =
          socket.user.role === 'admin' ||
          (socket.user.role === 'teacher' &&
            (await teacherAssignedToEvent(socket.user.teacherId, eventId)));
        if (allowed) {
          socket.join(`event:${eventId}`);
          socket.emit('event:subscribed', { eventId });
        } else {
          logger.warn(`Socket event:subscribe denied user=${socket.user.id} event=${eventId}`);
          socket.emit('event:denied', { eventId });
        }
      } catch (err) {
        logger.error(`Socket event:subscribe failed user=${socket.user.id}: ${err.message}`);
        socket.emit('event:denied', { eventId: payload && payload.eventId });
      }
    });

    socket.on('event:unsubscribe', (payload) => {
      const eventId = Number.parseInt(payload && payload.eventId, 10);
      if (Number.isInteger(eventId)) socket.leave(`event:${eventId}`);
    });
  });

  return io;
}

function emitToEvent(eventId, event, payload) {
  if (io) io.to(`event:${eventId}`).emit(event, payload);
}

function emitToUser(userId, event, payload) {
  if (io) io.to(`user:${userId}`).emit(event, payload);
}

/** Drops all live sockets of a user (used on logout / account deactivation). */
function disconnectUser(userId) {
  if (io) io.in(`user:${userId}`).disconnectSockets(true);
}

function getIo() {
  return io;
}

module.exports = { init, emitToEvent, emitToUser, disconnectUser, getIo };

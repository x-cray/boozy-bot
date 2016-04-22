/* @flow */
'use strict';

const co = require('co');
const Queue = require('bull');
const TelegramApiClient = require('./lib/telegram-api-client');
const config = require('./lib/config');
const logger = require('./lib/logger');

const queueConfig = config.get('queue');
const botConfig = config.get('bot');
const updatesQueue = new Queue('updates', queueConfig.redis.port, queueConfig.redis.host);
const apiClient = new TelegramApiClient(botConfig.token);
const cleanupPeriod = 1000 * 60 * 60 * 24; // one day.

// Cleanup old jobs.
setInterval(
  () => updatesQueue.clean(cleanupPeriod),
  cleanupPeriod
);

co(function* enqueueBotUpdates() {
  while (true) { // eslint-disable-line no-constant-condition
    try {
      const updates = yield apiClient.getUpdates();
      if (updates && updates.length) {
        updates.forEach(u => {
          logger.info(`Adding job for update ${u.update_id}`);
          updatesQueue.add(u, {
            attempts: 10,
            timeout: 10000,
            backoff: {
              type: 'exponential',
              delay: 1000
            }
          });
        });
      }
    } catch (e) {
      logger.error(e);
    }
  }
});

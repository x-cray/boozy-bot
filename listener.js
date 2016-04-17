/* @flow */
'use strict';

const co = require('co');
const Queue = require('bull');
const ApiClient = require('./lib/api-client');
const config = require('./lib/config');
const logger = require('./lib/logger');

const queueConfig = config.get('queue');
const updatesQueue = new Queue('updates', queueConfig.redis.port, queueConfig.redis.host);
const apiClient = new ApiClient();

co(function* enqueueBotUpdates() {
  while (true) { // eslint-disable-line no-constant-condition
    try {
      const updates = yield apiClient.getUpdates();
      if (updates.length) {
        updates.forEach(updatesQueue.add.bind(updatesQueue));
      }
    } catch (e) {
      logger.error(e);
    }
  }
});

logger.close();

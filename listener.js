/* @flow */
'use strict';

import http from 'http';
import Queue from 'bull';
import config from './lib/config.js';

const queueConfig = config.get('queue');
const botConfig = config.get('bot');
const updatesQueue = Queue('updates', queueConfig.redis.port, queueConfig.redis.host);
let offset = null;

function* getUpdates() {
  http.get(`https://api.telegram.org/bot${botConfig.token}/getUpdates?timeout=5&${offset}`);
}

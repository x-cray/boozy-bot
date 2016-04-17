/* @flow */
'use strict';

const config = require('./config');
const logger = require('./logger');
const fetch = require('node-fetch');
const botConfig = config.get('bot');

class ApiClient {
  constructor() {
    if (!botConfig.token) {
      throw new Error('Bot token is not provided');
    }

    this.apiRoot = `https://api.telegram.org/bot${botConfig.token}/`;
    this.offset = '';
  }

  getUpdates() {
    const url = `${this.apiRoot}getUpdates?timeout=10&offset=${this.offset}`;
    logger.info(`Getting updates from ${url}`);
    return fetch(url)
      .then(r => r.json())
      .then(o => {
        if (!o.ok) {
          throw new Error('Failed to retrieve updates');
        }

        if (o.result.length) {
          this.offset = o.result[o.result.length - 1].update_id + 1;
          logger.info(`Next offset: ${this.offset}`);
        }

        return o.result;
      });
  }
}

module.exports = ApiClient;

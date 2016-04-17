/* @flow */
'use strict';

const logger = require('./logger');
const fetch = require('node-fetch');

function ensureSuccess(response) {
  if (!response.ok) {
    throw new Error(
      `Failed to retrieve updates. Code ${response.error_code}: ${response.description}`
    );
  }
  return response;
}

class TelegramApiClient {
  constructor(apiToken) {
    if (!apiToken) {
      throw new Error('Bot API token is not provided');
    }

    this.apiRoot = `https://api.telegram.org/bot${apiToken}`;
    this.offset = '';
  }

  getUrl(path) {
    return `${this.apiRoot}${path}`;
  }

  getUpdates() {
    const url = this.getUrl(`/getUpdates?timeout=10&offset=${this.offset}`);
    logger.info(`Getting updates from ${url}`);
    return fetch(url)
      .then(r => r.json())
      .then(ensureSuccess)
      .then(r => {
        if (r.result.length) {
          this.offset = r.result[r.result.length - 1].update_id + 1;
          logger.info(`Next offset: ${this.offset}`);
        }

        return r.result;
      });
  }

  sendInlineQueryAnswer(answer) {
    const url = this.getUrl('/answerInlineQuery');
    const payload = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(answer)
    };
    return fetch(url, payload)
      .then(r => r.json())
      .then(ensureSuccess);
  }
}

module.exports = TelegramApiClient;

/* @flow */
'use strict';

const fetch = require('node-fetch');
const logger = require('./logger');
const telegramLogger = logger.child({ source: 'telegram' });

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

  postCommand(command, payload) {
    const url = this.getUrl(`/${command}`);
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    };
    telegramLogger.debug(payload, `Sending ${command} command`);
    return fetch(url, options)
      .then(r => r.json())
      .then(ensureSuccess);
  }

  getUpdates() {
    const url = this.getUrl(`/getUpdates?timeout=10&offset=${this.offset}`);
    telegramLogger.debug(`Getting updates from ${url}`);
    return fetch(url)
      .then(r => r.json())
      .then(ensureSuccess)
      .then(r => {
        if (r.result.length) {
          this.offset = r.result[r.result.length - 1].update_id + 1;
          telegramLogger.debug(`Next offset: ${this.offset}`);
        }

        return r.result;
      });
  }

  sendInlineQueryAnswer(answer) {
    return this.postCommand('answerInlineQuery', answer);
  }

  sendMessage(chatId, text, replyMarkup, disableNotification) {
    const payload = {
      text,
      chat_id: chatId,
      parse_mode: 'Markdown'
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    if (disableNotification) {
      payload.disable_notification = true;
    }
    return this.postCommand('sendMessage', payload);
  }
}

module.exports = TelegramApiClient;

/* @flow */
'use strict';

const fetch = require('node-fetch');
const logger = require('./logger');
const errors = require('./errors');
const telegramLogger = logger.child({ source: 'telegram' });

function ApiError(body) {
  this.code = body.error_code;
  this.message = `Telegram API call failed. Code ${body.error_code}: ${body.description}`;
}

function ensureSuccess(response) {
  return response.json()
    .then(body => {
      if (!response.ok) {
        // Handle HTTP error.
        throw new errors.HttpError(response.status, response.statusText, new ApiError(body));
      }

      if (!body.ok) {
        // Handle API error.
        throw new ApiError(body);
      }

      return body;
    });
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
      .then(ensureSuccess);
  }

  getUpdates() {
    const url = this.getUrl(`/getUpdates?timeout=10&offset=${this.offset}`);
    telegramLogger.debug(`Getting updates from ${url}`);
    return fetch(url)
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

  sendMessage(chatId, text, replyMarkup, replyToMessageId, enableWebPreview) {
    const payload = {
      text,
      chat_id: chatId,
      parse_mode: 'Markdown',
      disable_web_page_preview: !enableWebPreview
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    if (replyToMessageId) {
      payload.reply_to_message_id = replyToMessageId;
    }
    return this.postCommand('sendMessage', payload);
  }
}

module.exports = TelegramApiClient;

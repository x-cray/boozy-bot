/* @flow */
'use strict';

const Queue = require('bull');
const TelegramApiClient = require('./lib/telegram-api-client');
const AddbApiClient = require('./lib/addb-api-client');
const config = require('./lib/config');
const logger = require('./lib/logger');
const queueLogger = logger.child({ source: 'queue' });
const workerLogger = logger.child({ source: 'worker' });

const queueConfig = config.get('queue');
const botConfig = config.get('bot');
const addbConfig = config.get('addb');
const updatesQueue = new Queue('updates', queueConfig.redis.port, queueConfig.redis.host);
const telegramApiClient = new TelegramApiClient(botConfig.token);
const addbApiClient = new AddbApiClient(addbConfig.key);

updatesQueue
  .on('ready', () => queueLogger.info('Queue is ready to process jobs'))
  .on('error', err => queueLogger.error(err, 'Queue error'))
  .on('cleaned', (jobs, type) => queueLogger.info(`Cleaned ${jobs.length} ${type} jobs`))
  .on('failed', (job, err) => queueLogger.warn(err, `Job ${job.jobId} failed`))
  .on('stalled', job => queueLogger.warn(`Job ${job.jobId} stalled`));

function searchIngredients(inlineQuery) {
  workerLogger.info(inlineQuery, 'Processing inline query update');
  return addbApiClient.searchIngredients(inlineQuery.query)
    .then(r => {
      if (r.result && r.result.length) {
        const queryResults = r.result.map(ingredient => ({
          type: 'article',
          id: ingredient.id,
          title: ingredient.name,
          description: ingredient.description,
          thumb_url: `http://assets.absolutdrinks.com/ingredients/200x200/${ingredient.id}.png`,
          thumb_width: 200,
          thumb_height: 200,
          input_message_content: {
            message_text: `I've got *${ingredient.name}*`,
            parse_mode: 'Markdown'
          }
        }));
        const inlineQueryAnswer = {
          inline_query_id: inlineQuery.id,
          results: JSON.stringify(queryResults)
        };
        return telegramApiClient.sendInlineQueryAnswer(inlineQueryAnswer);
      }
      return Promise.resolve();
    });
}

updatesQueue.process(update => {
  // Handle inline ingredients search query.
  if (update.data.inline_query && update.data.inline_query.query) {
    return searchIngredients(update.data.inline_query);
  }

  // Handle selected ingredient.
  if (update.data.chosen_inline_result) {
    workerLogger.info(update.data, 'User selected inline query result');
    return Promise.resolve();
  }

  // Just skip unrecognized update.
  workerLogger.info(update.data, 'Skipping update');
  return Promise.resolve();
});

const cleanupPeriod = 1000 * 60 * 60 * 24; // one day.
setInterval(() => {
  // Cleanup old jobs.
  updatesQueue.clean(cleanupPeriod);
}, cleanupPeriod);

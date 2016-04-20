/* @flow */
'use strict';

const Queue = require('bull');
const TelegramApiClient = require('./lib/telegram-api-client');
const AddbApiClient = require('./lib/addb-api-client');
const config = require('./lib/config');
const logger = require('./lib/logger');
const Repository = require('./lib/repository');
const repository = new Repository();
const queueLogger = logger.child({ source: 'queue' });
const workerLogger = logger.child({ source: 'worker' });

const queueConfig = config.get('queue');
const botConfig = config.get('bot');
const addbConfig = config.get('addb');
const updatesQueue = new Queue('updates', queueConfig.redis.port, queueConfig.redis.host);
const telegramApiClient = new TelegramApiClient(botConfig.token);
const addbApiClient = new AddbApiClient(addbConfig.key);
const inlineResultsPerPage = 10;
const samples = ['orange', 'vodka', 'lime', 'rum', 'ice', 'mint', 'cinnamon', 'aperol', 'syrup'];

updatesQueue
  .on('ready', () => queueLogger.info('Queue is ready to process jobs'))
  .on('error', err => queueLogger.error(err, 'Queue error'))
  .on('cleaned', (jobs, type) => queueLogger.info(`Cleaned ${jobs.length} ${type} jobs`))
  .on('failed', (job, err) => queueLogger.warn(err, `Job ${job.jobId} failed`))
  .on('stalled', job => queueLogger.warn(`Job ${job.jobId} stalled`));

function handleCommand(chatId, user, command, parameter) {
  switch (command) {
    case 'start': {
      const randomSearch = samples[Math.floor(Math.random() * samples.length)];
      return telegramApiClient.sendMessage(chatId, 'Meet BoozyBot!', {
        inline_keyboard: [[{
          text: `Try it: ${randomSearch}`,
          switch_inline_query: randomSearch
        }]]
      });
    }
    case 'list':
      return repository.getIngredients(chatId)
        .then(l => telegramApiClient.sendMessage(chatId, `Listing ${l.length} ingredients`));
    case 'clear':
      return repository.clearIngredients(chatId)
        .then(telegramApiClient.sendMessage(chatId, 'Cleared available ingredients'));
    default:
      return Promise.resolve();
  }
}

function processCommand(message) {
  workerLogger.info(`Received bot command: ${message.text}`);
  const commandEntity = message.entities[0];
  const command = message.text.substr(commandEntity.offset + 1, commandEntity.length - 1);
  const parameter = message.text.substr(commandEntity.offset + commandEntity.length).trim();
  return Promise.all([
    repository.addLoggedCommand(command, parameter, message.from),
    handleCommand(message.chat.id, message.from, command, parameter)
  ]);
}

function getChosenIngredientMessage(ingredient) {
  return `/add@${botConfig.name} *${ingredient.id}*.
I've got [${ingredient.name}](http://www.absolutdrinks.com/en/drinks/with/${ingredient.id}/).`;
}

function searchIngredients(inlineQuery) {
  workerLogger.info(inlineQuery, 'Processing inline query update');
  const offset = parseInt(inlineQuery.offset, 10) || 0;

  // Display inline mode help button.
  if (!inlineQuery.query) {
    return telegramApiClient.sendInlineQueryAnswer({
      inline_query_id: inlineQuery.id,
      results: [],
      switch_pm_text: 'Start typing an ingredient name. Tap for help.',
      switch_pm_parameter: 'hint'
    });
  }

  // Return list of found ingredients.
  return addbApiClient.searchIngredients(inlineQuery.query, offset, inlineResultsPerPage)
  .then(r => {
    if (r.result && r.result.length) {
      const queryResults = r.result.map(ingredient => ({
        type: 'article',
        id: ingredient.id,
        title: ingredient.name,
        description: ingredient.description,
        url: `http://www.absolutdrinks.com/en/drinks/with/${ingredient.id}/`,
        thumb_url: `http://assets.absolutdrinks.com/ingredients/200x200/${ingredient.id}.png`,
        thumb_width: 200,
        thumb_height: 200,
        input_message_content: {
          message_text: getChosenIngredientMessage(ingredient),
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        }
      }));
      const inlineQueryAnswer = {
        inline_query_id: inlineQuery.id,
        cache_time: 10,
        results: JSON.stringify(queryResults)
      };
      const totalItems = parseInt(r.totalResult, 10) || 0;
      const isLastPage = totalItems - offset <= inlineResultsPerPage;
      let nextOffset = offset;
      if (!isLastPage) {
        nextOffset += inlineResultsPerPage;
      }
      if (nextOffset) {
        inlineQueryAnswer.next_offset = nextOffset;
      }
      return telegramApiClient.sendInlineQueryAnswer(inlineQueryAnswer);
    }
    return Promise.resolve();
  });
}

updatesQueue.process(update => {
  // Handle inline ingredients search query.
  if (update.data.inline_query) {
    return searchIngredients(update.data.inline_query);
  }

  // Handle bot command.
  if (update.data.message &&
    update.data.message.entities &&
    update.data.message.entities.length &&
    update.data.message.entities[0].type === 'bot_command'
  ) {
    return processCommand(update.data.message);
  }

  // Just skip unrecognized update.
  workerLogger.debug(update.data, 'Skipping update');
  return Promise.resolve();
});

const cleanupPeriod = 1000 * 60 * 60 * 24; // one day.
setInterval(() => {
  // Cleanup old jobs.
  updatesQueue.clean(cleanupPeriod);
}, cleanupPeriod);

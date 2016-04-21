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

function getIngredientURL(ingredientCode) {
  return `http://www.absolutdrinks.com/en/drinks/with/${ingredientCode}/`;
}

function getIngredientImageURL(ingredientCode) {
  return `http://assets.absolutdrinks.com/ingredients/200x200/${ingredientCode}.png`;
}

function getIngredientsMessage(ingredients) {
  if (!ingredients.length) {
    return `No ingredients currently. Tap on my name (@${botConfig.name}) and type your ingredient`;
  }
  const list = ingredients
    .map(i => `- *${i.ingredientName}* [(details)](${getIngredientURL(i.ingredientCode)})`)
    .join('\n');
  const message =
`Currently known ingredients:
${list}
Hit /search to find matching drink recipes.
You may remove individual ingredients with /remove or start over with /clear.`;

  return message;
}

function processNewIngredient(message) {
  const codeEntity = message.entities[0];
  const ingredientCode = message.text.substr(codeEntity.offset, codeEntity.length);
  return addbApiClient.getIngredient(ingredientCode)
  // TODO: Check for existing ingredient.
  .then(i => repository.addIngredient(
    ingredientCode,
    i.name,
    i.description,
    message.chat.id,
    message.from
  ));
}

function handleCommand(chatId, user, command, parameter) {
  switch (command) {
    case 'start': {
      const showHint = parameter === 'hint';
      let replyMarkup = null;
      let introMessage =
        '🎉 Hey! I\'m here to help you to come up with party drink ideas based ' +
        'on what ingredients you have in your bar. Add me to the group chat and I\'ll suggest ' +
        'you recipes for ingredients people have in sum.\n' +
        'And yes, you have to be at least 18 years old and drink responsibly 🍸';
      if (!showHint) {
        introMessage += '\n\nStart typing your ingredient following my nickname in the message box.'
      } else {
        const randomSearch = samples[Math.floor(Math.random() * samples.length)];
        replyMarkup = {
          inline_keyboard: [[{
            text: `Try it now: ${randomSearch}`,
            switch_inline_query: randomSearch
          }]]
        };
      }
      return telegramApiClient.sendMessage(chatId, introMessage, replyMarkup, true);
    }
    case 'list':
      return repository.getIngredients(chatId)
        .then(l => telegramApiClient.sendMessage(chatId, getIngredientsMessage(l)));
    case 'clear':
      return repository.clearIngredients(chatId)
        .then(telegramApiClient.sendMessage(chatId, 'Cleared available ingredients'));
    default:
      workerLogger.warn(`Unrecognized command ${command}`);
      return Promise.resolve();
  }
}

function processCommand(message) {
  workerLogger.info(`Received bot command: ${message.text}`);
  const commandEntity = message.entities[0];
  const fullCommand = message.text.substr(commandEntity.offset + 1, commandEntity.length - 1);
  const atIndex = fullCommand.indexOf('@');
  const command = ~atIndex ? fullCommand.substr(0, atIndex) : fullCommand;
  const parameter = message.text.substr(commandEntity.offset + commandEntity.length).trim();
  return Promise.all([
    repository.addLoggedCommand(command, parameter, message.from),
    handleCommand(message.chat.id, message.from, command, parameter)
  ]);
}

function getChosenIngredientMessage(ingredient) {
  const message =
`/add@${botConfig.name} *${ingredient.id}*.
I've got [${ingredient.name}](http://www.absolutdrinks.com/en/drinks/with/${ingredient.id}/).`;
  return message;
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
        url: getIngredientURL(ingredient.id),
        thumb_url: getIngredientImageURL(ingredient.id),
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
        results: queryResults
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
  const data = update.data;

  // Handle inline ingredients search query.
  if (data.inline_query) {
    return searchIngredients(data.inline_query);
  }

  if (data.message && data.message.entities && data.message.entities.length) {
    // Handle bot command.
    if (data.message.entities[0].type === 'bot_command') {
      return processCommand(data.message);
    }

    // Handle chosen ingredient message.
    if (data.message.text.startsWith('/add') && data.message.entities[0].type === 'bold') {
      return processNewIngredient(data.message);
    }
  }

  // ... or just skip unrecognized update.
  workerLogger.debug(data, 'Skipping update');
  return Promise.resolve();
});

const cleanupPeriod = 1000 * 60 * 60 * 24; // one day.
setInterval(() => {
  // Cleanup old jobs.
  updatesQueue.clean(cleanupPeriod);
}, cleanupPeriod);

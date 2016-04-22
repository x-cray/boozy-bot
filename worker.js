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
const ingredientCodeRegEx = /^.*\((.+)\)$/ig;
const samples = ['orange', 'vodka', 'lime', 'rum', 'ice', 'mint', 'cinnamon', 'aperol', 'syrup'];
const ingredientTypeIcons = {
  BaseSpirit: '',
  berries: '🍓',
  brandy: '',
  decoration: '',
  fruits: '🍐',
  gin: '',
  ice: '',
  mixers: '',
  others: '',
  rum: '',
  'spices-herbs': '',
  'spirits-other': '',
  tequila: '',
  vodka: '',
  whisky: '',
};

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

function getRandomIngredient() {
  return samples[Math.floor(Math.random() * samples.length)];
}

function getChosenIngredientMessage(ingredient) {
  const message =
    `/add@${botConfig.name} *${ingredient.id}*. ` +
    `I've got [${ingredient.name}](${getIngredientURL(ingredient.id)}).`;
  return message;
}

function getClearedIngredientsMessage() {
  return 'Cleared available ingredients.';
}

function getRemoveIngredientMessage() {
  return 'Which ingredient you would like to remove?';
}

function getRemovedIngredientMessage(ingredient) {
  return `Removed ${ingredient}.`;
}

function getInlineHelpMessage() {
  return 'Start typing an ingredient name. Tap for help.';
}

function getIngredientsListMessage(ingredients) {
  const list = ingredients
    .map(i => `- *${i.ingredientName}* [(details)](${getIngredientURL(i.ingredientCode)})`)
    .join('\n');
  const msg =
    `Currently chosen ingredients:\n${list}\n` +
    'Hit /search to find matching drink recipes.\n' +
    'You may want to remove individual ingredients with /remove or start over with /clear.';
  return msg;
}

function getIntroductionMessage(helpMessage) {
  const msg =
    '🎉 Hey! I\'m here to help you to come up with party drink ideas based ' +
    'on which ingredients you have in your bar. Add me to the group chat and I\'ll suggest ' +
    'you recipes for ingredients people have in sum.\n' +
    'And yes, you have to be at least 18 years old and drink responsibly 🍸' +
    `\n\nTo try, ${helpMessage}`;
  return msg;
}

function getActionHelp(chat) {
  const randomSearch = getRandomIngredient();
  return {
    message: `in any of your chats type '@${botConfig.name} ${randomSearch}' ` +
    'in the message field as an example.',
    replyMarkup: chat.type === 'private' ? {
      inline_keyboard: [[{
        text: `Try it now: ${randomSearch}`,
        switch_inline_query: randomSearch
      }]]
    } : null
  };
}

function sendNoChosenIngredientsMessage(chat) {
  const actionHelp = getActionHelp(chat);
  const msg = `No ingredients are chosen currently. To add one, ${actionHelp.message}`;
  return telegramApiClient.sendMessage(chat.id, msg, actionHelp.replyMarkup);
}

function processNewIngredient(message) {
  const codeEntity = message.entities[0];
  const ingredientCode = message.text.substr(codeEntity.offset, codeEntity.length);
  return addbApiClient.getIngredient(ingredientCode)
    // TODO: Check for existing ingredient.
    // TODO: Check for total maximum number of ingredients.
    .then(i => repository.addIngredient(
      ingredientCode,
      i.name,
      i.type,
      i.description,
      message.chat.id,
      message.from
    ));
}

function parseIngredientCode(messageText) {
  if (typeof messageText === 'string') {
    const matches = messageText.match(ingredientCodeRegEx);
    console.log(matches);
    if (matches && matches.length) {
      return matches[1];
    }
  }

  return null;
}

function processIngredientRemoval(ingredientCode, message) {
  return repository.removeIngredient(message.chat.id, ingredientCode)
    .then(repository.setChatMode(message.chat.id, ''))
    .then(telegramApiClient.sendMessage(
      message.chat.id,
      getRemovedIngredientMessage(message.text), {
        hide_keyboard: true,
        selective: true
      }
    ));
}

function handleCommand(command, parameter, messageId, chat, user) {
  switch (command) {
    case 'start': {
      const actionHelp = getActionHelp(chat);
      return telegramApiClient.sendMessage(
        chat.id,
        getIntroductionMessage(actionHelp.message),
        actionHelp.replyMarkup
      );
    }
    case 'list': {
      return repository.getIngredients(chat.id)
        .then(ingredients => {
          if (!ingredients.length) {
            return sendNoChosenIngredientsMessage(chat);
          }
          return telegramApiClient.sendMessage(
            chat.id,
            getIngredientsListMessage(ingredients)
          );
        });
    }
    case 'remove':
      return repository.getIngredients(chat.id)
        .then(ingredients => {
          if (!ingredients.length) {
            return sendNoChosenIngredientsMessage(chat);
          }
          const replyMarkup = {
            keyboard: ingredients.map(i => [`${i.ingredientName} (${i.ingredientCode})`]),
            resize_keyboard: true,
            one_time_keyboard: true,
            selective: true
          };
          return repository.setChatMode(chat.id, 'remove')
            .then(telegramApiClient.sendMessage(
              chat.id,
              getRemoveIngredientMessage(),
              replyMarkup,
              messageId
            ));
        });
    case 'clear':
      return repository.clearIngredients(chat.id)
        .then(telegramApiClient.sendMessage(
          chat.id,
          getClearedIngredientsMessage()
        ));
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
    handleCommand(command, parameter, message.message_id, message.chat, message.from)
  ]);
}

function processInlineQuery(inlineQuery) {
  workerLogger.info(inlineQuery, 'Processing inline query update');
  const offset = parseInt(inlineQuery.offset, 10) || 0;

  // Display inline mode help button.
  if (!inlineQuery.query) {
    return telegramApiClient.sendInlineQueryAnswer({
      inline_query_id: inlineQuery.id,
      results: [],
      switch_pm_text: getInlineHelpMessage(),
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
  workerLogger.debug(data, 'Received an update');

  // Handle inline ingredients search query.
  if (data.inline_query) {
    return processInlineQuery(data.inline_query);
  }

  if (data.message) {
    if (data.message.entities && data.message.entities.length) {
      // Handle bot command.
      if (data.message.entities[0].type === 'bot_command') {
        return processCommand(data.message);
      }

      // Handle chosen ingredient message.
      if (data.message.text.startsWith('/add') && data.message.entities[0].type === 'bold') {
        return processNewIngredient(data.message);
      }
    }

    // Try to guess ingredient code from the message.
    const ingredientCode = parseIngredientCode(data.message.text);
    if (ingredientCode) {
      // It's possible that user tries tu remove an ingredient. Check chat mode.
      return repository.getChatMode(data.message.chat.id).then(chatMode => {
        if (chatMode === 'remove') {
          // Handle ingredient removal.
          return processIngredientRemoval(ingredientCode, data.message);
        }

        // False alarm, just skip this update.
        workerLogger.debug(
          `Skipping update ${data.update_id} with ingredient code, was not in any related mode`
        );
        return Promise.resolve();
      });
    }
  }

  // ... or just skip unrecognized update.
  workerLogger.debug(`Skipping update ${data.update_id}`);
  return Promise.resolve();
});

const cleanupPeriod = 1000 * 60 * 60 * 24; // one day.
setInterval(() => {
  // Cleanup old jobs.
  updatesQueue.clean(cleanupPeriod);
}, cleanupPeriod);

/* @flow */
'use strict';

const Queue = require('bull');
const TelegramApiClient = require('./lib/telegram-api-client');
const AddbApiClient = require('./lib/addb-api-client');
const config = require('./lib/config');
const logger = require('./lib/logger');
const errors = require('./lib/errors');
const Repository = require('./lib/repository');
const repository = new Repository();
const queueLogger = logger.child({ source: 'queue' });
const workerLogger = logger.child({ source: 'worker' });

const queueConfig = config.get('queue');
const botConfig = config.get('bot');
const botanConfig = config.get('botan');
const addbConfig = config.get('addb');
const botan = require('botanio')(botanConfig.token);
const updatesQueue = new Queue('updates', queueConfig.redis.port, queueConfig.redis.host);
const telegramApiClient = new TelegramApiClient(botConfig.token);
const addbApiClient = new AddbApiClient(addbConfig.key);
const inlineResultsPerPage = 10;
const maxIngredientsPerChat = 10;
const maxSearchResultsPerPage = 2;
const maxUnmatchedIngredients = 1;
const ingredientCodeRegEx = /^.*\((.+)\)$/;
const samples = ['orange', 'vodka', 'lime', 'rum', 'ice', 'mint', 'cinnamon', 'aperol', 'syrup'];
const ingredientTypes = {
  BaseSpirit: {
  },
  berries: {
    icon: '🍓',
    notSignificant: true
  },
  brandy: {
  },
  decoration: {
    notSignificant: true
  },
  fruits: {
    icon: '🍐',
    notSignificant: true
  },
  gin: {
  },
  ice: {
    notSignificant: true
  },
  mixers: {
    notSignificant: true
  },
  others: {
    notSignificant: true
  },
  rum: {
  },
  'spices-herbs': {
  },
  'spirits-other': {
  },
  tequila: {
  },
  vodka: {
  },
  whisky: {
  },
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

function getDrinkURL(drinkId) {
  return `http://www.absolutdrinks.com/en/drinks/${drinkId}`;
}

function getDrinkImageURL(drinkId) {
  return `http://assets.absolutdrinks.com/drinks/${drinkId}.png`;
}

function getRandomIngredient() {
  return samples[Math.floor(Math.random() * samples.length)];
}

function getChosenIngredientMessage(ingredient) {
  return `/add@${botConfig.name} *${ingredient.id}*`;
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

function getAddedIngredientMessage(ingredient) {
  return `Added ${ingredient}. ` +
    'You may add more ingredients or use /search to find matching drinks. ' +
    'To check already chosen ingredients use /list.';
}

function getTooManyIngredientsMessage() {
  return `You already have ${maxIngredientsPerChat} ingredients in this chat. I can't handle more.`;
}

function getIngredientExistsMessage() {
  return 'You already have one. You may check your ingredients with /list.';
}

function getNextPageHelpMessage() {
  return 'To view other results tap /next.';
}

function getNoMoreResultsMessage() {
  return 'No more search results. Modify your ingredients list and do /search again.';
}

function getInlineHelpMessage() {
  return 'Start typing an ingredient name. Tap for help.';
}

function getNoDrinksFoundMessage(helpMessage) {
  return 'I\'m sorry, but I couldn\'t find any matching drinks. ' +
    'Try the different set of ingredients. ' +
    `To add an ingredient, ${helpMessage}`;
}

function getIngredientListItem(item, isPrivate) {
  let base = `- *${item.ingredientName}* [(details)](${getIngredientURL(item.ingredientCode)})`;
  if (!isPrivate) {
    base += ` by ${item.getFullName()}`;
  }
  return base;
}

function getIngredientsListMessage(ingredients, isPrivate) {
  const list = ingredients
    .map(i => getIngredientListItem(i, isPrivate))
    .join('\n');
  const msg =
    `📋 Currently chosen ingredients:\n${list}\n` +
    'Hit /search to find matching drink recipes.\n' +
    'You may want to remove individual ingredients with /remove or start over with /clear.';
  return msg;
}

function getIntroductionMessage(helpMessage) {
  const msg =
    'Hey! I\'m here to help you to come up with party drink ideas based ' +
    'on which ingredients you have in your bar. Add me to the group chat and I\'ll suggest ' +
    'you recipes for ingredients people have on hand.\n' +
    'And yes, you have to be at least 18 years old and drink responsibly 🍸🍷🍹' +
    `\n\nTo try, ${helpMessage}`;
  return msg;
}

function getIngredientSearchHelp(chat) {
  const randomSearch = getRandomIngredient();
  const isPrivate = chat.type === 'private';
  let message = `in the message field type '@${botConfig.name} ${randomSearch}' ` +
    'as an example.';
  if (isPrivate) {
    message += ' Or press the button below 👇';
  }
  return {
    message,
    replyMarkup: isPrivate ? {
      inline_keyboard: [[{
        text: `💡 Try it now: ${randomSearch}`,
        switch_inline_query: randomSearch
      }]]
    } : null
  };
}

function sendNoChosenIngredientsMessage(chat) {
  const actionHelp = getIngredientSearchHelp(chat);
  const message = `No ingredients are chosen currently. To add one, ${actionHelp.message}`;
  return telegramApiClient.sendMessage(chat.id, message, actionHelp.replyMarkup);
}

function getUnmatchedIngredientsCount(ingredientsToCheck, ingredientHash) {
  return ingredientsToCheck.reduce((memo, ingredient) => {
    // If we have particular ingredient in chosen ingredients hash or
    // it is meant to be not significant, don't add up to unmatched count.
    if (
      ingredient.id in ingredientHash ||
      (ingredientTypes[ingredient.type] && ingredientTypes[ingredient.type].notSignificant)
    ) {
      return memo;
    }
    // Otherwise, ingredient is not matched.
    return ++memo;
  }, 0);
}

function pickMatchingDrinks(foundDrinks, ingredientHash) {
  // Filter all found drinks based on ingredients on hand.
  if (foundDrinks.result && foundDrinks.result.length) {
    const candidates = foundDrinks.result.reduce((memo, drink) => {
      const unmatchedCount = getUnmatchedIngredientsCount(drink.ingredients, ingredientHash);
      // Only consider drinks with limited unmatched ingredints count.
      if (unmatchedCount <= maxUnmatchedIngredients) {
        memo.push(drink);
      }
      return memo;
    }, []);
    // Order drinks by rating.
    return candidates.sort((a, b) => b.rating - a.rating);
  }
  return [];
}

function getDrinkVideoURL(drink) {
  if (drink.videos) {
    const youtube = drink.videos.find(el => el.type === 'youtube');
    if (youtube) {
      return `http://www.youtube.com/watch?v=${youtube.video}`;
    }
  }
  return null;
}

function getDrinkIngredients(drink, ingredientHash) {
  const existingIngredients = [];
  const ingredientsToGet = [];
  drink.ingredients.forEach(i => {
    if (i.id in ingredientHash) {
      existingIngredients.push(i.textPlain);
    } else {
      if (ingredientTypes[i.type] && ingredientTypes[i.type].notSignificant) {
        ingredientsToGet.push(i.textPlain);
      } else {
        ingredientsToGet.push(`[${i.textPlain}](${getIngredientURL(i.id)})`);
      }
    }
  });
  return {
    existing: existingIngredients.length ? existingIngredients.join(', ') : 'nothing',
    toGet: ingredientsToGet.length ? ingredientsToGet.join(', ') : 'nothing'
  };
}

function sendDrinkToChat(chatId, drink, ingredientHash) {
  const ingredients = getDrinkIngredients(drink, ingredientHash);
  const videoURL = getDrinkVideoURL(drink);
  /* eslint prefer-template: 0 */
  const message = `🍸 *${drink.name}* ` +
    (videoURL ? `[(video)](${videoURL}) ` : '') +
    `[(picture)](${getDrinkImageURL(drink.id)}) ` +
    `[(details)](${getDrinkURL(drink.id)})\n` +
    `*You have:* ${ingredients.existing}; *you'll need to get:* ${ingredients.toGet}\n` +
    `*Directions:* ${drink.descriptionPlain}\n` +
    getNextPageHelpMessage();

  return telegramApiClient.sendMessage(chatId, message, null, null, true);
}

function sendDrinksToChat(chatId, drinks, ingredientHash) {
  return drinks.reduce(
    (promise, drink) => promise.then(sendDrinkToChat(chatId, drink, ingredientHash)),
    Promise.resolve()
  );
}

function getIngredientHash(ingredientCodes) {
  return ingredientCodes.reduce((memo, item) => {
    memo[item] = true;
    return memo;
  }, {});
}

function handleCommand(command, parameter, message) {
  const chat = message.chat;
  switch (command) {
    case 'help':
    case 'start': {
      botan.track(message, 'Start');
      const actionHelp = getIngredientSearchHelp(chat);
      return telegramApiClient.sendMessage(
        chat.id,
        getIntroductionMessage(actionHelp.message),
        actionHelp.replyMarkup
      );
    }
    case 'list': {
      botan.track(message, 'List');
      return repository.getIngredients(chat.id)
        .then(ingredients => {
          if (!ingredients.length) {
            return sendNoChosenIngredientsMessage(chat);
          }
          return telegramApiClient.sendMessage(
            chat.id,
            getIngredientsListMessage(ingredients, chat.type === 'private')
          );
        });
    }
    case 'remove': {
      botan.track(message, 'Remove');
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
              message.message_id
            ));
        });
    }
    case 'search': {
      botan.track(message, 'Search');
      return repository.getIngredients(chat.id)
        .then(ingredients => {
          if (!ingredients.length) {
            return sendNoChosenIngredientsMessage(chat);
          }
          const ingredientCodes = ingredients.map(i => i.ingredientCode);
          const ingredientHash = getIngredientHash(ingredientCodes);
          return addbApiClient.getDrinks(ingredientCodes)
            .then(drinks => pickMatchingDrinks(drinks, ingredientHash))
            .then(drinks => {
              if (!drinks.length) {
                const actionHelp = getIngredientSearchHelp(chat);
                return telegramApiClient.sendMessage(
                  chat.id,
                  getNoDrinksFoundMessage(actionHelp.message),
                  actionHelp.replyMarkup
                );
              }
              const drinksToShow = drinks.splice(0, maxSearchResultsPerPage);
              // Send part of drinks to chat, save the rest to search results cache.
              return sendDrinksToChat(chat.id, drinksToShow, ingredientHash)
                .then(repository.saveSearchResults(chat.id, drinks));
            });
        });
    }
    case 'clear': {
      botan.track(message, 'Clear');
      return repository.clearIngredients(chat.id)
        .then(telegramApiClient.sendMessage(
          chat.id,
          getClearedIngredientsMessage()
        ));
    }
    case 'next': {
      botan.track(message, 'Next');
      return repository.fetchSearchResults(chat.id, maxSearchResultsPerPage)
        .then(results => {
          if (!results.length) {
            return telegramApiClient.sendMessage(chat.id, getNoMoreResultsMessage());
          }
          return repository.getIngredients(chat.id)
            .then(ingredients => {
              const ingredientCodes = ingredients.map(i => i.ingredientCode);
              const ingredientHash = getIngredientHash(ingredientCodes);
              const drinks = results.map(r => r.drinkObject);
              // Send next results page to chat and remove them from cache.
              return sendDrinksToChat(chat.id, drinks, ingredientHash)
                .then(Promise.all(results.map(r => r.destroy())));
            });
        });
    }
    default: {
      botan.track(message, 'Unrecognized');
      workerLogger.warn(`Unrecognized command ${command}`);
      return Promise.resolve();
    }
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
    handleCommand(command, parameter, message)
  ]);
}

function processNewIngredient(message) {
  const codeEntity = message.entities[0];
  const ingredientCode = message.text.substr(codeEntity.offset, codeEntity.length);
  botan.track(message, 'Add ingredient');
  // Check for existing ingredient.
  return repository.hasIngredient(ingredientCode, message.chat.id)
    .then(hasIngredient => {
      if (hasIngredient) {
        return telegramApiClient.sendMessage(message.chat.id, getIngredientExistsMessage());
      }
      // Check for maximum ingredients per chat.
      return repository.getIngredientsCount(message.chat.id)
        .then(count => {
          if (count >= maxIngredientsPerChat) {
            return telegramApiClient.sendMessage(message.chat.id, getTooManyIngredientsMessage());
          }
          // We may proceed if all checks are passed.
          return addbApiClient.getIngredient(ingredientCode)
            // Add ingredient.
            .then(i => repository.addIngredient(
              ingredientCode,
              i.name,
              i.type,
              i.description,
              message.chat.id,
              message.from
            ))
            // Send confirmation to chat.
            .then(i => telegramApiClient.sendMessage(
              message.chat.id,
              getAddedIngredientMessage(i.ingredientName)
            ));
        });
    });
}

function processIngredientRemoval(ingredientCode, message) {
  botan.track(message, 'Remove ingredient');
  return repository.removeIngredient(message.chat.id, ingredientCode)
    .then(repository.setChatMode(message.chat.id, ''))
    .then(telegramApiClient.sendMessage(
      message.chat.id,
      getRemovedIngredientMessage(message.text), {
        hide_keyboard: true
      }
    ));
}

function processInlineQuery(inlineQuery) {
  workerLogger.info(inlineQuery, 'Processing inline query update');
  const offset = parseInt(inlineQuery.offset, 10) || 0;

  // Display inline mode help button.
  if (!inlineQuery.query) {
    botan.track(inlineQuery, 'Empty inline query');
    return telegramApiClient.sendInlineQueryAnswer({
      inline_query_id: inlineQuery.id,
      results: [],
      switch_pm_text: getInlineHelpMessage(),
      switch_pm_parameter: 'hint'
    });
  }

  // Return list of found ingredients.
  botan.track(inlineQuery, 'Inline query');
  return addbApiClient.searchIngredients(inlineQuery.query, offset, inlineResultsPerPage)
    .then(r => {
      if (r.result && r.result.length) {
        const queryResults = r.result.map(ingredient => ({
          type: 'article',
          id: ingredient.id,
          title: ingredient.name,
          description: ingredient.description,
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

function parseIngredientCode(messageText) {
  if (typeof messageText === 'string') {
    const matches = messageText.match(ingredientCodeRegEx);
    if (matches && matches.length) {
      return matches[1];
    }
  }
  return null;
}

function executeJob(job) {
  const update = job.data;
  workerLogger.debug(update, 'Received an update');

  // Handle inline ingredients search query.
  if (update.inline_query) {
    return processInlineQuery(update.inline_query);
  }

  if (update.message) {
    if (update.message.entities && update.message.entities.length) {
      // Handle bot command.
      if (update.message.entities[0].type === 'bot_command') {
        return processCommand(update.message);
      }

      // Handle chosen ingredient message.
      if (update.message.text.startsWith('/add') && update.message.entities[0].type === 'bold') {
        return processNewIngredient(update.message);
      }
    }

    // Try to guess ingredient code from the message.
    const ingredientCode = parseIngredientCode(update.message.text);
    if (ingredientCode) {
      // It's possible that user tries tu remove an ingredient. Check chat mode.
      return repository.getChatMode(update.message.chat.id).then(chatMode => {
        if (chatMode === 'remove') {
          // Handle ingredient removal.
          return processIngredientRemoval(ingredientCode, update.message);
        }

        // False alarm, just skip this update.
        workerLogger.debug(
          `Skipping update ${update.update_id} with ingredient code, was not in any related mode`
        );
        return Promise.resolve();
      });
    }
  }

  // ... or just skip unrecognized update.
  workerLogger.debug(`Skipping update ${update.update_id}`);
  return Promise.resolve();
}

updatesQueue.process((job, done) => {
  executeJob(job)
    .then(() => done())
    .catch(err => {
      // Log the error.
      workerLogger.error(err, 'Worker error');

      // Check for error type and decide on job retrying.
      if (err instanceof errors.HttpError) {
        if (err.status >= 400 && err.status < 500) {
          // Skip retrying for any client errors.
          workerLogger.info('Skip retrying the job due to unrecoverable client error.');
          return done();
        }
      }

      // Retry on any other error types.
      return done(err);
    });
});

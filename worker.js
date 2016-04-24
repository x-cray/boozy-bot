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
  return `Added ${ingredient}.`;
}

function getTooManyIngredientsMessage() {
  return `You already have ${maxIngredientsPerChat} ingredients in this chat. I can't handle more.`;
}

function getIngredientExistsMessage() {
  return 'You already have one.';
}

function getNextPageHelpMessage() {
  return 'Hit /next to show next results.';
}

function getNoMoreResultsMessage() {
  return 'No more search results. Modify your ingredients list and do /search again.';
}

function getInlineHelpMessage() {
  return 'Start typing an ingredient name. Tap for help.';
}

function getNoDrinksFoundMessage() {
  return 'I\'m sorry, but I couldn\'t find any matching drinks. ' +
    'Try the different set of ingredients.';
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
    `Currently chosen ingredients:\n${list}\n` +
    'Hit /search to find matching drink recipes.\n' +
    'You may want to remove individual ingredients with /remove or start over with /clear.';
  return msg;
}

function getIntroductionMessage(helpMessage) {
  const msg =
    '🎉 Hey! I\'m here to help you to come up with party drink ideas based ' +
    'on which ingredients you have in your bar. Add me to the group chat and I\'ll suggest ' +
    'you recipes for ingredients people have on hand.\n' +
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
        })
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

function processIngredientRemoval(ingredientCode, message) {
  return repository.removeIngredient(message.chat.id, ingredientCode)
    .then(repository.setChatMode(message.chat.id, ''))
    .then(telegramApiClient.sendMessage(
      message.chat.id,
      getRemovedIngredientMessage(message.text), {
        hide_keyboard: true
      }
    ));
}

function getUnmatchedIngredientsCount(ingredientsToCheck, ingredientHash) {
  return ingredientsToCheck.reduce((memo, ingredient) => {
    // If we have particular ingredient in chosen ingredients hash or
    // it is meant to be not significant, don't add up to unmatched count.
    if (ingredient.id in ingredientHash || ingredientTypes[ingredient.type].notSignificant) {
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
      if (ingredientTypes[i.type].notSignificant) {
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
  let message = `*${drink.name}* ` +
    `[(picture)](${getDrinkImageURL(drink.id)}) ` +
    `[(details)](${getDrinkURL(drink.id)})\n` +
    `*You have:* ${ingredients.existing}; *you'll need to get:* ${ingredients.toGet}\n` +
    `*Directions:* ${drink.descriptionPlain}`;
  const videoURL = getDrinkVideoURL(drink);
  if (videoURL) {
    message += `\n[Watch how-to video](${videoURL})`;
  }
  message += `\n${getNextPageHelpMessage()}`;
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

function handleCommand(command, parameter, messageId, chat) {
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
            getIngredientsListMessage(ingredients, chat.type === 'private')
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
    case 'search':
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
                return telegramApiClient.sendMessage(chat.id, getNoDrinksFoundMessage());
              }
              const drinksToShow = drinks.splice(0, maxSearchResultsPerPage);
              // Send part of drinks to chat, save the rest to search results cache.
              return sendDrinksToChat(chat.id, drinksToShow, ingredientHash)
                .then(repository.saveSearchResults(chat.id, drinks));
            });
        });
    case 'clear':
      return repository.clearIngredients(chat.id)
        .then(telegramApiClient.sendMessage(
          chat.id,
          getClearedIngredientsMessage()
        ));
    case 'next':
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
    handleCommand(command, parameter, message.message_id, message.chat)
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

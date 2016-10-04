/* @flow */
'use strict';

const config = require('./lib/config');
const botConfig = config.get('bot');
const samples = ['orange', 'vodka', 'lime', 'rum', 'ice', 'mint', 'cinnamon', 'aperol', 'syrup'];

module.exports = {
  maxIngredientsPerChat: 10,

  ingredientTypes: {
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
  },

  getIngredientURL(ingredientId) {
    return `http://www.absolutdrinks.com/en/drinks/with/${ingredientId}/`;
  },

  getIngredientThumbnailURL(ingredientId) {
    return `http://assets.absolutdrinks.com/ingredients/200x200/${ingredientId}.png`;
  },

  getDrinkThumbnailURL(drinkId) {
    return `http://assets.absolutdrinks.com/ingredients/200x200/${drinkId}.png`;
  },

  getDrinkURL(drinkId) {
    return `http://www.absolutdrinks.com/en/drinks/${drinkId}`;
  },

  getDrinkVideoURL(drink) {
    if (drink.videos) {
      const youtube = drink.videos.find(el => el.type === 'youtube');
      if (youtube) {
        return `http://www.youtube.com/watch?v=${youtube.video}`;
      }
    }
    return null;
  },

  getDrinkImageURL(drinkId) {
    return `http://assets.absolutdrinks.com/drinks/${drinkId}.png`;
  },

  getRandomIngredient() {
    return samples[Math.floor(Math.random() * samples.length)];
  },

  getChosenIngredientMessage(ingredient) {
    return `/add@${botConfig.name} *${ingredient.id}*`;
  },

  getClearedIngredientsMessage() {
    return 'Cleared available ingredients.';
  },

  getRemoveIngredientMessage() {
    return 'Which ingredient you would like to remove?';
  },

  getRemovedIngredientMessage(ingredient) {
    return `Removed ${ingredient}.`;
  },

  getAddedIngredientMessage(ingredient) {
    return `Added ${ingredient}. ` +
      'You may add more ingredients or use /search to find matching drinks. ' +
      'To check already chosen ingredients use /list.';
  },

  getTooManyIngredientsMessage() {
    return `You already have ${this.maxIngredientsPerChat} ingredients in this chat.` +
      ' I can\'t handle more.';
  },

  getIngredientExistsMessage() {
    return 'You already have one. You may check your ingredients with /list.';
  },

  getNextPageHelpMessage() {
    return 'To view other results tap /next.';
  },

  getNoMoreResultsMessage() {
    return 'No more search results. Modify your ingredients list and do /search again.';
  },

  getInlineHelpMessage() {
    return 'Start typing an ingredient or drink name. Tap for help.';
  },

  getNoDrinksFoundMessage(helpMessage) {
    return 'I\'m sorry, but I couldn\'t find any matching drinks. ' +
      'Try the different set of ingredients. ' +
      `To add an ingredient, ${helpMessage}`;
  },

  getIngredientListItem(item, isPrivate) {
    let base = `- *${item.ingredientName}* ` +
      `[(details)](${this.getIngredientURL(item.ingredientCode)})`;
    if (!isPrivate) {
      base += ` by ${item.getFullName()}`;
    }
    return base;
  },

  getDrinkMessage(drink, ingredientHash) {
    const ingredients = this.getDrinkIngredients(drink, ingredientHash);
    const videoURL = this.getDrinkVideoURL(drink);
    /* eslint prefer-template: 0 */
    return `🍸 *${drink.name}* ` +
      (videoURL ? `[(video)](${videoURL}) ` : '') +
      `[(picture)](${this.getDrinkImageURL(drink.id)}) ` +
      `[(details)](${this.getDrinkURL(drink.id)})\n` +
      `*You have:* ${ingredients.existing}; *you'll need to get:* ${ingredients.toGet}\n` +
      `*Directions:* ${drink.descriptionPlain}\n` +
      this.getNextPageHelpMessage();
  },

  getDrinkIngredients(drink, ingredientHash) {
    const existingIngredients = [];
    const ingredientsToGet = [];
    drink.ingredients.forEach(i => {
      if (i.id in ingredientHash) {
        existingIngredients.push(i.textPlain);
      } else {
        if (this.ingredientTypes[i.type] && this.ingredientTypes[i.type].notSignificant) {
          ingredientsToGet.push(i.textPlain);
        } else {
          ingredientsToGet.push(`[${i.textPlain}](${this.getIngredientURL(i.id)})`);
        }
      }
    });
    return {
      existing: existingIngredients.length ? existingIngredients.join(', ') : 'nothing',
      toGet: ingredientsToGet.length ? ingredientsToGet.join(', ') : 'nothing'
    };
  },

  getIngredientsListMessage(ingredients, isPrivate) {
    const list = ingredients
      .map(i => this.getIngredientListItem(i, isPrivate))
      .join('\n');
    const msg =
      `📋 Currently chosen ingredients:\n${list}\n` +
      'Hit /search to find matching drink recipes.\n' +
      'You may want to remove individual ingredients with /remove or start over with /clear.';
    return msg;
  },

  getIntroductionMessage(helpMessage) {
    const msg =
      'Hey! I\'m here to help you to come up with party drink ideas based ' +
      'on which ingredients you have in your bar. Add me to the group chat and I\'ll suggest ' +
      'you recipes for ingredients people have on hand.\n' +
      'And yes, you have to be at least 18 years old and drink responsibly 🍸🍷🍹' +
      `\n\nTo try, ${helpMessage}`;
    return msg;
  },

  getIngredientSearchHelp(chat) {
    const randomSearch = this.getRandomIngredient();
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
  },

  getNoChosenIngredientsMessage(chat) {
    const actionHelp = this.getIngredientSearchHelp(chat);
    return {
      message: `No ingredients are chosen currently. To add one, ${actionHelp.message}`,
      replyMarkup: actionHelp.replyMarkup
    };
  }
};

/* @flow */
'use strict';

const sequelize = require('./sequelize');
const models = require('./models');

// Sync all models that aren't already in the database
sequelize.sync();

class Repository {
  addLoggedCommand(command, parameter, user) {
    const logEntry = models.LoggedCommand.build({
      command,
      parameter,
      userId: user.id,
      username: user.username,
      userFirstName: user.first_name,
      userLastName: user.last_name
    });

    return logEntry.save();
  }

  hasIngredient(ingredientCode, chatId, userId) {
    return models.Ingredient.count({ where: {
      ingredientCode,
      chatId,
      userId
    } }).then(c => !!c);
  }

  addIngredient(ingredientCode, ingredientName, ingredientDescription, chatId, user) {
    const ingredient = models.Ingredient.build({
      ingredientCode,
      ingredientName,
      ingredientDescription,
      chatId,
      userId: user.id,
      username: user.username,
      userFirstName: user.first_name,
      userLastName: user.last_name
    });

    return ingredient.save();
  }

  getIngredients(chatId) {
    return models.Ingredient.all({ where: { chatId } });
  }

  clearIngredients(chatId) {
    return models.Ingredient.destroy({ where: { chatId } });
  }
}

module.exports = Repository;

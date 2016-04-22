/* @flow */
'use strict';

const sequelize = require('./sequelize');
const models = require('./models');

// Sync all models that aren't already in the database
sequelize.sync();

class Repository {
  getChatMode(id) {
    return models.ChatMode.findOne({ where: { id } })
      .then(m => (m ? m.mode : null));
  }

  setChatMode(id, mode) {
    return models.ChatMode.upsert({ id, mode });
  }

  addLoggedCommand(command, parameter, user) {
    return models.LoggedCommand.create({
      command,
      parameter,
      userId: user.id,
      username: user.username,
      userFirstName: user.first_name,
      userLastName: user.last_name
    });
  }

  hasIngredient(ingredientCode, chatId, userId) {
    return models.Ingredient.count({ where: {
      ingredientCode,
      chatId,
      userId
    } }).then(c => !!c);
  }

  addIngredient(ingredientCode, ingredientName, ingredientType, ingredientDescription, chatId, user) {
    return models.Ingredient.create({
      ingredientCode,
      ingredientName,
      ingredientType,
      ingredientDescription,
      chatId,
      userId: user.id,
      username: user.username,
      userFirstName: user.first_name,
      userLastName: user.last_name
    });
  }

  getIngredients(chatId) {
    return models.Ingredient.all({ where: { chatId } });
  }

  removeIngredient(chatId, ingredientCode) {
    return models.Ingredient.destroy({ where: { ingredientCode, chatId } });
  }

  clearIngredients(chatId) {
    return models.Ingredient.destroy({ where: { chatId } });
  }
}

module.exports = Repository;

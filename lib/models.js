/* @flow */
'use strict';

const Sequelize = require('sequelize');
const sequelize = require('./sequelize');

function getFullName() {
  return [this.userFirstName, this.userLastName].join(' ');
}

const LoggedCommand = sequelize.define('logged_command', {
  id: {
    type: Sequelize.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  command: Sequelize.STRING,
  parameter: Sequelize.STRING(512),
  username: Sequelize.STRING,
  userId: {
    type: Sequelize.INTEGER,
    field: 'user_id'
  },
  userFirstName: {
    type: Sequelize.STRING,
    field: 'user_first_name'
  },
  userLastName: {
    type: Sequelize.STRING,
    field: 'user_last_name'
  }
}, {
  indexes: [{
    fields: ['command']
  }, {
    fields: ['user_id']
  }],
  underscored: true,
  instanceMethods: { getFullName }
});

const Ingredient = sequelize.define('ingredient', {
  id: {
    type: Sequelize.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  ingredientCode: {
    type: Sequelize.STRING,
    field: 'ingredient_code'
  },
  ingredientName: {
    type: Sequelize.STRING,
    field: 'ingredient_name'
  },
  ingredientDescription: {
    type: Sequelize.STRING(512),
    field: 'ingredient_description'
  },
  chatId: {
    type: Sequelize.INTEGER,
    field: 'chat_id'
  },
  username: Sequelize.STRING,
  userId: {
    type: Sequelize.INTEGER,
    field: 'user_id'
  },
  userFirstName: {
    type: Sequelize.STRING,
    field: 'user_first_name'
  },
  userLastName: {
    type: Sequelize.STRING,
    field: 'user_last_name'
  }
}, {
  indexes: [{
    fields: ['ingredient_code']
  }, {
    fields: ['chat_id']
  }, {
    fields: ['user_id']
  }],
  underscored: true,
  instanceMethods: { getFullName }
});

module.exports = {
  LoggedCommand,
  Ingredient
};

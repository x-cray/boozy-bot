/* @flow */
'use strict';

const Sequelize = require('sequelize');
const logger = require('./logger');
const config = require('./config');
const dbConfig = config.get('db');
const sequelize = new Sequelize(dbConfig.name, dbConfig.user, dbConfig.password, {
  host: dbConfig.host,
  dialect: 'mysql',
  logging: logger.child({ source: 'orm' }).info,
  benchmark: true
});

module.exports = sequelize;

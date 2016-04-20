/* @flow */
'use strict';

const Sequelize = require('sequelize');
const logger = require('./logger');
const config = require('./config');
const dbConfig = config.get('db');
const ormLogger = logger.child({ source: 'orm' });
const sequelize = new Sequelize(dbConfig.name, dbConfig.user, dbConfig.password, {
  host: dbConfig.host,
  dialect: 'mysql',
  logging: ormLogger.debug.bind(ormLogger),
  benchmark: true
});

module.exports = sequelize;

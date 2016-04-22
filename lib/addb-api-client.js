/* @flow */
'use strict';

const fetch = require('node-fetch');
const logger = require('./logger');
const addbLogger = logger.child({ source: 'addb' });

function ensureJsonResult(result) {
  if (!result.ok) {
    addbLogger.debug(result, 'Received error from ADDB');
    return {};
  }
  return result.json();
}

class AddbApiClient {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('Addb API key is not provided');
    }

    this.apiKey = apiKey;
    this.apiRoot = 'https://addb.absolutdrinks.com';
  }

  getUrl(path) {
    return `${this.apiRoot}${path}?apiKey=${this.apiKey}`;
  }

  searchIngredients(query, offset, pageSize) {
    const prefix = this.getUrl(`/quickSearch/ingredients/${query}`);
    const url = `${prefix}&pageSize=${pageSize}&start=${offset}`;
    return fetch(url).then(ensureJsonResult);
  }

  getIngredient(ingredientCode) {
    const url = this.getUrl(`/ingredients/${ingredientCode}`);
    return fetch(url).then(ensureJsonResult);
  }

  getDrinks(ingredientCodes) {
    const query = ingredientCodes.join('/or/');
    const prefix = this.getUrl(`/drinks/with/${query}/`);
    const url = `${prefix}&pageSize=100`;
    return fetch(url).then(ensureJsonResult);
  }
}

module.exports = AddbApiClient;

/* @flow */
'use strict';

const fetch = require('node-fetch');

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
    return fetch(url)
      .then(r => r.ok ? r.json() : {});
  }
}

module.exports = AddbApiClient;

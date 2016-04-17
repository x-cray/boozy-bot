/* @flow */
'use strict';

const toureiro = require('toureiro');
const config = require('./lib/config');
const app = toureiro(config.get('queue'));

app.listen(3000, () => {
  console.log('Toureiro is now listening at port 3000...');
});

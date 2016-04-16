/* @flow */
'use strict';

import nconf from 'nconf';
import path from 'path';

nconf
	.argv()
	.env('__')
	.file('global', path.join(__dirname, '../config.json'));

export default nconf;

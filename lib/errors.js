/* @flow */
'use strict';

function HttpError(status, statusText, apiError) {
  this.status = status;
  this.statusText = statusText;
  this.apiError = apiError;
}

module.exports = {
  HttpError
};

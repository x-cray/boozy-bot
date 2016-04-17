'use strict';

const bunyan = require('bunyan');
const bunyanFormat = require('bunyan-format');
const bunyanLogentries = require('bunyan-logentries');
const config = require('./config');
const logentriesConfig = config.get('logentries');
let logentriesStream = null;

function getFullErrorStack(ex) {
  let ret = ex.stack || ex.toString();
  if (ex.cause && typeof (ex.cause) === 'function') {
    const cex = ex.cause();
    if (cex) {
      ret += `\nCaused by: ${getFullErrorStack(cex)}`;
    }
  }
  return ret;
}

function errSerializer(err) {
  if (!err || !err.stack) {
    return err;
  }

  const obj = {
    message: err.message,
    name: err.name,
    stack: getFullErrorStack(err),
    code: err.code,
    signal: err.signal,
    details: err.details
  };

  if (err.errors && err.errors.length) {
    obj.errors = err.errors.map(errSerializer);
  }

  return obj;
}

const formatOut = bunyanFormat({ outputMode: 'short', color: require('supports-color') });

const logStreams = [{
  level: 'debug',
  stream: formatOut
}];

const log = bunyan.createLogger({
  name: 'boozy-bot',
  serializers: {
    err: errSerializer
  },
  streams: logStreams
});

if (logentriesConfig.enabled) {
  logentriesStream = bunyanLogentries.createStream(logentriesConfig);
  logStreams.push({
    type: 'raw',
    stream: logentriesStream
  });
}

log.close = function close() {
  if (logentriesStream) {
    logentriesStream.end();
  }
};

module.exports = log;

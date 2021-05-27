/**
 * Created by 弘树<dickeylth@live.cn> on 16/3/22.
 * Logger wrapper
 */
"use strict";

const _ = require('lodash');
const chalk = require('chalk');

const defaultLogger = {
  raw: (msg) => {
    console.log(msg);
  },
  info: (msg) => {
    console.log(chalk.blue(`>> ${msg}`));
  },
  ok: (msg) => {
    console.log(chalk.green(`>> ${msg}`));
  },
  warn: (msg) => {
    console.log(chalk.yellow(`[!] ${msg}`));
  },
  error: (msg) => {
    console.log(chalk.red(`[!] ${msg}`));
  },
  verbose: {}
};

Object.keys(defaultLogger).forEach(logType => {
  defaultLogger.verbose[logType] = msg => {
    if (process.argv.indexOf('--verbose') !== -1) {
      defaultLogger[logType](msg);
    }
  };
});

module.exports = (logger) => {
  return _.defaultsDeep(logger, defaultLogger);
};

/**
 * Created by 弘树<dickeylth@live.cn> on 16/4/19.
 */
// create cert when you want to use https features
// please manually trust this rootCA when it is the first time you run it
"use strict";

const certMgr = require('anyproxy').utils.certMgr;
const isRootCAFileExists = certMgr.isRootCAFileExists;

if (isRootCAFileExists && !isRootCAFileExists()) {
  certMgr.generateRootCA(() => {
    console.log('Root certification generated.');
  });
}

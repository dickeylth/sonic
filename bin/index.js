#!/usr/bin/env node

/**
 * Created by 弘树<dickeylth@live.cn> on 16/3/28.
 */

"use strict";

const fs = require('fs');
const path = require('path');
const argv = require('minimist')(process.argv.slice(2));
const merge = require('lodash').merge;
const UtilsLib = require('../lib/utils');

if (argv.h || argv.help) {
  // 输出 help
  console.log(`
  Usage: sonic [options]

  Options:

    -h, --help                                   查看帮助
    -v, --version                                查看版本号
    -w, --webpackConfig [value]                  webpack.config.js 配置文件路径
    -s, --serverPort [value]                     本地静态资源服务端口号
    -p, --proxyPort [value]                      代理服务工作端口号
    --hosts [value]                              需要代理的本地虚拟域名, 请以 ',' 分隔
    --https                                      是否切换到 https
  `);

} else if (argv.v || argv.version) {

  console.log(require('../package.json').version);

} else {
  const Sonic = require('../index');
  const PWD = process.cwd();
  const CONFIG_FILE = 'sonic.config.js';
  const CONFIG_FILE_PATH = path.join(PWD, CONFIG_FILE);

  let options = require('../lib/constants').defaultOptions;

  // 合并本地配置文件
  if (fs.existsSync(CONFIG_FILE_PATH)) {
    try {
      options = merge(options, require(CONFIG_FILE_PATH));
    } catch (e) {
      console.error('Error parsing sonic config file from: ' + CONFIG_FILE_PATH);
      return;
    }
  }

  // 合并命令行参数配置
  var cliOptions = {
    webpackConfig: argv.w || argv.webpackConfig,
    serverPort: argv.s || argv.serverPort,
    proxyPort: argv.p || argv.proxyPort,
    hosts: argv.hosts && argv.split(',') || [],
    https: argv.https
  };
  Object.keys(cliOptions).forEach(opt => {
    !cliOptions[opt] && delete cliOptions[opt];
  });

  var mergeOptions = merge(options, cliOptions);

  // write to local file
  if (!fs.existsSync(CONFIG_FILE_PATH)) {
    fs.writeFileSync(CONFIG_FILE_PATH, `
var PWD = process.cwd();
module.exports = {

  // webpack 配置, 可为 webpack.config.js 路径或 webpack 配置对象
  webpackConfig: '${mergeOptions.webpackConfig}',

  // 本地静态资源服务端口号
  serverPort: ${mergeOptions.serverPort},

  // 需要代理的 hosts 字符串数组
  hosts: [${mergeOptions.hosts.map(h => '"' + h + '"').join(',')}],

  // 是否显示 webpack 编译进度
  progress: true,

  // 是否禁用控制台 log 输出
  silent: false,

  // 本地代理服务端口号
  proxyPort: ${mergeOptions.proxyPort},

  // Anyproxy 的 web 请求监控页面端口号
  webPort: 8002,

  // Anyproxy 的 websocket 请求工作端口号
  socketPort: 8003,

  // 是否自动注入 HMR
  injectHMR: true,

  // 注入 WindVane 脚本路径, 自动在 WindVane 容器下注入 windvane.js, 如不需要设置为 false 即可
  injectWV: '${mergeOptions.injectWV}',

  // 是否切换到 https
  https: ${!!mergeOptions.https},

  // 内容根目录
  contentBase: PWD,

  // 是否仅启动静态资源服务, 而不基于 webpack-dev-server
  pureStatic: false,

  // 是否在浏览器自动打开 Url
  openBrowser: true,

  // 默认开启的路径
  openPath: '/',

  // 要 mock 的请求 url 应该匹配的正则表达式
  mockRegExp: ${mergeOptions.mockRegExp},

  /**
   * 接口 mock 处理函数
   * @param requestUrl {String} 请求 URL
   * @param response {Object} 服务端响应
   * @param response.headers {Object} 响应头
   * @param response.body {Object|String}  响应体, 如果是 JSON / JSONP, 自动转为 JSON 对象
   * @returns {Object} 返回可 JSON 序列化的对象
   */
  mockFunction: (requestUrl, response) => {
    return response.body;
  },

  // hosts 映射表, 域名 - IP 键值对
  hostsMap: {},

  // 需要匹配的资源 combo regexp
  assetsComboRegExp: /$^/,

  /**
   * 拆分 combo 到本地
   * @param comboUrl {String} combo url
   * @param comboParts {Array} combo parts
   * @returns {Array} 映射到本地的路径, 相对当前工作目录
   */
  assetsComboMapLocal: (comboUrl, comboParts) => {
    return comboParts;
  },

  // 需要修改的 HTML 页面的 URL 匹配正则
  htmlInterceptReg: /$^/,

  /**
   * HTML 操作函数
   * @param reqUrl {String} 请求 URL
   * @param reqHeaders {Object} 请求头
   * @param resHeaders {Object} 响应头
   * @param $ {Object} jQuery 对象
   * @param commentNodes {Array} 注释节点
   * @param logger {Object}
   * @param callback {Function} 回调
   */
  htmlModify: (reqUrl, reqHeaders, resHeaders, $, commentNodes, logger, cb) => {
    cb($.html());
  },

  // webpack-dev-server stats options
  webpackStatsOption: {}
}
    `);
  }

  UtilsLib.reBindMockFns(mergeOptions, ['mockFunction', 'htmlModify', 'assetsComboMapLocal'], CONFIG_FILE_PATH);

  Sonic(mergeOptions);

}

/**
 * Created by 弘树<dickeylth@live.cn> on 16/3/2.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const PWD = process.cwd();

const USER_HOME_PATH = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
const DEFAULT_USER_DIR = path.join(USER_HOME_PATH, '.clam-devserver-chrome');
let DEFAULT_BROWSER = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_CANARY_BROWSER = '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary';

// 优先使用 Google Chrome Canary
if (fs.existsSync(CHROME_CANARY_BROWSER)) {
  DEFAULT_BROWSER = CHROME_CANARY_BROWSER;
}

const anyproxyCertDir = path.join(USER_HOME_PATH, '.anyproxy/certificates');

const Constants = {
  USER_HOME_PATH,
  DEFAULT_USER_DIR,
  DEFAULT_BROWSER,
  HTTPS: {
    CERT_DIR: anyproxyCertDir,
    CA: path.join(anyproxyCertDir, 'rootCA.crt')
  },
  WV_SCRIPT: 'https://g.alicdn.com/mtb/lib-windvane/2.1.8/windvane.js',
  COMBO_SIGN: '??',
  COMBO_SEP: ','
};

Constants.defaultOptions = {

  // webpack 配置, 可为 webpack.config.js 路径或 webpack 配置对象
  webpackConfig: 'webpack.config.js',

  // 本地静态资源服务端口号
  serverPort: 8081,

  // 需要代理的 hosts 字符串数组
  hosts: [
    'dev.m.taobao.com',
    'dev.wapa.taobao.com',
    'dev.waptest.taobao.com'
  ],

  // 是否显示 webpack 编译进度
  progress: true,

  // 是否禁用控制台 log 输出
  silent: false,

  // 本地代理服务端口号
  proxyPort: 8080,

  // Anyproxy 的 web 请求监控页面端口号
  webPort: 8002,

  // Anyproxy 的 websocket 请求工作端口号
  socketPort: 8003,

  // weex 页面 reloader websocket 端口号
  weexPageReloadPort: 8082,

  // 是否自动注入 HMR
  injectHMR: true,

  // 注入 WindVane 脚本路径, 自动在 WindVane 容器下注入 windvane.js, 如不需要设置为 `false` 即可
  injectWV: Constants.WV_SCRIPT,

  // 是否切换到 https
  https: false,

  // 是否自动注入 CORS 响应头
  corsInject: false,

  // 内容根目录
  contentBase: PWD,

  // 是否仅启动静态资源服务, 而不基于 webpack-dev-server
  pureStatic: false,

  // 是否在浏览器自动打开 Url
  openBrowser: true,

  // 默认开启的路径
  openPath: '/',

  // 新起 Chrome 基于的用户目录绝对路径
  chromeUserDir: DEFAULT_USER_DIR,

  // 浏览器程序路径(mac 下 Chrome)
  browserApp: DEFAULT_BROWSER,

  // 要 mock 的请求 url 应该匹配的正则表达式
  mockRegExp: /api\.(waptest|wapa|m)\.taobao\.com/i,

  // 接口 mock 处理函数
  mockFunction: (requestUrl, response) => {

    const url = require('url');

    let parsedReqUrl = url.parse(requestUrl, true);
    let params = parsedReqUrl.query;
    let responseBody = response.body;

    switch (params.api) {
      // case '...':
      //   responseBody.test = 12345;
      //   break;
      default:
        responseBody.default = true;
        break;
    }

    return response.body;
  },

  // hosts 映射表, 域名 - IP 键值对
  hostsMap: {},

  // html 拦截请求 URL 正则
  htmlInterceptReg: /$^/,

  // HTML 操作函数
  htmlModify: (reqUrl, reqHeaders, resHeaders, $, commentNodes, logger, cb) => {
    cb($.html());
  },

  // 二维码插件
  qrcodeMiddleWare: true,

  // webpack-dev-server stats options
  webpackStatsOption: {}
};

module.exports = Constants;

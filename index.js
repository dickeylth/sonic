/**
 * Created by 弘树<dickeylth@live.cn> on 16/3/21.
 * http://gitlab.alibaba-inc.com/trip-tools/sonic
 *
 * Copyright (c) 2016 弘树
 * Licensed under the MIT license.
 */
"use strict";

const os = require('os');
const fs = require('fs');
const url = require('url');
const path = require('path');
const chalk = require('chalk');
const EventEmitter = require('events');
const PWD = process.cwd();
const _ = require('lodash');
const portfinder = require('portfinder');
const co = require('co');

// 先禁用掉 Anyproxy 的 Log
const anyproxyLog = require('anyproxy/lib/log');
anyproxyLog.setPrintStatus(false);

const proxy = require('anyproxy');
const certMgr = proxy.utils.certMgr;
const express = require('express');
const serveIndex = require('serve-index');
const open = require('open');
const shell = require('shelljs');
const ws = require('ws');
const WebSocketServer = ws.Server;
const utilsLib = require('./lib/utils');
const localIp = utilsLib.getLocalIp();
const initLogger = require('./lib/logger');
const Constants = require('./lib/constants');
const execSync = require('child_process').execSync;

const isArm64 = () => {
  return execSync('uname -m').toString().trim() === 'arm64';
}

const checkHttpsCA = (options) => {
  // create cert when you want to use https features
  // please manually trust this rootCA when it is the first time you run it
  if (options.https && !certMgr.isRootCAFileExists()) {
    shell.exec(`node ${__dirname}/lib/cert.js`, {
      silent: false
    });
    // console.log('\n>> 请先参考 https://github.com/alibaba/anyproxy/wiki/HTTPS%E7%9B%B8%E5%85%B3%E6%95%99%E7%A8%8B 完成证书配置!');
    console.log('\n>> 请先参考 http://anyproxy.io/cn/#osx%E7%B3%BB%E7%BB%9F%E4%BF%A1%E4%BB%BBca%E8%AF%81%E4%B9%A6 完成证书配置!');
    console.log('>> 然后重新执行命令启动服务');
    process.exit();
  }
}

/**
 * 初始化 proxy
 * @param options
 * @param logger
 */
const initProxy = (options, logger) => {

  options.logger = logger;

  const proxyOptions = {
    type: 'http',
    port: options.proxyPort,
    hostname: 'localhost',
    rule: require('./lib/anyproxy4-rule')(options),

    // optional, save request data to a specified file, will use in-memory db if not specified
    // dbFile        : null,

    // optional, port for web interface
    webPort: options.webPort,

    // optional, internal port for web socket,
    // replace this when it is conflict with your own service
    socketPort: options.socketPort,

    // optional, speed limit in kb/s
    // throttle      : 10,

    // optional, set it when you don't want to use the web interface
    // disableWebInterface : false,

    // optional, do not print anything into terminal. do not set it when you are still debugging.
    silent: options.silent,
    interceptHttps: true,
    dangerouslyIgnoreUnauthorized: true
  };

  new proxy.ProxyServer(proxyOptions).start();
};

/**
 * 创建 weex reload socket server
 * @param options {Object} 配置项
 * @param logger {Object}
 * @returns {*}
 * @constructor
 */
function WeexReloadSocket(options, logger) {
  const wss = new WebSocketServer({ port: options.weexPageReloadPort });
  const self = this;

  wss.on('connection', wsClient => {
    logger.verbose.ok('>> Socket connection conneted for weex reload');
    self.ws = wsClient;
    wsClient.on('message', message => {
      logger.verbose.info('>> Weex reload socket received: %s', message);
    });
    // ws.send('something');
  });
  return self;
}

/**
 * 打印本地服务配置
 * @param options
 * @param logger
 */
const printServerTable = (options, logger) => {
  logger.ok(`
-------------- 服务配置 --------------
本地 IP 地址\t=> ${options.localIp}
本地代理服务\t=> ${options.localIp}:${options.proxyPort}
静态资源服务\t=> http://${options.localIp}:${options.serverPort}
请求代理监控\t=> http://localhost:${options.webPort}
-------------- 服务配置 --------------
  `);
};

/**
 * 本地静态服务 setHeaders 共用逻辑
 * @param res
 * @param filePath
 * @constructor
 */
const StaticSetHeaders = (res, filePath) => {
  if (/\.jsbundle/.test(filePath)) {
    res.type('js');
  }
};

const weexReqMiddleWare = require('./lib/wx-middleware');
const qrcodeReqMiddleWare = require('./lib/qr-middleware');

const corsMiddleWare = (req, res, next) => {
  if (req.headers.origin) {
    res.set('Access-Control-Allow-Origin', req.headers.origin);
  } else if (req.headers.referer) {
    const refererObj = url.parse(req.headers.referer);
    res.set('Access-Control-Allow-Origin', `${refererObj.protocol}//${refererObj.host}`);
  }
  res.set('Access-Control-Allow-Headers', '*');
  next();
}

/**
 * 入口
 * @param options {object} 配置对象
 * @param [logger] {object} logger
 * @param callback {function} 回调
 */
module.exports = (options, logger, callbackFn) => {
  // 参数整理
  if (typeof callbackFn === 'undefined' && typeof logger === 'function') {
    callbackFn = logger;
    logger = {};
  }

  const callback = (server) => {

    // 进程退出
    process.on('exit', () => {
      try {
        const cacheSize = Number(execSync(`ls -l |grep "^d"|wc -l`, {
          cwd: path.join(os.homedir(), '.anyproxy/cache')
        }).toString().trim());
        if (cacheSize >= 80) {
          console.log(chalk.yellow.bold(`\n检查到 anyproxy 缓存文件(${cacheSize})可能占用磁盘空间较大，您可以执行：\n`));
          console.log(chalk.yellow(`du -hs ~/.anyproxy/cache 查看大小`));
          console.log(chalk.yellow(`rm -rf ~/.anyproxy/cache 清理空间\n`));
        }
      } catch (err) {
        // console.error(err);
      }
    });

    // ctrl+c
    process.on('SIGINT', () => {
      server.close();
      process.exit();
    });

    callbackFn && callbackFn(server);
  };

  const defaultOptions = Constants.defaultOptions;
  options = _.merge({}, defaultOptions, options);

  // 需要绑定 127.0.0.1 localhost，此处先检查
  utilsLib.checkHosts();
  checkHttpsCA(options);

  logger = initLogger(logger);

  // 主流程
  co(function *() {

    // 先获取一堆可用的端口号，由于后面都是同步传入，而端口号的获取是异步的，因此先批量处理掉
    const PORT_OPTIONS = [
      'proxyPort',              // 代理服务端口
      'webPort',                // anyproxy web ui 界面服务端口
      'socketPort',             // anyproxy websocket 服务端口
      'serverPort',             // 静态服务端口
      'weexPageReloadPort',     // weex 页面自动刷新端口
    ];
    for (const [index, optionName] of PORT_OPTIONS.entries()) {
      const minPort = Math.max(index * 1000 + 8000, 8080);
      const port = yield portfinder.getPortPromise({
        port: minPort,
      });
      if (
        options[optionName] == undefined ||
        options[optionName] == defaultOptions[optionName]
      ) {
        options[optionName] = port;
      }
    }

    // 初始化 weex reloader websocket;
    const WeexReloaderSocket = options.weexPageReloadPort ? new WeexReloadSocket(options, logger) : null;

    // https 处理
    let server;
    const openBrowserEmitter = new EventEmitter();
    const protocol = options.https ? 'https' : 'http';
    const serverCert = path.join(Constants.HTTPS.CERT_DIR, `${localIp}.crt`);
    const serverKey = path.join(Constants.HTTPS.CERT_DIR, `${localIp}.key`);

    // node_modules 路径
    const resolver = (options.resolver && typeof options.resolver === 'string') ? {
      default: options.resolver
    } : Object.assign({
      default: path.join(PWD, 'node_modules')
    }, options.resolver);

    // webpack 路径
    const webpackDir = resolver.webpack || resolver.default;
    const webpackDevServerDir = resolver.webpackDevServer || resolver.webpack || resolver.default;

    // 整理 webpackConfig
    var webpackConfig;
    if (!options.webpackConfig && !options.devServer) {
      // webpack config 为 null || undefined
      options.pureStatic = true;
    } else if (typeof options.webpackConfig === 'string') {
      // 字符串, 认为是 webpack 配置文件路径
      let webpackConfigPath = options.webpackConfig;

      // 相对/绝对路径处理
      if (!/^\//.test(webpackConfigPath)) {
        webpackConfigPath = path.join(PWD, webpackConfigPath);
      }

      try {
        webpackConfig = require(webpackConfigPath);
        // 更新 options.webpackConfig
        options.webpackConfig = webpackConfig;
      } catch (e) {
        if (fs.existsSync(webpackConfigPath)) {
          logger.error(`>> Error loading ${webpackConfigPath}`);
          logger.error(e.stack || e);
        }
        // webpack 配置不存在, 认为仅启动纯静态文件服务
        options.webpackConfig = null;
        options.pureStatic = true;
      }
    } else if (typeof options.webpackConfig === 'function') {
      var TEMP_ENV = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      webpackConfig = options.webpackConfig();
      process.env.NODE_ENV = TEMP_ENV;
      if (!webpackConfig) options.pureStatic = true;
    } else if (_.isObject(options.webpackConfig)) {
      webpackConfig = options.webpackConfig;
    }
    options.webpackConfig = webpackConfig;

    // HMR 注入
    // 3.3.0 开始自动注入 client 和 hmr，WTF!!!
    // https://github.com/webpack/webpack-dev-server/issues/1703
    // https://github.com/webpack/webpack-dev-server/pull/1738
    // https://github.com/webpack/webpack-dev-server/blob/v3.3.0/lib/utils/updateCompiler.js
    if (webpackConfig && options.injectHMR) {
      logger.verbose.info('HMR injected.');
      const fixRelative = (str) => {
        if (!/^[./]/.test(str)) {
          return `./${str}`;
        }
        return str;
      };
      const patchEntries = (webpackCfg) => {
        let context = webpackCfg.context || PWD;
        let entries = webpackCfg.entry;
        let hotScripts = [
          fixRelative(`${path.relative(context, require.resolve(path.join(webpackDevServerDir, 'webpack-dev-server/client')))}?${protocol}://${localIp}:${options.serverPort}/`),
          fixRelative(`${path.relative(context, require.resolve(path.join(webpackDir, 'webpack/hot/dev-server')))}`)
        ];

        if (_.isPlainObject(entries)) {
          // entry 为 map 对象
          // 为每个 entry 都拼接上 webpack hot scripts
          Object.keys(entries).forEach(entryKey => {
            let prevEntryScripts = entries[entryKey];
            if (!Array.isArray(prevEntryScripts)) {
              if (typeof prevEntryScripts === 'string') {
                prevEntryScripts = [prevEntryScripts];
              } else {
                prevEntryScripts = [];
              }
            }
            entries[entryKey] = prevEntryScripts.concat(hotScripts);
          });
        } else if (Array.isArray(entries)) {
          // entry 为数组
          entries = entries.concat(hotScripts);
        }
        return Object.assign(webpackCfg, {
          entry: entries
        });
      };
      if (Array.isArray(webpackConfig)) {
        webpackConfig = webpackConfig.map(patchEntries);
      } else {
        webpackConfig = patchEntries(webpackConfig);
      }
    }

    // 初始化 Proxy Server
    initProxy(options, logger);

    // host 证书生成
    if (options.https && !(
      certMgr.isRootCAFileExists()
        && fs.existsSync(serverKey)
        && fs.existsSync(serverCert)
      )) {
      yield new Promise(resolve => {
        if (!certMgr.isRootCAFileExists()) {
          certMgr.generateRootCA(/* localIp, */() => {
            certMgr.getCertificate(localIp, resolve);
          });
        } else {
          certMgr.getCertificate(localIp, resolve);
        }
      });
    }

    // bind app middleware
    const bindAppMiddleware = (app) => {
      app.use(corsMiddleWare);
      if (options.middlewares) {
        options.middlewares.forEach(function(m) {
          app.use(m);
        });
      }
      if (options.weexMiddleware || options.weexDebug) {
        app.use(weexReqMiddleWare(
          options.contentBase,
          logger,
          `http://127.0.0.1:${options.proxyPort}`,
          `${localIp}:${options.serverPort}`,
          protocol,
          options,
          webpackConfig
        ));
      } else if (options.qrcodeMiddleWare) {
        app.use(qrcodeReqMiddleWare(
          options.contentBase,
          logger,
          `${localIp}:${options.serverPort}`
        ));
      }
      // hack for contentBase support `index: false`
      app.use(serveIndex(options.contentBase, {
        icons: true
      }));
      app.use(express.static(options.contentBase, {
        index: false,
        setHeaders: StaticSetHeaders
      }));
    };

    if (options.pureStatic) {
      // Pure Express Static Asset Server

      const app = express();
      // bind middleware
      bindAppMiddleware(app);

      // start server
      if (options.https) {
        server = require('https').createServer({
          key: fs.readFileSync(serverKey),
          cert: fs.readFileSync(serverCert)
        }, app).listen(options.serverPort);
      } else {
        server = app.listen(options.serverPort);
      }

      server.sockets = [];

    } else if (options.devServer) {
      const devServerOptions = options.devServerOptions || {};

      if (typeof options.devServer === 'function') {
        server = yield options.devServer(Object.assign({
          host: localIp,
          port: options.serverPort,
          https: options.https ? {
            key: serverKey,
            cert: serverCert,
            ca: Constants.HTTPS.CA
          } : false,
          bindAppMiddleware,
          afterCompile() {
            server.emitter.emit('compileDone');
          },
        }, devServerOptions));
      } else {
        server = options.devServer;
        bindAppMiddleware(server);
      }

      if (devServerOptions.listen !== false) {
        server.listen(options.serverPort, '0.0.0.0', function() {
          server.emitter.emit('compileDone');
          devServerOptions.afterCompile && devServerOptions.afterCompile.apply(this, arguments);
        });
      }
    } else {

      // webpack-dev-server

      // 依赖确认
      yield utilsLib.loadPackage('webpack', '1.12', logger, webpackDir.replace(/\/node_modules\/?$/, ''));
      yield utilsLib.loadPackage('webpack-dev-server', '1.14', logger, webpackDevServerDir.replace(/\/node_modules\/?$/, ''));

      const webpack = require(path.join(webpackDir, 'webpack'));
      const ProgressPlugin = require(path.join(webpackDir, 'webpack/lib/ProgressPlugin'));
      const WebpackDevServer = require(path.join(webpackDevServerDir, 'webpack-dev-server'));

      if (options.progress) {
        const addProgressPlugin = function(cfg) {
          // 输出进度百分比
          let chars = 0;
          let lastState;
          let lastStateTime;

          cfg.plugins = cfg.plugins || [];
          cfg.plugins.push(new ProgressPlugin((percentage, msg) => {

            function goToLineStart(nextMessage) {
              let str = '';
              for (; chars > nextMessage.length; chars--) {
                str += '\b \b';
              }
              chars = nextMessage.length;
              for (let i = 0; i < chars; i++) {
                str += '\b';
              }
              if (str) process.stderr.write(str);
            }

            var state = msg;
            if (percentage < 1) {
              percentage = Math.floor(percentage * 100);
              msg = `${percentage}% ${msg}`;
              if (percentage < 100) {
                msg = ` ${msg}`;
              }
              if (percentage < 10) {
                msg = ` ${msg}`;
              }
            } else {
              server.emitter.emit('compileDone');
            }
            if (options.profile) {
              state = state.replace(/^\d+\/\d+\s+/, '');
              if (percentage === 0) {
                lastState = null;
                lastStateTime = +new Date();
              } else if (state !== lastState || percentage === 1) {
                const now = Date.now();
                if (lastState) {
                  const stateMsg = (now - lastStateTime) + 'ms ' + lastState;
                  goToLineStart(stateMsg);
                  process.stderr.write(stateMsg + '\n');
                  chars = 0;
                }
                lastState = state;
                lastStateTime = now;
              }
            }
            goToLineStart(msg);
            process.stderr.write(msg);
          }));
        }

        if (Array.isArray(webpackConfig)) {
          webpackConfig.forEach(function(cfg) {
            addProgressPlugin(cfg);
          });
        } else {
          addProgressPlugin(webpackConfig);
        }
      } else {
        setTimeout(() => {
          openBrowserEmitter.emit('ready');
        }, 3000);
      }

      // webpack compiler 初始化
      const compiler = webpack(webpackConfig);

      let outputConfig = webpackConfig.output;
      let devServerOptions = webpackConfig.devServer;
      if (Array.isArray(webpackConfig)) {
        // webpack.config 为数组时, 合并多个配置项
        devServerOptions = webpackConfig[0].devServer;
        outputConfig = _.merge.apply(null, [{}].concat(
          webpackConfig.map(configItem => configItem.output)));
      }

      server = new WebpackDevServer(compiler, _.merge({
        filename: outputConfig.filename,
        publicPath: outputConfig.publicPath
      }, {
        // webpack-dev-server options

        // 3.3.1 开始需要指定这两个字段，WTF!!!
        // host and port can be undefined or null
        // https://github.com/webpack/webpack-dev-server/blob/master/CHANGELOG.md#bug-fixes
        // https://github.com/webpack/webpack-dev-server/pull/1779
        host: localIp,
        port: options.serverPort,

        // hack below static options
        contentBase: false,
        // contentBase: options.contentBase,
        // contentBase: "/path/to/directory",
        // or: contentBase: "http://localhost/",

        hot: true,
        // inline: true,

        // unused!!!
        // debug: true,
        // failsOnError: false,

        // Enable special support for Hot Module Replacement
        // Page is no longer updated, but a "webpackHotUpdate" message is send to the content
        // Use "webpack/hot/dev-server" as additional module in your entry point
        // Note: this does _not_ add the `HotModuleReplacementPlugin` like the CLI option does.

        // Set this as true if you want to access dev server from arbitrary url.
        // This is handy if you are using a html5 router.
        historyApiFallback: false,

        // Set this if you want webpack-dev-server to delegate a single path to an arbitrary server.
        // Use "*" to proxy all paths to the specified server.
        // This is useful if you want to get rid of 'http://localhost:8080/' in script[src],
        // and has many other use cases (see https://github.com/webpack/webpack-dev-server/pull/127 ).
        // proxy: {
        //   "*": {
        //     target: "http://localhost:8080",
        //     secure: false
        //   }
        // },

        // webpack-dev-middleware options
        quiet: false,
        noInfo: false,
        // https://github.com/webpack/webpack-dev-server/issues/882#issuecomment-296436909
        // https://github.com/webpack/webpack-dev-server/commit/02ec65ba1016be2a20d0ff05cbcd5dd365d31a79#diff-15fb51940da53816af13330d8ce69b4eR332
        disableHostCheck: true,
        // lazy: true,
        // filename: "bundle.js",
        watchOptions: {
          aggregateTimeout: 300,
          poll: 1000
        },
        https: options.https ? {
          key: fs.readFileSync(serverKey),
          cert: fs.readFileSync(serverCert),
          ca: fs.readFileSync(Constants.HTTPS.CA)
        } : false,
        // publicPath: "/assets/",
        headers: {
          'X-Custom-Header': 'yes',
          'Cache-Control': 'no-cache'
        },
        before: (app/*, server, compiler*/) => {
          app.use(corsMiddleWare);
        },
        stats: _.merge({
          colors: true,
          chunks: false
        }, options.webpackStatsOption)
      }, devServerOptions));

      // bind middleware
      bindAppMiddleware(server);

      server.listen(options.serverPort);

    }

    // 挂载 `EventEmitter`
    server.emitter = new EventEmitter();

    function onWebpackCompileDone() {
      logger.ok('\n');
      openBrowserEmitter.emit('ready');
      if (WeexReloaderSocket && WeexReloaderSocket.ws) {
        try {
          WeexReloaderSocket.ws.send('refresh');
        } catch (e) {
          logger.verbose.warn(e);
        }
      }
    }

    server.emitter.on('compileDone', function() {
      if (options.onCompileDone) {
        const res = options.onCompileDone.apply(this, arguments);
        if (res && res.then) {
          res.then(onWebpackCompileDone).catch(onWebpackCompileDone)
        } else {
          onWebpackCompileDone();
        }
      } else {
        onWebpackCompileDone();
      }
    });

    const serverHost = `${protocol}://localhost:${options.serverPort}`;
    let serverPath = options.openUrl || (serverHost + options.openPath);

    const openBrowserKey = 'dev.openBrowser';
    const clamRoot = path.join(os.homedir(), '.clam');
    const clamConfigPath = path.join(clamRoot, 'config.json');
    const clamConfigJSON = fs.existsSync(clamConfigPath) ? require(clamConfigPath) : {};
    const openBrowser = (openBrowserKey in clamConfigJSON) ? clamConfigJSON[openBrowserKey] :  options.openBrowser;

    if (openBrowser && server.sockets.length === 0) {
      // 当且仅当 webpack-dev-server 的 socket 连接不存在时自动打开浏览器

      // wait till first build complete
      openBrowserEmitter.once('ready', () => {

        // Print Server Detail
        printServerTable(_.merge(options, {
          localIp
        }), logger);

        // 重新打开 Anyprox 的 Log
        anyproxyLog.setPrintStatus(true);

        if (process.platform === 'darwin') {
          // 如果在 mac os 下, 默认打开新建 Chrome 浏览器配置代理
          serverPath = options.openUrl
            || ((`${protocol}://${options.hosts[0]}` || serverHost) + options.openPath);
          let cmd = [
            isArm64() ? 'arch -arm64' : '',
            options.browserApp.replace(/\x20/g, '\\ '),
            `-proxy-server="http://127.0.0.1:${options.proxyPort}"`,
            '--auto-open-devtools-for-tabs',
            '--no-first-run',
            // '--js-flags="--trace-opt --trace-deopt --prof --noprof-lazy --log-timer-events"',
            `--user-data-dir="${path.join(options.chromeUserDir, `${options.proxyPort}`)}"`,
            serverPath
          ].join(' ');
          if (options.weexDebug && options.weexDebug.debugServerPort) {
            cmd += ` http://${localIp}:${options.weexDebug.debugServerPort}`;
          }
          logger.verbose.info(`>> [Open Chrome Command]: ${cmd}`);
          shell.exec(cmd, {
            silent: true,
            async: true
          }, (code, output) => {
            logger.verbose.info(`${code}\n------\n`);
            logger.verbose.info(output);
          });
        } else {
          // 否则打开默认浏览器, 需用户手动绑定代理
          open(serverPath);
        }
        // for grunt watch task
        callback(server, options);
      });
    } else {
      // wait till first build complete
      openBrowserEmitter.once('ready', () => {
        // for grunt watch task
        callback(server, options);
      });
    }
    if (options.pureStatic) {
      // 别忘了自动打开浏览器
      openBrowserEmitter.emit('ready');
    }
  }).then(val => {
    if (val) {
      logger.info(val);
    }
  }, err => {
    logger.error(err.stack);
  });
};

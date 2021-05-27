/**
 * Created by 弘树<dickeylth@live.cn> on 16/8/27.
 * weex middleware
 */
"use strict";

const fs = require('fs');
const path = require('path');
const url = require('url');
const request = require('request');
const cheerio = require('cheerio');
const qrcode = require('yaqrcode');

/**
 * 生成扫码 URL
 * @param reqUrlObj {Object} 请求 URL 对象
 * @param serverHost {String} 本机 host
 * @param weexWebpackConfig {Object} webpackConfig for weex
 * @return {String}
 */
const generateScanUrl = (reqUrlObj, serverHost, options, weexWebpackConfig) => {
  options = options || {};
  const parsedReqUrl = Object.assign({}, reqUrlObj);
  parsedReqUrl.protocol = options.https ? 'https:' : (parsedReqUrl.protocol || 'http:');
  parsedReqUrl.host = serverHost;
  parsedReqUrl.query['hot-reload'] = true;
  const wxTpl = parsedReqUrl.query._wx_tpl;
  if (wxTpl) {
    const parsedWxTpl = url.parse(decodeURIComponent(wxTpl));
    parsedWxTpl.host = serverHost;
    parsedReqUrl.search = null;
    parsedReqUrl.query._wx_tpl = url.format(parsedWxTpl);
    // 防止页面刷新后二维码同时包含 _wx_tpl 和 wh_weex 参数，在手淘 android 下存在降级 H5 的 bug
    delete parsedReqUrl.query.wh_weex;
  } else if (weexWebpackConfig) {
    // 不带 `_wx_tpl` 参数, 且为基于 Vue 的 Weex 项目
    // vue 2.0 扫码URL: e.g. http://30.27.100.57:8081/demo/entry.weex.js?wh_weex=true
    const reqPathName = path.basename(reqUrlObj.pathname);
    // 去文件后缀名
    const weexNativePathFileName = weexWebpackConfig.output.filename
      .replace('[name]', reqPathName.split('.').slice(0, -1).join('.'));
    parsedReqUrl.pathname = reqUrlObj.pathname.replace(reqPathName, weexNativePathFileName);
    delete parsedReqUrl.search;
    parsedReqUrl.query.wh_weex = true;
  }
  return url.format(parsedReqUrl);
};

// 注入 qr code 脚本到页面，控制台输出 qr code 二维码图
const injectHTML = (htmlSource, scanUrl, weexPageReloadPort, logger) => {
  logger.verbose.info('>> Injecting HTML for weex.');
  const LOCAL_IP = require('./utils').getLocalIp();
  const $ = cheerio.load(htmlSource, {
    normalizeWhitespace: false,
    xmlMode: false,
    decodeEntities: false
  });
  let qrcodeLog = '';
  try {
    qrcodeLog = `console.log("%c          ",
    "padding:2px 80px 4px;" +
    "line-height:160px;background:url('${qrcode(scanUrl)}') no-repeat;" +
    "background-size:160px");`
  } catch (e) {
    qrcodeLog = `console.error("自动生成二维码失败，请手动拷贝以上链接去其他工具生成二维码");`;
  }
  $('head').prepend(`<script>
    if (!/_wx_tpl/.test(location.search) && !/wh_weex/.test(location.search)) {
      var u = new URL('${scanUrl}');
      var searchParams = u.search.slice(1);
      u.search = '';
      history.replaceState({}, '', '?' + searchParams);
    }
    </script>`);
  $('body').append(`<script>
    console.log('Weex Native 扫码 URL: ${scanUrl}');
    if (!window.qrCodeInjected){${qrcodeLog}window.qrCodeInjected = true}
    // for weex-toolkit.
    ; (function startRefreshController () {
      if (location.protocol.match(/file/)) {
        return
      }
      if (location.search.indexOf('hot-reload') === -1) {
        return
      }
      if (typeof WebSocket === 'undefined') {
        console.info('auto refresh need WebSocket support');
        return
      }
      if (!${weexPageReloadPort}) {
        return;
      }
      const host = '${LOCAL_IP}';
      const port = ${weexPageReloadPort};
      const client = new WebSocket('ws://' + host + ':' + port + '/',
        'echo-protocol'
      );
      client.onerror = function () {
        console.log('page refresh controller websocket connection error')
      };
      client.onmessage = function (e) {
        console.log('Received: ' + e.data);
        if (e.data === 'refresh') {
          location.reload();
        }
      };
    })()
  </script>`);

  return $.html();
};

/**
 * weex proc middleware
 * @param contentBase
 * @param logger
 * @param proxyUrl 代理 URL
 * @param serverHost
 * @param protocol {String}
 * @param options {Object}
 * @param options.weexPageReloadPort {Number} weex 页面刷新 socket 端口号
 * @param webpackConfig {Object|Array} webpack 配置项
 * @returns {function(*, *, *)}
 * @constructor
 */
module.exports = (contentBase, logger, proxyUrl, serverHost, protocol, options, webpackConfig) => {
  const { weexPageReloadPort } = options;
  return (req, res, next) => {
    const parsedReqUrl = url.parse(req.url, true);
    const reqPath = parsedReqUrl.pathname;
    const filePath = path.join(contentBase, reqPath);

    delete parsedReqUrl.query.__edith_orig_url__;

    // 对 .we 和有对应 weex 文件的 .html 文件请求做处理
    if (/\.we\b/.test(reqPath) ||
      (/\.html/.test(reqPath) && fs.existsSync(filePath.replace(/\.html/, '.we')))) {
      logger.verbose.info('>> Enter weex middleware');
      if (!req.query._wx_tpl && !req.query.page) {
        if (req.query.page) {
          // 请求 url 参数上有 `page`, 用来做 H5 降级调试, 不要做处理
        } else {
          // 请求 url 参数上没有 `_wx_tpl`
          const reqProtocol = parsedReqUrl.protocol || `${protocol}:`;
          parsedReqUrl.query._wx_tpl = `${reqProtocol}//${req.headers.host}${req.url.replace(/\.(we|html)$/, '.js')}`;
          parsedReqUrl.query['hot-reload'] = true;
          delete parsedReqUrl.search;
          res.status(302).location(url.format(parsedReqUrl));
        }
        next();
      } else {
        if (/\.we\b/.test(reqPath)) {
          const matchHTMLPath = path.join(contentBase, reqPath.replace(/\.we$/, '.html'));
          const baseHTMLPath = path.join(contentBase, 'index.html');
          const defaultHTMLPath = path.join(__dirname, '../assets/weex.html');
          let sendFilePath;
          if (fs.existsSync(matchHTMLPath)) {
            sendFilePath = matchHTMLPath;
          } else {
            let upperDirPath = path.join(matchHTMLPath, '../');
            let recursiveHTMLPath = path.join(upperDirPath, 'index.html');
            while (recursiveHTMLPath !== baseHTMLPath && !sendFilePath) {
              upperDirPath = path.join(upperDirPath, '../');
              recursiveHTMLPath = path.join(upperDirPath, 'index.html');
              if (fs.existsSync(recursiveHTMLPath)) {
                logger.verbose.info(`>> Loading ${recursiveHTMLPath} for ${reqPath}`);
                sendFilePath = recursiveHTMLPath;
              }
            }
            // 使用默认内置的 html 托底
            if (!sendFilePath) {
              if (fs.existsSync(baseHTMLPath)) {
                sendFilePath = baseHTMLPath;
              } else {
                // sendFilePath = defaultHTMLPath;
              }
            }
          }

          res.type('html');
          if (sendFilePath) {
            const reqUrlObj = Object.assign(parsedReqUrl, {
              protocol: `${protocol}:`,
              host: req.headers.host,
              pathname: path.relative(contentBase, sendFilePath)
                .replace(new RegExp('\\' + path.sep, 'g'), '/')
            });
            // req.pipe(request(url.format(reqUrlObj), {
            //   proxy: proxyUrl
            // })).pipe(res);

            const reqObj = {
              url: url.format(reqUrlObj),
              proxy: proxyUrl,
              strictSSL: false
            };

            request(reqObj, (err, resp, body) => {
              if (!err && resp.statusCode === 200) {
                res.send(injectHTML(
                  body.toString('utf-8'),
                  generateScanUrl(parsedReqUrl, serverHost, options),
                  weexPageReloadPort,
                  logger)
                );
              } else {
                logger.error(`>> Error fetch ${JSON.stringify(
                  reqUrlObj, null, 2
                )} [${resp && resp.statusCode}]`);
                res.send(body);
              }
            });
          } else {
            logger.verbose.info(`Loading ${defaultHTMLPath} for ${reqPath}`);
            res.send(injectHTML(
              fs.readFileSync(defaultHTMLPath, 'utf-8'),
              generateScanUrl(parsedReqUrl, serverHost, options),
              weexPageReloadPort,
              logger)
            );
          }
        } else {
          res.type('html');
          res.send(injectHTML(
            fs.readFileSync(filePath, 'utf-8'),
            generateScanUrl(parsedReqUrl, serverHost, options),
            weexPageReloadPort,
            logger)
          );
          // next();
        }
      }
    } else if (/\.vue\b/.test(reqPath) ||
      (/\.html/.test(reqPath)
        && fs.existsSync(filePath)
        && fs.existsSync(filePath.replace(/\.html/, '.vue')))) {
      // .vue 和 .html 文件同时存在, 再检查 webpackConfig 里包含 weex bundle 构建, 以免误伤 vue in h5.
      res.type('html');
      if (Array.isArray(webpackConfig)) {
        const weexWebpackConfig = webpackConfig.filter(function(c) {
          return (c.type === 'weex') || (c.output && c.output.filename && c.output.filename.indexOf('weex.js') > -1);
        })[0];
        if (!weexWebpackConfig) {
          console.error('>> Unable to find webpackConfig for weex, please make sure `webpackConfig.type === "weex".`');
        }
        res.send(injectHTML(
          fs.readFileSync(filePath, 'utf-8'),
          generateScanUrl(parsedReqUrl, serverHost, options, weexWebpackConfig),
          weexPageReloadPort,
          logger)
        );
      } else {
        res.send(injectHTML(
          fs.readFileSync(filePath, 'utf-8'),
          generateScanUrl(parsedReqUrl, serverHost, options, webpackConfig),
          weexPageReloadPort,
          logger)
        );
      }
    } else if (/\.html/.test(reqPath)) {
      // rax 请求的 html 文件
      const htmlSource = fs.readFileSync(filePath, 'utf-8');
      if (
        /web-rax-framework/.test(htmlSource) ||
        /seed-weex/.test(htmlSource)
      ) {
        let wpConfig = webpackConfig;
        // 页面有引用 Rax 基础框架
        if (Array.isArray(webpackConfig)) {
          const weexWebpackConfig = webpackConfig.filter(function(c) {
            return (c.type === 'weex') || (c.output && c.output.filename && c.output.filename.indexOf('weex.js') > -1);
          })[0];
          if (!weexWebpackConfig) {
            console.error('>> Unable to find webpackConfig for weex, please make sure `webpackConfig.type === "weex".`');
          }
          wpConfig = weexWebpackConfig;
        }
        let scanUrl = generateScanUrl(parsedReqUrl, serverHost, options, wpConfig);

        // 访问 html?wh_weex=true，返回 weex.js 的内容
        if (
          !req.query['_wx_tpl'] &&
          req.query['wh_weex'] === 'true' &&
          (
            req.headers['f-refer'] === 'weex' ||
            /Weex\//i.test(req.headers['user-agent'] || '')
          )
        ) {
          request(scanUrl, function(err, resp, body) {
            if (!err && resp.statusCode === 200) {
              res.set('Content-Type', 'application/javascript');
              res.send(body.toString('utf-8'));
            } else {
              res.send(injectHTML(
                htmlSource,
                scanUrl,
                weexPageReloadPort,
                logger)
              );
            }
          });
        } else {
          if (!url.parse(scanUrl, true)._wx_tpl) {
            delete parsedReqUrl.query.wh_weex;
            parsedReqUrl.protocol = protocol;
            parsedReqUrl.host = options.hosts.indexOf(req.headers.host) < 0 ? options.hosts[0] : req.headers.host;
            parsedReqUrl.query._wx_tpl = scanUrl
            parsedReqUrl.search = null;
            scanUrl = url.format(parsedReqUrl);
          }
          res.send(injectHTML(
            htmlSource,
            scanUrl,
            weexPageReloadPort,
            logger)
          );
        }
      } else { next(); }
    } else {
      next();
    }
  };
};

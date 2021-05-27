/**
 * Created by 弘树<dickeylth@live.cn> on 16/1/20.
 */
"use strict";

const utilsLib = require('./utils');
const Constants = require('./constants');
const cheerio = require('cheerio');
const url = require('url');
const request = require('request');
const fs = require('fs');
const path = require('path');
const ssiLib = require('./ssi');
const iconv = require('iconv-lite');

function testLocalRegExp(localRegExp, pureReqPath) {
  if (Array.isArray(localRegExp)) {
    let result = false;
    localRegExp.some(function(r) {
      if (testLocalRegExp(r, pureReqPath)) {
        return (result = true);
      }
    });
    return result;
  } else if (typeof localRegExp === 'function') {
    return localRegExp(pureReqPath);
  } else if (localRegExp instanceof RegExp) {
    return localRegExp.test(pureReqPath);
  }

  return false;
}

/**
 * 是否需要代理到本地静态服务|Webpack-dev-server 服务
 * @param options {Object} 配置对象
 * @param options.contentBase {String}
 * @param options.webpackConfig.output.publicPath
 * @param reqPath {String} 请求路径
 * @returns {boolean}
 */
const isProxyToLocalServe = (options, reqPath) => {
  // 去除 query 先
  const pureReqPath = reqPath.split('?')[0];
  const contentBase = options.contentBase;

  // 兼容 webpack config 可能是数组，归一化为数组
  let {
    localRegExp,
    webpackConfig = []
  } = options;
  if (!Array.isArray(webpackConfig)) {
    webpackConfig = [webpackConfig];
  }
  const isReqPathMatchWebpack = (requestPath) => {
    const result = webpackConfig.some(configItem =>
      requestPath.indexOf(
        ((configItem || {}).output || {}).publicPath) === 0
    );
    return result;
  };

  const proxyToLocalServe = fs.existsSync(path.join(contentBase, pureReqPath))
    // .js 文件可能是需要 .we 文件构建后生成
    || fs.existsSync(path.join(contentBase, pureReqPath.replace(/\.js/, '.we')))
    || isReqPathMatchWebpack(pureReqPath)
    || testLocalRegExp(localRegExp, pureReqPath);
  return proxyToLocalServe;
};

// 是否是 favicon 标签页图标
const isLocalFavicon = (req, hosts) => {
  let local = false;
  hosts.some(h => {
    return (local = req.url.indexOf(`${req.protocol}://${h}/favicon.ico`) === 0);
  });
  return local;
};


/*
 read the following wiki before using rule file
 https://github.com/alibaba/anyproxy/wiki/What-is-rule-file-and-how-to-write-one
 */
module.exports = (proxyOptions) => {

  let mockRegExp = proxyOptions.mockRegExp;
  let httpsRegExp = proxyOptions.httpsRegExp;
  if (!(mockRegExp instanceof RegExp)) {
    // 一个不会匹配任何字符串的正则表达式
    // ref: http://stackoverflow.com/questions/1723182/a-regex-that-will-never-be-matched-by-anything
    mockRegExp = /$^/;
  }
  if (!(httpsRegExp instanceof RegExp)) {
    httpsRegExp = /$^/;
  }
  // let localIp = utilsLib.getLocalIp();
  const hostsMap = proxyOptions.hostsMap;
  const logger = proxyOptions.logger;

  return {
    /*
     * These functions will overwrite the default ones, write your own when necessary.
     */
    summary() {
      return 'Proxy for Sonic!';
    },

    // =======================
    // when getting a request from user
    // 收到用户请求之后
    // =======================

    // 是否截获https请求
    // should intercept https request, or it will be forwarded to real server
    shouldInterceptHttpsReq(req) {

      const proxyHosts = proxyOptions.hosts;
      const reqHeaders = req.headers;
      let reqHost = reqHeaders.host || reqHeaders.hostname;
      if (reqHost) {
        reqHost = reqHost.split(':')[0];
        // 仅对虚拟域名及匹配 mock 请求做拦截
        return (proxyHosts.indexOf(reqHost) !== -1)
          || mockRegExp.test(req.url)
          || (reqHost in hostsMap)
          || httpsRegExp.test(req.url);
      }
      return false;
    },

    // 是否在本地直接发送响应（不再向服务器发出请求）
    // whether to intercept this request by local logic
    // if the return value is true, anyproxy will call dealLocalResponse to get response data
    // and will not send request to remote server anymore
    // req is the user's request sent to the proxy server
    shouldUseLocalResponse(req/* , reqBody*/) {
      // const parsedReqUrl = url.parse(req.url);
      let requestUrl = req.url;
      if (isLocalFavicon(req, proxyOptions.hosts)) {
        logger.verbose.info(`>> Parsing local favicon: ${req.url}`);
        return true;
      }
      if (proxyOptions.assetsComboMapLocal &&
        proxyOptions.assetsComboRegExp &&
        proxyOptions.assetsComboRegExp.test(req.url) &&
        (req.url.indexOf(Constants.COMBO_SIGN) !== -1)) {
        // 匹配了需要映射到本地的资源 combo
        logger.verbose.info(`>> Parsing combo url: ${req.url}`);
        return true;
      // } else if (/\.we/.test(parsedReqUrl.pathname)) {
      //   // 请求 .we 文件, 检查本地路径是否存在
      //   return fs.existsSync(path.join(proxyOptions.contentBase, parsedReqUrl.pathname));
      }

      // 接口 mock
      if (proxyOptions.mockBeforeFunction && mockRegExp) {

        if (/^\//.test(requestUrl)) {
          let protocol = 'http:';
          if (req.connection.encrypted) {
            protocol = 'https:';
          }
          requestUrl = `${protocol}//${req.headers.host}${requestUrl}`;
        }

        if (mockRegExp.test(requestUrl)) {
          let mockBeforeData = proxyOptions.mockBeforeFunction(requestUrl);
          if (mockBeforeData != undefined) {
            if (mockBeforeData.headers) {
              req.mockBeforeData = mockBeforeData;
            } else {
              req.mockBeforeData = {
                headers: {
                  'Access-Control-Allow-Origin': req.headers.Origin || req.headers.origin,
                  'Access-Control-Allow-Credentials': 'true',
                  'Access-Control-Allow-Methods': ['GET,PUT,POST'],
                  'Access-Control-Expose-Headers': ['Origin,X-Requested-With,Content-Type,Accept'],
                  'Content-Type': 'application/json;charset=UTF-8'
                },
                body: typeof mockBeforeData === 'string' ? mockBeforeData : JSON.stringify(mockBeforeData)
              }
            }
            return true;
          }
        }
      }

      return false;
    },

    // 如果shouldUseLocalResponse返回true，会调用这个函数来获取本地响应内容
    // you may deal the response locally instead of sending it to server
    // this function be called when shouldUseLocalResponse returns true
    // callback(statusCode,resHeader,responseData)
    // e.g. callback(200,{"content-type":"text/html"},"hello world")
    dealLocalResponse(req, reqBody, callback) {
      // const parsedReqUrl = url.parse(req.url, true);
      if (req.mockBeforeData != undefined) {
        const mockBeforeData = req.mockBeforeData;
        delete req.mockBeforeData;
        utilsLib.mockResponse(req.url,
          mockBeforeData.headers,
          mockBeforeData.body,
          (rq, rs) => rs.body,
          logger,
          (body) => {
            callback(200, mockBeforeData.headers, body)
          }
        );
      } else if (isLocalFavicon(req, proxyOptions.hosts)) {
        fs.readFile(path.join(__dirname, 'favicon.ico'), (err, body) => {
          callback(200, {
            'Content-Type': 'image/x-icon'
          }, body);
        });
      } else if (proxyOptions.assetsComboMapLocal &&
        proxyOptions.assetsComboRegExp &&
        proxyOptions.assetsComboRegExp.test(req.url)) {
        let comboParts = req.url.split(Constants.COMBO_SIGN);
        const comboPrefix = comboParts[0];
        comboParts = comboParts[1].split(Constants.COMBO_SEP)
          .map(comboPath => (comboPrefix + comboPath));
        const localParts = proxyOptions.assetsComboMapLocal(req.url, comboParts);
        const protocol = proxyOptions.https ? 'https' : 'http';
        const localServerPort = proxyOptions.serverPort;
        let ContentType;
        const localPartsPromise = localParts.map((localPath, index) => {
          return new Promise(resolve => {
            const localReqUrl = url.resolve(`${protocol}://127.0.0.1:${localServerPort}/`, localPath);
            // log
            logger.verbose.info(`>> request ${localPath} from <local>: ${localReqUrl}`);
            request(localReqUrl, (err, resp, body) => {
              if (!err && resp.statusCode === 200) {
                !ContentType && (ContentType = resp.headers['content-type']);
                resolve(body);
              } else {
                // 本地加载失败, 请求远程
                const remoteUrl = comboParts[index];
                // log
                logger.verbose.info(`>> request ${localPath} from <remote>: ${remoteUrl}`);
                request(remoteUrl, (remoteErr, remoteResp, remoteBody) => {
                  if (!remoteErr && remoteResp.statusCode === 200) {
                    !ContentType && (ContentType = remoteResp.headers['content-type']);
                    resolve(remoteBody);
                  } else {
                    resolve(
                      `;console.error("Error loading ${localPath} from remote ${remoteUrl}");`
                    );
                  }
                });
              }
            });
          });
        });
        Promise.all(localPartsPromise).then(resolvedSourceCodes => {
          callback(200, {
            'Content-Type': ContentType
          }, resolvedSourceCodes.join('\n'));
        });
      } else {
        callback(404, {}, `[!]Error processing ${req.url}`);
      }
    },


    // =======================
    // when ready to send a request to server
    // 向服务端发出请求之前
    // =======================

    // 替换向服务器发出的请求协议（http和https的替换）
    // replace the request protocol when sending to the real server
    // protocol : "http" or "https"
    // replaceRequestProtocol: function (req, protocol) {
    //  var newProtocol = protocol;
    //  return newProtocol;
    // },

    // 替换向服务器发出的请求参数（option)
    // option is the configuration of the http request sent to remote server.
    // You may refers to http://nodejs.org/api/http.html#http_http_request_options_callback
    // you may return a customized option to replace the original one
    // you should not overwrite content-length header in options,
    // since anyproxy will handle it for you
    replaceRequestOption(req, option) {
      const newOption = option;

      const proxyHosts = proxyOptions.hosts;
      const requestHost = option.hostname;
      // TODO `isProxyToLocalServe` 可能不准, 如果 anyproxy 的 `replaceRequestOption` 支持异步才比较优雅
      if (proxyHosts.indexOf(requestHost) !== -1
        && isProxyToLocalServe(proxyOptions, option.path)) {
        // if (proxyHosts.indexOf(requestHost) != -1) {
        // 匹配代理 hostname 且符合代理到本地规则
        logger.info(`[Proxy Host] ${requestHost} => localhost`);
        newOption.hostname = 'localhost';
        newOption.port = proxyOptions.serverPort;
        // prevent 304 not-modified response, http://stackoverflow.com/a/19168739/1661664
        newOption.headers['If-None-Match'] = 'no-match-for-this';
        newOption.origUrl = req.url;

      } else if ((requestHost !== 'localhost') && (requestHost in hostsMap)) {
        // 匹配代理 hosts hostname
        const ipAddr = hostsMap[requestHost];
        logger.info(`[Proxy Hosts] ${requestHost} => ${ipAddr}`);
        newOption.hostname = ipAddr;
      } else if (option.port === 80) {
        // console.log(newOption);
        // if (typeof proxyOptions.replaceRequestUrl === 'function') {
        //   var newUrl = proxyOptions.replaceRequestUrl(url.format(newOption));
        // }
      }

      return newOption;
    },

    // 替换请求的body
    // replace the request body
    // replaceRequestData: function (req, data) {
    //  return data;
    // },

    //
    // =======================
    // when ready to send the response to user after receiving response from server
    // 向用户返回服务端的响应之前
    // =======================
    //
    // 替换服务器响应的http状态码
    // replace the statusCode before it's sent to the user
    // replaceResponseStatusCode(req, res, statusCode){
    //   let newStatusCode = statusCode;
    //   const parsedReqUrl = url.parse(req.url, true);
    //   const pathname = parsedReqUrl.pathname;
    //   if (/\.html/.test(pathname)) {
    //     // 检查对应 .we 文件本地路径是否存在
    //     // 并且请求参数不包含 _wx_tpl
    //     if (
    //       newStatusCode !== 302 &&
    //       fs.existsSync(path.join(proxyOptions.contentBase, pathname.replace(/\.html/, '.we'))) &&
    //         !parsedReqUrl.query._wx_tpl
    //     ) {
    //       // 302 重定向到带 _wx_tpl 参数的 URL 去
    //       newStatusCode = 302;
    //     }
    //   }
    //   return newStatusCode;
    // },
    //
    // 替换服务器响应的http头
    // replace the httpHeader before it's sent to the user
    // Here header == res.headers
    replaceResponseHeader(req, res, header) {
      const newHeader = header;
      if (proxyOptions.corsInject) {
        newHeader['Access-Control-Allow-Origin'] = '*';
        newHeader['Access-Control-Allow-Methods'] = ['GET,PUT,POST'];
        newHeader['Access-Control-Allow-Headers'] =
          ['Origin, X-Requested-With, Content-Type, Accept'];
      }
      // const parsedReqUrl = url.parse(req.url, true);
      // const pathname = parsedReqUrl.pathname;
      // if (/\.html/.test(pathname)) {
      //   // 检查对应 .we 文件本地路径是否存在
      //   // 并且请求参数不包含 _wx_tpl
      //   if (
      //     fs.existsSync(path.join(proxyOptions.contentBase, pathname.replace(/\.html/, '.we'))) &&
      //     !parsedReqUrl.query._wx_tpl
      //   ) {
      //     // 302 重定向到带 _wx_tpl 参数的 URL 去
      //
      //     // 没有 `_wx_tpl` 参数, 重定向一下
      //     // TODO: https 开启时, req.url 仅为 pathname, to be fixed...
      //
      //     parsedReqUrl.query._wx_tpl = `${req.url.replace(/\.html/, '.js')}`;
      //     delete parsedReqUrl.search;
      //     newHeader.location = url.format(parsedReqUrl);
      //   }
      // }

      // 本地开发禁用 HSTS 的强制 HTTPS 行为
      // ref: http://stackoverflow.com/questions/34108241/non-authoritative-reason-header-field-http
      // ref: https://developer.mozilla.org/zh-CN/docs/Security/HTTP_Strict_Transport_Security
      newHeader['Strict-Transport-Security'] = 'max-age=0';

      return newHeader;
    },

    // 替换服务器响应的数据
    // replace the response from the server before it's sent to the user
    // you may return either a Buffer or a string
    // serverResData is a Buffer.
    // for those non-unicode response, serverResData.toString() should not be your first choice.
    replaceServerResDataAsync(req, res, serverResData, callback) {

      let requestUrl = req.url;

      // tag 是否需要 mock
      let needProxy = false;

      // 接口 mock
      if (proxyOptions.mockFunction && mockRegExp) {

        if (/^\//.test(requestUrl)) {
          let protocol = 'http:';
          if (req.connection.encrypted) {
            protocol = 'https:';
          }
          requestUrl = `${protocol}//${req.headers.host}${requestUrl}`;
        }

        if (mockRegExp.test(requestUrl)) {

          const resHeaders = res.headers;
          if (resHeaders.location || resHeaders.Location) {
            // 响应头包含 `"location"`, 表明到重定向
            callback(serverResData);
          } else {
            // 接口 mock
            utilsLib.mockResponse(requestUrl,
              resHeaders,
              serverResData.toString(),
              proxyOptions.mockFunction,
              logger,
              callback
            );
            needProxy = true;
          }
        }
      }

      // 页面 mock, 处理 tms 区块
      const proxyHosts = proxyOptions.hosts;
      const reqHeaders = req.headers;
      const requestHost = reqHeaders.host || reqHeaders.hostname;
      const resContentType = res.headers['Content-Type'] || '';
      if (resContentType.indexOf('text/html') !== -1 &&
        (proxyHosts.indexOf(requestHost) !== -1
          || proxyOptions.htmlInterceptReg.test(requestUrl)
        )
      ) {
        // 'content-type': 'text/html;charset=GBK' 处理
        let resCharset = 'utf-8';
        if (resContentType && /charset=/i.test(resContentType)) {
          resCharset = resContentType.split('charset=')[1].toLowerCase();
        }
        serverResData = iconv.decode(serverResData, resCharset);

        // cheerio parse html
        let $ = cheerio.load(serverResData, {
          normalizeWhitespace: false,
          xmlMode: false,
          decodeEntities: false
        });
        const commentNodes = utilsLib.parseCommentNodes($, $.root(), []);

        const injectWV = proxyOptions.injectWV;
        if (injectWV) {
          // 在 WindVane 容器内注入 windvane.js
          const userAgent = reqHeaders['User-Agent'];
          const scriptPath = (typeof injectWV === 'string') ? injectWV : Constants.WV_SCRIPT;
          if (/WindVane/i.test(userAgent)) {
            $('head').prepend(`<script src=\"${scriptPath}\"></script>`);
          }
        }

        // SSI include
        if (commentNodes.length > 0) {
          $ = ssiLib($,
              commentNodes,
              path.join(process.cwd(), url.parse(requestUrl).pathname),
              serverResData
            ) || $;
        }

        // 匹配代理 hostname, 且为页面请求
        if (typeof proxyOptions.htmlModify === 'function') {
          proxyOptions.htmlModify(
            req.url,
            reqHeaders,
            res.headers,
            $,
            commentNodes,
            logger,
            (finalServerResData) => {
              callback(iconv.encode(finalServerResData, resCharset));
            }
          );

          needProxy = true;
        }

      }

      if (!needProxy) {
        callback(serverResData);
      }
    }

    // 在请求返回给用户前的延迟时间
    // add a pause before sending response to user
    // pauseBeforeSendingResponse : function(req,res){
    //  var timeInMS = 0; //delay all requests for 1ms
    //  return timeInMS;
    // }
  };

};

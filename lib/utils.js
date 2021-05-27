/**
 * Created by 弘树<dickeylth@live.cn> on 16/2/25.
 */
"use strict";

const path = require('path');
const os = require('os');
const url = require('url');
// const cheerio = require('cheerio');
// const request = require('request');
// const iconv = require('iconv-lite');
// const _ = require('lodash');
// const he = require('he');
const chalk = require('chalk');
const shell = require('shelljs');
const hostile = require('hostile');

/**
 * Mock 服务端响应
 * @param reqUrl {String} 请求 url
 * @param serverResHeaders {Object} 服务端返回响应头
 * @param serverResData {String} 服务端返回数据
 * @param mockFunction {Function} mock 函数
 * @param logger {Object} logger
 * @param callback {Function} 回调函数
 */
function mockResponse(reqUrl, serverResHeaders, serverResData, mockFunction, logger, callback) {

  if (mockFunction && typeof mockFunction === 'function') {
    let ContentType = serverResHeaders['content-type'] || serverResHeaders['Content-Type'];
    if (ContentType) {
      let resContentType = ContentType.split(';').shift();
      if (resContentType === 'application/json') {
        // 处理 JSON / JSONP
        let jsonRetObj = {};

        try {
          jsonRetObj = JSON.parse(serverResData);

          // mockFunction 传入参数
          // - reqUrl: {String} 请求 URL
          // - response: {Object} 响应
          // - response.headers: {Object} 响应头
          // - response.body: {Object|String} 响应体(JSON Object / String)
          let mockResult = JSON.stringify(mockFunction(reqUrl, {
            headers: serverResHeaders,
            body: jsonRetObj
          }));

          // 加上请求 url 上的 callback padding
          const requestParams = url.parse(reqUrl, true).query;
          if (requestParams && requestParams.callback) {
            mockResult = `${requestParams.callback}(${mockResult})`;
          }

          logger.ok(`[Interface Mock] Interface Response Mocked for ${reqUrl}`);
          callback(mockResult);

        } catch (e) {
          // 非合法 JSON 串, 尝试转 JSONP
          var jsonpRegExp = /^\s*(\w*)\((.*)\);?$/g;
          var matchResult = jsonpRegExp.exec(serverResData);
          if (matchResult) {
            var jsonpCallback = matchResult[1],
              jsonStr = matchResult[2];

            try {
              jsonRetObj = JSON.parse(jsonStr.trim());

              var newResponse = mockFunction(reqUrl, {
                headers: serverResHeaders,
                body: jsonRetObj
              });

              // 拿到改写的响应头, 记得拼接回 JSON Padding
              newResponse = jsonpCallback + '(' + JSON.stringify(newResponse) + ');';

              logger.ok(`[Interface Mock] Interface Response Mocked for ${reqUrl}`);
              callback(newResponse);

            } catch (e) {
              // JSONP 包裹内容不是合法 JSON
              logger.error(chalk.red(`>> [Invalid JSON in JSONP Response!]: ${serverResData}`));
              logger.error(e.stack);
              callback(serverResData);
              return;
            }

          } else {
            // 非合法 JSONP 格式响应, 退出
            logger.error(chalk.red(`>> [Invalid JSONP Response!]: ${serverResData}`));
            callback(serverResData);
            return;
          }
        }
      }
    }
  }
  callback(serverResData);

}


/**
 * 读取本机 IP 地址（IPv4）
 * @returns {String}
 */
function getLocalIp() {
  const ifaces = os.networkInterfaces();
  let lookupIpAddress = null;
  for (let dev in ifaces) {
    if (dev !== 'en1' && dev !== 'en0') {
      continue;
    }
    ifaces[dev].forEach(function (details) {
      if (details.family == 'IPv4') {
        lookupIpAddress = details.address;
      }
    });
  }
  return lookupIpAddress || '127.0.0.1';
}


/**
 * 递归调用解析出指定节点下所有注释节点
 * @param $
 * @param node
 * @param commentNodes
 * @returns {Array}
 */
function parseCommentNodes($, node, commentNodes) {
  if (node.type === 'comment') {
    commentNodes.push(node);
  } else {
    $(node).contents().each((nodeIdx, childNode) => {
      parseCommentNodes($, childNode, commentNodes);
    });
  }
  return commentNodes;
}

/**
 * 文件变化时重新绑定函数
 * 从而支持改 sonic config 文件时(如修改接口 mock 返回), 支持刷新页面即生效而不必重启服务
 * @param options
 * @param bindFnNames
 * @param CONFIG_FILE_PATH
 */
exports.reBindMockFns = (options, bindFnNames, CONFIG_FILE_PATH) => {
  bindFnNames.forEach(fnName => {
    options[fnName] = function () {
      delete require.cache[CONFIG_FILE_PATH];
      const realTimeConfig = require(CONFIG_FILE_PATH);
      return realTimeConfig[fnName].apply(null, arguments);
    };
  });
};

/**
 * 加载 npm package
 * @param pkgName {String}
 * @param pkgVersion {String}
 * @param logger {Object}
 * @returns {Promise}
 */
exports.loadPackage = (pkgName, pkgVersion, logger, cwd) => {
  return new Promise((resolve, reject) => {
    try {
      require(path.join(cwd || process.cwd(), 'node_modules', pkgName));
      resolve();
    } catch (e) {
      logger.warn(chalk.yellow(`
${pkgName} not found under local, to be installed...
      `));
      shell.exec(`npm install ${pkgName}@${pkgVersion} --registry=https://registry.npm.taobao.org`, {
        silent: false
      }, (code, output) => {
        if (code !== 0) {
          logger.error(`Failed to install ${pkgName}, please check you network connection!`);
          reject(output);
        } else {
          resolve();
        }
      });
    }
  });
};

exports.checkHosts = () => {
  const ip = '127.0.0.1';
  const host = 'localhost';
  let hasLocalhost = false;

  try {
    const lines = hostile.get() || [];
    lines.some((line) => {
      return (hasLocalhost = line[0] === ip && !!line[1] && line[1].indexOf(host) > -1);
    });
  } catch (err) {
    return;
  }

  if (!hasLocalhost) {
    try {
      console.log(chalk.yellow(`> 需要添加 ${ip} ${host} 到 ${hostile.HOSTS} 文件`));
      console.log(chalk.yellow('> 正为尝试您自动添加...'));
      shell.exec(`sudo -- sh -c -e "echo '\n${ip} ${host}' >> ${hostile.HOSTS}";`);
      console.log(chalk.green('> 添加成功'));
    } catch (err) {
      console.error(chalk.red(`> 添加失败，请手动添加后重试命令`));
      throw err;
    }
  }
}

exports.mockResponse = mockResponse;
exports.getLocalIp = getLocalIp;
exports.parseCommentNodes = parseCommentNodes;

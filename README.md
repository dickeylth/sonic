# @ali/sonic

![Sonic](https://gw.alicdn.com/tps/TB1qqPfMXXXXXaiXXXXXXXXXXXX-800-600.png_320x320.jpg)

Image From: <https://dribbble.com/shots/2338954-Sonic-Speed>

> 一键式多功能前端本地开发调试环境
>
> Front-End Dev server based on [anyproxy](http://anyproxy.io) & [webpack-dev-server](https://github.com/webpack/webpack-dev-server).

## 特性

1. 轻量级的本地静态资源服务，自动起 Chrome 进程完成代理绑定，支持可配置的虚拟域名，淘系下 \*.taobao.com 域名开发（免登、mtop）无痛开发再也不是梦;
1. 自动按需整合 [webpack-dev-server](https://github.com/webpack/webpack-dev-server), 零配置支持 [HMR（Hot Module Replacement, 热模块替换）](https://webpack.github.io/docs/hot-module-replacement.html);
1. 支持方便的接口 Mock（JSONP 也不在话下）和输出页面 DOM 修改([TMS/EMS 区块嵌入页面](http://h5.alibaba-inc.com/awp/PageTags.html#tms_标签)，脚本注入 so easy);
1. https 支持，只需信任 anyproxy 证书，即刻进入 https 的世界;
1. 轻松 hosts 绑定，指定 hosts 映射表即可，从此远离修改系统 hosts 文件;
1. TO BE CONTINUED...

## 安装

### 命令行使用

```shell
tnpm i @ali/sonic -g
```

### 作为 lib

```shell
tnpm i @ali/sonic -S
```

## 使用

### 命令行

命令行下执行 `sonic`, 会自动将当前作为目录作为内容根目录起本地服务, 如果当前目录下有 `webpack.config.js` 文件, 会将其作为 webpackConfig, 起 webpack-dev-server, 并会在控制台输出相应配置:

```
h5 ➤ sonic --https
Proxy for Sonic!
Anyproxy rules initialize finished, have fun!
>> Proxy server started at http://10.62.64.141:8080
GUI interface started at : http://10.62.64.141:8002/
Http proxy started at 10.62.64.141:8080
[internal https]certificate created for 10.62.64.141
>>
-------------- 服务配置 --------------
本地 IP 地址	=> 10.62.64.141
本地代理服务	=> 10.62.64.141:8080
静态资源服务	=> http://10.62.64.141:8081
请求代理监控	=> http://localhost:8002
-------------- 服务配置 --------------
...
```

如果当前目录下不存在 sonic 配置文件 (`sonic.config.js`), 则会自动根据模板和当前配置项生成一份, 后续命令行执行会合并命令行参数和 sonic 配置文件配置.

查看全部命令行参数:

```
h5 ➤ sonic -h

  Usage: sonic [options]

  Options:

    -h, --help                                   查看帮助
    -v, --version                                查看版本号
    -w, --webpackConfig [value]                  webpack.config.js 配置文件路径
    -s, --serverPort [value]                     本地静态资源服务端口号
    -p, --proxyPort [value]                      代理服务工作端口号
    --hosts [value]                              需要代理的本地虚拟域名, 请以 ',' 分隔
    --https                                      是否切换到 https

```

### 作为 lib

```
var Sonic = require('@ali/sonic');
var options = {
  // webpack 配置, 可为 webpack.config.js 路径或 webpack 配置对象
  webpackConfig: path.join(pwd, 'webpack.config.js'),

  // 本地静态资源服务端口号
  serverPort: 8081,

  // 本地代理服务端口号
  proxyPort: 8080,

  // Anyproxy 的 web 请求监控页面端口号
  webPort: 8002,

  // Anyproxy 的 websocket 请求工作端口号
  socketPort: 8003,

  // 需要代理的 hosts 字符串数组
  hosts: [],

  // 是否显示 webpack 编译进度
  progress: true,

  // 是否自动注入 HMR
  injectHMR: true,

  // 注入 WindVane 脚本路径, 自动在 WindVane 容器下注入 windvane.js, 如不需要设置为 `false` 即可
  injectWV: true || 'http://xxx/windvane.js',

  // 是否切换到 https
  https: false,

  // 内容根目录
  contentBase: pwd,

  // 是否禁用控制台 log 输出
  silent: false,

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
  mockRegExp: null,

  /**
   * 接口 mock 处理函数
   * @param requestUrl {String} 请求 URL
   * @param response {Object} 服务端响应
   * @param response.headers {Object} 响应头
   * @param response.body {Object|String}  响应体, 如果是 JSON / JSONP, 自动转为 JSON 对象
   * @returns {Object} 返回可 JSON 序列化的对象
   */
  mockFunction: (requestUrl, response) => {
    return responseBody;
  },

  // hosts 映射表, 域名 - IP 键值对
  hostsMap: {},

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

  /**
   * 改写发出的请求
   */
  modifyRequestObject: (requestObj) => {
    requestObj.requestOptions.port = 1234;
    return requestObj;
  }
};
Sonic(options, /*logger (optional)*/, (server) => {

  // 进程退出
  process.on('SIGINT', () => {
    server.close();
  });
});
```

### Options

#### options.webpackConfig

- Type: `String|Object`
- Default value: `path.join(process.cwd(), 'webpack.config.js')`
- Webpack config 文件路径 / Webpack 配置对象

#### options.serverPort

- Type: `Number`
- Default value: `8081`
- 本地静态服务工作的端口号

#### options.proxyPort

- Type: `Number`
- Default value: `8080`
- 代理服务工作端口号

#### options.webPort

- Type: `Number`
- Default value: `8002`
- Anyproxy 的 web 请求监控页面端口号


#### options.socketPort

- Type: `Number`
- Default value: `8003`
- Anyproxy 的 websocket 请求工作端口号


#### options.hosts

- Type: `Array`
- Default value: `[]`
- 需要模拟的虚拟域名

#### options.progress

- Type: `Boolean`
- Default value: `true`
- 是否显示 webpack 编译进度


#### options.injectHMR

- Type: `Boolean`
- Default value: `true`
- 是否对 webpack 编译, 自动注入 [HMR](https://webpack.github.io/docs/hot-module-replacement.html)


#### options.injectWV

- Type: `Boolean|String`
- Default value: `true`
- 是否在 WindVane 容器内(根据 UserAgent 探测)自动注入 windvane.js, 或者可配置为 windvane.js 脚本路径

### options.https

- Type: `Boolean`
- Default value: `false`
- 是否切换到 https.


#### options.contentBase

- Type: `String`
- Default value: `process.cwd()`
- [Webpack Dev Server 的 contentBase 配置](https://webpack.github.io/docs/webpack-dev-server.html#api)

#### options.silent

- Type: `Boolean`
- Default value: `false`
- 是否禁用掉控制台 anyproxy 输出 log

#### options.pureStatic

- Type: `Boolean`
- Default value: `false`
- 是否仅仅启动本地纯静态文件服务, 而不需要 webpack-dev-server

#### options.openBrowser

- Type: `Boolean`
- Default value: `true`
- 是否在浏览器自动打开 Url

### options.openPath

- Type: `String`
- Default value: `'/'`
- 本地服务启动后自动加载的路径

### options.openUrl

- Type: `String`
- Default value: `'/'`
- 本地服务启动后自动加载的页面完整 URL, 优先级高于 `options.openPath`

### options.mockRegExp

- Type: `RegExp`
- Default value: `null`
- 需要接口 Mock 的 url 应该匹配的正则

### options.mockFunction

- Type: `Function`
- Default value: `(requestUrl, response) => { return responseBody; }`
- 接口 Mock 方法

### options.mockBeforeFunction

- Type: `Function`
- Default value: `(requestUrl) => { return responseBody; }`
- 接口 Mock 方法

### options.hostsMap

- Type: `Object`
- Default value: `{}`
- hosts 映射表, 和本地绑 hosts 一样的原理

### options.htmlInterceptReg

- Type: `RegExp`
- Default value: `/$^/`(不匹配任何 URL)
- 需要页面 Mock 的 url 应该匹配的正则

### options.htmlModify

- Type: `Function`
- Default value: `(reqUrl, reqHeaders, resHeaders, $, commentNodes, logger, cb) => { cb($.html()); }`
- 对本地虚拟域名下加载的 html 页面进行自定义操作(如插入脚本, tms/ems 区块自动注入等)

### options.assetsComboRegExp

- Type: `RegExp`
- Default value: `/$^/`(不匹配任何 URL)
- 需要拆分 js/css 资源 combo 的 url 应该匹配的正则

### options.assetsComboMapLocal

- Type: `Function`
- Default value: `(comboUrl, comboParts) => { return comboParts; }`
- 输入远程 js/css 资源 combo 的 url 和拆分后的各个单独资源文件请求, 返回对应应该映射到本地的文件路径(相对于当前工作目录)。
- 如某个映射本地文件不存在会自动加载线上。

### options.webpackStatsOption

- Type: `Object`
- Default value: `{}`
- [`stats` option for webpack-dev-server](https://webpack.github.io/docs/webpack-dev-server.html#api)

### options.modifyRequestObject

- Type: `Function`
- Default value: `(requestObj) => { return requestObj; }`
- 改写请求，请参考 <http://anyproxy.io/cn/#%E4%BF%AE%E6%94%B9%E8%AF%B7%E6%B1%82%E7%9A%84%E7%9B%AE%E6%A0%87%E5%9C%B0%E5%9D%80>。


### options.corsInject

- Type: `Boolean`
- Default value: `true`
- 是否自动注入 CORS 响应头.

## 接口 Mock

### 接口 Mock 脚本 Demo

```js
/**
 * 接口 mock 处理模块
 * @param requestUrl {String} 请求 URL
 * @param response {Object} 服务端响应
 * @param response.headers {Object} 响应头
 * @param response.body {Object|String}  响应体, 如果是 JSON / JSONP, 自动转为 JSON 对象
 * @returns {Object} 返回可 JSON 序列化的对象
 */
module.exports = function (requestUrl, response) {

  var url = require('url');
  var parsedReqUrl = url.parse(requestUrl, true);
  var params = parsedReqUrl.query;
  var responseBody = response.body;

  switch (params.api) {
    // case 'mtop.xxx':
    //   responseBody.test = 123;
    //   break;
    default:
      responseBody.default = true;
      break;
  }

	return responseBody;
};
```

## 原理图

![原理图](http://gtms02.alicdn.com/tps/i2/TB1ITFhMXXXXXbUaXXXFD0rNpXX-1778-1334.png)

1. 开发者从虚拟域名（如 `dev.waptest.taobao.com`）请求本地目录页面；
2. 本地代理服务对浏览器各个请求分别做不同的代理分发：
3. 如果是虚拟域名下的资源请求 `dev.waptest.taobao.com/*`，统一定向到本地 webpack-dev-server 的静态资源服务；
4. 如果是请求 url 匹配上接口 mock url 规则，将接口服务器的响应做代理，执行用户定义的响应数据重写逻辑后，再通过代理服务传递回浏览器端；
5. 其他类型的资源请求（如线上图片、埋点等），代理服务器透明代理，不做处理

## 常见问题

- Q: 接口代理未生效?
  - A: 有可能站点证书已过期, 参见 [Anyproxy issue #1](http://gitlab.alibaba-inc.com/alipay-ct-wd/anyproxy/issues/1), 删除掉旧证书(路径默认在 ~/.anyproxy-certs)刷新即可重新生成新的证书.

- Q: 切换到 https 时站点或接口访问有问题?
  - A: 尝试 `rm -rf ~/.anyproxy-certs`, 然后重新启动服务, 将 anyproxy 证书加入系统钥匙串, 然后重试.
  - A: 更多 https 配置可参考: [HTTPS相关教程](https://github.com/alibaba/anyproxy/wiki/HTTPS%E7%9B%B8%E5%85%B3%E6%95%99%E7%A8%8B)

- Q: 移动端如何绑定 HTTP 代理？
    - A:
        1. Android
	        - 参考：[安卓手机如何进行代理设置](http://jingyan.baidu.com/article/fd8044faebfaa85030137a72.html)
        2. iOS
	        - 参考：[iOS开发工具——网络封包分析工具Charles](http://www.infoq.com/cn/articles/network-packet-analysis-tool-charles/)\#iPhone上的设置

- Q: 移动端（手机、Pad 等）如何访问 https？
    - A: 在桌面浏览器打开控制台输出的 `请求代理监控	=> http://localhost:8002` 部分的监控页面 url，点击『QRCode of rootCA.crt』，在新打开的 [http://localhost:8002/qr_root](http://localhost:8002/qr_root) 页面中通过移动端扫码应用扫码即会自动进入证书安装流程（建议最好使用系统原生浏览器打开二维码 url）

## 周边

- Grunt task: [@ali/grunt-devserver](http://web.npm.alibaba-inc.com/package/@ali/grunt-devserver)

## Credits

- [![Anyproxy](http://gtms04.alicdn.com/tps/i4/TB1XfxDHpXXXXXpapXX20ySQVXX-512-512.png_120x120.jpg)](http://anyproxy.io/)
- [webpack-dev-server](https://webpack.github.io/docs/webpack-dev-server.html)

## Release History

- [1.0.0]
  - initial version

## License
Copyright (c) 2016 弘树. Licensed under the MIT license.

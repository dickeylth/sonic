const legacy = require('./anyproxy-rule');

module.exports = function(options) {
  const rule = legacy(options);

  function dealLocalResponse(req) {
    return new Promise(function(resolve) {
      rule.dealLocalResponse(req, {}, function(statusCode, header, body) {
        resolve({
          statusCode,
          header,
          body
        });
      });
    });
  }

  function replaceServerResDataAsync(req, res) {
    return new Promise(function(resolve) {
      res.headers = res.header; // 兼容
      rule.replaceServerResDataAsync(req, res, res.body, function(body) {
        resolve(Object.assign(Object.assign({}, res), { body }));
      });
    });
  }

  // 兼容
  function parseRequest(req) {
    req.requestOptions.headers.hostname = req.requestOptions.hostname;
    req.requestOptions.headers.host = req.requestOptions.headers.Host;
    req.headers = req.requestOptions.headers;
    req.connection = req._req.connection;
    return req;
  }

  return {
    summary: rule.summary(),

    *beforeDealHttpsRequest(req) { // eslint-disable-line
      // 兼容
      return rule.shouldInterceptHttpsReq({
        headers: {
          host: req._req.headers.host,
        },
        url: req._req.url
      });
    },

    *beforeSendRequest(req) {
      req = parseRequest(req);
      if (typeof options.modifyRequestObject === 'function') {
        req = options.modifyRequestObject(req);
      }
      req.requestOptions = rule.replaceRequestOption(req, req.requestOptions);
      req.requestOptions.headers = rule.replaceResponseHeader(req, {}, req.requestOptions.headers);

      if (rule.shouldUseLocalResponse(req)) {
        req.response = yield dealLocalResponse(req);
      }

      return req;
    },

    *beforeSendResponse(req, res) {
      const response = yield replaceServerResDataAsync(parseRequest(req), res.response);
      return { response };
    }
  }
}

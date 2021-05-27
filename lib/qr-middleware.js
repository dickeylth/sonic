const pwd = process.cwd();
const fs = require('fs');
const path = require('path');
const url = require('url');
const cheerio = require('cheerio');
const qrcode = require('yaqrcode');
const pkgPath = path.join(pwd, 'package.json');
const pkg = fs.existsSync(pkgPath) ? require(pkgPath) : {};

const injectHTML = (htmlSource, scanUrl, logger) => {
  logger.verbose.info('>> Injecting QRCode.');

  const $ = cheerio.load(htmlSource, {
    normalizeWhitespace: false,
    xmlMode: false,
    decodeEntities: false
  });

  let qrcodeLog = '';

  try {
    qrcodeLog = `console.log("%c          ",
    "padding:2px 80px 4px;" +
    "line-height:160px;background:url('" + "${qrcode(scanUrl)}" +  "') no-repeat;" +
    "background-size:160px");`
  } catch (e) {
    qrcodeLog = `console.error("自动生成二维码失败，请手动拷贝以上链接去其他工具生成二维码");`
  }

  $('body').append(`
    <script>
      (function() {
        console.log('扫码 URL: ' + '${scanUrl}');
        if (!window.qrCodeInjected){
          ${qrcodeLog}
          window.qrCodeInjected = true;
        }
      })();
    </script>
    `);

  return $.html();
};

function generateScanUrl(req, parsedReqUrl, serverHost) {
  const edithUrl = req.query.__edith_orig_url__;

  if (edithUrl) {
    parsedReqUrl = url.parse(edithUrl, true);
  }

  parsedReqUrl.search = null; // 设置为空，否则 format 时直接用老的 search 不用新的 query 对象
  parsedReqUrl.host = parsedReqUrl.host || req.host;
  parsedReqUrl.protocol = parsedReqUrl.protocol || req.protocol || 'http';

  delete parsedReqUrl.query.__edith_orig_url__;

  if (pkg.flugy) {
    if (!parsedReqUrl.query.wbundle) {
      const parsedWbundleUrl = url.parse(parsedReqUrl.format(), true);
      parsedWbundleUrl.hash = '';
      parsedWbundleUrl.query = {};
      parsedWbundleUrl.search = null;
      parsedWbundleUrl.pathname = parsedWbundleUrl.pathname.replace(/\.html$/, pkg.lib === 'rax' ? '.web.js' : '.entry.js');
      if (edithUrl) {
        if (!/\/clam\/share\//.test(parsedWbundleUrl.pathname)) {
          parsedWbundleUrl.pathname = parsedWbundleUrl.pathname.replace('/clam/', '/clam/share/')
        }
      } else {
        parsedWbundleUrl.host = serverHost;
      }
      parsedReqUrl.query.wbundle = parsedWbundleUrl.format();
    }
    parsedReqUrl.query.un_flutter = true;
  } else if (edithUrl) {
    if (!/\/clam\/share\//.test(parsedReqUrl.pathname)) {
      parsedReqUrl.pathname = parsedReqUrl.pathname.replace('/clam/', '/clam/share/');
    }
  }

  return parsedReqUrl.format();
}

module.exports = (contentBase, logger, serverHost) => {
  return (req, res, next) => {
    const parsedReqUrl = url.parse(req.url, true);
    const reqPath = parsedReqUrl.pathname;
    const filePath = path.join(contentBase, reqPath);

    if (/\.html/.test(reqPath) && fs.existsSync(filePath)) {
      const htmlSource = fs.readFileSync(filePath, 'utf-8');
      const scanUrl = generateScanUrl(req, parsedReqUrl, serverHost);
      res.send(injectHTML(
        htmlSource,
        scanUrl,
        logger)
      );
    } else {
      next();
    }
  };
}

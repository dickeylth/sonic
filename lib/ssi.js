/**
 * Created by 弘树<dickeylth@live.cn> on 16/6/3.
 */
"use strict";

const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');
const SSI_REG = /\#include\s*virtual=[\'|\"](.*)[\'|\"]/;

module.exports = ($, commentNodes, fileAbsPath, fileOrigSource) => {
  const ssiNodes = commentNodes.filter(comNode => SSI_REG.test(comNode.data));
  if (ssiNodes.length > 0) {
    const fileDirAbsPath = path.dirname(fileAbsPath);
    ssiNodes.forEach(ssiNode => {
      const ssiStr = ssiNode.data;
      const includeFilePath = ssiStr.match(SSI_REG)[1];

      const fileResolvePath = path.resolve(path.dirname(fileAbsPath), includeFilePath);
      if (fs.existsSync(fileResolvePath)) {
        let ssiSegmentSource = fs.readFileSync(fileResolvePath, 'utf8');
        const $$ = cheerio.load(ssiSegmentSource, {
          normalizeWhitespace: false,
          xmlMode: false,
          decodeEntities: false
        });

        // 相对路径替换
        $$('script[src]').each((idx, scriptNode) => {
          scriptNode = $$(scriptNode);
          const scriptSrcPath = scriptNode.attr('src');
          if (/^\./.test(scriptSrcPath)) {
            const scriptAbsPath = path.resolve(path.dirname(fileResolvePath), scriptSrcPath);
            // grunt.verbose.writeln('scriptAbsPath: ' + scriptAbsPath);
            const scriptNewRelPath = path.relative(fileDirAbsPath, scriptAbsPath);
            // grunt.verbose.writeln('scriptNewRelPath: ' + scriptNewRelPath);
            // 采用替换, 而不是直接修改 $$, 因为 SSI 区块可能不是完整的闭合标签
            ssiSegmentSource = ssiSegmentSource.replace(scriptSrcPath, scriptNewRelPath);
          }
        });
        $$('link[href]').each((idx, styleNode) => {
          styleNode = $$(styleNode);
          const styleSrcPath = styleNode.attr('href');
          if (/^\./.test(styleSrcPath)) {
            const styleAbsPath = path.resolve(path.dirname(fileResolvePath), styleSrcPath);
            // grunt.verbose.writeln('styleAbsPath: ' + styleAbsPath);
            const styleNewRelPath = path.relative(fileDirAbsPath, styleAbsPath);
            // grunt.verbose.writeln('styleNewRelPath: ' + styleNewRelPath);
            // 采用替换
            ssiSegmentSource = ssiSegmentSource.replace(styleSrcPath, styleNewRelPath);
          }
        });
        // $(ssiNode).replaceWith(ssiSegmentSource);
        // console.log($(ssiNode));
        fileOrigSource = fileOrigSource.replace(`<!--${ssiStr}-->`, ssiSegmentSource);
      } else {
        ssiNode.data = `ERROR: SSI PATH ${fileResolvePath} not exist.`;
      }
    });

    return cheerio.load(fileOrigSource, {
      normalizeWhitespace: false,
      xmlMode: false,
      decodeEntities: false
    });
  }
  return $;
};

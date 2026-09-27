/*
 * string-engine.js — 字符串拼接降级引擎。
 * 当浏览器不支持 CSS Typed OM（或 Typed OM 写入失败）时，
 * 用纯函数求值 + 字符串拼接完成同样的样式更新，保证结果一致。
 */
(function (root) {
  'use strict';

  var ExpressionEngine = root.ExpressionEngine;

  // 求值并格式化为 CSS 字符串，如 "42.5px"
  function evaluateToString(input, ctx) {
    var result = ExpressionEngine.evaluateExpression(input, ctx);
    return format(result);
  }

  function format(result) {
    var num = Math.round(result.value * 1e6) / 1e6; // 控制浮点噪声
    return num + (result.unit === 'number' ? '' : result.unit);
  }

  // 批量样式更新（字符串方式）：拼接 cssText 一次性写入
  function batchApply(updates) {
    var failures = [];
    var applied = 0;
    // 按元素分组，拼接 cssText 减少 reflow
    var byEl = new Map();
    for (var i = 0; i < updates.length; i++) {
      var u = updates[i];
      if (!byEl.has(u.el)) byEl.set(u.el, []);
      byEl.get(u.el).push(u);
    }
    byEl.forEach(function (list, el) {
      var cssText = list.map(function (u) {
        var prop = u.property.replace(/[A-Z]/g, function (c) {
          return '-' + c.toLowerCase();
        });
        return prop + ': ' + u.value + (u.unit === 'number' ? '' : u.unit);
      }).join('; ');
      try {
        el.style.cssText += ';' + cssText;
        applied += list.length;
      } catch (e) {
        list.forEach(function (u) {
          failures.push({ property: u.property, error: String(e) });
        });
      }
    });
    return { applied: applied, failures: failures };
  }

  root.StringEngine = {
    evaluateToString: evaluateToString,
    format: format,
    batchApply: batchApply
  };
})(typeof self !== 'undefined' ? self : this);

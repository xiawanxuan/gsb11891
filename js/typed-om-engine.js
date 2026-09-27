/*
 * typed-om-engine.js — 基于 CSS Typed OM 的样式数值引擎。
 * 使用 CSSUnitValue / CSSMathSum / CSSMathProduct / CSSMathNegate / CSSMathInvert
 * 构建计算表达式，并通过 attributeStyleMap 批量写入样式。
 * 所有 API 调用均包裹 try/catch，失败时抛出带 cause 的错误供上层降级。
 */
(function (root) {
  'use strict';

  var UnitSystem = root.UnitSystem;

  // 特性检测：Typed OM 是否可用
  function detectSupport() {
    var supported = typeof CSSUnitValue === 'function' &&
      typeof CSSMathSum === 'function' &&
      typeof CSSMathProduct === 'function' &&
      typeof CSSMathNegate === 'function' &&
      typeof CSSMathInvert === 'function' &&
      typeof CSS !== 'undefined' && typeof CSS.px === 'function' &&
      typeof document !== 'undefined' &&
      document.documentElement &&
      'attributeStyleMap' in document.documentElement;
    var detail = {
      CSSUnitValue: typeof CSSUnitValue === 'function',
      CSSMathSum: typeof CSSMathSum === 'function',
      CSSMathProduct: typeof CSSMathProduct === 'function',
      CSSMathNegate: typeof CSSMathNegate === 'function',
      CSSMathInvert: typeof CSSMathInvert === 'function',
      attributeStyleMap: typeof document !== 'undefined' &&
        !!document.documentElement && 'attributeStyleMap' in document.documentElement
    };
    return { supported: supported, detail: detail };
  }

  // 采集真实换算上下文（em/rem/vw/vh/% 的参照值）
  function collectContext(el) {
    el = el || document.documentElement;
    var fontSize = parseFloat(getComputedStyle(el).fontSize) || 16;
    var rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    var parent = el.parentElement;
    var percentBase = parent ? parent.getBoundingClientRect().width : 100;
    return {
      fontSize: fontSize,
      rootFontSize: rootFontSize,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      percentBase: percentBase || 100
    };
  }

  function unitValue(value, unit) {
    if (unit === 'number') return new CSSUnitValue(value, 'number');
    return new CSSUnitValue(value, unit);
  }

  // 把表达式 AST 构建为 Typed OM 计算树（CSSMathSum/Product/Negate/Invert）
  function buildMathTree(ast) {
    switch (ast.type) {
      case 'literal':
        return unitValue(ast.value, ast.unit);
      case 'negate':
        return new CSSMathNegate(buildMathTree(ast.operand));
      case 'binary': {
        var left = buildMathTree(ast.left);
        var right = buildMathTree(ast.right);
        switch (ast.op) {
          case '+':
            return new CSSMathSum(left, right);
          case '-':
            return new CSSMathSum(left, new CSSMathNegate(right));
          case '*':
            return new CSSMathProduct(left, right);
          case '/':
            return new CSSMathProduct(left, new CSSMathInvert(right));
          default:
            throw new Error('未知运算符: ' + ast.op);
        }
      }
      default:
        throw new Error('未知 AST 节点: ' + ast.type);
    }
  }

  // 用 Typed OM 求值：构建计算树 -> 临时写入 -> 读回解析后的 CSSUnitValue
  // 返回 { value, unit }（px 系单位会按浏览器规则归一）
  function evaluateViaTypedOM(ast, probeEl) {
    var probe = probeEl || document.createElement('div');
    var tree = buildMathTree(ast);
    var previous;
    var hadValue = probe.attributeStyleMap.has('width');
    if (hadValue) previous = probe.attributeStyleMap.get('width');
    try {
      probe.attributeStyleMap.set('width', tree);
      var readBack = probe.attributeStyleMap.get('width');
      if (!readBack) throw new Error('Typed OM 回读为空');
      // 尝试归一到可比较的数值
      var simple = trySimplify(readBack);
      return simple;
    } finally {
      if (hadValue) probe.attributeStyleMap.set('width', previous);
      else probe.attributeStyleMap.delete('width');
    }
  }

  function trySimplify(cssValue) {
    if (cssValue instanceof CSSUnitValue) {
      return { value: cssValue.value, unit: cssValue.unit };
    }
    // CSSMathSum 等：尝试 .to() 归一，失败则返回字符串形式
    if (cssValue && typeof cssValue.to === 'function') {
      try {
        var px = cssValue.to('px');
        if (px instanceof CSSUnitValue) return { value: px.value, unit: 'px' };
      } catch (e) { /* 含 % 等无法归一时忽略 */ }
    }
    return { value: NaN, unit: 'raw', raw: String(cssValue) };
  }

  // 单位换算（Typed OM 优先，失败回退纯函数换算）
  function convertUnit(value, fromUnit, toUnit, ctx) {
    var support = detectSupport();
    if (support.supported) {
      try {
        var uv = unitValue(value, fromUnit);
        var converted = uv.to(toUnit);
        if (converted instanceof CSSUnitValue) return converted.value;
      } catch (e) { /* 落到纯函数换算 */ }
    }
    var result = UnitSystem.convert(value, fromUnit, toUnit, ctx);
    if (result === null) {
      var err = new Error('单位不兼容: 无法将 "' + fromUnit + '" 换算为 "' + toUnit + '"');
      err.kind = 'incompatible-units';
      throw err;
    }
    return result;
  }

  // 批量样式更新（Typed OM）：同一帧内写入 attributeStyleMap
  // updates: [{ el, property, value(number), unit }]
  // 返回 { applied, failures: [{ property, error }] }
  function batchApply(updates) {
    var failures = [];
    var applied = 0;
    for (var i = 0; i < updates.length; i++) {
      var u = updates[i];
      try {
        u.el.attributeStyleMap.set(u.property, unitValue(u.value, u.unit));
        applied++;
      } catch (e) {
        failures.push({ property: u.property, error: String(e) });
      }
    }
    return { applied: applied, failures: failures };
  }

  root.TypedOMEngine = {
    detectSupport: detectSupport,
    collectContext: collectContext,
    buildMathTree: buildMathTree,
    evaluateViaTypedOM: evaluateViaTypedOM,
    convertUnit: convertUnit,
    batchApply: batchApply,
    unitValue: unitValue
  };
})(typeof self !== 'undefined' ? self : this);

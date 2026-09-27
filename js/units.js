/*
 * units.js — 纯单位系统：单位分类、兼容性判断、单位换算。
 * 不依赖 DOM / CSS Typed OM，可在浏览器、Web Worker、Node 中运行。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.UnitSystem = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 单位 -> 维度类别（% 视为长度：有 percentBase 上下文时可与 px 系互换）
  var UNIT_DIMENSION = {
    px: 'length', em: 'length', rem: 'length',
    vw: 'length', vh: 'length', '%': 'length',
    s: 'time', ms: 'time',
    deg: 'angle', rad: 'angle',
    number: 'number'
  };

  // 默认换算上下文（浏览器里会被真实上下文覆盖）
  var DEFAULT_CONTEXT = {
    fontSize: 16,      // 当前元素 font-size (px)，用于 em
    rootFontSize: 16,  // 根元素 font-size (px)，用于 rem
    viewportWidth: 1024,
    viewportHeight: 768,
    percentBase: 100   // % 的参照基准 (px)，例如父元素宽度
  };

  function dimensionOf(unit) {
    return UNIT_DIMENSION[unit] || null;
  }

  function isKnownUnit(unit) {
    return Object.prototype.hasOwnProperty.call(UNIT_DIMENSION, unit);
  }

  function isCompatible(unitA, unitB) {
    var da = dimensionOf(unitA);
    var db = dimensionOf(unitB);
    return da !== null && da === db;
  }

  // 将 value(unit) 换算为 toUnit，返回数值；无法换算时返回 null
  function convert(value, fromUnit, toUnit, ctx) {
    ctx = ctx || DEFAULT_CONTEXT;
    if (fromUnit === toUnit) return value;
    if (!isCompatible(fromUnit, toUnit)) return null;

    var dim = dimensionOf(fromUnit);
    if (dim === 'length') {
      var px = toPx(value, fromUnit, ctx);
      return px === null ? null : fromPx(px, toUnit, ctx);
    }
    if (dim === 'time') {
      var ms = fromUnit === 's' ? value * 1000 : value;
      return toUnit === 's' ? ms / 1000 : ms;
    }
    if (dim === 'angle') {
      var deg = fromUnit === 'rad' ? value * 180 / Math.PI : value;
      return toUnit === 'rad' ? deg * Math.PI / 180 : deg;
    }
    // number 只能同单位互转
    return null;
  }

  function toPx(value, unit, ctx) {
    switch (unit) {
      case 'px': return value;
      case 'em': return value * ctx.fontSize;
      case 'rem': return value * ctx.rootFontSize;
      case 'vw': return value * ctx.viewportWidth / 100;
      case 'vh': return value * ctx.viewportHeight / 100;
      case '%': return value * ctx.percentBase / 100;
      default: return null;
    }
  }

  function fromPx(px, unit, ctx) {
    switch (unit) {
      case 'px': return px;
      case 'em': return ctx.fontSize === 0 ? null : px / ctx.fontSize;
      case 'rem': return ctx.rootFontSize === 0 ? null : px / ctx.rootFontSize;
      case 'vw': return ctx.viewportWidth === 0 ? null : px / ctx.viewportWidth * 100;
      case 'vh': return ctx.viewportHeight === 0 ? null : px / ctx.viewportHeight * 100;
      case '%': return ctx.percentBase === 0 ? null : px / ctx.percentBase * 100;
      default: return null;
    }
  }

  return {
    UNIT_DIMENSION: UNIT_DIMENSION,
    DEFAULT_CONTEXT: DEFAULT_CONTEXT,
    dimensionOf: dimensionOf,
    isKnownUnit: isKnownUnit,
    isCompatible: isCompatible,
    convert: convert,
    toPx: toPx,
    fromPx: fromPx
  };
});

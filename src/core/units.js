/**
 * 单位换算模块。
 * 所有长度统一换算到 px；相对单位依赖 UnitContext 提供基准。
 */
import { IncompatibleUnitsError } from './errors.js';

/** 绝对单位 -> px 的换算系数。 */
export const ABSOLUTE_TO_PX = Object.freeze({
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  pt: 96 / 72,
  pc: 16,
});

export const RELATIVE_UNITS = Object.freeze(['em', 'rem', 'vw', 'vh', '%']);

/** 单位 -> 维度。% 视为 percentage，但在提供 percentBase 时可换算为 length。 */
export const UNIT_DIMENSION = Object.freeze({
  px: 'length', in: 'length', cm: 'length', mm: 'length',
  q: 'length', pt: 'length', pc: 'length',
  em: 'length', rem: 'length', vw: 'length', vh: 'length',
  '%': 'percentage',
  deg: 'angle', grad: 'angle', rad: 'angle', turn: 'angle',
  s: 'time', ms: 'time',
});

/**
 * @typedef {Object} UnitContext
 * @property {number} fontSize      当前元素字号（em 基准），默认 16
 * @property {number} rootFontSize  根元素字号（rem 基准），默认 16
 * @property {number} viewportWidth 视口宽（vw 基准），默认 1024
 * @property {number} viewportHeight 视口高（vh 基准），默认 768
 * @property {number|null} percentBase 百分比基准（如父容器宽度），null 表示未知
 */
export const DEFAULT_CONTEXT = Object.freeze({
  fontSize: 16,
  rootFontSize: 16,
  viewportWidth: 1024,
  viewportHeight: 768,
  percentBase: null,
});

export function normalizeContext(ctx = {}) {
  return { ...DEFAULT_CONTEXT, ...ctx };
}

export function dimensionOf(unit) {
  if (unit == null) return 'number';
  const dim = UNIT_DIMENSION[unit];
  if (!dim) throw new IncompatibleUnitsError(`未知单位 "${unit}"`);
  return dim;
}

/**
 * 把 { value, unit } 换算成 px 数值。
 * unit 为 null（纯数字）时原样返回。
 */
export function toPx(value, unit, ctx = DEFAULT_CONTEXT) {
  const context = normalizeContext(ctx);
  if (unit == null) return value;
  if (unit in ABSOLUTE_TO_PX) return value * ABSOLUTE_TO_PX[unit];
  switch (unit) {
    case 'em': return value * context.fontSize;
    case 'rem': return value * context.rootFontSize;
    case 'vw': return (value / 100) * context.viewportWidth;
    case 'vh': return (value / 100) * context.viewportHeight;
    case '%':
      if (context.percentBase == null) {
        throw new IncompatibleUnitsError('缺少 percentBase，无法将 % 换算为 px');
      }
      return (value / 100) * context.percentBase;
    default:
      throw new IncompatibleUnitsError(`单位 "${unit}" 不能换算为长度`);
  }
}

/**
 * 把 px 数值换算成目标单位（toPx 的逆运算）。
 */
export function fromPx(pxValue, targetUnit, ctx = DEFAULT_CONTEXT) {
  const context = normalizeContext(ctx);
  if (targetUnit == null) return pxValue;
  if (targetUnit in ABSOLUTE_TO_PX) return pxValue / ABSOLUTE_TO_PX[targetUnit];
  switch (targetUnit) {
    case 'em': return pxValue / context.fontSize;
    case 'rem': return pxValue / context.rootFontSize;
    case 'vw': return (pxValue / context.viewportWidth) * 100;
    case 'vh': return (pxValue / context.viewportHeight) * 100;
    case '%':
      if (context.percentBase == null) {
        throw new IncompatibleUnitsError('缺少 percentBase，无法将 px 换算为 %');
      }
      return (pxValue / context.percentBase) * 100;
    default:
      throw new IncompatibleUnitsError(`单位 "${targetUnit}" 不能作为长度目标单位`);
  }
}

/**
 * 单位换算便捷入口：convert(10, 'em', 'px', ctx)。
 */
export function convert(value, fromUnit, toUnit, ctx = DEFAULT_CONTEXT) {
  const fromDim = dimensionOf(fromUnit);
  const toDim = dimensionOf(toUnit);
  // percentage 与 length 在提供基准时视为可互通
  const compatible =
    fromDim === toDim ||
    ([fromDim, toDim].every((d) => d === 'length' || d === 'percentage'));
  if (!compatible) {
    throw new IncompatibleUnitsError(`单位不兼容：${fromUnit}(${fromDim}) 无法换算为 ${toUnit}(${toDim})`);
  }
  return fromPx(toPx(value, fromUnit, ctx), toUnit, ctx);
}

/** 判断两个单位在运算中是否可合并（加减）。 */
export function isAddCompatible(unitA, unitB) {
  const dimA = dimensionOf(unitA);
  const dimB = dimensionOf(unitB);
  if (dimA === dimB) return true;
  const pair = [dimA, dimB];
  return pair.every((d) => d === 'length' || d === 'percentage');
}

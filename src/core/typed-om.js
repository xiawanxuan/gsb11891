/**
 * CSS Typed OM 适配层（仅浏览器环境可用）。
 * 负责：能力检测、AST -> CSSMathValue 树构建、attributeStyleMap 写入与回读。
 */
import { TypedOMUnsupportedError } from './errors.js';

/** 检测当前环境是否支持 CSS Typed OM。 */
export function isTypedOMSupported() {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof CSS !== 'undefined' &&
      typeof CSS.number === 'function' &&
      typeof CSSMathSum === 'function' &&
      typeof CSSMathProduct === 'function' &&
      typeof document !== 'undefined' &&
      'attributeStyleMap' in document.documentElement
    );
  } catch {
    return false;
  }
}

/** 确保支持，否则抛 TypedOMUnsupportedError。 */
export function assertTypedOMSupported() {
  if (!isTypedOMSupported()) throw new TypedOMUnsupportedError();
}

function literalToCSSNumeric(value, unit) {
  if (unit == null) return new CSSUnitValue(value, 'number');
  if (unit === '%') return new CSSUnitValue(value, 'percent');
  return new CSSUnitValue(value, unit);
}

/**
 * 把 AST 构建为 Typed OM 值树：
 * + / -  -> CSSMathSum（减法转为加负值）
 * *      -> CSSMathProduct
 * /      -> CSSMathProduct(x, CSSMathInvert)
 * 一元负号 -> CSSMathNegate
 */
export function astToTypedOM(ast) {
  assertTypedOMSupported();
  switch (ast.type) {
    case 'literal':
      return literalToCSSNumeric(ast.value, ast.unit);
    case 'negate':
      return new CSSMathNegate(astToTypedOM(ast.operand));
    case 'binary': {
      const left = astToTypedOM(ast.left);
      const right = astToTypedOM(ast.right);
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
          throw new Error(`未知运算符 ${ast.op}`);
      }
    }
    default:
      throw new Error(`未知 AST 节点 ${ast.type}`);
  }
}

/**
 * 用 Typed OM 写入单个属性。
 * @param {Element} el
 * @param {string} property 连字符属性名，如 'margin-top'
 * @param {CSSStyleValue|string} value
 */
export function setStyleTyped(el, property, value) {
  el.attributeStyleMap.set(property, value);
}

/**
 * 用 Typed OM 回读属性（返回 CSSStyleValue 或其字符串形式）。
 */
export function getStyleTyped(el, property) {
  return el.attributeStyleMap.get(property);
}

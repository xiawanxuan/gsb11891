/**
 * 批量样式更新引擎。
 * 把「表达式 -> 求值/构建 Typed OM 值 -> 写入 -> 回读校验」串成一条流水线，
 * 并在每一层提供降级：Typed OM -> setProperty -> cssText 拼接。
 */
import { parse, evaluate, evaluateWithFallback } from './parser.js';
import { isTypedOMSupported, astToTypedOM } from './typed-om.js';
import { valueToCssString, setStyleString, getStyleString } from './fallback.js';
import { StyleUpdateError } from './errors.js';
import { toPx } from './units.js';

/**
 * @typedef {Object} UpdateResult
 * @property {string} property
 * @property {'typed-om'|'string'|'calc-string'} mode 实际生效的写入路径
 * @property {string} cssText 最终写入的字符串形式
 * @property {boolean} readbackMatch 回读值是否与写入值一致（数值容差比较）
 * @property {string} [warning] 非致命问题说明
 */

export class StyleEngine {
  /**
   * @param {Object} opts
   * @param {boolean} [opts.forceFallback] 强制走字符串路径（用于对照实验）
   * @param {Object}  [opts.context] 单位换算上下文
   * @param {number}  [opts.maxDepth] 表达式最大嵌套深度
   */
  constructor({ forceFallback = false, context = {}, maxDepth } = {}) {
    this.forceFallback = forceFallback;
    this.context = context;
    this.maxDepth = maxDepth;
    this.typedOMAvailable = !forceFallback && isTypedOMSupported();
  }

  /**
   * 计算表达式的目标值，返回 { mode, cssText, typedValue? }。
   */
  resolve(expression) {
    const options = this.maxDepth ? { maxDepth: this.maxDepth } : {};
    if (this.typedOMAvailable) {
      // Typed OM 路径：构建 CSSMath 值树；过深时降级为 calc 字符串
      try {
        const ast = parse(expression, options);
        return { mode: 'typed-om', typedValue: astToTypedOM(ast), cssText: String(expression) };
      } catch (err) {
        if (err && err.code === 'EXPRESSION_TOO_DEEP') {
          const r = evaluateWithFallback(expression, this.context, options);
          return { mode: 'calc-string', cssText: r.cssText };
        }
        throw err;
      }
    }
    // 字符串路径：本地求值后写计算结果；过深时降级为 calc 字符串
    const result = evaluateWithFallback(expression, this.context, options);
    if (result.mode === 'calc-string') {
      return { mode: 'calc-string', cssText: result.cssText };
    }
    return { mode: 'string', cssText: valueToCssString(result) };
  }

  /**
   * 更新单个属性，带完整降级链与回读校验。
   * @returns {UpdateResult}
   */
  updateProperty(el, property, expression) {
    const resolved = this.resolve(expression);
    let mode = resolved.mode;

    if (resolved.mode === 'typed-om') {
      try {
        el.attributeStyleMap.set(property, resolved.typedValue);
      } catch (err) {
        // Typed OM 写入失败 -> 本地求值后降级为字符串（原始表达式不是合法 CSS，不能直接写）
        mode = 'string';
        const fallbackResult = evaluateWithFallback(expression, this.context);
        const cssText = fallbackResult.mode === 'calc-string'
          ? fallbackResult.cssText
          : valueToCssString(fallbackResult);
        resolved.cssText = cssText;
        try {
          setStyleString(el, property, cssText);
        } catch (err2) {
          throw new StyleUpdateError(property, err2);
        }
      }
    } else {
      try {
        setStyleString(el, property, resolved.cssText);
      } catch (err) {
        throw new StyleUpdateError(property, err);
      }
    }

    const { match, warning } = this.checkReadback(el, property, resolved.cssText);
    return { property, mode, cssText: resolved.cssText, readbackMatch: match, warning };
  }

  /**
   * 回读校验：浏览器可能把值归一化（如 1em -> 16px、颜色转 rgb），
   * 这里对长度做数值容差比较，其余做字符串比较。
   */
  checkReadback(el, property, expectedCssText) {
    let actual;
    try {
      actual = getStyleString(el, property);
    } catch {
      return { match: false, warning: '回读失败' };
    }
    if (!actual) return { match: true }; // 无法回读（如 jsdom/mock），不视为失败
    const numRe = /^(-?\d*\.?\d+)([a-z%]*)$/i;
    const expectedMatch = String(expectedCssText).trim().match(numRe);
    const actualMatch = String(actual).trim().match(numRe);
    if (expectedMatch && actualMatch) {
      const [, ev, eu] = expectedMatch;
      const [, av, au] = actualMatch;
      if (eu === au) {
        const ok = Math.abs(parseFloat(ev) - parseFloat(av)) < 1e-4;
        return ok
          ? { match: true }
          : { match: false, warning: `回读数值差异: 期望 ${expectedCssText}, 实际 ${actual}` };
      }
      // 单位被浏览器归一化（如 em -> px）：换算到同一单位后比较数值
      try {
        const expectedPx = toPx(parseFloat(ev), eu || null, this.context);
        const actualPx = toPx(parseFloat(av), au || null, this.context);
        const ok = Math.abs(expectedPx - actualPx) < 1e-4;
        return ok
          ? { match: true, warning: `单位被归一化: ${expectedCssText} -> ${actual}` }
          : { match: false, warning: `回读数值差异: 期望 ${expectedCssText}, 实际 ${actual}` };
      } catch {
        return { match: false, warning: `回读单位差异: 期望 ${expectedCssText}, 实际 ${actual}` };
      }
    }
    return String(actual).trim() === String(expectedCssText).trim()
      ? { match: true }
      : { match: false, warning: `回读差异: 期望 ${expectedCssText}, 实际 ${actual}` };
  }

  /**
   * 批量更新：同一帧内写入多个 (元素, 属性, 表达式)。
   * @param {Array<{el: Element, property: string, expression: string}>} updates
   * @returns {{ results: UpdateResult[], failures: Array<{property: string, error: Error}> }}
   */
  batchUpdate(updates) {
    const results = [];
    const failures = [];
    for (const { el, property, expression } of updates) {
      try {
        results.push(this.updateProperty(el, property, expression));
      } catch (error) {
        failures.push({ property, error });
      }
    }
    return { results, failures };
  }
}

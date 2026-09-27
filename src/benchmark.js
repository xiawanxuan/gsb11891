/**
 * 性能基准：Typed OM / 数值求值 vs 字符串拼接。
 * - benchmarkCompute：纯计算（可在 Worker 中运行）
 * - benchmarkStyleWrites：真实样式写入（仅主线程，需要 DOM）
 * 所有计时同时写入 performance.mark/measure，供 PerformanceObserver 收集。
 */
import { evaluateExpression } from './core/parser.js';
import { convert } from './core/units.js';
import { StyleEngine } from './core/batch.js';

const now = () =>
  (typeof performance !== 'undefined' ? performance.now() : Date.now());

function measure(name, start, end) {
  if (typeof performance !== 'undefined' && performance.measure) {
    try {
      performance.measure(name, { start, end });
    } catch { /* 忽略 measure 失败 */ }
  }
}

/**
 * 纯计算对照：数值求值（Typed OM 语义的本地实现） vs calc() 字符串拼接。
 * @returns {{ typedMs: number, stringMs: number, iterations: number, speedup: number }}
 */
export function benchmarkCompute(iterations = 20000, context = {}) {
  let sink = 0;

  // 字符串拼接路径：拼出 calc() 表达式（浏览器中还需解析，这里只计拼接成本）
  let t0 = now();
  for (let i = 0; i < iterations; i++) {
    const s = 'calc(' + (i % 97) + 'px + ' + (i % 13) + 'em * 2 - ' + (i % 7) + 'vw)';
    sink += s.length;
  }
  let t1 = now();
  measure('bench:string-concat', t0, t1);
  const stringConcatMs = t1 - t0;

  // 求值路径：解析 + 单位换算 + 归一到 px
  t0 = now();
  for (let i = 0; i < iterations; i++) {
    const r = evaluateExpression(`${i % 97}px + ${i % 13}em * 2 - ${i % 7}vw`, context);
    sink += r.value;
  }
  t1 = now();
  measure('bench:typed-eval', t0, t1);
  const evalMs = t1 - t0;

  // 单位换算路径
  t0 = now();
  for (let i = 0; i < iterations; i++) {
    sink += convert((i % 50) + 1, 'em', 'vw', { ...context, percentBase: 500 });
  }
  t1 = now();
  measure('bench:unit-convert', t0, t1);
  const convertMs = t1 - t0;

  void sink;
  return { iterations, stringConcatMs, evalMs, convertMs };
}

/**
 * 样式写入对照（需要 DOM）：Typed OM attributeStyleMap vs style.setProperty 字符串。
 * @param {Element} el 目标元素（建议离屏）
 * @param {number} iterations
 */
export function benchmarkStyleWrites(el, iterations = 5000, context = {}) {
  const properties = ['width', 'height', 'margin-left', 'padding-top'];
  const typedEngine = new StyleEngine({ context });
  const stringEngine = new StyleEngine({ forceFallback: true, context });

  const updates = [];
  for (let i = 0; i < iterations; i++) {
    updates.push({
      el,
      property: properties[i % properties.length],
      expression: `${(i % 200) + 10}px + ${i % 5}em`,
    });
  }

  let t0 = now();
  const typedResult = typedEngine.batchUpdate(updates);
  const t1 = now();
  measure('bench:writes-typed-om', t0, t1);

  t0 = now();
  const stringResult = stringEngine.batchUpdate(updates);
  const t2 = now();
  measure('bench:writes-string', t0, t2);

  return {
    iterations,
    typedOmMs: t1 - t0,
    stringMs: t2 - t1,
    speedup: (t2 - t1) / Math.max(t1 - t0, 1e-9),
    typedFailures: typedResult.failures.length,
    stringFailures: stringResult.failures.length,
  };
}

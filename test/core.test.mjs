import { test } from 'node:test';
import assert from 'node:assert/strict';

import { convert, toPx, fromPx } from '../src/core/units.js';
import {
  parse,
  evaluate,
  evaluateExpression,
  evaluateWithFallback,
} from '../src/core/parser.js';
import {
  IncompatibleUnitsError,
  DivisionByZeroError,
  ExpressionTooDeepError,
} from '../src/core/errors.js';
import { StyleEngine } from '../src/core/batch.js';
import { valueToCssString } from '../src/core/fallback.js';
import { benchmarkCompute } from '../src/benchmark.js';

const CTX = {
  fontSize: 16,
  rootFontSize: 16,
  viewportWidth: 1000,
  viewportHeight: 800,
  percentBase: 400,
};

/* ---------- 验收 1：单位转换正确 ---------- */
test('单位转换：px/em/rem/vw/vh/% 互转', () => {
  assert.equal(toPx(2, 'em', CTX), 32);
  assert.equal(toPx(1.5, 'rem', CTX), 24);
  assert.equal(toPx(50, 'vw', CTX), 500);
  assert.equal(toPx(25, 'vh', CTX), 200);
  assert.equal(toPx(50, '%', CTX), 200);
  assert.equal(fromPx(32, 'em', CTX), 2);
  assert.equal(convert(10, 'em', 'px', CTX), 160);
  assert.equal(convert(160, 'px', 'em', CTX), 10);
  assert.equal(convert(100, 'vw', 'px', CTX), 1000);
  assert.ok(Math.abs(convert(50, '%', 'vw', CTX) - 20) < 1e-9); // 200px / 1000px * 100
});

/* ---------- 验收 2：表达式求值正确 ---------- */
test('表达式求值：四则运算与优先级', () => {
  assert.deepEqual(evaluateExpression('10px + 5px', CTX), { value: 15, unit: 'px' });
  assert.deepEqual(evaluateExpression('2em * 3', CTX), { value: 96, unit: 'px' });
  assert.deepEqual(evaluateExpression('100px / 4', CTX), { value: 25, unit: 'px' });
  assert.deepEqual(evaluateExpression('calc(10px + 2em) * 2', CTX), { value: 84, unit: 'px' });
  assert.deepEqual(evaluateExpression('(10px + 5px) * (8 / 4)', CTX), { value: 30, unit: 'px' });
  assert.deepEqual(evaluateExpression('100px / 50px', CTX), { value: 2, unit: null });
  assert.deepEqual(evaluateExpression('-5px + 20px', CTX), { value: 15, unit: 'px' });
  assert.deepEqual(evaluateExpression('50% / 5', CTX), { value: 40, unit: 'px' }); // 200/5
  assert.deepEqual(evaluateExpression('10vw + 10vh', CTX), { value: 180, unit: 'px' });
});

/* ---------- 验收 6：单位不兼容有提示 ---------- */
test('单位不兼容：抛出 IncompatibleUnitsError 并带中文提示', () => {
  assert.throws(() => evaluateExpression('10px + 5s', CTX), (err) => {
    assert.ok(err instanceof IncompatibleUnitsError);
    assert.equal(err.code, 'INCOMPATIBLE_UNITS');
    assert.match(err.message, /单位不兼容/);
    return true;
  });
  assert.throws(() => evaluateExpression('10px + 5', CTX), IncompatibleUnitsError);
  assert.throws(() => convert(1, 'px', 's', CTX), IncompatibleUnitsError);
  assert.throws(() => evaluateExpression('2px * 3px', CTX), IncompatibleUnitsError);
});

/* ---------- 验收 7：除零被捕获 ---------- */
test('除零：抛出 DivisionByZeroError', () => {
  assert.throws(() => evaluateExpression('100px / 0', CTX), (err) => {
    assert.ok(err instanceof DivisionByZeroError);
    assert.equal(err.code, 'DIVISION_BY_ZERO');
    return true;
  });
  assert.throws(() => evaluateExpression('100px / (2 - 2)', CTX), DivisionByZeroError);
});

/* ---------- 验收 8：表达式过深有降级 ---------- */
test('表达式过深：解析抛错，evaluateWithFallback 降级为 calc 字符串', () => {
  const deep = '1px' + ' + (1px'.repeat(50) + ')'.repeat(50);
  assert.throws(() => parse(deep, { maxDepth: 32 }), (err) => {
    assert.ok(err instanceof ExpressionTooDeepError);
    assert.equal(err.code, 'EXPRESSION_TOO_DEEP');
    return true;
  });
  const result = evaluateWithFallback(deep, CTX, { maxDepth: 32 });
  assert.equal(result.mode, 'calc-string');
  assert.ok(result.cssText.startsWith('calc('));
});

/* ---------- 验收 3 + 5 + 9：批量更新正确、降级存在且结果一致 ---------- */
function makeMockElement() {
  return { style: {} };
}

test('批量更新：字符串降级路径写入正确', () => {
  const engine = new StyleEngine({ forceFallback: true, context: CTX });
  const el = makeMockElement();
  const { results, failures } = engine.batchUpdate([
    { el, property: 'width', expression: '10px + 2em' },      // 42px
    { el, property: 'height', expression: '50% / 2' },        // 100px
    { el, property: 'margin-left', expression: '1rem * 2' },  // 32px
  ]);
  assert.equal(failures.length, 0);
  assert.equal(results.length, 3);
  assert.equal(el.style.width, '42px');
  assert.equal(el.style.height, '100px');
  assert.equal(el.style.marginLeft, '32px');
  assert.ok(results.every((r) => r.mode === 'string'));
  assert.ok(results.every((r) => r.readbackMatch));
});

test('降级一致性：forceFallback 与求值结果一致', () => {
  const engine = new StyleEngine({ forceFallback: true, context: CTX });
  const expr = 'calc(10px + 2em) * 3 - 5vw';
  const el = makeMockElement();
  const [r] = engine.batchUpdate([{ el, property: 'width', expression: expr }]).results;
  const expected = evaluateExpression(expr, CTX);
  assert.equal(r.cssText, valueToCssString(expected));
  assert.equal(el.style.width, `${expected.value}px`);
});

test('批量更新：单个失败不影响其他属性，且被记录', () => {
  const engine = new StyleEngine({ forceFallback: true, context: CTX });
  const okEl = makeMockElement();
  const badEl = { style: null }; // 触发 StyleUpdateError
  const { results, failures } = engine.batchUpdate([
    { el: okEl, property: 'width', expression: '10px' },
    { el: badEl, property: 'height', expression: '10px' },
  ]);
  assert.equal(results.length, 1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].error.code, 'STYLE_UPDATE_FAILED');
});

/* ---------- 验收 4：性能对照可量化 ---------- */
test('性能基准：返回可量化的计时数据', () => {
  const r = benchmarkCompute(500, CTX);
  assert.ok(r.stringConcatMs >= 0);
  assert.ok(r.evalMs >= 0);
  assert.ok(r.convertMs >= 0);
  assert.equal(r.iterations, 500);
});

/* ---------- 其他：valueToCssString 格式 ---------- */
test('valueToCssString：数值截断与单位拼接', () => {
  assert.equal(valueToCssString({ value: 42, unit: 'px' }), '42px');
  assert.equal(valueToCssString({ value: 1 / 3, unit: 'em' }), '0.3333em');
  assert.equal(valueToCssString({ value: 7, unit: null }), '7');
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ExpressionEngine = require('../js/expression.js');

const ctx = {
  fontSize: 16, rootFontSize: 16,
  viewportWidth: 1024, viewportHeight: 768, percentBase: 100
};

function evalExpr(input) {
  return ExpressionEngine.evaluateExpression(input, ctx);
}

test('基本加减与单位统一', () => {
  assert.deepEqual(evalExpr('10px + 5px'), { value: 15, unit: 'px' });
  assert.deepEqual(evalExpr('10px - 4px'), { value: 6, unit: 'px' });
});

test('混合单位加法自动换算 (em -> px)', () => {
  // 2em = 32px, + 16px = 48px
  assert.deepEqual(evalExpr('2em + 16px'), { value: 48, unit: 'px' });
});

test('复合表达式: (10px + 2em) * 3 - 5%', () => {
  // (10 + 32) * 3 - 5 = 121
  assert.deepEqual(evalExpr('(10px + 2em) * 3 - 5%'), { value: 121, unit: 'px' });
});

test('乘除与优先级', () => {
  assert.deepEqual(evalExpr('2 + 3 * 4'), { value: 14, unit: 'number' });
  assert.deepEqual(evalExpr('10px / 2'), { value: 5, unit: 'px' });
  assert.deepEqual(evalExpr('3 * 4px'), { value: 12, unit: 'px' });
});

test('一元负号', () => {
  assert.deepEqual(evalExpr('-5px + 10px'), { value: 5, unit: 'px' });
  assert.deepEqual(evalExpr('-(3px + 3px)'), { value: -6, unit: 'px' });
});

test('除零被捕获', () => {
  assert.throws(() => evalExpr('10px / 0'), (e) => {
    assert.equal(e.kind, 'division-by-zero');
    assert.match(e.message, /除数为零/);
    return true;
  });
  assert.throws(() => evalExpr('5% / (1 - 1)'),
    (e) => e.kind === 'division-by-zero');
});

test('单位不兼容有明确提示', () => {
  assert.throws(() => evalExpr('5px + 3s'), (e) => {
    assert.equal(e.kind, 'incompatible-units');
    assert.match(e.message, /px/);
    assert.match(e.message, /s/);
    return true;
  });
});

test('带单位乘法报不兼容', () => {
  assert.throws(() => evalExpr('10px * 2px'),
    (e) => e.kind === 'incompatible-units');
});

test('语法错误被捕获', () => {
  assert.throws(() => evalExpr('10px +'), (e) => e.kind === 'syntax');
  assert.throws(() => evalExpr('hello'), (e) => e.kind === 'syntax');
  assert.throws(() => evalExpr('(1px'), (e) => e.kind === 'syntax');
});

test('表达式过深抛出 too-deep', () => {
  const deep = '('.repeat(100) + '1px' + ')'.repeat(100);
  assert.throws(() => evalExpr(deep), (e) => {
    assert.equal(e.kind, 'too-deep');
    return true;
  });
});

test('过深表达式触发迭代降级且结果一致', () => {
  const nest = (n, inner) => '('.repeat(n) + inner + ')'.repeat(n);
  const deepExpr = nest(70, '1px') + ' + ' + nest(70, '2px');
  const fb = ExpressionEngine.evaluateWithFallback(deepExpr, ctx);
  assert.equal(fb.degraded, true);
  // 与等价的浅表达式结果一致
  assert.deepEqual(fb.result, evalExpr('1px + 2px'));
});

test('迭代降级与递归求值结果一致', () => {
  const cases = [
    '(10px + 2em) * 3 - 5%',
    '-(3px + 3px) * -2',
    '2 + 3 * 4 - (8 / 2)',
    '50vw + 10px - 2rem'
  ];
  for (const c of cases) {
    const tokens = ExpressionEngine.tokenize(c);
    const recursive = ExpressionEngine.evaluate(ExpressionEngine.parse(tokens), ctx);
    const iterative = ExpressionEngine.evaluateIterative(tokens, ctx);
    assert.deepEqual(iterative, recursive, c);
  }
});

test('不过深时降级函数不触发降级', () => {
  const fb = ExpressionEngine.evaluateWithFallback('1px + 2px', ctx);
  assert.equal(fb.degraded, false);
  assert.deepEqual(fb.result, { value: 3, unit: 'px' });
});

test('超过硬上限时降级也失败并明确报错', () => {
  const deepOnly = '('.repeat(600) + '1px' + ')'.repeat(600);
  assert.throws(() => ExpressionEngine.evaluateWithFallback(deepOnly, ctx),
    (e) => {
      assert.equal(e.kind, 'too-deep');
      assert.match(e.message, /512/);
      return true;
    });
});

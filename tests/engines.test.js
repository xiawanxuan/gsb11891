'use strict';
// 用 vm 构造无 DOM 环境，验证降级路径与批量更新行为
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { self: {}, console };
vm.createContext(sandbox);
for (const f of ['units.js', 'expression.js', 'string-engine.js', 'typed-om-engine.js']) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}
const { UnitSystem, ExpressionEngine, StringEngine, TypedOMEngine } = sandbox.self;

const ctx = {
  fontSize: 16, rootFontSize: 16,
  viewportWidth: 1024, viewportHeight: 768, percentBase: 100
};

test('Node 环境下 Typed OM 检测为不支持', () => {
  const support = TypedOMEngine.detectSupport();
  assert.equal(support.supported, false);
  assert.equal(support.detail.CSSUnitValue, false);
});

test('不支持时 convertUnit 降级为纯函数换算且结果正确', () => {
  assert.equal(TypedOMEngine.convertUnit(2, 'em', 'px', ctx), 32);
  assert.equal(TypedOMEngine.convertUnit(50, 'vw', 'px', ctx), 512);
});

test('不支持时不兼容单位换算抛出带 kind 的错误', () => {
  assert.throws(() => TypedOMEngine.convertUnit(1, 'px', 's', ctx),
    (e) => e.kind === 'incompatible-units');
});

test('字符串引擎求值与纯函数求值一致（降级结果一致）', () => {
  const expr = '(10px + 2em) * 3 - 5%';
  const pure = ExpressionEngine.evaluateExpression(expr, ctx);
  const str = StringEngine.evaluateToString(expr, ctx);
  assert.equal(str, '121px');
  assert.equal(parseFloat(str), pure.value);
});

test('字符串批量更新: 全部应用且 cssText 正确', () => {
  const els = Array.from({ length: 4 }, () => ({ style: { cssText: '' } }));
  const updates = [];
  for (let i = 0; i < 10; i++) {
    updates.push({
      el: els[i % 4],
      property: i % 2 === 0 ? 'width' : 'height',
      value: 20 + i,
      unit: 'px'
    });
  }
  const result = StringEngine.batchApply(updates);
  assert.equal(result.applied, 10);
  assert.equal(result.failures.length, 0);
  assert.match(els[0].style.cssText, /width: 20px/);
  assert.match(els[1].style.cssText, /height: 21px/);
});

test('批量更新失败被捕获并记录', () => {
  const badEl = {};
  Object.defineProperty(badEl, 'style', {
    get() { return {}; },
    set() { throw new Error('read-only style'); }
  });
  // cssText += 会触发 set style? 不会——是对 style.cssText 赋值。
  // 构造 cssText setter 抛错的元素：
  const throwingEl = {
    get style() {
      return {
        set cssText(v) { throw new Error('cssText 写入被拒绝'); },
        get cssText() { return ''; }
      };
    }
  };
  const result = StringEngine.batchApply([
    { el: throwingEl, property: 'width', value: 10, unit: 'px' }
  ]);
  assert.equal(result.applied, 0);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].error, /cssText/);
});

test('camelCase 属性转 kebab-case', () => {
  const el = { style: { cssText: '' } };
  StringEngine.batchApply([{ el, property: 'marginTop', value: 8, unit: 'px' }]);
  assert.match(el.style.cssText, /margin-top: 8px/);
});

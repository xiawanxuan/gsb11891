'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const UnitSystem = require('../js/units.js');

const ctx = {
  fontSize: 16, rootFontSize: 16,
  viewportWidth: 1024, viewportHeight: 768, percentBase: 200
};

test('同单位换算为恒等', () => {
  assert.equal(UnitSystem.convert(42, 'px', 'px', ctx), 42);
  assert.equal(UnitSystem.convert(3.5, 'em', 'em', ctx), 3.5);
});

test('em/rem -> px', () => {
  assert.equal(UnitSystem.convert(2, 'em', 'px', ctx), 32);
  assert.equal(UnitSystem.convert(1.5, 'rem', 'px', ctx), 24);
});

test('vw/vh -> px', () => {
  assert.equal(UnitSystem.convert(50, 'vw', 'px', ctx), 512);
  assert.equal(UnitSystem.convert(25, 'vh', 'px', ctx), 192);
});

test('% -> px 与 px -> %', () => {
  assert.equal(UnitSystem.convert(50, '%', 'px', ctx), 100);
  assert.equal(UnitSystem.convert(100, 'px', '%', ctx), 50);
});

test('px -> em/rem 往返一致', () => {
  const em = UnitSystem.convert(48, 'px', 'em', ctx);
  assert.equal(em, 3);
  assert.equal(UnitSystem.convert(em, 'em', 'px', ctx), 48);
});

test('em -> vw 跨单位链式换算', () => {
  // 1em = 16px = 16/1024*100 vw = 1.5625vw
  assert.ok(Math.abs(UnitSystem.convert(1, 'em', 'vw', ctx) - 1.5625) < 1e-9);
});

test('不兼容单位返回 null', () => {
  assert.equal(UnitSystem.convert(1, 'px', 's', ctx), null);
  assert.equal(UnitSystem.convert(1, '%', 'deg', ctx), null);
  assert.equal(UnitSystem.convert(1, 'px', 'number', ctx), null);
});

test('兼容性判断', () => {
  assert.ok(UnitSystem.isCompatible('px', 'em'));
  assert.ok(UnitSystem.isCompatible('vw', '%'));
  assert.ok(!UnitSystem.isCompatible('px', 's'));
  assert.ok(!UnitSystem.isCompatible('deg', 'ms'));
});

test('除零保护: 基准为 0 时返回 null', () => {
  const zeroCtx = { fontSize: 0, rootFontSize: 0, viewportWidth: 0, viewportHeight: 0, percentBase: 0 };
  assert.equal(UnitSystem.convert(1, 'px', 'em', zeroCtx), null);
  assert.equal(UnitSystem.convert(1, 'px', '%', zeroCtx), null);
});

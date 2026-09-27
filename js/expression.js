/*
 * expression.js — CSS 数值表达式解析与求值（纯逻辑，无 DOM 依赖）。
 * 支持 + - * / 、括号、带单位字面量（px/em/rem/vw/vh/%/s/ms/deg/rad）与裸数字。
 * 错误类型：单位不兼容、除零、表达式过深、语法错误。
 */
(function (root, factory) {
  var UnitSystem = (typeof module === 'object' && module.exports)
    ? require('./units.js')
    : root.UnitSystem;
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(UnitSystem);
  } else {
    root.ExpressionEngine = factory(UnitSystem);
  }
})(typeof self !== 'undefined' ? self : this, function (UnitSystem) {
  'use strict';

  var MAX_DEPTH = 64;       // 递归解析的嵌套深度上限，超过则降级
  var HARD_MAX_DEPTH = 512; // 迭代降级求值器的硬上限，防止资源耗尽

  // 各维度的规范基准单位（混合单位运算时归一到基准单位，与浏览器计算样式一致）
  var CANONICAL_UNIT = { length: 'px', time: 'ms', angle: 'deg', number: 'number' };

  function ExprError(kind, message) {
    var err = new Error(message);
    err.name = 'ExprError';
    err.kind = kind; // 'incompatible-units' | 'division-by-zero' | 'too-deep' | 'syntax'
    return err;
  }

  // ---------- 词法分析 ----------
  var TOKEN_RE = /\s*(?:(\d*\.?\d+(?:[eE][+-]?\d+)?)(px|em|rem|vw|vh|%|ms|s|deg|rad)?|([+\-*/()]))/g;

  function tokenize(input) {
    var tokens = [];
    var lastIndex = 0;
    var match;
    TOKEN_RE.lastIndex = 0;
    while ((match = TOKEN_RE.exec(input)) !== null) {
      if (match.index !== lastIndex) {
        throw ExprError('syntax', '无法识别的字符，位置 ' + lastIndex + ': "' + input.slice(lastIndex, match.index) + '"');
      }
      lastIndex = TOKEN_RE.lastIndex;
      if (match[3]) {
        tokens.push({ type: 'op', value: match[3] });
      } else {
        tokens.push({
          type: 'number',
          value: parseFloat(match[1]),
          unit: match[2] || 'number'
        });
      }
    }
    if (lastIndex !== input.length || tokens.length === 0) {
      throw ExprError('syntax', '表达式不完整或含非法内容: "' + input + '"');
    }
    return tokens;
  }

  // ---------- 递归下降解析（带深度限制） ----------
  // grammar: expr := term (('+'|'-') term)* ; term := factor (('*'|'/') factor)* ;
  // factor := ('+'|'-') factor | '(' expr ')' | number
  function parse(tokens) {
    var pos = 0;

    function peek() { return tokens[pos]; }
    function next() { return tokens[pos++]; }

    function parseExpr(depth) {
      if (depth > MAX_DEPTH) {
        throw ExprError('too-deep', '表达式嵌套深度超过 ' + MAX_DEPTH + '，已触发降级');
      }
      var node = parseTerm(depth);
      while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
        var op = next().value;
        node = { type: 'binary', op: op, left: node, right: parseTerm(depth) };
      }
      return node;
    }

    function parseTerm(depth) {
      var node = parseFactor(depth);
      while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
        var op = next().value;
        node = { type: 'binary', op: op, left: node, right: parseFactor(depth) };
      }
      return node;
    }

    function parseFactor(depth) {
      if (depth > MAX_DEPTH) {
        throw ExprError('too-deep', '表达式嵌套深度超过 ' + MAX_DEPTH + '，已触发降级');
      }
      var tok = peek();
      if (!tok) throw ExprError('syntax', '表达式意外结束');
      if (tok.type === 'op' && (tok.value === '-' || tok.value === '+')) {
        next();
        var operand = parseFactor(depth + 1);
        return tok.value === '-' ? { type: 'negate', operand: operand } : operand;
      }
      if (tok.type === 'op' && tok.value === '(') {
        next();
        var inner = parseExpr(depth + 1);
        var closing = next();
        if (!closing || closing.type !== 'op' || closing.value !== ')') {
          throw ExprError('syntax', '缺少右括号');
        }
        return inner;
      }
      if (tok.type === 'number') {
        next();
        return { type: 'literal', value: tok.value, unit: tok.unit };
      }
      throw ExprError('syntax', '意外的记号: "' + tok.value + '"');
    }

    var ast = parseExpr(0);
    if (pos !== tokens.length) {
      throw ExprError('syntax', '表达式存在多余内容');
    }
    return ast;
  }

  // ---------- 求值 ----------
  // 值表示：{ value: number, unit: string }
  function evaluate(ast, ctx) {
    switch (ast.type) {
      case 'literal':
        return { value: ast.value, unit: ast.unit };
      case 'negate': {
        var v = evaluate(ast.operand, ctx);
        return { value: -v.value, unit: v.unit };
      }
      case 'binary':
        return evalBinary(ast, ctx);
      default:
        throw ExprError('syntax', '未知 AST 节点: ' + ast.type);
    }
  }

  function evalBinary(ast, ctx) {
    return applyBinary(ast.op, evaluate(ast.left, ctx), evaluate(ast.right, ctx), ctx);
  }

  function applyBinary(op, left, right, ctx) {
    switch (op) {
      case '+':
      case '-': {
        // 加减要求单位兼容；裸数字可与任意单位运算（视为同单位）
        var pair = unifyUnits(left, right, ctx);
        var result = op === '+' ? pair.a + pair.b : pair.a - pair.b;
        return { value: result, unit: pair.unit };
      }
      case '*': {
        // 乘法：至少一侧为裸数字
        if (left.unit !== 'number' && right.unit !== 'number') {
          throw ExprError('incompatible-units',
            '乘法要求至少一侧为无单位数字，得到 "' + left.unit + ' * ' + right.unit + '"');
        }
        var unit = left.unit === 'number' ? right.unit : left.unit;
        return { value: left.value * right.value, unit: unit };
      }
      case '/': {
        if (right.value === 0) {
          throw ExprError('division-by-zero', '除数为零: ' + formatValue(left) + ' / 0');
        }
        if (right.unit !== 'number') {
          throw ExprError('incompatible-units',
            '除法要求除数为无单位数字，得到 "/ ' + right.unit + '"');
        }
        return { value: left.value / right.value, unit: left.unit };
      }
      default:
        throw ExprError('syntax', '未知运算符: ' + op);
    }
  }

  // 统一两个操作数的单位，返回 { a, b, unit }；混合单位归一到维度基准单位（如 px）
  function unifyUnits(left, right, ctx) {
    if (left.unit === right.unit) {
      return { a: left.value, b: right.value, unit: left.unit };
    }
    if (left.unit === 'number') {
      return { a: left.value, b: right.value, unit: right.unit };
    }
    if (right.unit === 'number') {
      return { a: left.value, b: right.value, unit: left.unit };
    }
    if (!UnitSystem.isCompatible(left.unit, right.unit)) {
      throw ExprError('incompatible-units',
        '单位不兼容: "' + left.unit + '" 与 "' + right.unit + '"（' +
        (UnitSystem.dimensionOf(left.unit) || '未知') + ' ≠ ' +
        (UnitSystem.dimensionOf(right.unit) || '未知') + '）');
    }
    // 归一到维度基准单位（length -> px, time -> ms, angle -> deg）
    var base = CANONICAL_UNIT[UnitSystem.dimensionOf(left.unit)] || left.unit;
    var a = UnitSystem.convert(left.value, left.unit, base, ctx);
    var b = UnitSystem.convert(right.value, right.unit, base, ctx);
    if (a === null || b === null) {
      throw ExprError('incompatible-units',
        '无法将 "' + left.unit + '" / "' + right.unit + '" 归一到 "' + base + '"');
    }
    return { a: a, b: b, unit: base };
  }

  function formatValue(v) {
    return v.value + (v.unit === 'number' ? '' : v.unit);
  }

  // 一站式：解析并求值，返回 { value, unit }
  function evaluateExpression(input, ctx) {
    return evaluate(parse(tokenize(input)), ctx);
  }

  // ---------- 迭代求值器（过深降级路径） ----------
  // 递归下降在 MAX_DEPTH 处中止；降级时改用 shunting-yard 栈式求值，
  // 无递归深度限制，仅受 HARD_MAX_DEPTH 资源上限约束，结果与递归路径一致。
  var PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2, 'u-': 3 };

  function evaluateIterative(tokens, ctx) {
    var values = [];
    var ops = [];
    var depth = 0;
    var prev = null;

    function applyTop() {
      var op = ops.pop();
      if (op === 'u-') {
        var v = values.pop();
        values.push({ value: -v.value, unit: v.unit });
      } else {
        var b = values.pop();
        var a = values.pop();
        values.push(applyBinary(op, a, b, ctx));
      }
    }

    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      if (tok.type === 'number') {
        values.push({ value: tok.value, unit: tok.unit });
      } else if (tok.value === '(') {
        depth++;
        if (depth > HARD_MAX_DEPTH) {
          throw ExprError('too-deep',
            '表达式嵌套超过硬上限 ' + HARD_MAX_DEPTH + '，降级求值也无法处理');
        }
        ops.push('(');
      } else if (tok.value === ')') {
        depth--;
        while (ops.length && ops[ops.length - 1] !== '(') applyTop();
        if (!ops.length) throw ExprError('syntax', '括号不匹配');
        ops.pop();
      } else {
        var op = tok.value;
        var isUnary = prev === null ||
          (prev.type === 'op' && prev.value !== ')');
        if (isUnary && op === '+') { prev = tok; continue; }
        if (isUnary && op === '-') op = 'u-';
        while (ops.length && ops[ops.length - 1] !== '(' &&
               PRECEDENCE[ops[ops.length - 1]] >= PRECEDENCE[op]) {
          applyTop();
        }
        ops.push(op);
      }
      prev = tok;
    }
    while (ops.length) {
      if (ops[ops.length - 1] === '(') throw ExprError('syntax', '括号不匹配');
      applyTop();
    }
    if (values.length !== 1) throw ExprError('syntax', '表达式不完整');
    return values[0];
  }

  // 过深降级：先走递归路径；触发 too-deep 时降级为迭代求值。
  // 返回 { result: {value, unit}, degraded: boolean }
  function evaluateWithFallback(input, ctx) {
    var tokens = tokenize(input);
    try {
      return { result: evaluate(parse(tokens), ctx), degraded: false };
    } catch (e) {
      if (!e || e.kind !== 'too-deep') throw e;
    }
    return { result: evaluateIterative(tokens, ctx), degraded: true };
  }

  return {
    MAX_DEPTH: MAX_DEPTH,
    HARD_MAX_DEPTH: HARD_MAX_DEPTH,
    ExprError: ExprError,
    tokenize: tokenize,
    parse: parse,
    evaluate: evaluate,
    evaluateIterative: evaluateIterative,
    evaluateExpression: evaluateExpression,
    evaluateWithFallback: evaluateWithFallback
  };
});

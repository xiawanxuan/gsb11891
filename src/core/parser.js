/**
 * 表达式解析与求值。
 * 支持：数字+单位字面量、+ - * /、括号、calc(...) 包装、一元负号。
 * 求值时把所有长度归一到 px；超过最大嵌套深度抛 ExpressionTooDeepError。
 */
import {
  IncompatibleUnitsError,
  DivisionByZeroError,
  ExpressionTooDeepError,
  TypedOMError,
} from './errors.js';
import { toPx, dimensionOf, normalizeContext } from './units.js';

export const DEFAULT_MAX_DEPTH = 32;

const TOKEN_RE = /\s*(?:(\d*\.?\d+(?:[eE][+-]?\d+)?)([a-zA-Z%]*)|([()+\-*/])|(calc)|(.))/g;

function tokenize(input) {
  const tokens = [];
  let match;
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(input)) !== null) {
    const [, num, unit, op, calc, bad] = match;
    if (bad !== undefined) throw new TypedOMError(`无法解析的字符 "${bad}"`, 'PARSE_ERROR');
    if (calc !== undefined) { tokens.push({ type: 'calc' }); continue; }
    if (op !== undefined) { tokens.push({ type: 'op', value: op }); continue; }
    if (num !== undefined) {
      tokens.push({ type: 'number', value: parseFloat(num), unit: unit || null });
    }
  }
  return tokens;
}

/**
 * 解析为 AST。
 * literal:  { type: 'literal', value, unit }
 * negate:   { type: 'negate', operand }
 * binary:   { type: 'binary', op, left, right }
 */
export function parse(input, { maxDepth = DEFAULT_MAX_DEPTH } = {}) {
  const tokens = tokenize(String(input));
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expectOp = (op) => {
    const t = next();
    if (!t || t.type !== 'op' || t.value !== op) {
      throw new TypedOMError(`期望 "${op}"`, 'PARSE_ERROR');
    }
  };

  function parseExpr(depth) {
    if (depth > maxDepth) throw new ExpressionTooDeepError(depth, maxDepth);
    let left = parseTerm(depth);
    while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value;
      const right = parseTerm(depth);
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  function parseTerm(depth) {
    let left = parseUnary(depth);
    while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
      const op = next().value;
      const right = parseUnary(depth);
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  function parseUnary(depth) {
    if (peek() && peek().type === 'op' && peek().value === '-') {
      next();
      return { type: 'negate', operand: parseUnary(depth) };
    }
    if (peek() && peek().type === 'op' && peek().value === '+') {
      next();
      return parseUnary(depth);
    }
    return parsePrimary(depth);
  }

  function parsePrimary(depth) {
    const t = next();
    if (!t) throw new TypedOMError('表达式意外结束', 'PARSE_ERROR');
    if (t.type === 'number') return { type: 'literal', value: t.value, unit: t.unit };
    if (t.type === 'calc') {
      expectOp('(');
      const inner = parseExpr(depth + 1);
      expectOp(')');
      return inner;
    }
    if (t.type === 'op' && t.value === '(') {
      const inner = parseExpr(depth + 1);
      expectOp(')');
      return inner;
    }
    throw new TypedOMError(`意外的 token: ${JSON.stringify(t)}`, 'PARSE_ERROR');
  }

  const ast = parseExpr(1);
  if (pos < tokens.length) {
    throw new TypedOMError('表达式末尾存在多余内容', 'PARSE_ERROR');
  }
  return ast;
}

/**
 * 求值结果：{ value: number, unit: 'px'|null }
 * 长度统一归一到 px；纯数字 unit 为 null。
 */
export function evaluate(ast, ctx = {}) {
  const context = normalizeContext(ctx);

  function evalNode(node) {
    switch (node.type) {
      case 'literal':
        return { value: node.value, unit: node.unit };
      case 'negate': {
        const v = evalNode(node.operand);
        return { value: -v.value, unit: v.unit };
      }
      case 'binary':
        return evalBinary(node.op, evalNode(node.left), evalNode(node.right));
      default:
        throw new TypedOMError(`未知 AST 节点 ${node.type}`, 'EVAL_ERROR');
    }
  }

  function dimOf(v) {
    return v.unit == null ? 'number' : dimensionOf(v.unit);
  }

  function asLengthPx(v) {
    const dim = dimOf(v);
    if (dim !== 'length' && dim !== 'percentage') {
      throw new IncompatibleUnitsError(`单位不兼容：期望长度单位，得到 ${v.unit ?? 'number'}(${dim})`);
    }
    return toPx(v.value, v.unit, context);
  }

  function evalBinary(op, a, b) {
    const dimA = dimOf(a);
    const dimB = dimOf(b);
    switch (op) {
      case '+':
      case '-': {
        if (dimA === 'number' && dimB === 'number') {
          return { value: op === '+' ? a.value + b.value : a.value - b.value, unit: null };
        }
        if (dimA === 'number' || dimB === 'number') {
          throw new IncompatibleUnitsError(
            `单位不兼容：${a.unit ?? 'number'} 与 ${b.unit ?? 'number'} 不能相${op === '+' ? '加' : '减'}`,
          );
        }
        const pxA = asLengthPx(a);
        const pxB = asLengthPx(b);
        return { value: op === '+' ? pxA + pxB : pxA - pxB, unit: 'px' };
      }
      case '*': {
        if (dimA === 'number' && dimB === 'number') {
          return { value: a.value * b.value, unit: null };
        }
        if (dimA === 'number') return { value: a.value * asLengthPx(b), unit: 'px' };
        if (dimB === 'number') return { value: asLengthPx(a) * b.value, unit: 'px' };
        throw new IncompatibleUnitsError('两个带单位值不能相乘（结果维度无意义）');
      }
      case '/': {
        if (b.value === 0) throw new DivisionByZeroError();
        if (dimA === 'number' && dimB === 'number') {
          return { value: a.value / b.value, unit: null };
        }
        if (dimB === 'number') return { value: asLengthPx(a) / b.value, unit: 'px' };
        if (dimA === 'number') {
          throw new IncompatibleUnitsError('纯数字不能除以带单位值');
        }
        // length / length -> 无量纲比值
        return { value: asLengthPx(a) / asLengthPx(b), unit: null };
      }
      default:
        throw new TypedOMError(`未知运算符 ${op}`, 'EVAL_ERROR');
    }
  }

  return evalNode(ast);
}

/** 一步到位：解析 + 求值。 */
export function evaluateExpression(input, ctx = {}, options = {}) {
  return evaluate(parse(input, options), ctx);
}

/**
 * 带降级的求值：表达式过深时不抛错，改为返回 calc() 字符串交给浏览器原生计算。
 * @returns {{ mode: 'value', value: number, unit: string|null } | { mode: 'calc-string', cssText: string }}
 */
export function evaluateWithFallback(input, ctx = {}, options = {}) {
  try {
    const result = evaluateExpression(input, ctx, options);
    return { mode: 'value', ...result };
  } catch (err) {
    if (err instanceof ExpressionTooDeepError) {
      const cssText = /^calc\(/.test(String(input).trim())
        ? String(input).trim()
        : `calc(${input})`;
      return { mode: 'calc-string', cssText, degradedFrom: err };
    }
    throw err;
  }
}

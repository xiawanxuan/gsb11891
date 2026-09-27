/*
 * worker.js — Web Worker：在后台线程批量求值表达式，避免阻塞主线程。
 * 消息协议：
 *   { type: 'eval-batch', id, expressions: [string], ctx }
 *   <- { type: 'eval-batch-result', id, results: [{ ok, value?, unit?, error?, kind? }] }
 */
importScripts('units.js', 'expression.js');

self.onmessage = function (e) {
  var msg = e.data;
  if (msg.type !== 'eval-batch') return;

  var results = msg.expressions.map(function (expr) {
    try {
      var r = ExpressionEngine.evaluateExpression(expr, msg.ctx);
      return { ok: true, value: r.value, unit: r.unit };
    } catch (err) {
      return {
        ok: false,
        error: String(err && err.message || err),
        kind: err && err.kind || 'unknown'
      };
    }
  });

  self.postMessage({ type: 'eval-batch-result', id: msg.id, results: results });
};

/*
 * main.js — UI 装配：特性检测、单位换算、表达式求值、批量更新、
 * 性能对照、Worker 求值、降级日志、回读差异对比。
 */
(function () {
  'use strict';

  var support = TypedOMEngine.detectSupport();
  var ctx = TypedOMEngine.collectContext();
  var worker = null;
  var workerSeq = 0;
  var pendingWorkerCalls = new Map();

  // ---------- 工具 ----------
  function $(id) { return document.getElementById(id); }
  function log(el, text, cls) {
    el.textContent = text;
    el.className = 'result ' + (cls || '');
  }
  function logFallback(reason) {
    var record = { reason: reason, at: new Date().toISOString() };
    LabDB.saveFallback(record).catch(function () {});
    var ul = $('fallback-log');
    var li = document.createElement('li');
    li.textContent = '[' + record.at.slice(11, 19) + '] ' + reason;
    ul.prepend(li);
  }

  // ---------- 1. 特性检测 ----------
  function renderSupport() {
    var el = $('support-status');
    var lines = [];
    Object.keys(support.detail).forEach(function (k) {
      lines.push((support.detail[k] ? '✓' : '✗') + ' ' + k);
    });
    el.textContent = lines.join('\n');
    var badge = $('support-badge');
    if (support.supported) {
      badge.textContent = 'Typed OM 可用';
      badge.className = 'badge ok';
    } else {
      badge.textContent = 'Typed OM 不可用 — 已降级到字符串拼接';
      badge.className = 'badge warn';
      logFallback('浏览器不支持 CSS Typed OM，全局降级到字符串拼接');
    }
  }

  // ---------- 2. 单位换算 ----------
  function runConversion() {
    var value = parseFloat($('conv-value').value);
    var from = $('conv-from').value;
    var to = $('conv-to').value;
    var out = $('conv-result');
    if (isNaN(value)) { log(out, '请输入有效数值', 'error'); return; }
    try {
      var result = TypedOMEngine.convertUnit(value, from, to, ctx);
      log(out, value + from + ' = ' + (Math.round(result * 1e4) / 1e4) + to +
        '\n（上下文: fontSize=' + ctx.fontSize + 'px, root=' + ctx.rootFontSize +
        'px, vw=' + ctx.viewportWidth + ', vh=' + ctx.viewportHeight +
        ', %基准=' + Math.round(ctx.percentBase) + 'px）', 'ok');
    } catch (e) {
      log(out, '⚠ ' + e.message, 'error');
    }
  }

  // ---------- 3. 表达式求值 ----------
  function runEvaluation() {
    var input = $('expr-input').value.trim();
    var out = $('expr-result');
    if (!input) { log(out, '请输入表达式', 'error'); return; }

    // 先走纯函数求值（两个引擎共用同一套语义，保证降级结果一致）
    var pureResult;
    try {
      pureResult = ExpressionEngine.evaluateExpression(input, ctx);
    } catch (e) {
      handleExprError(e, input, out);
      return;
    }

    var text = '求值结果: ' + StringEngine.format(pureResult);

    // Typed OM 可用时，构建 CSSMath* 计算树并回读，对比一致性
    if (support.supported) {
      try {
        var ast = ExpressionEngine.parse(ExpressionEngine.tokenize(input));
        var probe = document.createElement('div');
        document.body.appendChild(probe);
        var omResult = TypedOMEngine.evaluateViaTypedOM(ast, probe);
        document.body.removeChild(probe);
        if (omResult.unit !== 'raw' && !isNaN(omResult.value)) {
          var diff = Math.abs(omResult.value - pureResult.value);
          text += '\nTyped OM 回读: ' + omResult.value + omResult.unit +
            (diff < 1e-6 ? '（与纯函数求值一致 ✓）'
              : '（差异 ' + diff.toExponential(2) + '，单位归一导致）');
        } else if (omResult.raw) {
          text += '\nTyped OM 计算树: ' + omResult.raw;
        }
      } catch (e) {
        text += '\n⚠ Typed OM 求值失败，已使用纯函数结果（降级）: ' + e.message;
        logFallback('Typed OM 表达式求值失败: ' + e.message);
      }
    } else {
      text += '\n（Typed OM 不可用，使用字符串降级路径，结果一致）';
    }
    log(out, text, 'ok');
  }

  function handleExprError(e, input, out) {
    if (e.kind === 'too-deep') {
      // 表达式过深：降级为迭代求值
      log(out, '⚠ ' + e.message + '\n尝试迭代降级求值…', 'warn');
      logFallback('表达式过深(' + ExpressionEngine.MAX_DEPTH + '层): "' +
        input.slice(0, 60) + '…"，触发迭代降级');
      try {
        var fb = ExpressionEngine.evaluateWithFallback(input, ctx);
        log(out, '⚠ 表达式过深，已降级为迭代求值（结果一致）\n结果: ' +
          StringEngine.format(fb.result), 'warn');
      } catch (e2) {
        log(out, '✗ 迭代降级也失败: ' + e2.message, 'error');
      }
    } else if (e.kind === 'division-by-zero') {
      log(out, '✗ 除零被捕获: ' + e.message, 'error');
    } else if (e.kind === 'incompatible-units') {
      log(out, '✗ 单位不兼容: ' + e.message +
        '\n提示: 加减法要求两侧单位维度相同（如 px+em 可以，px+s 不行）', 'error');
    } else {
      log(out, '✗ ' + e.message, 'error');
    }
  }

  // ---------- 4. 批量样式更新 ----------
  function makeUpdates(count) {
    var boxes = document.querySelectorAll('.demo-box');
    var updates = [];
    for (var i = 0; i < count; i++) {
      var el = boxes[i % boxes.length];
      updates.push({
        el: el,
        property: i % 2 === 0 ? 'width' : 'height',
        value: 20 + (i * 7) % 60,
        unit: 'px'
      });
    }
    return updates;
  }

  function runBatchUpdate() {
    var count = parseInt($('batch-count').value, 10) || 100;
    var updates = makeUpdates(count);
    var out = $('batch-result');

    var useTypedOM = support.supported;
    var result;
    if (useTypedOM) {
      try {
        result = TypedOMEngine.batchApply(updates);
      } catch (e) {
        logFallback('Typed OM 批量更新失败: ' + e.message + '，降级到字符串');
        result = StringEngine.batchApply(updates);
        useTypedOM = false;
      }
    } else {
      result = StringEngine.batchApply(updates);
    }

    var text = (useTypedOM ? 'Typed OM' : '字符串(降级)') +
      ' 批量更新: 成功 ' + result.applied + ' 项';
    if (result.failures.length) {
      text += '，失败 ' + result.failures.length + ' 项\n' +
        result.failures.slice(0, 3).map(function (f) {
          return '  ✗ ' + f.property + ': ' + f.error;
        }).join('\n');
    }

    // 回读差异对比：attributeStyleMap vs getComputedStyle
    if (support.supported) {
      var box = document.querySelector('.demo-box');
      var omVal = box.attributeStyleMap.get('width');
      var csVal = getComputedStyle(box).width;
      var inlineVal = box.style.width;
      text += '\n回读对比(第一个盒子 width):' +
        '\n  attributeStyleMap: ' + (omVal ? omVal.toString() : '(空)') +
        '\n  getComputedStyle:  ' + csVal +
        '\n  style.width:       ' + (inlineVal || '(空，Typed OM 写入不同步到 style 字符串)');
    }
    log(out, text, result.failures.length ? 'warn' : 'ok');
  }

  // ---------- 5. 性能对照 ----------
  function runBenchmark() {
    var count = parseInt($('bench-count').value, 10) || 200;
    var updates = makeUpdates(count);
    var out = $('bench-result');
    log(out, '运行中…', '');

    var typedFn = support.supported
      ? TypedOMEngine.batchApply
      : function (u) { return StringEngine.batchApply(u); };

    setTimeout(function () {
      var r = Benchmark.runComparison('batch-' + count, updates, typedFn,
        StringEngine.batchApply, 5);
      var text = '批量更新 ' + count + ' 项 × 5 轮:\n' +
        '  Typed OM 平均: ' + r.typedAvg.toFixed(3) + ' ms' +
        (support.supported ? '' : '（不支持，实际跑的是字符串）') + '\n' +
        '  字符串拼接平均: ' + r.stringAvg.toFixed(3) + ' ms\n' +
        '  加速比: ' + (r.speedup ? r.speedup.toFixed(2) + 'x' : 'N/A');
      log(out, text, 'ok');
      r.typedOMSupported = support.supported;
      LabDB.saveBenchmark(r).then(renderBenchmarkHistory).catch(function () {});
    }, 50);
  }

  function renderBenchmarkHistory() {
    LabDB.listBenchmarks().then(function (rows) {
      var tbody = $('bench-history');
      tbody.innerHTML = '';
      rows.slice(-10).reverse().forEach(function (r) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + r.label + '</td>' +
          '<td>' + r.typedAvg.toFixed(3) + ' ms</td>' +
          '<td>' + r.stringAvg.toFixed(3) + ' ms</td>' +
          '<td>' + (r.speedup ? r.speedup.toFixed(2) + 'x' : '-') + '</td>' +
          '<td>' + (r.typedOMSupported ? '是' : '否(降级)') + '</td>';
        tbody.appendChild(tr);
      });
    }).catch(function () {});
  }

  // ---------- 6. Worker 批量求值 ----------
  function getWorker() {
    if (!worker) {
      worker = new Worker('js/worker.js');
      worker.onmessage = function (e) {
        var msg = e.data;
        var pending = pendingWorkerCalls.get(msg.id);
        if (pending) {
          pendingWorkerCalls.delete(msg.id);
          pending(msg.results);
        }
      };
    }
    return worker;
  }

  function runWorkerEval() {
    var out = $('worker-result');
    var expressions = [];
    for (var i = 0; i < 500; i++) {
      expressions.push('(' + (i % 50 + 1) + 'px + ' + (i % 10 + 1) + 'em) * 2 - 5%');
    }
    expressions.push('10px / 0');        // 除零用例
    expressions.push('5px + 3s');        // 单位不兼容用例
    log(out, 'Worker 求值中（502 条表达式）…', '');
    getWorker();
    var id = ++workerSeq;
    var t0 = performance.now();
    pendingWorkerCalls.set(id, function (results) {
      var elapsed = performance.now() - t0;
      var ok = results.filter(function (r) { return r.ok; }).length;
      var failed = results.filter(function (r) { return !r.ok; });
      var text = 'Worker 完成: ' + ok + ' 成功 / ' + failed.length + ' 失败，' +
        '耗时 ' + elapsed.toFixed(1) + ' ms（未阻塞主线程）';
      failed.forEach(function (f) {
        text += '\n  ✗ [' + f.kind + '] ' + f.error;
      });
      log(out, text, 'ok');
    });
    worker.postMessage({ type: 'eval-batch', id: id, expressions: expressions, ctx: ctx });
  }

  // ---------- 启动 ----------
  function init() {
    renderSupport();
    Benchmark.startObserver();
    $('conv-btn').addEventListener('click', runConversion);
    $('expr-btn').addEventListener('click', runEvaluation);
    $('batch-btn').addEventListener('click', runBatchUpdate);
    $('bench-btn').addEventListener('click', runBenchmark);
    $('worker-btn').addEventListener('click', runWorkerEval);
    renderBenchmarkHistory();
    LabDB.listFallbacks().then(function (rows) {
      rows.slice(-20).reverse().forEach(function (r) {
        var li = document.createElement('li');
        li.textContent = '[' + r.at.slice(11, 19) + '] ' + r.reason;
        $('fallback-log').appendChild(li);
      });
    }).catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

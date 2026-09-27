/**
 * 页面主逻辑：能力检测、演示交互、基准测试调度、结果持久化。
 */
import { isTypedOMSupported } from './core/typed-om.js';
import { evaluateExpression, evaluateWithFallback } from './core/parser.js';
import { convert } from './core/units.js';
import { StyleEngine } from './core/batch.js';
import { benchmarkStyleWrites } from './benchmark.js';
import { saveRun, loadRuns, clearRuns } from './store.js';

const $ = (sel) => document.querySelector(sel);

const typedOMOK = isTypedOMSupported();
const engine = new StyleEngine({ maxDepth: 32 });

function currentContext() {
  const root = getComputedStyle(document.documentElement);
  const target = $('#demo-box');
  const targetStyle = target ? getComputedStyle(target) : root;
  return {
    fontSize: parseFloat(targetStyle.fontSize) || 16,
    rootFontSize: parseFloat(root.fontSize) || 16,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    percentBase: 400,
  };
}

function log(panelSel, message, kind = 'info') {
  const panel = $(panelSel);
  const line = document.createElement('div');
  line.className = `log-line log-${kind}`;
  line.textContent = message;
  panel.prepend(line);
}

/* ---------- PerformanceObserver：收集 measure 与 longtask ---------- */
const perfEntries = [];
if (typeof PerformanceObserver !== 'undefined') {
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        perfEntries.push({ name: entry.name, duration: entry.duration, type: entry.entryType });
        log('#perf-log', `[${entry.entryType}] ${entry.name}: ${entry.duration.toFixed(2)}ms`);
      }
    });
    observer.observe({ entryTypes: ['measure', 'longtask'] });
  } catch { /* 老浏览器忽略 */ }
}

/* ---------- 能力检测展示 ---------- */
function renderSupport() {
  const el = $('#support-status');
  if (typedOMOK) {
    el.textContent = '✅ 当前浏览器支持 CSS Typed OM，使用 attributeStyleMap 高速路径';
    el.className = 'status ok';
  } else {
    el.textContent = '⚠️ 当前浏览器不支持 CSS Typed OM，已自动降级到字符串操作（结果一致）';
    el.className = 'status warn';
  }
}

/* ---------- 单位换算演示 ---------- */
function demoConvert() {
  const value = parseFloat($('#conv-value').value);
  const from = $('#conv-from').value;
  const to = $('#conv-to').value;
  try {
    const result = convert(value, from, to, currentContext());
    $('#conv-result').textContent = `${value}${from} = ${result.toFixed(4)}${to}`;
    $('#conv-result').className = 'result ok';
  } catch (err) {
    $('#conv-result').textContent = `❌ ${err.message}`;
    $('#conv-result').className = 'result err';
  }
}

/* ---------- 表达式求值演示（含错误处理） ---------- */
function demoEvaluate() {
  const expr = $('#expr-input').value;
  try {
    const result = evaluateWithFallback(expr, currentContext(), { maxDepth: 32 });
    if (result.mode === 'calc-string') {
      $('#expr-result').textContent =
        `⚠️ 表达式过深，已降级为浏览器原生计算: ${result.cssText.slice(0, 80)}…`;
      $('#expr-result').className = 'result warn';
    } else {
      $('#expr-result').textContent = `= ${result.value.toFixed(4)}${result.unit ?? ''}`;
      $('#expr-result').className = 'result ok';
    }
  } catch (err) {
    const prefix = { INCOMPATIBLE_UNITS: '单位不兼容', DIVISION_BY_ZERO: '除零' }[err.code] ?? '错误';
    $('#expr-result').textContent = `❌ [${prefix}] ${err.message}`;
    $('#expr-result').className = 'result err';
  }
}

/* ---------- 批量更新演示 ---------- */
function demoBatchUpdate() {
  const box = $('#demo-box');
  const updates = [
    { el: box, property: 'width', expression: $('#upd-width').value },
    { el: box, property: 'height', expression: $('#upd-height').value },
    { el: box, property: 'margin-left', expression: $('#upd-margin').value },
    { el: box, property: 'padding-top', expression: $('#upd-padding').value },
  ];
  const { results, failures } = engine.batchUpdate(updates);
  for (const r of results) {
    const warn = r.warning ? ` (${r.warning})` : '';
    log('#batch-log', `✔ ${r.property} <- ${r.cssText} [${r.mode}]${warn}`,
      r.readbackMatch ? 'info' : 'warn');
  }
  for (const f of failures) {
    log('#batch-log', `✖ ${f.property}: ${f.error.message}`, 'err');
  }
  log('#batch-log', `批量更新完成：成功 ${results.length}，失败 ${failures.length}`);
}

/* ---------- 基准测试 ---------- */
function runBenchmark() {
  const iterations = parseInt($('#bench-iterations').value, 10) || 5000;
  log('#bench-log', `主线程样式写入基准（${iterations} 次）…`);

  // 离屏元素，避免布局抖动干扰计时
  const sandbox = document.createElement('div');
  sandbox.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
  document.body.appendChild(sandbox);

  const writeResult = benchmarkStyleWrites(sandbox, iterations, currentContext());
  document.body.removeChild(sandbox);

  log('#bench-log',
    `Typed OM 写入: ${writeResult.typedOmMs.toFixed(2)}ms | 字符串写入: ${writeResult.stringMs.toFixed(2)}ms | 加速比: ${writeResult.speedup.toFixed(2)}x`,
    'info');

  // Worker 中跑纯计算基准
  if (typeof Worker !== 'undefined') {
    log('#bench-log', 'Worker 计算基准运行中…');
    const worker = new Worker('./src/benchmark-worker.js', { type: 'module' });
    worker.onmessage = async (event) => {
      const { type, payload, message } = event.data;
      if (type === 'error') {
        log('#bench-log', `Worker 基准失败: ${message}`, 'err');
      } else {
        log('#bench-log',
          `Worker 计算: 字符串拼接 ${payload.stringConcatMs.toFixed(2)}ms | 求值 ${payload.evalMs.toFixed(2)}ms | 单位换算 ${payload.convertMs.toFixed(2)}ms`);
        await saveRun({
          kind: 'benchmark',
          typedOMSupported: typedOMOK,
          write: writeResult,
          compute: payload,
        });
        log('#bench-log', '结果已保存到 IndexedDB');
        renderHistory();
      }
      worker.terminate();
    };
    worker.onerror = (e) => {
      log('#bench-log', `Worker 错误: ${e.message}`, 'err');
      worker.terminate();
    };
    worker.postMessage({ type: 'run', iterations, context: currentContext() });
  }
}

/* ---------- 历史记录 ---------- */
async function renderHistory() {
  const runs = await loadRuns();
  const panel = $('#history-log');
  panel.innerHTML = '';
  for (const run of runs.slice(-10).reverse()) {
    const d = new Date(run.timestamp).toLocaleTimeString();
    const line = document.createElement('div');
    line.className = 'log-line';
    line.textContent =
      `${d} | TypedOM:${run.typedOMSupported ? '✓' : '✗'} | 写入 ${run.write.typedOmMs.toFixed(1)}ms vs ${run.write.stringMs.toFixed(1)}ms (${run.write.speedup.toFixed(2)}x)`;
    panel.appendChild(line);
  }
}

/* ---------- 错误场景演示 ---------- */
function demoErrors() {
  const cases = [
    ['单位不兼容', () => evaluateExpression('10px + 5s', currentContext())],
    ['除零', () => evaluateExpression('100px / (2 - 2)', currentContext())],
    ['表达式过深', () => {
      const deep = '1px' + ' + (1px'.repeat(40) + ')'.repeat(40);
      return evaluateWithFallback(deep, currentContext(), { maxDepth: 32 });
    }],
    ['数字+长度混算', () => evaluateExpression('10px + 5', currentContext())],
  ];
  for (const [name, fn] of cases) {
    try {
      const r = fn();
      const msg = r && r.mode === 'calc-string'
        ? '已降级为 calc() 字符串'
        : `= ${JSON.stringify(r)}`;
      log('#error-log', `[${name}] ${msg}`, 'warn');
    } catch (err) {
      log('#error-log', `[${name}] 已捕获: ${err.code} - ${err.message}`, 'err');
    }
  }
}

/* ---------- 绑定 ---------- */
function init() {
  renderSupport();
  $('#btn-convert').addEventListener('click', demoConvert);
  $('#btn-eval').addEventListener('click', demoEvaluate);
  $('#btn-batch').addEventListener('click', demoBatchUpdate);
  $('#btn-bench').addEventListener('click', runBenchmark);
  $('#btn-errors').addEventListener('click', demoErrors);
  $('#btn-clear-history').addEventListener('click', async () => {
    await clearRuns();
    renderHistory();
  });
  renderHistory();
}

document.addEventListener('DOMContentLoaded', init);

/*
 * benchmark.js — 性能对照：Typed OM vs 字符串拼接。
 * 使用 performance.mark/measure + PerformanceObserver 采集耗时，
 * 结果可持久化到 IndexedDB。
 */
(function (root) {
  'use strict';

  var measures = [];
  var observer = null;

  function startObserver() {
    if (typeof PerformanceObserver !== 'function') return false;
    try {
      observer = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) {
          measures.push({ name: entry.name, duration: entry.duration, at: Date.now() });
        });
      });
      observer.observe({ entryTypes: ['measure'] });
      return true;
    } catch (e) {
      return false;
    }
  }

  function drain() {
    var out = measures.slice();
    measures.length = 0;
    return out;
  }

  // 运行一轮对照实验
  // typedFn / stringFn: (updates) => result
  function runComparison(label, updates, typedFn, stringFn, iterations) {
    iterations = iterations || 5;
    var results = { label: label, iterations: iterations, typed: [], string: [] };

    for (var i = 0; i < iterations; i++) {
      performance.mark('typed-start');
      typedFn(updates);
      performance.mark('typed-end');
      performance.measure('typed-' + label + '-' + i, 'typed-start', 'typed-end');
      results.typed.push(lastMeasureDuration('typed-' + label + '-' + i));

      performance.mark('string-start');
      stringFn(updates);
      performance.mark('string-end');
      performance.measure('string-' + label + '-' + i, 'string-start', 'string-end');
      results.string.push(lastMeasureDuration('string-' + label + '-' + i));
    }

    results.typedAvg = avg(results.typed);
    results.stringAvg = avg(results.string);
    results.speedup = results.stringAvg > 0
      ? results.stringAvg / results.typedAvg : null;
    results.at = new Date().toISOString();
    return results;
  }

  function lastMeasureDuration(name) {
    var entries = performance.getEntriesByName(name, 'measure');
    return entries.length ? entries[entries.length - 1].duration : 0;
  }

  function avg(arr) {
    if (!arr.length) return 0;
    return arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
  }

  root.Benchmark = {
    startObserver: startObserver,
    drain: drain,
    runComparison: runComparison
  };
})(typeof self !== 'undefined' ? self : this);

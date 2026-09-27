/**
 * Web Worker：在后台线程跑纯计算基准，避免阻塞 UI。
 * 接收: { type: 'run', iterations, context }
 * 回发: { type: 'result', payload } | { type: 'error', message }
 */
import { benchmarkCompute } from './benchmark.js';

self.onmessage = (event) => {
  const { type, iterations, context } = event.data || {};
  if (type !== 'run') return;
  try {
    const payload = benchmarkCompute(iterations, context);
    self.postMessage({ type: 'result', payload });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message, code: err.code });
  }
};

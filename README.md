# CSS Typed OM 实验室

围绕 CSS Typed OM 的样式数值计算演示：单位换算、表达式求值、批量样式更新，
并与字符串拼接方式做性能对照。不支持 Typed OM 的浏览器自动降级，结果保持一致。

## 运行

```bash
npm run serve        # 或 python3 -m http.server 8080
# 打开 http://localhost:8080
```

需要通过 HTTP 访问（Web Worker 与 IndexedDB 不支持 file:// 协议）。

## 测试

```bash
npm test             # 30 个用例，覆盖全部验收标准
```

## 架构

| 文件 | 职责 |
| --- | --- |
| `js/units.js` | 纯单位系统：维度分类、兼容性判断、px/em/rem/vw/vh/% 换算（含上下文） |
| `js/expression.js` | 表达式词法/递归下降解析（深度上限 64）+ 迭代降级求值器（硬上限 512） |
| `js/typed-om-engine.js` | Typed OM 引擎：CSSUnitValue/CSSMathSum/CSSMathProduct/CSSMathNegate/CSSMathInvert 计算树、attributeStyleMap 批量写入、特性检测 |
| `js/string-engine.js` | 字符串拼接降级引擎：同一套求值语义，保证降级结果一致 |
| `js/benchmark.js` | performance.mark/measure + PerformanceObserver 性能对照 |
| `js/worker.js` | Web Worker 后台批量求值，不阻塞主线程 |
| `js/db.js` | IndexedDB 持久化基准结果与降级事件日志 |
| `js/main.js` | UI 装配、错误处理、降级编排、回读差异对比 |

## 验收标准对照

| 标准 | 实现 | 测试 |
| --- | --- | --- |
| 单位转换正确 | `units.js` 经 px 中枢换算，em/rem/vw/vh/% 依赖真实上下文 | `tests/units.test.js` |
| 表达式求值正确 | 递归下降 + 混合单位归一到 px（与浏览器计算样式一致） | `tests/expression.test.js` |
| 批量更新正确 | Typed OM `attributeStyleMap` / 字符串 `cssText` 双路径 | `tests/engines.test.js` |
| 性能对照可量化 | PerformanceObserver 采集 measure，加速比入库可复查 | 页面第 5 节 |
| 不支持时降级 | `detectSupport()` 六项检测，失败即切字符串引擎 | `tests/engines.test.js` |
| 单位不兼容有提示 | `incompatible-units` 错误携带双方单位与维度说明 | `tests/expression.test.js` |
| 除零被捕获 | `division-by-zero` 专用错误类型 | `tests/expression.test.js` |
| 表达式过深有降级 | 递归 64 层 → 迭代求值器 512 层硬上限 | `tests/expression.test.js` |
| 降级结果一致 | 双引擎共用 `expression.js` 语义；迭代/递归结果逐项比对 | `tests/expression.test.js` |

## 关键设计

- **单一语义源**：Typed OM 与字符串引擎都基于 `expression.js` 求值，
  从根上保证"降级方案结果一致"，而不是两套各自实现的解析器。
- **属性回读差异**：批量更新后同时展示 `attributeStyleMap.get()`、
  `getComputedStyle()` 与 `style.width` 三者差异——Typed OM 写入
  不会同步到 `style` 字符串，这是常见的踩坑点。
- **样式更新失败**：`batchApply` 逐项 try/catch，返回
  `{ applied, failures }`，失败项带属性名与错误信息。
- **除零防护**：表达式层捕获 `x / 0`；单位换算层对 0 基准
  （fontSize=0 等）返回 null 并转为不兼容错误。

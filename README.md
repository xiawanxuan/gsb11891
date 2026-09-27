# CSS Typed OM 样式计算工作台

围绕 CSS Typed OM（`CSSUnitValue` / `CSSMathSum` / `CSSMathProduct` 等）的样式数值计算演示与基准工程，附带完整的错误处理与字符串降级方案。

## 运行

```bash
npm run serve        # 或任意静态服务器，然后打开 http://localhost:8080
npm test             # 运行核心逻辑单元测试（Node 22+，无需浏览器）
```

> 需要通过 HTTP 访问（ES Module + Web Worker 不支持 file:// 直开）。

## 架构

```
index.html              演示页面（5 个功能区）
styles.css
src/
  core/
    errors.js           领域错误：单位不兼容 / 除零 / 过深 / 不支持 / 写入失败
    units.js            px/em/rem/vw/vh/%（含 in/cm/mm/pt/pc）换算，依赖 UnitContext
    parser.js           表达式解析（+ - * /、括号、calc）与求值，深度限制 + calc() 降级
    typed-om.js         Typed OM 能力检测、AST -> CSSMath 值树、attributeStyleMap 读写
    fallback.js         字符串降级：setProperty / cssText 写入与回读
    batch.js            StyleEngine：求值 -> 写入 -> 回读校验的批量流水线，三级降级
  benchmark.js          性能基准（计算 + 样式写入），写入 performance.measure
  benchmark-worker.js   Web Worker：后台跑纯计算基准，不阻塞 UI
  store.js              IndexedDB：持久化历次基准结果
  main.js               页面交互、PerformanceObserver 采集、历史渲染
test/core.test.mjs      10 个单元测试，覆盖全部验收标准
```

## 错误处理与降级链

| 场景 | 行为 |
| --- | --- |
| 浏览器不支持 Typed OM | `isTypedOMSupported()` 检测，自动切字符串路径，结果一致 |
| 单位不兼容（如 `10px + 5s`、`px + 纯数字`） | 抛 `IncompatibleUnitsError`，UI 中文提示 |
| 除零（如 `100px / (2-2)`） | 抛 `DivisionByZeroError` 并被捕获展示 |
| 表达式嵌套过深（>32 层） | 抛 `ExpressionTooDeepError`，降级为原生 `calc()` 字符串交给浏览器计算 |
| Typed OM 写入失败 | 降级 `style.setProperty`，再失败抛 `StyleUpdateError`，批量中单条失败不影响其他 |
| 属性回读差异（如 em 被归一化为 px） | 换算到同单位后数值容差比较，差异以 warning 标出 |

## 验收标准对照

- **单位转换正确** → `test/core.test.mjs`「单位转换」用例
- **表达式求值正确** → 「表达式求值」用例（优先级、括号、calc、负号、百分比）
- **批量更新正确** → 「批量更新」用例（mock 元素断言写入值）
- **性能对照可量化** → 页面第 4 区输出 ms 与加速比，PerformanceObserver 采集，IndexedDB 存历史
- **不支持时有降级 / 降级结果一致** → 「降级一致性」用例（forceFallback 与求值结果逐字符一致）
- **单位不兼容提示 / 除零捕获 / 过深降级** → 对应三个错误用例 + 页面第 5 区可交互触发

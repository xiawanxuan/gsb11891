/** Typed OM 样式计算相关的领域错误类型。 */

export class TypedOMError extends Error {
  constructor(message, code) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

/** 单位维度不兼容（如 length + time、number + length）。 */
export class IncompatibleUnitsError extends TypedOMError {
  constructor(message) {
    super(message, 'INCOMPATIBLE_UNITS');
  }
}

/** 除零。 */
export class DivisionByZeroError extends TypedOMError {
  constructor(message = '除零错误：表达式中出现除以 0') {
    super(message, 'DIVISION_BY_ZERO');
  }
}

/** 表达式嵌套/递归过深，需要降级。 */
export class ExpressionTooDeepError extends TypedOMError {
  constructor(depth, maxDepth) {
    super(`表达式嵌套深度 ${depth} 超过上限 ${maxDepth}，已触发降级`, 'EXPRESSION_TOO_DEEP');
    this.depth = depth;
    this.maxDepth = maxDepth;
  }
}

/** 当前环境不支持 CSS Typed OM。 */
export class TypedOMUnsupportedError extends TypedOMError {
  constructor() {
    super('当前浏览器不支持 CSS Typed OM，已降级到字符串操作', 'TYPED_OM_UNSUPPORTED');
  }
}

/** 样式写入失败（Typed OM 与 setProperty 均失败时抛出）。 */
export class StyleUpdateError extends TypedOMError {
  constructor(property, cause) {
    super(`样式属性 "${property}" 更新失败: ${cause ? cause.message : '未知原因'}`, 'STYLE_UPDATE_FAILED');
    this.property = property;
    this.cause = cause;
  }
}

/**
 * 字符串降级适配层。
 * 在 Typed OM 不可用、或 Typed OM 写入失败时使用。
 * 只依赖 CSSOM 的 style.setProperty / cssText，兼容所有浏览器。
 */

/** 把求值结果格式化为 CSS 字符串。 */
export function valueToCssString({ value, unit }) {
  // 避免浮点尾巴，保留 4 位小数并去掉多余的 0
  const rounded = Math.round(value * 10000) / 10000;
  return unit ? `${rounded}${unit}` : String(rounded);
}

/**
 * 用字符串方式写入单个属性。
 * @param {Element|Object} el 真实元素或带 style 的 mock
 * @param {string} property 连字符属性名
 * @param {string} cssText 如 '42px'
 */
export function setStyleString(el, property, cssText) {
  if (el.style && typeof el.style.setProperty === 'function') {
    el.style.setProperty(property, cssText);
  } else if (el.style) {
    // 最简 mock / 老环境：直接赋值驼峰属性
    const camel = property.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    el.style[camel] = cssText;
  } else {
    throw new Error('目标元素没有可用的 style 对象');
  }
}

/**
 * 字符串方式回读属性。
 */
export function getStyleString(el, property) {
  if (el.style && typeof el.style.getPropertyValue === 'function') {
    return el.style.getPropertyValue(property);
  }
  const camel = property.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  return el.style ? el.style[camel] : '';
}

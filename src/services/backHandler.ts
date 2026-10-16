/**
 * 返回键处理器栈（LIFO）。
 *
 * 背景：Android 系统返回键/手势返回由 @capacitor/app 的 backButton 事件接管
 * （见 src/main.ts 的 setupBackButton）。当有底部弹层、多选模式等临时 UI 状态
 * 打开时，返回键的直觉预期是「先关闭当前浮层/退出多选」，再走页面回退。
 *
 * 用法：进入可拦截状态时 pushBackHandler(handler)，离开时调用返回的注销函数；
 * handler 返回 true 表示已消费本次返回事件，返回 false 表示未处理（继续冒泡到页面回退）。
 */

/** 返回键处理器：返回 true 表示已消费本次返回事件 */
export type BackHandler = () => boolean

/** 处理器栈，栈顶优先 */
const handlers: BackHandler[] = []

/**
 * 注册返回键处理器（压入栈顶）。
 * @returns 注销函数，组件卸载/状态退出时必须调用，避免关闭后仍被消费
 */
export function pushBackHandler(handler: BackHandler): () => void {
  handlers.push(handler)
  return () => {
    const idx = handlers.indexOf(handler)
    if (idx >= 0) handlers.splice(idx, 1)
  }
}

/**
 * 消费一次返回事件：若栈非空则调用栈顶处理器。
 * @returns 是否被处理器消费（true 时不应再走页面回退/退出）
 */
export function consumeBackEvent(): boolean {
  const handler = handlers[handlers.length - 1]
  if (!handler) return false
  return handler() === true
}

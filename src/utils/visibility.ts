/**
 * 共享的 IntersectionObserver 集合，供大量网格卡片复用，
 * 避免每张卡片各自创建 observer 造成内存与性能浪费。
 *
 * 同一元素可以用不同的 rootMargin 订阅多次，用于实现两级策略：
 * - 近距（默认 200px）：进入即加载/播放；
 * - 远距（600px）：彻底离开后才释放已解码的图片，控制长列表内存。
 * 以「元素 + margin」为键登记回调，可见性变化时通知对应卡片。
 */

type VisibilityCallback = (visible: boolean) => void

/** 预加载边距：提前 200px 开始加载，让图片进入视口时已经就绪 */
export const PRELOAD_MARGIN = '200px'
/** 释放边距：超出此范围才回收已解码图片，避免来回滚动反复加载 */
export const RELEASE_MARGIN = '600px'

/** 每种 rootMargin 对应一个 observer 与其回调表 */
const observers = new Map<string, IntersectionObserver>()
const callbacks = new Map<string, WeakMap<Element, VisibilityCallback>>()

function ensureObserver(rootMargin: string): IntersectionObserver | null {
  const existing = observers.get(rootMargin)
  if (existing) return existing
  if (typeof IntersectionObserver === 'undefined') return null
  const cbs = new WeakMap<Element, VisibilityCallback>()
  const obs = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const cb = cbs.get(entry.target)
        if (cb) cb(entry.isIntersecting)
      }
    },
    { rootMargin, threshold: 0 }
  )
  observers.set(rootMargin, obs)
  callbacks.set(rootMargin, cbs)
  return obs
}

/** 订阅元素可见性变化；非浏览器环境（如 SSR/测试）默认始终可见 */
export function observeVisibility(
  el: Element,
  cb: VisibilityCallback,
  rootMargin: string = PRELOAD_MARGIN
): void {
  const obs = ensureObserver(rootMargin)
  if (!obs) {
    cb(true)
    return
  }
  callbacks.get(rootMargin)!.set(el, cb)
  obs.observe(el)
}

/** 取消某个边距的订阅 */
export function unobserveVisibility(el: Element, rootMargin: string = PRELOAD_MARGIN): void {
  const obs = observers.get(rootMargin)
  if (!obs) return
  obs.unobserve(el)
  callbacks.get(rootMargin)?.delete(el)
}

/** 取消该元素在所有边距下的订阅（卡片卸载时用） */
export function unobserveAllVisibility(el: Element): void {
  for (const [margin, obs] of observers) {
    obs.unobserve(el)
    callbacks.get(margin)?.delete(el)
  }
}

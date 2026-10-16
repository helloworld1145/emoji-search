import type { InjectionKey } from 'vue'

/**
 * 首页下拉刷新跨组件通信契约。
 * App.vue 承载真实滚动容器与触摸手势，通过 provide 暴露 setHandler；
 * 首页（Home.vue）通过 inject 注册 / 注销自己的刷新回调。
 */
export interface PullRefreshApi {
  /** 注册首页下拉刷新回调；传入 null 即注销。回调返回 Promise，完成后指示器自动回弹 */
  setHandler: (fn: (() => Promise<void>) | null) => void
}

/** 下拉刷新的注入键，provide / inject 双方共用同一实例 */
export const PULL_REFRESH_KEY: InjectionKey<PullRefreshApi> = Symbol('pullRefresh')

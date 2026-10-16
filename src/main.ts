import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import App from './App.vue'
import router from './router'
import { consumeBackEvent } from './services/backHandler'
import './style.css'

createApp(App).use(createPinia()).use(router).mount('#app')

/**
 * 注册 Android 系统返回键（含手势返回）处理。
 *
 * 根因背景：Capacitor 6 的 BridgeActivity 默认不处理系统返回键，未注册监听时
 * 按返回 = 系统默认行为 finish Activity，即无论几级页面都直接退出 App。
 * 注册 backButton 监听后，AppPlugin 的 OnBackPressedCallback 会拦截返回键：
 * 1. 先尝试让浮层/多选等处理器消费（backHandler 栈顶）；
 * 2. 未被消费且有历史栈（canGoBack，如表情详情等二级页）→ 回退上一页；
 * 3. 无历史栈（首页/搜索/收藏夹等 Tab 页）→ 退出 App。
 *
 * Web 调试环境（非原生平台）不注册，不影响 npm run dev。
 */
function setupBackButton() {
  if (!Capacitor.isNativePlatform()) return

  CapApp.addListener('backButton', ({ canGoBack }) => {
    // 1. 弹层/多选模式打开时，返回键优先关闭浮层而非回退页面
    if (consumeBackEvent()) return

    // 2. 二级页面：回退上一页
    if (canGoBack) {
      router.back()
      return
    }

    // 3. 无历史栈：退出 App
    void CapApp.exitApp()
  })
}

setupBackButton()

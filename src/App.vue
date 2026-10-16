<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, provide } from 'vue'
import { useRoute } from 'vue-router'
import { Home, User, RefreshCw } from 'lucide-vue-next'
import { useEmojiStore } from './stores/emoji'
import { PULL_REFRESH_KEY } from './services/pullRefresh'

const route = useRoute()
const emojiStore = useEmojiStore()

const tabs = [
  { path: '/home', label: '首页', icon: Home },
  { path: '/mine', label: '我的', icon: User }
]

const showTabBar = computed(() => !route.meta.hideNav)
const activePath = computed(() => route.path)

/**
 * 需要 keep-alive 缓存的页面（组件名，对应 src/views 下的文件名）。
 * 列表页缓存后，从表情详情等二级页返回时保留滚动位置与已加载数据，
 * 不再重新挂载（否则首页会回到最顶上，且网格要重新查库）。
 * 详情页（EmojiDetail）等不缓存，每次进入都是全新实例。
 */
const cachedViews = ['Home', 'Collections', 'CollectionDetail', 'Trash']

/** 主滚动容器引用：本 App 的滚动容器是 <main>（非 window），位置记忆须手动维护 */
const mainRef = ref<HTMLElement | null>(null)

/** 各路由的滚动位置记忆（key 为 fullPath）：离开页面前记住，返回时恢复 */
const scrollMemory = new Map<string, number>()
/** 待恢复到主容器的滚动位置，在过渡动画的 enter 阶段应用 */
let pendingRestore = 0

watch(
  () => route.fullPath,
  (to, from) => {
    const main = mainRef.value
    if (!main || !from) return
    // 记忆离开页面的位置；超出容量时淘汰最旧的记录
    while (scrollMemory.size >= 50) {
      const oldest = scrollMemory.keys().next().value
      if (oldest === undefined) break
      scrollMemory.delete(oldest)
    }
    scrollMemory.set(from, main.scrollTop)
    // 新页面一律从顶部开始：不清零的话，比当前偏移矮的页面（如详情页）
    // 会停留在首页的滚动偏移处，一进来就停在半空中
    main.scrollTop = 0
    pendingRestore = scrollMemory.get(to) ?? 0
  }
)

/**
 * 恢复目标页面的滚动位置。
 * 在 @enter（新页面已挂载、绘制前）与 @after-enter（过渡结束、内容高度最终确定）
 * 各应用一次，重复赋同值幂等：@enter 时若旧内容尚未替换完会被钳制，
 * @after-enter 时新内容必已就绪，保证位置真正恢复。
 */
function restoreScroll(): void {
  if (mainRef.value) mainRef.value.scrollTop = pendingRestore
}

/* ===================== 下拉刷新（pull-to-refresh） ===================== */
const PULL_THRESHOLD = 60
const PULL_DAMPING = 0.5
const PULL_MAX = 100
const PULL_REFRESH_OFFSET = 50
const PULL_INDICATOR_HEIGHT = 44

/** 当前下拉位移（px）：0 表示未下拉 */
const pullDistance = ref(0)
/** 是否处于刷新中（松手超阈值后到回调完成期间为 true） */
const refreshing = ref(false)
/** 是否启用回弹过渡：手势跟随手指时为 false（实时），松手/刷新归零时为 true（动画） */
const pullTransition = ref(false)
/** 首页注册的刷新回调，非首页时为 null */
const pullHandler = ref<(() => Promise<void>) | null>(null)

function setHandler(fn: (() => Promise<void>) | null): void {
  pullHandler.value = fn
}
provide(PULL_REFRESH_KEY, { setHandler })

/** 仅在首页、非刷新中、已注册回调、且当前没有扫描/识别时才允许下拉 */
const canPull = computed(
  () =>
    route.path === '/home' &&
    !refreshing.value &&
    pullHandler.value !== null &&
    !['scanning', 'recognizing'].includes(emojiStore.scanState.phase)
)

const indicatorText = computed(() =>
  refreshing.value ? '正在刷新…' : pullDistance.value >= PULL_THRESHOLD ? '松开刷新' : '下拉刷新'
)

let pulling = false
let startY = 0

function beginPull(clientY: number): void {
  if (!canPull.value) return
  if (mainRef.value && mainRef.value.scrollTop > 0) return
  pulling = true
  startY = clientY
  pullTransition.value = false
}

function movePull(clientY: number, prevent: () => void): void {
  if (!pulling) return
  // 下拉过程中若滚动离开了顶部（如内容可滚动），立即取消手势并归零
  if (mainRef.value && mainRef.value.scrollTop > 0) {
    pulling = false
    pullDistance.value = 0
    return
  }
  const dy = clientY - startY
  if (dy <= 0) {
    pullDistance.value = 0
    return
  }
  // 拦截原生滚动 / 橡皮筋，确保手势被我们接管
  prevent()
  let d = dy * PULL_DAMPING
  if (d > PULL_MAX) d = PULL_MAX
  pullDistance.value = d
}

function endPull(): void {
  if (!pulling) return
  pulling = false
  pullTransition.value = true
  if (pullDistance.value >= PULL_THRESHOLD) {
    triggerRefresh()
  } else {
    pullDistance.value = 0
  }
}

async function triggerRefresh(): Promise<void> {
  refreshing.value = true
  // 固定停在指示器高度，展示「正在刷新」
  pullDistance.value = PULL_REFRESH_OFFSET
  const handler = pullHandler.value
  try {
    if (handler) await handler()
  } finally {
    refreshing.value = false
    pullDistance.value = 0
  }
}

function onTouchStart(e: TouchEvent): void {
  beginPull(e.touches[0].clientY)
}
function onTouchMove(e: TouchEvent): void {
  movePull(e.touches[0].clientY, () => e.preventDefault())
}
function onTouchEnd(): void {
  endPull()
}
function onMouseDown(e: MouseEvent): void {
  beginPull(e.clientY)
}
function onMouseMove(e: MouseEvent): void {
  if (e.buttons === 0) return
  movePull(e.clientY, () => e.preventDefault())
}
function onMouseUp(): void {
  endPull()
}

onMounted(() => {
  const main = mainRef.value
  if (!main) return
  // touchmove 必须 passive:false 才能 preventDefault 拦截原生下拉
  main.addEventListener('touchstart', onTouchStart, { passive: true })
  main.addEventListener('touchmove', onTouchMove, { passive: false })
  main.addEventListener('touchend', onTouchEnd, { passive: true })
  // Web 调试兜底：鼠标拖拽同样可触发下拉
  main.addEventListener('mousedown', onMouseDown)
  main.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
})
onUnmounted(() => {
  const main = mainRef.value
  if (main) {
    main.removeEventListener('touchstart', onTouchStart)
    main.removeEventListener('touchmove', onTouchMove)
    main.removeEventListener('touchend', onTouchEnd)
    main.removeEventListener('mousedown', onMouseDown)
    main.removeEventListener('mousemove', onMouseMove)
  }
  window.removeEventListener('mouseup', onMouseUp)
})
</script>

<template>
  <div class="h-full flex flex-col bg-surface">
    <main ref="mainRef" class="relative flex-1 overflow-y-auto">
      <!-- 下拉刷新指示器：平时藏在顶部之上，下拉时随手势滑入 -->
      <div
        class="pointer-events-none absolute left-0 right-0 top-0 z-40 flex justify-center"
        :style="{
          height: PULL_INDICATOR_HEIGHT + 'px',
          transform: `translateY(${pullDistance - PULL_INDICATOR_HEIGHT}px)`,
          opacity: pullDistance > 4 ? 1 : 0,
          transition: pullTransition ? 'transform .25s ease, opacity .2s ease' : 'none'
        }"
      >
        <div
          class="flex items-center gap-1.5 text-xs"
          :class="refreshing ? 'text-primary' : 'text-ink-muted'"
        >
          <RefreshCw
            :size="16"
            :class="{ 'animate-spin': refreshing, 'rotate-180': pullDistance >= PULL_THRESHOLD && !refreshing }"
          />
          <span>{{ indicatorText }}</span>
        </div>
      </div>

      <!-- 内容容器：下拉时整体下移，露出顶部指示器 -->
      <!-- min-h-full：让页面 .page 的 min-height:100% 能生效（父级高度为 auto 时
           百分比高度会退化为 auto），内容不满屏时也撑满，底部留白与长页面一致 -->
      <div
        class="min-h-full"
        :style="{
          transform: `translateY(${pullDistance}px)`,
          transition: pullTransition ? 'transform .25s ease' : 'none'
        }"
      >
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in" @enter="restoreScroll" @after-enter="restoreScroll">
            <keep-alive :include="cachedViews">
              <component :is="Component" />
            </keep-alive>
          </transition>
        </router-view>
      </div>
    </main>

    <nav v-if="showTabBar" class="tab-bar">
      <div class="flex h-16">
        <button
          v-for="tab in tabs"
          :key="tab.path"
          type="button"
          class="flex-1 flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors"
          :class="activePath === tab.path ? 'text-primary' : 'text-ink-muted'"
          @click="$router.replace(tab.path)"
        >
          <component :is="tab.icon" :size="22" :stroke-width="activePath === tab.path ? 2.4 : 1.8" />
          <span class="text-[11px] font-medium">{{ tab.label }}</span>
        </button>
      </div>
    </nav>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

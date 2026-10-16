<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'
import { Star, Check, ImageIcon } from 'lucide-vue-next'
import type { EmojiRecord } from '../types'
import { toImageSrcAsync, parseGifDuration } from '../utils/image'
import { enqueueLoad } from '../utils/loadQueue'
import {
  observeVisibility,
  unobserveAllVisibility,
  PRELOAD_MARGIN,
  RELEASE_MARGIN
} from '../utils/visibility'

const props = defineProps<{
  item: EmojiRecord
  selectable?: boolean
  selected?: boolean
}>()

const emit = defineEmits<{
  (e: 'click', item: EmojiRecord): void
  (e: 'longpress', item: EmojiRecord): void
  (e: 'toggle-select', item: EmojiRecord): void
}>()

/** 离开视口后延迟回收解码数据的等待时间：太短会导致来回滚动反复加载 */
const RELEASE_DELAY = 6000

const rootEl = ref<HTMLElement | null>(null)
const imgLoaded = ref(false)
const imgFailed = ref(false)
let pressTimer: number | null = null
let longPressed = false
let pressStartX = 0
let pressStartY = 0

/** 静态缩略图（GIF 的首帧 / 原图播放失败时的兜底）：进入视口才解析加载 */
const thumbSrc = ref('')
/** GIF 原图（动画）的可加载 URL，仅可见时按需加载 */
const gifBase = ref('')
/** 重播计数：改变它以强制 WebView 重新解码、从头播放（绕过大型 GIF 播放一次后停住的 WebView 限制） */
const gifKey = ref(1)
/** GIF 动画总时长（ms），由文件头解析；<=0 时回退固定间隔重播 */
const gifDuration = ref(0)
/** 给 URL 追加重播参数，绕过浏览器/WebView 缓存，强制重新加载从头播放 */
function withReplayKey(url: string, key: number): string {
  if (!url) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}__r=${key}`
}
/** GIF 原图加载失败标记：触发后静默回退静态缩略图 */
const gifFailed = ref(false)
/** 卡片是否处于可见范围（进入/离开视口） */
const visible = ref(false)
/** 缩略图是否已回退到原图（避免无限重试） */
const thumbFallback = ref(false)
/** 缩略图 / GIF 是否正在解析，避免重复入队 */
const thumbLoading = ref(false)
const gifLoading = ref(false)

/** 组件是否仍挂载：卸载后的异步解析结果直接丢弃 */
let alive = true
/** keep-alive 页面是否处于激活态：失焦（切页/缓存）时不回收图片，避免返回后重新加载 */
let pageActive = true
/** 离开视口后延迟回收的计时器 */
let releaseTimer: number | null = null

/** 当前实际展示的图源：可见且为 GIF 且原图就绪时播放动画，否则静态缩略图 */
const showingGif = computed(
  () => props.item.isGif && visible.value && gifBase.value !== '' && !gifFailed.value
)
const gifPlaySrc = computed(() => withReplayKey(gifBase.value, gifKey.value))
const currentSrc = computed(() => (showingGif.value ? gifPlaySrc.value : thumbSrc.value))

/** 按需解析并渲染缩略图：只有卡片进入视口（含预加载边距）才会真正发起加载 */
async function ensureThumb() {
  if (thumbLoading.value || thumbSrc.value || imgFailed.value) return
  thumbLoading.value = true
  try {
    const resolved = await enqueueLoad(
      () => toImageSrcAsync(props.item.thumbPath || props.item.path),
      () => alive && pageActive
    )
    if (!alive || resolved === undefined) return
    // 解析结果与当前图源一致：图源未变，直接复用，避免 keep-alive 二次进入时
    // :src 字符串不变导致 <img> 的 load 事件不再触发、imgLoaded 停在 false、
    // 图片停留在 opacity-0 而「看不见」（首进正常、再进不出来）。
    if (resolved === thumbSrc.value) return
    imgFailed.value = false
    if (!resolved) {
      // 源文件已删除 / 授权失效：直接占位，不再渲染空 src
      imgFailed.value = true
      return
    }
    imgLoaded.value = false
    thumbSrc.value = resolved
  } finally {
    thumbLoading.value = false
  }
}

/** 按需加载 GIF 原图（仅可见时），并解析时长用于精确重播 */
async function ensureGif() {
  if (gifBase.value || gifFailed.value || gifLoading.value) return
  gifLoading.value = true
  try {
    const url = await enqueueLoad(
      () => toImageSrcAsync(props.item.path),
      () => alive && pageActive
    )
    if (!alive || url === undefined) return
    if (!url) {
      gifFailed.value = true
      return
    }
    gifBase.value = url
    // 解析 GIF 时长用于精确循环重播；失败不影响播放，仅回退固定间隔
    parseGifDuration(url).then((d) => {
      gifDuration.value = d
    })
  } finally {
    gifLoading.value = false
  }
}

// 表情记录更新（如标签修正/收藏变化）时重置并重新解析图源
watch(
  () => props.item,
  () => {
    gifBase.value = ''
    gifKey.value = 1
    gifDuration.value = 0
    stopReplay()
    gifFailed.value = false
    thumbFallback.value = false
    thumbSrc.value = ''
    imgFailed.value = false
    imgLoaded.value = false
    // 不可见时只重置标记，等再次进入视口才按新图源加载
    if (visible.value) ensureThumb()
  }
)

/** 取消延迟回收 */
function cancelRelease() {
  if (releaseTimer !== null) {
    clearTimeout(releaseTimer)
    releaseTimer = null
  }
}

/**
 * 回收已解码的图片：长列表下滑后只保留视口附近的解码数据，
 * 避免图片数量极多时内存随滚动无限增长（重新进入视口会自动按需加载）。
 */
function releaseMedia() {
  cancelRelease()
  // 页面被缓存（keep-alive 失焦）时不回收：DOM 会被移出文档导致误判不可见，
  // 而返回时仍需立即显示，回收只会带来重新加载的闪烁。
  if (!pageActive) return
  if (!thumbSrc.value && !gifBase.value) return
  stopReplay()
  thumbSrc.value = ''
  gifBase.value = ''
  imgLoaded.value = false
}

/** 离开视口后延迟回收，给来回滚动留出缓冲 */
function scheduleRelease() {
  cancelRelease()
  if (!pageActive) return
  releaseTimer = window.setTimeout(() => {
    releaseTimer = null
    releaseMedia()
  }, RELEASE_DELAY)
}

let replayTimer: number | null = null
function stopReplay() {
  if (replayTimer !== null) {
    clearTimeout(replayTimer)
    replayTimer = null
  }
}
function startReplay() {
  stopReplay()
  const interval = gifDuration.value > 0 ? gifDuration.value + 120 : 4000
  const tick = () => {
    if (!visible.value || !props.item.isGif || gifFailed.value) return
    gifKey.value++
    replayTimer = window.setTimeout(tick, interval)
  }
  replayTimer = window.setTimeout(tick, interval)
}

// 进入/离开可视区：进入时从头播放并启动重播守护，离开时停止以省资源
watch(showingGif, (now) => {
  if (now) {
    gifKey.value++ // 从头开始，确保重新进入视口的 GIF 重新播放
    startReplay()
  } else {
    stopReplay()
  }
})

onMounted(() => {
  const el = rootEl.value
  if (!el) return
  // 近距：进入视口（含 200px 预加载）才解析并加载图片 / 播放 GIF
  observeVisibility(
    el,
    (v) => {
      visible.value = v
      if (v) {
        cancelRelease()
        ensureThumb()
        if (props.item.isGif) ensureGif()
      } else {
        scheduleRelease()
      }
    },
    PRELOAD_MARGIN
  )
  // 远距：彻底滚出（超出 600px）后回收解码数据，仅保留骨架占位
  observeVisibility(
    el,
    (v) => {
      if (v) cancelRelease()
      else releaseMedia()
    },
    RELEASE_MARGIN
  )
})

onUnmounted(() => {
  alive = false
  cancelRelease()
  stopReplay()
  if (rootEl.value) unobserveAllVisibility(rootEl.value)
})

// keep-alive 缓存的列表页离开后 DOM 会被移出文档，IntersectionObserver 会回调
// 「不可见」，此时既不该回收图片（返回还要立刻显示），也不该继续 GIF 重播。
onDeactivated(() => {
  pageActive = false
  cancelRelease()
  stopReplay()
})
onActivated(() => {
  pageActive = true
  if (showingGif.value) startReplay()
})

function onPointerDown(e: PointerEvent) {
  longPressed = false
  pressStartX = e.clientX
  pressStartY = e.clientY
  pressTimer = window.setTimeout(() => {
    longPressed = true
    emit('longpress', props.item)
  }, 500)
}

/** 手指移动超过阈值视为滚动，取消长按计时（避免滚动误触发面板） */
function onPointerMove(e: PointerEvent) {
  if (pressTimer === null) return
  const dx = Math.abs(e.clientX - pressStartX)
  const dy = Math.abs(e.clientY - pressStartY)
  if (dx > 10 || dy > 10) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

function onPointerUp() {
  if (pressTimer !== null) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

function onClick() {
  if (longPressed) return
  if (props.selectable) {
    emit('toggle-select', props.item)
    return
  }
  emit('click', props.item)
}

function onImgLoad() {
  imgLoaded.value = true
}

/** 缩略图加载失败时回退到原图（content:// 经 getViewableUrl 拷贝）。
 *  仅回退一次，避免无限重试；原图也失败才显示占位图。
 *  这保证静态图在缩略图缓存失效时仍能显示，与 GIF（始终回退原图）行为一致。 */
async function resolveThumbFallback() {
  imgFailed.value = false
  imgLoaded.value = false
  const url = await enqueueLoad(
    () => toImageSrcAsync(props.item.path),
    () => alive && pageActive
  )
  if (!alive || url === undefined) return
  if (!url || url === thumbSrc.value) {
    // 回退后仍是空或图源没变：<img> 不会再触发 load，直接显示占位避免停在透明态
    imgFailed.value = true
    return
  }
  thumbSrc.value = url
}

function onImgError() {
  if (showingGif.value) {
    // GIF 原图播放失败：静默回退静态缩略图，不显示失败占位
    gifFailed.value = true
  } else if (!thumbFallback.value) {
    thumbFallback.value = true
    resolveThumbFallback()
  } else {
    imgFailed.value = true
  }
}
</script>

<template>
  <div
    ref="rootEl"
    class="relative aspect-square rounded-card overflow-hidden bg-black/5 cursor-pointer active:scale-[0.97] transition-transform select-none"
    :class="{ 'ring-2 ring-primary ring-offset-1': selected }"
    style="touch-action: pan-y; -webkit-touch-callout: none;"
    role="button"
    tabindex="0"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointerleave="onPointerUp"
    @pointercancel="onPointerUp"
    @contextmenu.prevent
    @click="onClick"
  >
    <img
      v-if="!imgFailed && currentSrc"
      :src="currentSrc"
      :alt="item.ocrText || '表情'"
      loading="lazy"
      decoding="async"
      class="w-full h-full object-cover transition-opacity duration-200"
      :class="imgLoaded ? 'opacity-100' : 'opacity-0'"
      @load="onImgLoad"
      @error="onImgError"
    />
    <!-- 还没进入视口 / 已滚远被回收：只显示骨架占位，不占用图片内存 -->
    <div v-else-if="!imgFailed" class="w-full h-full" />
    <div v-else class="w-full h-full flex flex-col items-center justify-center text-ink-faint gap-1">
      <ImageIcon :size="22" />
      <span class="text-[10px]">加载失败</span>
    </div>

    <!-- GIF 角标 -->
    <span
      v-if="item.isGif"
      class="absolute left-1.5 top-1.5 px-1.5 py-0.5 rounded-md bg-black/55 text-white text-[10px] font-medium backdrop-blur-sm"
    >
      GIF
    </span>

    <!-- 收藏星标 -->
    <span
      v-if="item.isFavorite"
      class="absolute right-1.5 top-1.5 w-6 h-6 rounded-full bg-white/85 backdrop-blur-sm flex items-center justify-center shadow-sm"
    >
      <Star :size="13" class="text-warning" fill="currentColor" />
    </span>

    <!-- 多选角标 -->
    <span
      v-if="selectable"
      class="absolute right-1.5 bottom-1.5 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors"
      :class="selected ? 'bg-primary border-primary' : 'border-white bg-black/25'"
    >
      <Check v-if="selected" :size="14" class="text-white" />
    </span>
  </div>
</template>

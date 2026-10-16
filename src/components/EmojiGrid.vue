<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import EmojiCard from './EmojiCard.vue'
import type { EmojiRecord } from '../types'

const props = defineProps<{
  items: EmojiRecord[]
  loading?: boolean
  finished?: boolean
  selectable?: boolean
  selectedIds?: string[]
}>()

const emit = defineEmits<{
  (e: 'load-more'): void
  (e: 'click', item: EmojiRecord): void
  (e: 'longpress', item: EmojiRecord): void
  (e: 'toggle-select', item: EmojiRecord): void
}>()

const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

/** 哨兵是否在可视区内（用于内容不足一屏时主动补加载） */
function sentinelVisible(): boolean {
  const el = sentinel.value
  if (!el) return false
  const r = el.getBoundingClientRect()
  return r.top <= window.innerHeight && r.bottom >= 0
}

function tryLoadMore() {
  if (!props.loading && !props.finished && sentinelVisible()) {
    emit('load-more')
  }
}

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && !props.loading && !props.finished) {
        emit('load-more')
      }
    },
    { rootMargin: '200px' }
  )
  if (sentinel.value) observer.observe(sentinel.value)
})

onUnmounted(() => {
  observer?.disconnect()
  observer = null
})

/**
 * 列表内容变化或 loading/finished 回落时，若哨兵仍可见（内容不足一屏），
 * IntersectionObserver 不会再次触发（相交状态未改变），这里手动补一次加载，
 * 避免「滑不到底、永远停在首屏数量」的假死。
 */
watch(
  () => [props.items.length, props.loading, props.finished],
  () => {
    // 等本轮 DOM 更新完再判断可视性
    requestAnimationFrame(tryLoadMore)
  }
)
</script>

<template>
  <div>
    <div class="grid-emoji">
      <EmojiCard
        v-for="item in items"
        :key="item.id"
        :item="item"
        :selectable="selectable"
        :selected="selectedIds?.includes(item.id)"
        @click="emit('click', item)"
        @longpress="emit('longpress', item)"
        @toggle-select="emit('toggle-select', item)"
      />
    </div>

    <div ref="sentinel" class="h-4" />

    <div v-if="loading" class="flex items-center justify-center gap-2 py-4 text-ink-faint text-xs">
      <Loader2 :size="14" class="animate-spin" />
      <span>加载中…</span>
    </div>
    <div v-else-if="finished && items.length > 0" class="py-4 text-center text-xs text-ink-faint">
      — 没有更多了 —
    </div>
  </div>
</template>

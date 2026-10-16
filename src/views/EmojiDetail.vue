<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ChevronLeft,
  Share2,
  Star,
  FolderOpen,
  Copy,
  FileImage,
  Trash2,
  MessageCircle,
  MessagesSquare
} from 'lucide-vue-next'
import { useEmojiStore } from '../stores/emoji'
import { useCollectionStore } from '../stores/collection'
import { useTrashStore } from '../stores/trash'
import TagEditor from '../components/TagEditor.vue'
import CollectionPicker from '../components/CollectionPicker.vue'
import BaseSheet from '../components/BaseSheet.vue'
import { getById } from '../db/repositories/emoji'
import { initDatabase } from '../db/database'
import { toImageSrcAsync, formatSize, formatTime, parseGifDuration } from '../utils/image'
import type { EmojiRecord as EmojiItem } from '../types'

const route = useRoute()
const router = useRouter()
const emojiStore = useEmojiStore()
const collectionStore = useCollectionStore()
const trashStore = useTrashStore()

const emojiId = computed(() => route.params.id as string)
const item = ref<EmojiItem | null>(null)
const loading = ref(true)
const pickerOpen = ref(false)
const deleteConfirmOpen = ref(false)
const toast = ref('')

const editorValue = ref({ ocrText: '', tags: [] as string[] })

onUnmounted(() => stopDetailReplay())

onMounted(async () => {
  await initDatabase()
  const record = await getById(emojiId.value)
  item.value = record
  if (record) {
    editorValue.value = {
      ocrText: record.ocrText,
      tags: record.tags
    }
  }
  loading.value = false
})

/** 大图预览 URL：path 为 content://（SAF）时经 getViewableUrl 拷贝后加载 */
/** GIF 重播计数：改变以强制 WebView 重新解码、从头播放 */
const gifReplayKey = ref(0)
/** GIF 动画总时长（ms）；<=0 时回退固定间隔重播 */
const gifDuration = ref(0)

/** 给 URL 追加重播参数，强制重新加载从头播放（绕过大型 GIF 停住不重播） */
function replayUrl(url: string, key: number): string {
  if (!url) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}__r=${key}`
}

let detailReplayTimer: number | null = null
function stopDetailReplay() {
  if (detailReplayTimer !== null) {
    clearTimeout(detailReplayTimer)
    detailReplayTimer = null
  }
}
function startDetailReplay() {
  stopDetailReplay()
  const interval = gifDuration.value > 0 ? gifDuration.value + 120 : 4000
  const tick = () => {
    if (!item.value?.isGif) return
    gifReplayKey.value++
    detailReplayTimer = window.setTimeout(tick, interval)
  }
  detailReplayTimer = window.setTimeout(tick, interval)
}

const previewSrc = ref('')
/** 预览图加载失败（破图）时展示占位 */
const previewFailed = ref(false)
/** 源文件已删除 / 授权失效（toImageSrcAsync 返回空串） */
const sourceMissing = ref(false)
watchEffect(async () => {
  stopDetailReplay()
  previewFailed.value = false
  const current = item.value
  if (!current) {
    previewSrc.value = ''
    sourceMissing.value = false
    return
  }
  const src = await toImageSrcAsync(current.path)
  // 等待期间 item 已被切换/卸载时不回写陈旧值
  if (item.value !== current) return
  previewSrc.value = src
  if (item.value?.isGif && src) {
    // 解析 GIF 时长用于精确循环重播；失败不影响播放，仅回退固定间隔
    parseGifDuration(src).then((d) => {
      if (item.value !== current) return
      gifDuration.value = d
      startDetailReplay()
    })
  }
  sourceMissing.value = !src
})

function showToast(msg: string) {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 1600)
}

const shareMenuOpen = ref(false)

/** 打开分享菜单（源文件已删则直接提示，不弹菜单） */
function openShareMenu() {
  if (!item.value) return
  if (sourceMissing.value) {
    showToast('源文件已删除，无法分享')
    return
  }
  shareMenuOpen.value = true
}

/** 选择具体分享目标：微信 / QQ / 系统分享（更多） */
async function onShareTarget(target: 'wechat' | 'qq' | 'system') {
  if (!item.value) return
  shareMenuOpen.value = false
  const ok = await emojiStore.share(item.value.path, target, showToast)
  if (!ok) showToast('分享失败，请重试')
}

async function onToggleFavorite() {
  if (!item.value) return
  const next = await emojiStore.toggleFavorite(item.value.id)
  item.value.isFavorite = next
  showToast(next ? '已加入总收藏' : '已取消收藏')
}

/** 标签增删：即时落库（一次点击即生效，无需保存按钮） */
async function onPersistTags(tags: string[]) {
  if (!item.value) return
  try {
    await emojiStore.updateTags(item.value.id, { tags })
    item.value.tags = tags
    showToast('已保存')
  } catch (e) {
    console.error('updateTags failed', e)
    showToast('保存失败，请重试')
  }
}

/** 图片文字：失焦即时落库 */
async function onPersistText(text: string) {
  if (!item.value) return
  try {
    await emojiStore.updateTags(item.value.id, { ocrText: text })
    item.value.ocrText = text
    showToast('已保存')
  } catch (e) {
    console.error('updateTags failed', e)
    showToast('保存失败，请重试')
  }
}

async function onCopyPath() {
  if (!item.value) return
  try {
    await navigator.clipboard.writeText(item.value.path)
    showToast('路径已复制')
  } catch (e) {
    console.error('copy failed', e)
    showToast('复制失败')
  }
}

async function onPicked(collectionId: string) {
  pickerOpen.value = false
  if (!item.value) return
  await collectionStore.addEmoji(collectionId, item.value.id)
  showToast('已加入收藏夹')
}

/** 软删除：移入回收站（不删手机源文件），成功后返回上一页 */
async function confirmDelete() {
  deleteConfirmOpen.value = false
  if (!item.value) return
  try {
    await trashStore.moveToTrash([item.value.id])
    // 同步缓存中的首页网格，避免返回后已删表情仍残留在列表里
    emojiStore.removeFromGrid([item.value.id])
    showToast('已移入回收站')
    setTimeout(() => router.back(), 600)
  } catch (e) {
    console.error('moveToTrash failed', e)
    showToast('删除失败，请重试')
  }
}
</script>

<template>
  <div class="page pb-8">
    <!-- 顶部导航 -->
    <header
      class="sticky top-0 z-20 bg-surface/90 backdrop-blur-md px-4 py-3 flex items-center gap-2"
    >
      <button
        type="button"
        class="btn btn-ghost w-9 h-9 !p-0 cursor-pointer shrink-0"
        aria-label="返回"
        @click="router.back()"
      >
        <ChevronLeft :size="19" />
      </button>
      <h1 class="text-lg font-semibold flex-1 min-w-0 truncate">表情详情</h1>
      <button
        type="button"
        class="btn btn-ghost w-9 h-9 !p-0 cursor-pointer"
        :class="{ 'text-warning': item?.isFavorite }"
        aria-label="收藏"
        @click="onToggleFavorite"
      >
        <Star :size="17" :fill="item?.isFavorite ? 'currentColor' : 'none'" />
      </button>
      <button
        type="button"
        class="btn btn-primary h-9 px-4 text-xs cursor-pointer"
        @click="openShareMenu"
      >
        <Share2 :size="14" />
        分享
      </button>
    </header>

    <div v-if="loading" class="py-20 text-center text-sm text-ink-faint">加载中…</div>

    <template v-else-if="item">
      <!-- 大图预览 -->
      <section class="px-4">
        <div class="card overflow-hidden">
          <img
            v-if="previewSrc && !previewFailed"
            :src="item?.isGif ? replayUrl(previewSrc, gifReplayKey) : previewSrc"
            :alt="item.ocrText || '表情预览'"
            class="w-full max-h-[52vh] object-contain bg-black/[0.03]"
            @error="previewFailed = true"
          />
          <div
            v-else
            class="h-40 flex flex-col items-center justify-center gap-2 text-ink-faint"
          >
            <FileImage :size="26" />
            <span class="text-xs">源文件已删除或无法加载</span>
          </div>
        </div>
      </section>

      <!-- 文件信息 -->
      <section class="px-4 mt-3">
        <div class="card p-3.5 flex items-center gap-2.5 text-xs text-ink-muted">
          <FileImage :size="15" class="text-ink-faint shrink-0" />
          <span class="truncate flex-1" :title="item.path">{{ item.path }}</span>
          <span class="shrink-0">{{ formatSize(item.size) }}</span>
          <span class="shrink-0">{{ formatTime(item.updatedAt) }}</span>
        </div>
      </section>

      <!-- 标签区 -->
      <section class="px-4 mt-3">
        <div class="card p-4">
          <h3 class="text-sm font-medium mb-3">标签信息</h3>
          <TagEditor
            v-model="editorValue"
            @save-tags="onPersistTags"
            @save-text="onPersistText"
          />
        </div>
      </section>

      <!-- 操作区 -->
      <section class="px-4 mt-3 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          class="card h-11 flex items-center justify-center gap-1.5 text-sm font-medium cursor-pointer hover:shadow-float transition-shadow"
          @click="pickerOpen = true"
        >
          <FolderOpen :size="15" class="text-ink-muted" />
          加入收藏夹
        </button>
        <button
          type="button"
          class="card h-11 flex items-center justify-center gap-1.5 text-sm font-medium cursor-pointer hover:shadow-float transition-shadow"
          @click="onCopyPath"
        >
          <Copy :size="15" class="text-ink-muted" />
          复制路径
        </button>
      </section>

      <!-- 删除入口 -->
      <section class="px-4 mt-3">
        <button
          type="button"
          class="w-full h-11 rounded-xl bg-danger/10 text-danger text-sm font-medium flex items-center justify-center gap-1.5 cursor-pointer hover:bg-danger/15 transition-colors"
          @click="deleteConfirmOpen = true"
        >
          <Trash2 :size="15" />
          删除（移入回收站）
        </button>
      </section>
    </template>

    <div v-else class="py-20 text-center text-sm text-ink-faint">表情不存在或已删除</div>

    <!-- 收藏夹选择 -->
    <BaseSheet :visible="pickerOpen" title="加入收藏夹" @close="pickerOpen = false">
      <CollectionPicker :emoji-id="item?.id ?? ''" @picked="onPicked" />
    </BaseSheet>

    <!-- 删除确认 -->
    <BaseSheet
      :visible="deleteConfirmOpen"
      title="删除表情"
      @close="deleteConfirmOpen = false"
    >
      <p class="text-sm text-ink-muted py-2">
        删除后仅不在本 App 内显示，不会删除手机里的原图，可到「回收站」中恢复。确定删除吗？
      </p>
      <div class="flex gap-2 pt-2 pb-2">
        <button
          type="button"
          class="btn btn-ghost flex-1 h-11 text-sm cursor-pointer"
          @click="deleteConfirmOpen = false"
        >
          取消
        </button>
        <button
          type="button"
          class="btn flex-1 h-11 text-sm cursor-pointer bg-danger text-white"
          @click="confirmDelete"
        >
          移入回收站
        </button>
      </div>
    </BaseSheet>

    <!-- 分享选择 -->
    <BaseSheet :visible="shareMenuOpen" title="分享到" @close="shareMenuOpen = false">
      <div class="grid grid-cols-3 gap-3 py-2">
        <button
          type="button"
          class="flex flex-col items-center gap-2 cursor-pointer group"
          @click="onShareTarget('wechat')"
        >
          <span
            class="w-14 h-14 rounded-full bg-[#07C160] text-white flex items-center justify-center shadow-float transition-transform group-hover:scale-105 group-active:scale-95"
          >
            <MessageCircle :size="24" />
          </span>
          <span class="text-xs text-ink-muted">微信</span>
        </button>
        <button
          type="button"
          class="flex flex-col items-center gap-2 cursor-pointer group"
          @click="onShareTarget('qq')"
        >
          <span
            class="w-14 h-14 rounded-full bg-[#12B7F5] text-white flex items-center justify-center shadow-float transition-transform group-hover:scale-105 group-active:scale-95"
          >
            <MessagesSquare :size="24" />
          </span>
          <span class="text-xs text-ink-muted">QQ</span>
        </button>
        <button
          type="button"
          class="flex flex-col items-center gap-2 cursor-pointer group"
          @click="onShareTarget('system')"
        >
          <span
            class="w-14 h-14 rounded-full bg-black/10 text-ink-muted flex items-center justify-center shadow-float transition-transform group-hover:scale-105 group-active:scale-95"
          >
            <Share2 :size="24" />
          </span>
          <span class="text-xs text-ink-muted">系统分享</span>
        </button>
      </div>
      <p v-if="item?.isGif" class="text-[12px] text-ink-faint text-center pb-1 pt-1">
        微信可能仅发送 GIF 首帧，动图建议用 QQ 发送
      </p>
      <button
        type="button"
        class="btn btn-ghost w-full h-11 text-sm cursor-pointer mt-1"
        @click="shareMenuOpen = false"
      >
        取消
      </button>
    </BaseSheet>

    <transition name="toast">
      <div
        v-if="toast"
        class="fixed left-1/2 -translate-x-1/2 bottom-24 z-50 px-4 py-2 rounded-full bg-ink text-white text-xs shadow-float"
      >
        {{ toast }}
      </div>
    </transition>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>

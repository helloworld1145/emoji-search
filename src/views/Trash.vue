<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronLeft, RotateCcw, Trash2 } from 'lucide-vue-next'
import { useTrashStore } from '../stores/trash'
import { useEmojiStore } from '../stores/emoji'
import EmojiGrid from '../components/EmojiGrid.vue'
import EmptyState from '../components/EmptyState.vue'
import BaseSheet from '../components/BaseSheet.vue'
import { formatTime } from '../utils/image'
import type { EmojiRecord } from '../types'

const router = useRouter()
const trashStore = useTrashStore()
const emojiStore = useEmojiStore()

/** 当前操作的表情（点击网格项弹出 恢复/彻底删除 面板） */
const actionItem = ref<EmojiRecord | null>(null)
/** 待确认彻底删除的单条 id */
const purgeTarget = ref<string | null>(null)
const clearConfirmOpen = ref(false)
const toast = ref('')

const hasItems = computed(() => trashStore.items.length > 0)

onMounted(async () => {
  await trashStore.refreshCount()
  await trashStore.loadTrash(true)
})

// 缓存页面：每次进入重新拉取，保证从详情页新删的表情及时出现在回收站
onActivated(async () => {
  await trashStore.refreshCount()
  await trashStore.loadTrash(true)
})

function showToast(msg: string) {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 1600)
}

function onItemClick(item: EmojiRecord) {
  actionItem.value = item
}

/** 恢复：清零删除标记，表情重新出现在各列表/搜索中 */
async function onRestore() {
  const item = actionItem.value
  actionItem.value = null
  if (!item) return
  try {
    await trashStore.restore([item.id])
    // 恢复后同步首页网格（缓存首页不会自动重载，需显式刷新）
    await emojiStore.loadGrid(true)
    await emojiStore.refreshCounts()
    showToast('已恢复')
  } catch (e) {
    console.error('restore failed', e)
    showToast('恢复失败，请重试')
  }
}

function onAskPurge() {
  const item = actionItem.value
  actionItem.value = null
  if (item) purgeTarget.value = item.id
}

/** 彻底删除：仅移除 App 内记录，不删手机源文件 */
async function confirmPurge() {
  const id = purgeTarget.value
  purgeTarget.value = null
  if (!id) return
  try {
    await trashStore.purge([id])
    showToast('已彻底删除')
  } catch (e) {
    console.error('purge failed', e)
    showToast('删除失败，请重试')
  }
}

async function confirmClearAll() {
  clearConfirmOpen.value = false
  try {
    await trashStore.clearAll()
    showToast('回收站已清空')
  } catch (e) {
    console.error('clearAll failed', e)
    showToast('清空失败，请重试')
  }
}
</script>

<template>
  <div class="page pt-[calc(8px+env(safe-area-inset-top))] pb-8">
    <!-- 顶部导航 -->
    <header
      class="sticky top-0 z-20 bg-surface/90 backdrop-blur-md px-4 pt-2 pb-3 flex items-center gap-2"
    >
      <button
        type="button"
        class="btn btn-ghost w-9 h-9 !p-0 cursor-pointer shrink-0"
        aria-label="返回"
        @click="router.back()"
      >
        <ChevronLeft :size="19" />
      </button>
      <h1 class="text-lg font-semibold flex-1 min-w-0">回收站</h1>
      <button
        v-if="hasItems"
        type="button"
        class="btn btn-ghost h-9 px-3 text-xs cursor-pointer hover:text-danger"
        @click="clearConfirmOpen = true"
      >
        <Trash2 :size="14" />
        清空
      </button>
    </header>

    <p class="px-4 mb-3 text-xs leading-relaxed text-ink-faint">
      删除的表情仅不在本 App 内显示，不会删除手机里的原图。可随时恢复；
      彻底删除仅移除 App 内的记录与识别数据，重新扫描文件夹后会再次出现。
    </p>

    <section class="px-4">
      <EmojiGrid
        v-if="hasItems"
        :items="trashStore.items"
        :loading="trashStore.loading"
        :finished="trashStore.finished"
        @load-more="trashStore.loadTrash()"
        @click="onItemClick"
      />
      <EmptyState
        v-else-if="!trashStore.loading"
        icon="🗑️"
        title="回收站是空的"
        description="在首页长按表情或在详情页点「删除」，即可把表情移入这里"
      />
    </section>

    <!-- 单条操作面板：恢复 / 彻底删除 -->
    <BaseSheet
      :visible="actionItem !== null"
      title="回收站操作"
      @close="actionItem = null"
    >
      <div v-if="actionItem" class="space-y-1 pb-2">
        <p class="text-xs text-ink-faint px-1 pb-1">
          删除于 {{ formatTime(actionItem.deletedAt) }}
        </p>
        <button
          type="button"
          class="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-black/5 cursor-pointer text-left"
          @click="onRestore"
        >
          <RotateCcw :size="18" class="text-primary" />
          <span class="text-sm">恢复</span>
        </button>
        <button
          type="button"
          class="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-black/5 cursor-pointer text-left"
          @click="onAskPurge"
        >
          <Trash2 :size="18" class="text-danger" />
          <span class="text-sm text-danger">彻底删除</span>
        </button>
      </div>
    </BaseSheet>

    <!-- 彻底删除确认 -->
    <BaseSheet
      :visible="purgeTarget !== null"
      title="彻底删除"
      @close="purgeTarget = null"
    >
      <p class="text-sm text-ink-muted py-2">
        彻底删除会移除该表情在 App 内的记录、识别数据与收藏关联，且无法恢复。
        仍不会删除手机里的原图。确定继续吗？
      </p>
      <div class="flex gap-2 pt-2 pb-2">
        <button
          type="button"
          class="btn btn-ghost flex-1 h-11 text-sm cursor-pointer"
          @click="purgeTarget = null"
        >
          取消
        </button>
        <button
          type="button"
          class="btn flex-1 h-11 text-sm cursor-pointer bg-danger text-white"
          @click="confirmPurge"
        >
          彻底删除
        </button>
      </div>
    </BaseSheet>

    <!-- 清空回收站确认 -->
    <BaseSheet
      :visible="clearConfirmOpen"
      title="清空回收站"
      @close="clearConfirmOpen = false"
    >
      <p class="text-sm text-ink-muted py-2">
        将彻底删除回收站内全部表情（共 {{ trashStore.items.length }} 张），无法恢复；
        仍不会删除手机里的原图。确定清空吗？
      </p>
      <div class="flex gap-2 pt-2 pb-2">
        <button
          type="button"
          class="btn btn-ghost flex-1 h-11 text-sm cursor-pointer"
          @click="clearConfirmOpen = false"
        >
          取消
        </button>
        <button
          type="button"
          class="btn flex-1 h-11 text-sm cursor-pointer bg-danger text-white"
          @click="confirmClearAll"
        >
          全部清空
        </button>
      </div>
    </BaseSheet>

    <!-- 轻提示 -->
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

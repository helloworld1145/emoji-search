<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronLeft, Pencil, Trash2, Share2, X, CheckCheck, FolderMinus } from 'lucide-vue-next'
import { useCollectionStore } from '../stores/collection'
import { useEmojiStore } from '../stores/emoji'
import EmojiGrid from '../components/EmojiGrid.vue'
import EmptyState from '../components/EmptyState.vue'
import BaseSheet from '../components/BaseSheet.vue'
import type { EmojiRecord } from '../types'

const route = useRoute()
const router = useRouter()
const store = useCollectionStore()
const emojiStore = useEmojiStore()

const collectionId = computed(() => route.params.id as string)

const selecting = ref(false)
const selectedIds = ref<string[]>([])
const renameOpen = ref(false)
const renameText = ref('')
const deleteOpen = ref(false)
const toast = ref('')

onMounted(async () => {
  await store.loadCollections()
  await store.openCollection(collectionId.value)
})

// 缓存页面：每次进入重新拉取，同步从详情页加入收藏夹的新表情
onActivated(async () => {
  await store.loadCollections()
  await store.openCollection(collectionId.value)
})

function showToast(msg: string) {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 1600)
}

function openRename() {
  renameText.value = store.current?.name ?? ''
  renameOpen.value = true
}

async function confirmRename() {
  if (!renameText.value.trim()) return
  await store.rename(collectionId.value, renameText.value)
  renameOpen.value = false
  showToast('已重命名')
}

async function confirmDelete() {
  await store.remove(collectionId.value)
  deleteOpen.value = false
  router.back()
}

function toggleSelectMode() {
  selecting.value = !selecting.value
  selectedIds.value = []
}

function onToggleSelect(item: EmojiRecord) {
  const idx = selectedIds.value.indexOf(item.id)
  if (idx >= 0) selectedIds.value.splice(idx, 1)
  else selectedIds.value.push(item.id)
}

async function removeSelected() {
  for (const id of selectedIds.value) {
    await store.removeEmoji(collectionId.value, id)
  }
  const count = selectedIds.value.length
  selecting.value = false
  selectedIds.value = []
  showToast(`已移出 ${count} 张表情`)
}

async function shareSelected() {
  const items = store.currentItems.filter((e) => selectedIds.value.includes(e.id))
  if (items.length > 0) await emojiStore.share(items.map((e) => e.path))
}
</script>

<template>
  <div class="page pt-[env(safe-area-inset-top)]">
    <header class="sticky top-0 z-20 bg-surface/90 backdrop-blur-md px-4 py-3">
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn btn-ghost w-9 h-9 !p-0 cursor-pointer shrink-0"
          aria-label="返回"
          @click="router.back()"
        >
          <ChevronLeft :size="19" />
        </button>
        <div class="flex-1 min-w-0">
          <h1 class="text-lg font-semibold truncate">
            {{ store.current?.name ?? '收藏夹' }}
          </h1>
          <p class="text-xs text-ink-muted">{{ store.currentItems.length }} 张表情</p>
        </div>
        <button
          v-if="!store.current?.isDefault"
          type="button"
          class="btn btn-ghost h-9 px-3 text-xs cursor-pointer"
          @click="openRename"
        >
          <Pencil :size="13" />
          重命名
        </button>
        <button
          type="button"
          class="btn btn-ghost h-9 px-3 text-xs cursor-pointer"
          @click="toggleSelectMode"
        >
          <component :is="selecting ? X : CheckCheck" :size="14" />
          {{ selecting ? '取消' : '多选' }}
        </button>
      </div>
    </header>

    <!-- 批量操作栏 -->
    <div
      v-if="selecting"
      class="sticky top-[57px] z-10 mx-4 mb-3 card p-2.5 flex items-center gap-2 animate-fade-up"
    >
      <span class="text-xs text-ink-muted px-1">已选 {{ selectedIds.length }}</span>
      <div class="flex-1" />
      <button
        type="button"
        class="btn btn-ghost h-8 px-3 text-xs cursor-pointer"
        :disabled="selectedIds.length === 0"
        @click="shareSelected"
      >
        <Share2 :size="13" />
        分享
      </button>
      <button
        type="button"
        class="btn h-8 px-3 text-xs cursor-pointer bg-danger/10 text-danger"
        :disabled="selectedIds.length === 0"
        @click="removeSelected"
      >
        <FolderMinus :size="13" />
        移出收藏夹
      </button>
    </div>

    <section class="px-4">
      <EmojiGrid
        v-if="store.currentItems.length > 0"
        :items="store.currentItems"
        :loading="store.itemsLoading"
        :finished="store.itemsFinished"
        :selectable="selecting"
        :selected-ids="selectedIds"
        @load-more="store.loadItems()"
        @toggle-select="onToggleSelect"
      />
      <EmptyState
        v-else
        icon="⭐"
        title="收藏夹还是空的"
        description="在表情上长按，即可把表情加入这里"
      />
    </section>

    <!-- 底部危险操作（非总收藏才可删除） -->
    <div v-if="!store.current?.isDefault" class="px-4 pb-6">
      <button
        type="button"
        class="w-full h-11 rounded-xl bg-danger/10 text-danger text-sm font-medium cursor-pointer hover:bg-danger/15 transition-colors flex items-center justify-center gap-1.5"
        @click="deleteOpen = true"
      >
        <Trash2 :size="15" />
        删除整个收藏夹
      </button>
    </div>

    <!-- 重命名弹窗 -->
    <BaseSheet :visible="renameOpen" title="重命名收藏夹" @close="renameOpen = false">
      <div class="flex gap-2 pt-1 pb-2">
        <input
          v-model="renameText"
          type="text"
          class="flex-1 h-11 rounded-xl bg-black/5 px-3 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          @keyup.enter="confirmRename"
        />
        <button
          type="button"
          class="btn btn-primary h-11 px-5 text-sm cursor-pointer"
          @click="confirmRename"
        >
          保存
        </button>
      </div>
    </BaseSheet>

    <!-- 删除确认 -->
    <BaseSheet :visible="deleteOpen" title="删除收藏夹" @close="deleteOpen = false">
      <p class="text-sm text-ink-muted py-2">
        删除「{{ store.current?.name }}」后，其中的表情记录会被移除，但不会删除手机里的原图。确定删除吗？
      </p>
      <div class="flex gap-2 pt-2 pb-2">
        <button
          type="button"
          class="btn btn-ghost flex-1 h-11 text-sm cursor-pointer"
          @click="deleteOpen = false"
        >
          取消
        </button>
        <button
          type="button"
          class="btn flex-1 h-11 text-sm cursor-pointer bg-danger text-white"
          @click="confirmDelete"
        >
          删除
        </button>
      </div>
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

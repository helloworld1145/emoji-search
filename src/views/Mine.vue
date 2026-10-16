<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Plus, ChevronRight, Star, Download, Pencil, Trash2, Folder
} from 'lucide-vue-next'
import { useCollectionStore } from '../stores/collection'
import EmptyState from '../components/EmptyState.vue'
import BaseSheet from '../components/BaseSheet.vue'
import { exportBackup } from '../services/backup'
import { toImageSrc } from '../utils/image'

const router = useRouter()
const store = useCollectionStore()

const createOpen = ref(false)
const createName = ref('')
const renameTarget = ref<string | null>(null)
const renameText = ref('')
const deleteTarget = ref<string | null>(null)
const toast = ref('')

onMounted(async () => {
  await store.loadCollections()
})

function showToast(msg: string) {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 1600)
}

function openCollection(id: string) {
  router.push(`/collection/${id}`)
}

async function createCollection() {
  const name = createName.value.trim()
  if (!name) return
  const col = await store.create(name)
  createName.value = ''
  createOpen.value = false
  showToast(`已创建「${col.name}」`)
}

function openRename(id: string, name: string) {
  renameTarget.value = id
  renameText.value = name
}

async function confirmRename() {
  if (renameTarget.value && renameText.value.trim()) {
    await store.rename(renameTarget.value, renameText.value)
    showToast('已重命名')
  }
  renameTarget.value = null
}

async function confirmDelete() {
  if (deleteTarget.value) {
    await store.remove(deleteTarget.value)
    showToast('已删除收藏夹')
  }
  deleteTarget.value = null
}

async function onExport() {
  const ok = await exportBackup()
  showToast(ok ? '备份文件已生成，选择保存或发送' : '导出失败，请重试')
}
</script>

<template>
  <div class="page pt-[calc(8px+env(safe-area-inset-top))]">
    <header
      class="sticky top-0 z-20 bg-surface/90 backdrop-blur-md px-4 pt-2 pb-3 flex items-center justify-between"
    >
      <h1 class="text-[22px] font-semibold leading-tight">我的</h1>
    </header>

    <!-- 收藏夹模块 -->
    <section class="px-4 mt-1">
      <div class="flex items-center justify-between mb-2.5">
        <h2 class="text-[16px] font-semibold text-ink">我的收藏夹</h2>
        <div class="flex gap-2">
          <button
            type="button"
            class="btn btn-ghost h-9 px-3 text-xs cursor-pointer"
            @click="onExport"
          >
            <Download :size="14" />
            导出备份
          </button>
          <button
            type="button"
            class="btn btn-primary h-9 px-3.5 text-xs cursor-pointer"
            @click="createOpen = true"
          >
            <Plus :size="14" />
            新建
          </button>
        </div>
      </div>

      <div class="space-y-2.5">
        <div
          v-for="col in store.collections"
          :key="col.id"
          class="card p-3 flex items-center gap-3 cursor-pointer hover:shadow-float transition-shadow"
          @click="openCollection(col.id)"
        >
          <div
            class="w-14 h-14 rounded-xl overflow-hidden shrink-0 flex items-center justify-center"
            :class="col.isDefault ? 'bg-gradient-to-br from-primary/15 to-secondary/15' : 'bg-black/5'"
          >
            <img
              v-if="col.coverThumb"
              :src="toImageSrc(col.coverThumb)"
              class="w-full h-full object-cover"
              alt=""
            />
            <Star v-else-if="col.isDefault" :size="22" class="text-primary" fill="currentColor" />
            <Folder v-else :size="22" class="text-ink-faint" />
          </div>

          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <h3 class="text-sm font-medium truncate">{{ col.name }}</h3>
              <span
                v-if="col.isDefault"
                class="chip !px-1.5 !py-0.5 bg-primary/10 text-primary text-[10px]"
              >
                总收藏
              </span>
            </div>
            <p class="text-xs text-ink-muted mt-0.5">{{ col.count }} 张表情</p>
          </div>

          <div class="flex items-center gap-1 shrink-0" @click.stop>
            <button
              v-if="!col.isDefault"
              type="button"
              class="btn btn-ghost w-8 h-8 !p-0 cursor-pointer"
              aria-label="重命名"
              @click="openRename(col.id, col.name)"
            >
              <Pencil :size="14" />
            </button>
            <button
              v-if="!col.isDefault"
              type="button"
              class="btn btn-ghost w-8 h-8 !p-0 cursor-pointer hover:text-danger"
              aria-label="删除"
              @click="deleteTarget = col.id"
            >
              <Trash2 :size="14" />
            </button>
            <ChevronRight v-else :size="16" class="text-ink-faint" />
          </div>
        </div>

        <EmptyState
          v-if="store.collections.length === 0"
          icon="📁"
          title="还没有收藏夹"
          description="创建收藏夹，把常用表情归类整理，转发更快"
          action-text="新建收藏夹"
          @action="createOpen = true"
        />
      </div>

      <p class="mt-4 text-xs leading-relaxed text-ink-faint">
        导出的备份记录收藏夹结构与表情路径，不包含图片本身。
      </p>
    </section>

    <!-- 新建收藏夹 -->
    <BaseSheet :visible="createOpen" title="新建收藏夹" @close="createOpen = false">
      <div class="flex gap-2 pt-1 pb-2">
        <input
          v-model="createName"
          type="text"
          placeholder="收藏夹名称"
          class="flex-1 h-11 rounded-xl bg-black/5 px-3 text-sm outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-ink-faint"
          @keyup.enter="createCollection"
        />
        <button
          type="button"
          class="btn btn-primary h-11 px-5 text-sm cursor-pointer"
          @click="createCollection"
        >
          创建
        </button>
      </div>
    </BaseSheet>

    <!-- 重命名 -->
    <BaseSheet
      :visible="renameTarget !== null"
      title="重命名收藏夹"
      @close="renameTarget = null"
    >
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
    <BaseSheet
      :visible="deleteTarget !== null"
      title="删除收藏夹"
      @close="deleteTarget = null"
    >
      <p class="text-sm text-ink-muted py-2">
        删除后其中的表情记录会被移除，但不会删除手机里的原图。确定删除吗？
      </p>
      <div class="flex gap-2 pt-2 pb-2">
        <button
          type="button"
          class="btn btn-ghost flex-1 h-11 text-sm cursor-pointer"
          @click="deleteTarget = null"
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

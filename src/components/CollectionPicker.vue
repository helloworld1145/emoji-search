<script setup lang="ts">
import { ref } from 'vue'
import { FolderPlus, Check } from 'lucide-vue-next'
import { useCollectionStore } from '../stores/collection'
import { toImageSrc } from '../utils/image'

const props = defineProps<{
  emojiId: string
}>()

const emit = defineEmits<{
  (e: 'picked', collectionId: string): void
}>()

const store = useCollectionStore()
const creating = ref(false)
const newName = ref('')
const memberSet = ref<Set<string>>(new Set())

async function ensureLoaded() {
  if (!store.loaded) await store.loadCollections()
  const ids = await store.collectionsOf(props.emojiId)
  memberSet.value = new Set(ids)
}

async function createAndPick() {
  const name = newName.value.trim()
  if (!name) return
  const col = await store.create(name)
  newName.value = ''
  creating.value = false
  emit('picked', col.id)
}

defineExpose({ ensureLoaded })
</script>

<template>
  <div class="space-y-2">
    <button
      v-for="col in store.collections"
      :key="col.id"
      type="button"
      class="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-black/5 transition-colors cursor-pointer text-left"
      @click="emit('picked', col.id)"
    >
      <div class="w-11 h-11 rounded-lg bg-black/5 overflow-hidden shrink-0 flex items-center justify-center">
        <img
          v-if="col.coverThumb"
          :src="toImageSrc(col.coverThumb)"
          class="w-full h-full object-cover"
          alt=""
        />
        <span v-else class="text-lg">{{ col.isDefault ? '⭐' : '📁' }}</span>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium truncate">{{ col.name }}</div>
        <div class="text-xs text-ink-faint">{{ col.count }} 张表情</div>
      </div>
      <Check v-if="memberSet.has(col.id)" :size="16" class="text-primary" />
    </button>

    <!-- 新建收藏夹 -->
    <div v-if="creating" class="flex gap-2 pt-1">
      <input
        v-model="newName"
        type="text"
        placeholder="收藏夹名称"
        class="flex-1 h-10 rounded-xl bg-black/5 px-3 text-sm outline-none focus:ring-2 focus:ring-primary/40"
        @keyup.enter="createAndPick"
      />
      <button
        type="button"
        class="btn btn-primary h-10 px-4 text-sm cursor-pointer"
        @click="createAndPick"
      >
        创建
      </button>
    </div>
    <button
      v-else
      type="button"
      class="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-primary/40 text-primary text-sm font-medium cursor-pointer hover:bg-primary/5 transition-colors"
      @click="creating = true"
    >
      <FolderPlus :size="16" />
      新建收藏夹
    </button>
  </div>
</template>

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Collection, EmojiRecord } from '../types'
import * as collectionRepo from '../db/repositories/collection'
import * as emojiRepo from '../db/repositories/emoji'
import { initDatabase } from '../db/database'

const PAGE = 60

export const useCollectionStore = defineStore('collection', () => {
  const collections = ref<(Collection & { count: number; coverThumb: string })[]>([])
  const current = ref<Collection | null>(null)
  const currentItems = ref<EmojiRecord[]>([])
  const itemsLoading = ref(false)
  const itemsFinished = ref(false)
  const loaded = ref(false)

  async function loadCollections(): Promise<void> {
    await initDatabase()
    await collectionRepo.ensureDefaultCollection()
    const list = await collectionRepo.listCollections()
    collections.value = await Promise.all(
      list.map(async (c) => {
        const stats = await collectionRepo.getCollectionStats(c.id)
        return { ...c, count: stats.count, coverThumb: stats.coverThumb }
      })
    )
    loaded.value = true
  }

  async function openCollection(id: string): Promise<void> {
    const col = await collectionRepo.getCollection(id)
    current.value = col
    currentItems.value = []
    itemsFinished.value = false
    await loadItems(true)
  }

  async function loadItems(reset = false): Promise<void> {
    if (!current.value) return
    if (itemsLoading.value) return
    if (!reset && itemsFinished.value) return
    itemsLoading.value = true
    try {
      const offset = reset ? 0 : currentItems.value.length
      const rows = await collectionRepo.getCollectionItems(current.value.id, PAGE, offset)
      if (reset) currentItems.value = rows
      else currentItems.value.push(...rows)
      if (rows.length < PAGE) itemsFinished.value = true
    } catch (e) {
      console.error('loadItems failed', e)
    } finally {
      itemsLoading.value = false
    }
  }

  async function create(name: string): Promise<Collection> {
    const col = await collectionRepo.createCollection(name.trim() || '新收藏夹')
    await loadCollections()
    return col
  }

  async function rename(id: string, name: string): Promise<void> {
    await collectionRepo.renameCollection(id, name.trim())
    await loadCollections()
    if (current.value?.id === id) current.value.name = name.trim()
  }

  async function remove(id: string): Promise<void> {
    await collectionRepo.deleteCollection(id)
    if (current.value?.id === id) {
      current.value = null
      currentItems.value = []
    }
    await loadCollections()
  }

  /** 加入收藏夹；加入「我的收藏」总收藏夹（默认收藏夹）时同步星标 */
  async function addEmoji(collectionId: string, emojiId: string): Promise<void> {
    await collectionRepo.addToCollection(collectionId, emojiId)
    const col = collections.value.find((c) => c.id === collectionId)
    if (col?.isDefault) {
      await emojiRepo.setFavorite(emojiId, true)
    }
    await refreshCount(collectionId)
  }

  async function removeEmoji(collectionId: string, emojiId: string): Promise<void> {
    await collectionRepo.removeFromCollection(collectionId, emojiId)
    const col = collections.value.find((c) => c.id === collectionId)
    if (col?.isDefault) {
      await emojiRepo.setFavorite(emojiId, false)
    }
    currentItems.value = currentItems.value.filter((e) => e.id !== emojiId)
    await refreshCount(collectionId)
  }

  async function isIn(collectionId: string, emojiId: string): Promise<boolean> {
    return collectionRepo.isInCollection(collectionId, emojiId)
  }

  /** 表情所属的收藏夹 id 列表 */
  async function collectionsOf(emojiId: string): Promise<string[]> {
    return collectionRepo.getEmojiCollectionIds(emojiId)
  }

  async function refreshCount(id: string): Promise<void> {
    const stats = await collectionRepo.getCollectionStats(id)
    const col = collections.value.find((c) => c.id === id)
    if (col) {
      col.count = stats.count
      col.coverThumb = stats.coverThumb
    }
  }

  return {
    collections,
    current,
    currentItems,
    itemsLoading,
    itemsFinished,
    loaded,
    loadCollections,
    openCollection,
    loadItems,
    create,
    rename,
    remove,
    addEmoji,
    removeEmoji,
    isIn,
    collectionsOf,
    refreshCount
  }
})

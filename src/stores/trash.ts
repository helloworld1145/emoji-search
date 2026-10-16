import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { EmojiRecord } from '../types'
import * as emojiRepo from '../db/repositories/emoji'
import { initDatabase } from '../db/database'

const PAGE = 60

/**
 * 回收站 store：管理已软删表情（deleted_at > 0）。
 * deletedCount 供首页角标实时展示；删除/恢复动作会同时刷新角标。
 */
export const useTrashStore = defineStore('trash', () => {
  const items = ref<EmojiRecord[]>([])
  const total = ref(0)
  const deletedCount = ref(0)
  const loading = ref(false)
  const finished = ref(false)

  async function loadTrash(reset = false): Promise<void> {
    if (loading.value) return
    if (!reset && finished.value) return
    loading.value = true
    try {
      const offset = reset ? 0 : items.value.length
      const rows = await emojiRepo.getDeleted(PAGE, offset)
      if (reset) items.value = rows
      else items.value.push(...rows)
      if (rows.length < PAGE) finished.value = true
    } catch (e) {
      console.error('loadTrash failed', e)
    } finally {
      loading.value = false
    }
  }

  /** 刷新角标数量（首页入口用） */
  async function refreshCount(): Promise<void> {
    try {
      await initDatabase()
      deletedCount.value = await emojiRepo.countDeleted()
    } catch (e) {
      console.error('refreshCount failed', e)
    }
  }

  /** 软删除（移入回收站） */
  async function moveToTrash(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await emojiRepo.softDelete(ids)
    await refreshCount()
  }

  /** 从回收站恢复 */
  async function restore(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await emojiRepo.restoreEmojis(ids)
    items.value = items.value.filter((e) => !ids.includes(e.id))
    total.value = Math.max(0, total.value - ids.length)
    await refreshCount()
  }

  /** 彻底删除单条（仅移除 App 记录，不删手机源文件） */
  async function purge(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await emojiRepo.purgeEmojis(ids)
    items.value = items.value.filter((e) => !ids.includes(e.id))
    total.value = Math.max(0, total.value - ids.length)
    await refreshCount()
  }

  /** 清空回收站 */
  async function clearAll(): Promise<void> {
    await emojiRepo.purgeAllDeleted()
    items.value = []
    total.value = 0
    finished.value = true
    await refreshCount()
  }

  return {
    items,
    total,
    deletedCount,
    loading,
    finished,
    loadTrash,
    refreshCount,
    moveToTrash,
    restore,
    purge,
    clearAll
  }
})

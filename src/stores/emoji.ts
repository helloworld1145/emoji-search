import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { EmojiRecord, ScanProgress, SavedFolder } from '../types'
import * as emojiRepo from '../db/repositories/emoji'
import * as collectionRepo from '../db/repositories/collection'
import { initDatabase } from '../db/database'
import {
  onProgress,
  runRecognitionQueue,
  reRecognizeAll,
  refreshStats,
  listSavedFolders,
  addFolder as pickFolder,
  removeSavedFolder,
  scanFolderAndRecognize,
  errorMessage
} from '../services/scanner'
import {
  shareToWechat,
  shareToQQ,
  shareSystem,
  shareSystemMany
} from '../services/share'

const PAGE = 60

export const useEmojiStore = defineStore('emoji', () => {
  /** 首页网格数据（最新入库） */
  const items = ref<EmojiRecord[]>([])
  const total = ref(0)
  const pendingCount = ref(0)
  const scanState = ref<ScanProgress>({ phase: 'idle', total: 0, processed: 0 })
  const gridLoading = ref(false)
  const gridFinished = ref(false)
  const initialized = ref(false)
  /** 已保存（手动选择）的文件夹列表 */
  const savedFolders = ref<SavedFolder[]>([])
  /** 首页收藏夹筛选：非空时网格只显示该收藏夹内容，null 表示全部 */
  const filterCollectionId = ref<string | null>(null)

  let progressUnsubscribe: (() => void) | null = null

  /**
   * 初始化/进入首页：建库 + 订阅进度 + 加载首页数据。
   * 注意：每次进入首页都会重新加载网格，而不是依赖内存缓存。
   * 原因：表情被软删（移入回收站）、从回收站恢复/彻底删除、或从详情页返回后，
   * 若仅用内存 items 会导致已删除表情仍残留显示，必须重进 App 才刷新。
   * 进度订阅用 progressUnsubscribe 守卫，避免重复注册。
   */
  async function init(): Promise<void> {
    await initDatabase()
    if (!progressUnsubscribe) {
      progressUnsubscribe = onProgress((p) => {
        scanState.value = p
      })
    }
    initialized.value = true
    await loadFolders()
    await loadGrid(true)
    await refreshCounts()
  }

  /** 拉取用户已保存的文件夹列表 */
  async function loadFolders(): Promise<void> {
    try {
      savedFolders.value = await listSavedFolders()
    } catch (e) {
      console.error('loadFolders failed', e)
    }
  }

  async function refreshCounts(): Promise<void> {
    if (filterCollectionId.value) {
      total.value = (await collectionRepo.getCollectionStats(filterCollectionId.value)).count
    } else {
      const stats = await refreshStats()
      total.value = stats.total
      pendingCount.value = stats.pending
    }
  }

  async function loadGrid(reset = false): Promise<void> {
    if (gridLoading.value) return
    if (!reset && gridFinished.value) return
    if (reset) {
      // 重置分页时务必把「已加载完」标志清掉：否则上一次滑到底把 gridFinished
      // 置为 true 后，重新扫描/切换收藏夹导致的 reset 不会让它回落，
      // 哨兵元素判定 finished 为 true 便不再触发 load-more（须重进 App 才恢复）。
      items.value = []
      gridFinished.value = false
    }
    gridLoading.value = true
    try {
      const offset = items.value.length
      const rows = filterCollectionId.value
        ? await collectionRepo.getCollectionItems(filterCollectionId.value, PAGE, offset)
        : await emojiRepo.getRecent(PAGE, offset)
      items.value.push(...rows)
      if (rows.length < PAGE) gridFinished.value = true
    } catch (e) {
      console.error('loadGrid failed', e)
    } finally {
      gridLoading.value = false
    }
  }

  /**
   * 切换首页收藏夹筛选：传入已选中 id 即清除（回到全部），传入新 id 即切换。
   * 内部统一 reset 重新加载分页并刷新计数，与删除/扫描后刷新路径一致。
   */
  async function setCollectionFilter(id: string | null): Promise<void> {
    filterCollectionId.value = filterCollectionId.value === id ? null : id
    await loadGrid(true)
    await refreshCounts()
  }

  async function toggleFavorite(id: string): Promise<boolean> {
    const next = await emojiRepo.toggleFavorite(id)
    const item = items.value.find((e) => e.id === id)
    if (item) {
      item.isFavorite = next
      // 与 getRecent 的排序规则保持一致（星标优先，组内按入库时间倒序）：
      // 从详情页加星返回首页时该图立即置顶，取消星标后回落，无需重新查库
      items.value.sort(
        (a, b) =>
          Number(b.isFavorite) - Number(a.isFavorite) || b.createdAt - a.createdAt
      )
    }
    return next
  }

  /**
   * 从首页网格内存列表中移除指定表情（软删/彻底删后的即时同步）。
   * 首页被 keep-alive 缓存后不再靠重新加载网格来剔除已删表情，
   * 必须显式同步，否则从详情页删除返回首页时已删表情仍残留在网格里。
   */
  function removeFromGrid(ids: string[]): void {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    const before = items.value.length
    items.value = items.value.filter((e) => !idSet.has(e.id))
    const removed = before - items.value.length
    if (removed > 0) total.value = Math.max(0, total.value - removed)
  }

  /** 调起系统目录选择器挑选一个文件夹（仅添加，不立即扫描） */
  async function addFolder(): Promise<SavedFolder | null> {
    const folder = await pickFolder()
    if (folder) await loadFolders()
    return folder
  }

  /** 调起系统目录选择器挑选文件夹，并立即扫描 + 识别 */
  async function addFolderAndScan(): Promise<SavedFolder | null> {
    let folder: SavedFolder | null
    try {
      folder = await pickFolder()
    } catch (e) {
      // picker 授权等真实异常：写入 error 状态，让首页警示条可见
      const msg = errorMessage(e)
      console.error('addFolderAndScan picker failed:', msg)
      scanState.value = {
        phase: 'error',
        total: 0,
        processed: 0,
        message: `选择文件夹失败：${msg}`
      }
      return null
    }
    if (!folder) return null
    await loadFolders()
    await startFolderScan(folder)
    return folder
  }

  /** 扫描并识别某个已选文件夹 */
  async function startFolderScan(folder: SavedFolder): Promise<void> {
    try {
      scanState.value = {
        phase: 'scanning',
        total: 0,
        processed: 0,
        message: `扫描文件夹：${folder.name}`
      }
      const result = await scanFolderAndRecognize(folder)
      scanState.value = {
        phase: 'done',
        total: result,
        processed: result,
        message: `已扫描：${folder.name}`
      }
      await refreshCounts()
      await loadGrid(true)
    } catch (e) {
      const msg = errorMessage(e)
      console.error('startFolderScan failed:', msg)
      scanState.value = {
        phase: 'error',
        total: 0,
        processed: 0,
        message: `扫描「${folder.name}」失败：${msg}`
      }
    }
  }

  /** 重新识别：重置历史失败退出队列的记录并重新入队识别 */
  async function reRecognizeFailed(): Promise<number> {
    if (['scanning', 'recognizing'].includes(scanState.value.phase)) return 0
    try {
      scanState.value = {
        phase: 'recognizing',
        total: 0,
        processed: 0,
        message: '重新识别失败表情'
      }
      const count = await reRecognizeAll()
      scanState.value = {
        phase: 'done',
        total: count,
        processed: count,
        message: count > 0 ? `重新识别完成：${count} 张` : '没有需要重新识别的表情'
      }
      await refreshCounts()
      await loadGrid(true)
      return count
    } catch (e) {
      const msg = errorMessage(e)
      console.error('reRecognizeFailed failed:', msg)
      scanState.value = {
        phase: 'error',
        total: 0,
        processed: 0,
        message: `重新识别失败：${msg}`
      }
      return 0
    }
  }

  /** 移除一个已保存文件夹（仅删授权记录），并刷新列表 */
  async function removeFolder(treeUri: string): Promise<void> {
    await removeSavedFolder(treeUri)
    await loadFolders()
  }

  async function updateTags(
    id: string,
    data: { ocrText?: string; tags?: string[] }
  ): Promise<void> {
    await emojiRepo.updateUserTags(id, data)
    const item = items.value.find((e) => e.id === id)
    if (item) {
      if (data.ocrText !== undefined) item.ocrText = data.ocrText
      if (data.tags !== undefined) item.tags = data.tags
    }
  }

  async function share(
    paths: string | string[],
    target: 'wechat' | 'qq' | 'system' = 'system',
    toast?: (msg: string) => void
  ): Promise<boolean> {
    let ok = false
    if (target === 'wechat') {
      const p = Array.isArray(paths) ? paths[0] : paths
      ok = await shareToWechat(p, toast)
    } else if (target === 'qq') {
      const p = Array.isArray(paths) ? paths[0] : paths
      ok = await shareToQQ(p, toast)
    } else {
      ok = Array.isArray(paths) ? await shareSystemMany(paths) : await shareSystem(paths)
    }
    // 发送成功后沉淀「最近发送」，与悬浮窗发送保持同一 recent_sends 数据源
    // （失败不影响分享结果，静默忽略）
    if (ok) {
      const list = Array.isArray(paths) ? paths : [paths]
      for (const p of list) {
        try {
          const rec = await emojiRepo.getByPath(p)
          if (rec) await emojiRepo.recordSend(rec.id)
        } catch (e) {
          console.warn('recordSend failed for', p, e)
        }
      }
    }
    return ok
  }

  return {
    items,
    total,
    pendingCount,
    scanState,
    gridLoading,
    gridFinished,
    initialized,
    savedFolders,
    filterCollectionId,
    init,
    refreshCounts,
    loadGrid,
    loadFolders,
    addFolder,
    addFolderAndScan,
    startFolderScan,
    reRecognizeFailed,
    removeFolder,
    setCollectionFilter,
    toggleFavorite,
    updateTags,
    share,
    removeFromGrid
  }
})

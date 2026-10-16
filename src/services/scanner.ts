import type { EmojiRecord, ScanProgress, SavedFolder } from '../types'
import { EmojiScanner, type NativeScanItem } from './nativeBridge'
import * as emojiRepo from '../db/repositories/emoji'
import { initDatabase } from '../db/database'
import { uuid } from '../db/database'

const PAGE_SIZE = 100
const UPSERT_FLUSH = 200

/**
 * 提取可读错误信息：Capacitor 原生 reject 的错误码位于 Error.message
 * （如 FOLDER_PICK_CANCELLED / FOLDER_SCAN_FAILED / NO_URI），此处统一提取。
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message
  if (typeof e === 'string' && e) return e
  const anyE = e as { message?: string; code?: string } | null
  return anyE?.message || anyE?.code || String(e ?? 'UNKNOWN_ERROR')
}

let recognizing = false
let folderScanning = false
let nativeListenerAttached = false

type ProgressListener = (p: ScanProgress) => void
const progressListeners = new Set<ProgressListener>()

/** 订阅扫描/识别进度 */
export function onProgress(cb: ProgressListener): () => void {
  progressListeners.add(cb)
  if (!nativeListenerAttached) {
    nativeListenerAttached = true
    try {
      EmojiScanner.addListener('scanProgress', (data) => {
        progressListeners.forEach((fn) => fn(data))
      })
    } catch (e) {
      console.error('attach scanProgress listener failed', e)
    }
  }
  return () => {
    progressListeners.delete(cb)
  }
}

function emit(p: ScanProgress) {
  progressListeners.forEach((fn) => fn(p))
}

function toRecord(item: NativeScanItem): EmojiRecord {
  return {
    id: uuid(),
    path: item.path ?? '',
    thumbPath: item.thumbPath ?? '',
    mimeType: item.mime || 'image/jpeg',
    size: item.size ?? 0,
    width: item.width ?? 0,
    height: item.height ?? 0,
    isGif: !!item.isGif,
    ocrText: '',
    tags: [],
    isFavorite: false,
    mtime: item.mtime ?? 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: 0
  }
}

/**
 * 识别队列：对未识别表情执行端侧 AI 识别并打标签。
 * 每批 20 张，串行执行（控制内存峰值）。
 */
export async function runRecognitionQueue(): Promise<number> {
  if (recognizing) return 0
  recognizing = true
  let processed = 0
  try {
    for (;;) {
      const pending = await emojiRepo.getPendingRecognize(20)
      if (pending.length === 0) break

      const res = await EmojiScanner.recognizeBatch({
        paths: pending.map((p) => p.path),
        withOcr: true,
        withLabels: true
      })

      for (const r of res.results ?? []) {
        const record = await emojiRepo.getByPath(r.path)
        if (!record) continue
        const ocrText = r.ocrText ?? ''
        const labels = r.labels ?? []
        const emotions = r.emotions ?? []
        const hasSignal =
          ocrText.length > 0 ||
          labels.length > 0 ||
          emotions.some((e) => e !== 'neutral')
        if (!hasSignal) {
          await emojiRepo.markRecognizeFailed(record.id)
          continue
        }
        // 物体标签与情感统一转中文，合并去重后写入 tags 单列
        const tags = [
          ...emojiRepo.mapLabelsToChinese(labels),
          ...emojiRepo.mapEmotionsToChinese(emotions)
        ].filter((t, i, arr) => arr.indexOf(t) === i)
        await emojiRepo.applyAiResult(record.id, { ocrText, tags })
        processed++
      }
      emit({
        phase: 'recognizing',
        total: pending.length,
        processed,
        message: 'AI 识别中'
      })
    }
    return processed
  } catch (e) {
    console.error('runRecognitionQueue failed', e)
    throw e
  } finally {
    recognizing = false
  }
}

/**
 * 重新识别：把因历史失败退出识别队列的记录（recognized=0 且 fail_count>=3）
 * 重置后重新入队，复用现有识别编排。返回本次识别成功条数。
 */
export async function reRecognizeAll(): Promise<number> {
  await initDatabase()
  const reset = await emojiRepo.resetFailedRecognition()
  console.info(`[scanner] reRecognizeAll: reset ${reset} failed records`)
  if (reset === 0) return 0
  return runRecognitionQueue()
}

/** 返回用户已保存（持久化授权）的文件夹列表 */
export async function listSavedFolders(): Promise<SavedFolder[]> {
  try {
    const res = await EmojiScanner.listFolders()
    return res.folders
  } catch (e) {
    console.error('listSavedFolders failed', e)
    return []
  }
}

/** 调起系统目录选择器挑选并持久化一个文件夹；用户取消返回 null */
export async function addFolder(): Promise<SavedFolder | null> {
  try {
    const res = await EmojiScanner.openFolderPicker()
    return { treeUri: res.treeUri, name: res.name }
  } catch (e) {
    const msg = errorMessage(e)
    // 用户主动取消属于正常流程，不提示也不上抛
    if (msg.includes('FOLDER_PICK_CANCELLED')) {
      console.info('[scanner] addFolder cancelled by user')
      return null
    }
    // 真实失败（授权异常等）必须上抛，交由调用方展示，禁止静默吞掉
    console.error('[scanner] addFolder failed:', msg)
    throw new Error(msg)
  }
}

/** 移除一个已保存文件夹（仅删除授权记录，不影响已入库表情） */
export async function removeSavedFolder(treeUri: string): Promise<void> {
  try {
    await EmojiScanner.removeFolder({ treeUri })
  } catch (e) {
    console.error('removeSavedFolder failed', e)
  }
}

/**
 * 扫描某个文件夹的元数据并写入数据库（不识别）。
 * 仅做增量 upsert，不删除其它路径的已入库表情。返回 { added, total }。
 */
export async function scanFolderMetadata(folder: SavedFolder): Promise<{
  added: number
  total: number
}> {
  if (folderScanning) return { added: 0, total: 0 }
  folderScanning = true
  try {
    await initDatabase()
    const existing = await emojiRepo.getPathMtimeMap()
    const buffer: EmojiRecord[] = []
    // 已存在记录：重新扫描时刷新缩略图路径，避免缩略图缓存因 mtime 不稳定
    // （SAF 常返回 last_modified=0 而兜底为当前时间戳）或系统清理缓存后失效，
    // 导致首页静态图指向已不存在的缩略图文件而无法加载。GIF 因回退原图故不受影响，
    // 此处让静态图同样保持可用。仅更新 thumb_path，不触碰用户标签/收藏。
    const thumbUpdates: { path: string; thumbPath: string }[] = []
    let added = 0
    let offset = 0
    let total = 0

    for (;;) {
      const res = await EmojiScanner.scanFolder({
        treeUri: folder.treeUri,
        offset,
        limit: PAGE_SIZE,
        withThumbnails: true
      })
      total = res.total
      for (const item of res.items) {
        if (!existing.has(item.path)) {
          buffer.push(toRecord(item))
        } else {
          thumbUpdates.push({ path: item.path, thumbPath: item.thumbPath ?? '' })
        }
      }
      emit({
        phase: 'scanning',
        total,
        processed: offset + res.items.length,
        message: `扫描文件夹：${folder.name}`
      })
      if (buffer.length >= UPSERT_FLUSH) {
        await emojiRepo.upsertEmojisBatch(buffer)
        added += buffer.length
        buffer.length = 0
      }
      if (!res.hasMore || res.items.length === 0) break
      offset += res.items.length
    }

    if (buffer.length > 0) {
      await emojiRepo.upsertEmojisBatch(buffer)
      added += buffer.length
    }
    if (thumbUpdates.length > 0) {
      await emojiRepo.updateThumbPaths(thumbUpdates)
    }
    return { added, total }
  } catch (e) {
    console.error('scanFolderMetadata failed', e)
    throw e
  } finally {
    folderScanning = false
  }
}

/**
 * 扫描某文件夹并执行端侧 AI 识别（与自动扫描一致）。
 * 返回本次新增的已识别条数。
 */
export async function scanFolderAndRecognize(folder: SavedFolder): Promise<number> {
  await scanFolderMetadata(folder)
  return runRecognitionQueue()
}

/** 刷新统计：总数与待识别数 */
export async function refreshStats(): Promise<{ total: number; pending: number }> {
  const [total, pending] = await Promise.all([
    emojiRepo.countAll(),
    emojiRepo.countPendingRecognize()
  ])
  return { total, pending }
}

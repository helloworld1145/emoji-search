import { Capacitor, registerPlugin } from '@capacitor/core'
import type {
  EmojiScannerPlugin,
  FloatingWindowPlugin,
  ListenerHandle,
  NativeScanItem,
  RecognizeItem,
  ScanProgress
} from '../types'
import {
  generateMockFiles,
  mockRecognize,
  mockOpenFolderPicker,
  mockListFolders,
  mockRemoveFolder,
  mockScanFolder,
  mockGetViewableUrl,
  mockShareTo,
  onMockProgress,
  emitMockProgress
} from './mockScanner'

/** 是否使用浏览器 Mock 模式（非原生平台自动启用，便于电脑端调试） */
export const USE_MOCK = !Capacitor.isNativePlatform()

export type { NativeScanItem, RecognizeItem }

const native = registerPlugin<EmojiScannerPlugin>('EmojiScanner')

export interface RecognizeOptions {
  paths: string[]
  withOcr?: boolean
  withLabels?: boolean
}

/**
 * 归一化扫描项：统一 Mock 与原生两种返回字段差异。
 * - 原生返回 mimeType（非 mime），且 mtime 为秒级；Mock 返回 mime、mtime 毫秒。
 * - 原生 scanFolder 不返回 name，需由 path 推导。
 * - 同时兼容 thumbPath 与 Mock 的 thumbUri。
 */
function normalizeScanItem(f: {
  path: string
  name?: string
  mime?: string
  mimeType?: string
  mtime?: number
  size?: number
  width?: number
  height?: number
  isGif?: boolean
  thumbPath?: string
  thumbUri?: string
}): NativeScanItem {
  const rawMime = f.mime ?? f.mimeType ?? ''
  // 原生 mtime 为秒（约 1.7e9），Mock 为毫秒（约 1.7e12）；以 1e11 为界换算为毫秒
  const mtime =
    typeof f.mtime === 'number' && f.mtime > 0
      ? f.mtime < 1e11
        ? f.mtime * 1000
        : f.mtime
      : 0
  const name =
    f.name ?? (f.path ? f.path.split('/').pop() ?? f.path : '')
  return {
    path: f.path,
    name,
    size: f.size ?? 0,
    mime: rawMime,
    mtime,
    width: f.width ?? 0,
    height: f.height ?? 0,
    isGif: f.isGif ?? rawMime === 'image/gif',
    thumbPath: f.thumbPath ?? f.thumbUri ?? ''
  }
}

/** AI 识别（OCR + 情感）（Mock 模式返回模拟数据） */
async function recognizeBatch(
  opts: RecognizeOptions
): Promise<{ results: RecognizeItem[] }> {
  if (USE_MOCK) {
    const results = mockRecognize(opts.paths)
    const total = results.length
    for (let i = 0; i < total; i += 8) {
      await new Promise((r) => setTimeout(r, 50))
      emitMockProgress({
        phase: 'recognizing',
        total,
        processed: Math.min(total, i + 8),
        message: 'AI 识别中（Mock）'
      })
    }
    console.info(`[mock] recognizeBatch: ${total} results`)
    return { results }
  }
  return native.recognizeBatch({
    paths: opts.paths,
    withOcr: opts.withOcr ?? true,
    withLabels: opts.withLabels ?? true
  })
}

/** 取消当前扫描 */
async function cancelScan(): Promise<void> {
  if (USE_MOCK) return
  await native.cancelScan()
}

/** 订阅扫描/识别进度事件（Mock 模式走本地事件） */
function addListener(
  event: 'scanProgress',
  cb: (data: ScanProgress) => void
): ListenerHandle {
  if (USE_MOCK) {
    const off = onMockProgress(cb)
    return { remove: off }
  }
  let handle: ListenerHandle | null = null
  native.addListener(event, cb).then((h) => {
    handle = { remove: () => h.remove() }
  })
  return {
    remove: () => {
      handle?.remove()
    }
  }
}

/** 把文件复制到应用缓存，返回可分享的 URI（Mock 模式返回 data URI） */
async function prepareForShare(
  opts: { path: string }
): Promise<{ uri: string }> {
  if (USE_MOCK) {
    const files = generateMockFiles(48)
    const idx = Number((opts.path.match(/mock_emoji_(\d+)/) ?? [])[1] ?? 0)
    return { uri: files[idx]?.thumbUri ?? files[0].thumbUri }
  }
  return native.prepareForShare({ path: opts.path })
}

/** 调起系统目录选择器（Mock 模式返回模拟目录） */
async function openFolderPicker(): Promise<{
  treeUri: string
  name: string
}> {
  if (USE_MOCK) return mockOpenFolderPicker()
  return native.openFolderPicker()
}

/** 返回已保存的文件夹列表 */
async function listFolders(): Promise<{ folders: { treeUri: string; name: string }[] }> {
  if (USE_MOCK) {
    return { folders: mockListFolders() }
  }
  return native.listFolders()
}

/** 移除一个已保存文件夹 */
async function removeFolder(opts: { treeUri: string }): Promise<void> {
  if (USE_MOCK) {
    mockRemoveFolder(opts.treeUri)
    return
  }
  return native.removeFolder({ treeUri: opts.treeUri })
}

/** 扫描某个已授权文件夹（分页） */
async function scanFolder(
  opts: { treeUri: string; offset?: number; limit?: number; withThumbnails?: boolean }
): Promise<{
  items: NativeScanItem[]
  total: number
  hasMore: boolean
  folderName: string
}> {
  if (USE_MOCK) {
    const folders = mockListFolders()
    const meta = folders.find((f) => f.treeUri === opts.treeUri)
    const name = meta?.name ?? opts.treeUri
    const res = mockScanFolder(opts.treeUri, name, opts.offset ?? 0, opts.limit ?? 300)
    const items: NativeScanItem[] = res.items.map(normalizeScanItem)
    return { items, total: res.total, hasMore: res.hasMore, folderName: res.folderName }
  }
  // 真机分支同样必须过 normalizeScanItem：原生返回 mimeType/thumbPath 等字段，
  // 与前端期望的 mime/name 命名不一致，缺归一化会导致 toRecord 读到 undefined
  // 并在 esc() 处抛错，整批入库失败。
  const res = await native.scanFolder({
    treeUri: opts.treeUri,
    offset: opts.offset ?? 0,
    limit: opts.limit ?? 300,
    withThumbnails: opts.withThumbnails ?? true
  })
  return {
    items: (res.items ?? []).map(normalizeScanItem),
    total: res.total,
    hasMore: res.hasMore,
    folderName: res.folderName
  }
}

/** 把 content:// 或 file:// 路径转为可加载的 file:// URL（Mock 模式原样返回） */
export async function getViewableUrl(
  opts: { path: string }
): Promise<{ url: string; missing?: boolean }> {
  if (USE_MOCK) {
    return mockGetViewableUrl(opts.path)
  }
  return native.getViewableUrl({ path: opts.path })
}

/** 直接拉起微信/QQ 转发界面或回退系统面板（Mock 模式走 mockShareTo） */
async function shareTo(
  opts: { path: string; target: 'wechat' | 'qq' | 'system' }
): Promise<{ launched: boolean; reason?: string }> {
  if (USE_MOCK) {
    return mockShareTo(opts.path, opts.target)
  }
  return native.shareTo(opts)
}

/** 统一暴露给上层的插件门面（原生与 Mock 双模式） */
export const EmojiScanner = {
  recognizeBatch,
  cancelScan,
  prepareForShare,
  shareTo,
  addListener,
  openFolderPicker,
  listFolders,
  removeFolder,
  scanFolder,
  getViewableUrl
}

/**
 * 悬浮窗控制门面（原生与 Mock 双模式）。
 * Web 调试无原生悬浮窗，返回模拟状态，不真正显示，仅供 UI 联调。
 */
const nativeFloating = USE_MOCK
  ? null
  : registerPlugin<FloatingWindowPlugin>('FloatingWindow')

export const FloatingWindow = {
  async start(): Promise<{ running: boolean }> {
    if (USE_MOCK) return { running: true }
    return nativeFloating!.start()
  },
  async stop(): Promise<{ running: boolean }> {
    if (USE_MOCK) return { running: false }
    return nativeFloating!.stop()
  },
  async isRunning(): Promise<{ running: boolean }> {
    if (USE_MOCK) return { running: false }
    return nativeFloating!.isRunning()
  },
  async openSettings(): Promise<void> {
    if (USE_MOCK) return
    return nativeFloating!.openSettings()
  }
}

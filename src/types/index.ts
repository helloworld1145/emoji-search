/** 单条表情包记录 */
export interface EmojiRecord {
  id: string
  /** 原图绝对路径 */
  path: string
  /** 缩略图缓存路径（file:// URI） */
  thumbPath: string
  /** image/png / image/jpeg / image/gif 等 */
  mimeType: string
  /** 文件字节大小 */
  size: number
  width: number
  height: number
  isGif: boolean
  /** OCR 识别出的图片文字 */
  ocrText: string
  /**
   * 统一中文标签（AI 情感 + AI 物体 + 用户自定义）。
   * 情感与物体标签由 scanner.ts 在识别入口转中文后合并写入本列。
   */
  tags: string[]
  /** 是否在总收藏中 */
  isFavorite: boolean
  /** 文件修改时间（毫秒），增量扫描比对用 */
  mtime: number
  createdAt: number
  updatedAt: number
  /** 软删除时间戳（0=未删除，>0=已移入回收站；仅 App 内隐藏，不删源文件） */
  deletedAt: number
}

/** 收藏夹 */
export interface Collection {
  id: string
  name: string
  /** true 表示"总收藏" */
  isDefault: boolean
  createdAt: number
  emojiCount?: number
  coverThumb?: string
}

/** 扫描进度回调载荷 */
export interface ScanProgress {
  phase: 'idle' | 'scanning' | 'recognizing' | 'done' | 'error'
  total: number
  processed: number
  currentPath?: string
  message?: string
}

/** 设备端 AI 原始识别结果（ emotions 为英文 key，前端转中文标签后入 tags 列） */
export interface AiResult {
  ocrText: string
  labels: string[]
  emotions: string[]
}

/** 原生 scanFolder 返回的单条文件元数据 */
export interface NativeScanItem {
  path: string
  name: string
  size: number
  mime: string
  mtime: number
  width: number
  height: number
  isGif: boolean
  thumbPath: string
}

/** 调起系统目录选择器后返回的已选文件夹 */
export interface OpenFolderResult {
  treeUri: string
  name: string
}

/** 用户已保存（持久化）的文件夹 */
export interface SavedFolder {
  treeUri: string
  name: string
}

/** 扫描单个文件夹的返回 */
export interface FolderScanResult {
  items: NativeScanItem[]
  total: number
  hasMore: boolean
  folderName: string
}

/** 单条 AI 识别结果 */
export interface RecognizeItem {
  path: string
  ocrText: string
  emotions: string[]
  labels: string[]
}

/** 监听器句柄 */
export interface ListenerHandle {
  remove: () => void
}

/** EmojiScanner 原生插件接口（Web 端由 Mock 实现同等签名） */
export interface EmojiScannerPlugin {
  recognizeBatch(options: {
    paths: string[]
    withOcr?: boolean
    withLabels?: boolean
  }): Promise<{ results: RecognizeItem[] }>
  cancelScan(): Promise<void>
  prepareForShare(options: { path: string }): Promise<{ uri: string }>
  addListener(
    eventName: 'scanProgress',
    listener: (data: ScanProgress) => void
  ): Promise<ListenerHandle>
  /** 调起系统目录选择器，让用户手动挑选一个文件夹 */
  openFolderPicker(): Promise<OpenFolderResult>
  /** 返回用户已保存的全部文件夹 */
  listFolders(): Promise<{ folders: SavedFolder[] }>
  /** 移除一个已保存的文件夹 */
  removeFolder(options: { treeUri: string }): Promise<void>
  /** 扫描某个已授权文件夹（分页） */
  scanFolder(options: {
    treeUri: string
    offset?: number
    limit?: number
    withThumbnails?: boolean
  }): Promise<FolderScanResult>
  /**
   * 把 content:// 或 file:// 路径转为可加载的 file:// URL（content:// 经缓存拷贝）。
   * 源文件已删除 / 授权失效时返回 { url: '', missing: true }，前端应展示占位图，
   * 不得把无效 content:// 交给 WebView（会触发本地服务器打开不存在文档而闪退）。
   */
  getViewableUrl(options: { path: string }): Promise<{ url: string; missing?: boolean }>
  /** 直接拉起微信/QQ 转发界面（跳过系统面板），target='system' 走原系统面板兜底 */
  shareTo(options: {
    path: string
    target: 'wechat' | 'qq' | 'system'
  }): Promise<{ launched: boolean; reason?: 'NOT_INSTALLED' | 'LAUNCH_FAILED' | string }>
}

/** 悬浮窗控制插件（系统悬浮球快速发图） */
export interface FloatingWindowPlugin {
  /** 启动悬浮窗（未授权会 reject NO_OVERLAY_PERMISSION） */
  start(): Promise<{ running: boolean }>
  /** 停止悬浮窗 */
  stop(): Promise<{ running: boolean }>
  /** 当前是否运行中 */
  isRunning(): Promise<{ running: boolean }>
  /** 跳转系统悬浮窗权限设置页 */
  openSettings(): Promise<void>
}

/**
 * 浏览器调试用的 Mock 数据生成器。
 * 生成带头图（SVG data URI）的假表情文件，模拟真实扫描与 AI 识别结果。
 */

import type { ScanProgress, SavedFolder } from '../types'

type ProgressCallback = (state: ScanProgress) => void

const progressListeners = new Set<ProgressCallback>()

/** 订阅 Mock 进度事件（供 scanner.ts 的 onProgress 使用） */
export function onMockProgress(cb: ProgressCallback): () => void {
  progressListeners.add(cb)
  return () => {
    progressListeners.delete(cb)
  }
}

/** 触发 Mock 进度事件 */
export function emitMockProgress(state: ScanProgress): void {
  progressListeners.forEach((cb) => cb(state))
}

/** 生成一张带头像 emoji 与文字的静态 SVG data URI 图（缩略图用） */
function makeThumb(
  emoji: string,
  text: string,
  seed: number,
  size = 300
): string {
  const hue = (seed * 47) % 360
  const bg1 = `hsl(${hue}, 85%, 88%)`
  const bg2 = `hsl(${(hue + 40) % 360}, 90%, 78%)`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 300 300">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/>
  </linearGradient></defs>
  <rect width="300" height="300" fill="url(#g)"/>
  <text x="150" y="140" font-size="110" text-anchor="middle">${emoji}</text>
  <text x="150" y="230" font-size="30" font-weight="bold" fill="#1F2933" text-anchor="middle">${text}</text>
  <text x="150" y="270" font-size="18" fill="#6B7280" text-anchor="middle">mock-${seed}</text>
</svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

/**
 * 生成一张会动的 SVG data URI（仅供 Web 调试 GIF 播放演示）。
 * SMIL 动画在 Chromium 的 <img> 中可自动播放；背景色循环 + 表情旋转营造动效。
 * 内嵌 <desc>mock_emoji_NNN</desc> 以便 mockRecognize / prepareForShare 仍能解析索引。
 */
function makeAnimatedSvg(
  emoji: string,
  text: string,
  seed: number,
  index: number,
  size = 300
): string {
  const hue = (seed * 47) % 360
  const c1 = `hsl(${hue}, 85%, 88%)`
  const c2 = `hsl(${(hue + 60) % 360}, 90%, 80%)`
  const c3 = `hsl(${(hue + 120) % 360}, 85%, 86%)`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 300 300">
  <desc>mock_emoji_${String(index).padStart(3, '0')}</desc>
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
  </linearGradient></defs>
  <rect width="300" height="300" fill="url(#g)">
    <animate attributeName="fill" values="${c1};${c2};${c3};${c1}" dur="3s" repeatCount="indefinite"/>
  </rect>
  <g transform="translate(150 150)">
    <g>
      <text x="0" y="42" font-size="120" text-anchor="middle">${emoji}</text>
      <animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0" to="360" dur="4s" repeatCount="indefinite"/>
    </g>
  </g>
  <text x="150" y="250" font-size="30" font-weight="bold" fill="#1F2933" text-anchor="middle">${text}</text>
  <text x="150" y="280" font-size="18" fill="#6B7280" text-anchor="middle">mock-${seed}</text>
</svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

interface MockTemplate {
  emoji: string
  texts: string[]
  emotions: string[]
  labels: string[]
}

const TEMPLATES: MockTemplate[] = [
  {
    emoji: '🐱',
    texts: ['早安，打工人！', '摸鱼一时爽', '一直摸鱼一直爽', '今天不加班'],
    emotions: ['happy', 'neutral'],
    labels: ['Cat', 'Animal']
  },
  {
    emoji: '🐶',
    texts: ['我不想上班', '求求你放过我', '已阅，不改了', '在忙'],
    emotions: ['sad', 'fear'],
    labels: ['Dog', 'Animal']
  },
  {
    emoji: '🐼',
    texts: ['你再骂？', '头给你打歪', '已黑化', '别惹我'],
    emotions: ['angry', 'disgust'],
    labels: ['Panda', 'Animal']
  },
  {
    emoji: '🐸',
    texts: ['贴贴', '爱你哟', '么么哒', '抱一下'],
    emotions: ['love', 'happy'],
    labels: ['Frog', 'Animal']
  },
  {
    emoji: '🐰',
    texts: ['啊？', '真的假的？', '我裂开了', '惊了'],
    emotions: ['surprised', 'fear'],
    labels: ['Rabbit', 'Animal']
  },
  {
    emoji: '🐻',
    texts: ['……', '无语', '行吧', '算了'],
    emotions: ['neutral', 'disgust'],
    labels: ['Bear', 'Animal']
  },
  {
    emoji: '🐯',
    texts: ['冲！', '加油干', '搞钱要紧', '卷起来'],
    emotions: ['happy', 'surprise'],
    labels: ['Tiger', 'Animal']
  },
  {
    emoji: '🐷',
    texts: ['饿死了', '干饭去', '火锅约吗', '减肥明天'],
    emotions: ['happy', 'love'],
    labels: ['Pig', 'Food']
  },
  {
    // 非预置英文标签：用于 Web 调试验证「英文标签 → 中文词典」翻译效果
    // （Shoe → 鞋、Clothing → 服装，均直接走 labelDict 翻译入 tags）
    emoji: '👟',
    texts: ['冲冲冲', '快一点', '马上到', '跑路现场'],
    emotions: ['happy', 'fear'],
    labels: ['Shoe', 'Clothing']
  },
  {
    emoji: '☕',
    texts: ['咖啡续命', '再来一杯', '困成狗', '熬夜冠军'],
    emotions: ['sad', 'neutral'],
    labels: ['Coffee', 'Drink']
  }
]

export interface MockFile {
  path: string
  name: string
  size: number
  mime: string
  mtime: number
  width: number
  height: number
  isGif: boolean
  thumbUri: string
}

/** 生成 count 个假表情文件 */
export function generateMockFiles(count = 48): MockFile[] {
  const files: MockFile[] = []
  const now = Date.now()
  const dirs = [
    '/storage/emulated/0/Pictures/Emoji',
    '/storage/emulated/0/Pictures/WeChat',
    '/storage/emulated/0/Download',
    '/storage/emulated/0/DCIM/Screenshots'
  ]
  for (let i = 0; i < count; i++) {
    const tpl = TEMPLATES[i % TEMPLATES.length]
    const text = tpl.texts[Math.floor(i / TEMPLATES.length) % tpl.texts.length]
    const isGif = i % 5 === 0
    const ext = isGif ? 'gif' : 'png'
    // GIF 用会动的 SVG data URI 作为原图（Web 端 <img> 可自动播放，演示 GIF 动效）；
    // 非 GIF 维持原假路径，缩略图统一用静态 SVG。
    const source = isGif
      ? makeAnimatedSvg(tpl.emoji, text, i, i)
      : `${dirs[i % dirs.length]}/mock_emoji_${String(i).padStart(3, '0')}.${ext}`
    files.push({
      path: source,
      name: `mock_emoji_${String(i).padStart(3, '0')}.${ext}`,
      size: 60000 + (i * 7919) % 900000,
      mime: isGif ? 'image/gif' : 'image/png',
      mtime: now - i * 3600_000 * 7,
      width: 300,
      height: 300,
      isGif,
      thumbUri: makeThumb(tpl.emoji, text, i)
    })
  }
  return files
}

/** 模拟一次带进度回调的扫描过程（约 1.2 秒） */
export async function mockScanWithProgress(): Promise<MockFile[]> {
  const files = generateMockFiles(48)
  const total = files.length
  const steps = 8
  for (let s = 1; s <= steps; s++) {
    await new Promise((r) => setTimeout(r, 120))
    emitMockProgress({
      phase: 'scanning',
      total,
      processed: Math.round((s / steps) * total),
      message: '扫描中（Mock）'
    })
  }
  return files
}

/** 与模板对应的假 AI 识别结果 */
export function mockRecognize(
  paths: string[]
): { path: string; ocrText: string; emotions: string[]; labels: string[] }[] {
  return paths.map((p) => {
    const idx = Number((p.match(/mock_emoji_(\d+)/) ?? [])[1] ?? 0)
    const tpl = TEMPLATES[idx % TEMPLATES.length]
    const text = tpl.texts[Math.floor(idx / TEMPLATES.length) % tpl.texts.length]
    const emotions = [tpl.emotions[idx % tpl.emotions.length]]
    if (idx % 7 === 3) emotions.push('neutral')
    return { path: p, ocrText: text, emotions, labels: tpl.labels }
  })
}

// ───────────────────── 手动选择文件夹（Mock） ─────────────────────

/** 已保存的文件夹（内存态，模拟持久化） */
const mockSavedFolders: SavedFolder[] = [
  { treeUri: 'mock-tree://storage/Download/Emoji', name: 'Download/Emoji' },
  { treeUri: 'mock-tree://storage/Pictures/WeChat', name: 'Pictures/WeChat' }
]

/** 调起模拟的目录选择器：随机挑一个示例目录返回 */
export function mockOpenFolderPicker(): { treeUri: string; name: string } {
  const candidates = [
    { treeUri: 'mock-tree://storage/Download/Emoji', name: 'Download/Emoji' },
    { treeUri: 'mock-tree://storage/Pictures/WeChat', name: 'Pictures/WeChat' },
    { treeUri: 'mock-tree://storage/DCIM/Camera', name: 'DCIM/Camera' },
    { treeUri: 'mock-tree://storage/Tencent/QQfile_recv', name: 'Tencent/QQfile_recv' }
  ]
  const pick = candidates[Math.floor(Math.random() * candidates.length)]
  if (!mockSavedFolders.some((f) => f.treeUri === pick.treeUri)) {
    mockSavedFolders.push(pick)
  }
  return pick
}

export function mockListFolders(): SavedFolder[] {
  return mockSavedFolders.slice()
}

export function mockRemoveFolder(treeUri: string): void {
  const i = mockSavedFolders.findIndex((f) => f.treeUri === treeUri)
  if (i >= 0) mockSavedFolders.splice(i, 1)
}

/** Mock：Web 端无 content:// 概念，直接返回原路径（thumbUri 已是 data: URL 可直接加载） */
export function mockGetViewableUrl(path: string): { url: string; missing?: boolean } {
  return { url: path }
}

/** Mock：Web 端无原生分享，直接返回 launched:true，保证浏览器可联调分享菜单 UI */
export function mockShareTo(
  _path: string,
  _target: 'wechat' | 'qq' | 'system'
): Promise<{ launched: boolean; reason?: string }> {
  console.info('[mock] shareTo', _target, _path)
  return Promise.resolve({ launched: true })
}

/** 模拟扫描某个已选文件夹：复用假数据并打上文件夹标记 */
export function mockScanFolder(
  treeUri: string,
  name: string,
  offset = 0,
  limit = 300
): {
  items: MockFile[]
  total: number
  hasMore: boolean
  folderName: string
} {
  const all = generateMockFiles(48).map((f, i) => {
    const ext = f.isGif ? 'gif' : 'png'
    const name = `mock_emoji_${String(i).padStart(3, '0')}.${ext}`
    // GIF 项保留动画 data URI 原图；非 GIF 项按 treeUri 拼出假路径
    const path = f.isGif ? f.path : `${treeUri}/mock_emoji_${String(i).padStart(3, '0')}.${ext}`
    return { ...f, path, name }
  })
  const page = all.slice(offset, offset + limit)
  return {
    items: page,
    total: all.length,
    hasMore: offset + page.length < all.length,
    folderName: name
  }
}

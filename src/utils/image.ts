import { Capacitor } from '@capacitor/core'
import { getViewableUrl } from '../services/nativeBridge'

/**
 * 将原生 file:// 路径转为 WebView 可加载的 URL。
 * 原生端 Capacitor.convertFileSrc 支持「绝对路径」与「file:// URI」两种输入。
 */
export function toImageSrc(path: string): string {
  if (!path) return ''
  if (path.startsWith('http') || path.startsWith('data:')) return path
  try {
    return Capacitor.convertFileSrc(path)
  } catch (e) {
    console.error('convertFileSrc failed', e)
    return path
  }
}

/** content:// → file:// 缓存映射，避免重复拷贝 */
const viewableCache = new Map<string, string>()

/**
 * 异步获取可加载的图片 URL：
 * - http/data 原样返回；
 * - file:// 走 Capacitor.convertFileSrc；
 * - content:// 经原生 getViewableUrl 拷贝到应用缓存后返回 file://（SAF 图片必需）。
 *
 * ⚠️ 源文件已删除 / 授权失效时，原生返回 missing 标记，此时必须返回空串让 UI
 * 展示占位图。切勿回退 convertFileSrc(content://)：那会让 Capacitor WebView
 * 本地服务器去打开一个不存在的 SAF 文档，部分 ROM 的 DocumentsProvider 会抛
 * 非 IOException 的运行时异常，从 shouldInterceptRequest 逃出导致 App 闪退。
 */
export async function toImageSrcAsync(path: string): Promise<string> {
  if (!path) return ''
  if (path.startsWith('http') || path.startsWith('data:')) return path
  if (path.startsWith('content://')) {
    const cached = viewableCache.get(path)
    if (cached) return Capacitor.convertFileSrc(cached)
    try {
      const { url, missing } = await getViewableUrl({ path })
      // 源文件已删除 / 授权失效：不再尝试加载，交由调用方展示占位
      if (missing || !url || url.startsWith('content://')) return ''
      viewableCache.set(path, url)
      return Capacitor.convertFileSrc(url)
    } catch (e) {
      console.error('getViewableUrl failed', e)
      return ''
    }
  }
  return Capacitor.convertFileSrc(path)
}

/** 文件大小格式化 */
export function formatSize(bytes: number): string {
  if (bytes <= 0) return '-'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

/**
 * 解析 GIF 文件头，累加各帧延迟，估算动画总时长（毫秒）。
 *
 * 用途：Android WebView 对较大的 GIF 在播放完一遍后常会停在最后一帧、
 * 不再循环（解码/内存策略所致）。前端据此在动画结束后定时重新加载 GIF，
 * 强制 WebView 从头解码重播。
 *
 * 仅读取文件前 256KB（绝大多数 GIF 的帧控制信息位于此范围）；
 * 不支持 Range 或文件过大时返回 0，调用方回退为固定间隔重播。
 */
export async function parseGifDuration(url: string): Promise<number> {
  if (!url || url.startsWith('data:')) return 0
  try {
    // 先预判体积，避免对超大 GIF 整文件下载占用内存
    try {
      const head = await fetch(url, { method: 'HEAD' })
      const cl = head.headers.get('content-length')
      if (cl && Number(cl) > 300000) return 0
    } catch {
      // 不支持 HEAD 时忽略，继续尝试 Range 请求
    }
    const res = await fetch(url, { headers: { Range: 'bytes=0-262143' } })
    const buf = await res.arrayBuffer()
    if (buf.byteLength > 300000) return 0
    return sumGifDelay(buf)
  } catch {
    return 0
  }
}

/** 从 GIF 字节流累加各帧 delay（单位 1/100 秒 → 返回毫秒） */
function sumGifDelay(buf: ArrayBuffer): number {
  const bytes = new Uint8Array(buf)
  if (bytes.length < 13) return 0
  const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5])
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return 0
  let pos = 13
  const packed = bytes[12]
  if (packed & 0x80) {
    const gctSize = 2 ** ((packed & 0x07) + 1)
    pos += gctSize * 3
  }
  let total = 0
  let frames = 0
  const len = bytes.length
  while (pos < len) {
    const b = bytes[pos]
    if (b === 0x3b) break // 文件结束符
    if (b === 0x21) {
      const label = bytes[pos + 1]
      if (label === 0xf9) {
        // 图形控制扩展：0x21 0xF9 0x04 packed delayLo delayHi transparent 0x00
        const delay = bytes[pos + 4] | (bytes[pos + 5] << 8)
        total += delay <= 1 ? 10 : delay // 0/1 视为 100ms（多数解码器行为）
        frames++
        pos += 2 // 跳到块大小字段
        while (pos < len && bytes[pos] !== 0x00) pos += bytes[pos] + 1
        pos++ // 子块结束符 0x00
      } else {
        pos += 2
        while (pos < len && bytes[pos] !== 0x00) pos += bytes[pos] + 1
        pos++
      }
    } else if (b === 0x2c) {
      // 图像描述符：左2 上2 宽2 高2 packed1
      pos += 9
      const ipacked = bytes[pos - 1]
      if (ipacked & 0x80) {
        const lctSize = 2 ** ((ipacked & 0x07) + 1)
        pos += lctSize * 3
      }
      pos++ // LZW 最小码长
      while (pos < len && bytes[pos] !== 0x00) pos += bytes[pos] + 1
      pos++
    } else {
      pos++
    }
  }
  if (frames === 0) return 0
  return total * 10
}

/** 时间格式化：今天显示时分，本周显示周几，更早显示日期 */
export function formatTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const weekDays = ['日', '一', '二', '三', '四', '五', '六']
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays < 7) return `周${weekDays[d.getDay()]}`
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

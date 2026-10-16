import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { EmojiScanner } from './nativeBridge'

/**
 * 系统分享面板（兜底，保留原有逻辑）：
 * 原生把外部文件拷入应用缓存 → 调起系统分享面板（Share 插件走 FileProvider 授权）。
 */
export async function shareSystem(path: string): Promise<boolean> {
  if (!path) return false
  if (!Capacitor.isNativePlatform()) {
    console.info('[mock] shareSystem', path)
    return true
  }
  try {
    const { uri } = await EmojiScanner.prepareForShare({ path })
    await Share.share({ files: [uri], dialogTitle: '分享表情包' })
    return true
  } catch (e) {
    console.error('shareSystem failed', e)
    return false
  }
}

/** 批量系统分享（多张） */
export async function shareSystemMany(paths: string[]): Promise<boolean> {
  const valid = paths.filter((p) => p)
  if (valid.length === 0) return false
  if (!Capacitor.isNativePlatform()) {
    console.info('[mock] shareSystemMany', valid)
    return true
  }
  try {
    const uris: string[] = []
    for (const path of valid) {
      const { uri } = await EmojiScanner.prepareForShare({ path })
      uris.push(uri)
    }
    await Share.share({ files: uris, dialogTitle: '分享表情包' })
    return true
  } catch (e) {
    console.error('shareSystemMany failed', e)
    return false
  }
}

/**
 * 直接拉起微信转发界面（跳过系统面板）。
 * 未安装微信时回退系统分享并提示；拉起失败由原生侧自动回退。
 */
export async function shareToWechat(
  path: string,
  toast?: (msg: string) => void
): Promise<boolean> {
  if (!path) return false
  if (!Capacitor.isNativePlatform()) {
    console.info('[mock] shareToWechat', path)
    return true
  }
  try {
    const { launched, reason } = await EmojiScanner.shareTo({ path, target: 'wechat' })
    if (launched) return true
    if (reason === 'NOT_INSTALLED') {
      toast?.('未安装微信，已改用系统分享')
      return await shareSystem(path)
    }
    return false
  } catch (e) {
    console.error('shareToWechat failed', e)
    return false
  }
}

/** 直接拉起 QQ 转发界面（跳过系统面板） */
export async function shareToQQ(
  path: string,
  toast?: (msg: string) => void
): Promise<boolean> {
  if (!path) return false
  if (!Capacitor.isNativePlatform()) {
    console.info('[mock] shareToQQ', path)
    return true
  }
  try {
    const { launched, reason } = await EmojiScanner.shareTo({ path, target: 'qq' })
    if (launched) return true
    if (reason === 'NOT_INSTALLED') {
      toast?.('未安装 QQ，已改用系统分享')
      return await shareSystem(path)
    }
    return false
  } catch (e) {
    console.error('shareToQQ failed', e)
    return false
  }
}

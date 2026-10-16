import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import * as collectionRepo from '../db/repositories/collection'
import * as emojiRepo from '../db/repositories/emoji'

interface BackupData {
  version: number
  exportedAt: number
  collections: { name: string; isDefault: boolean; items: string[] }[]
}

/**
 * 导出收藏夹备份：收集夹结构 + 表情文件路径引用（不含图片本身），
 * 写入 Documents 目录并调起系统分享。换机/重装后可参照路径恢复。
 */
export async function exportBackup(): Promise<boolean> {
  try {
    const collections = await collectionRepo.listCollections()
    const data: BackupData = {
      version: 1,
      exportedAt: Date.now(),
      collections: []
    }
    for (const c of collections) {
      const items = await collectionRepo.getCollectionItems(c.id, 10000, 0)
      data.collections.push({
        name: c.name,
        isDefault: c.isDefault,
        items: items.map((i) => i.path)
      })
    }
    const favorites = await emojiRepo.getFavorites(10000, 0)
    const json = JSON.stringify(data, null, 2)
    const date = new Date().toISOString().slice(0, 10)
    const fileName = `emoji-backup-${date}.json`

    const result = await Filesystem.writeFile({
      path: fileName,
      data: json,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true
    })
    await Share.share({
      files: [result.uri],
      dialogTitle: '导出收藏备份'
    })
    return true
  } catch (e) {
    console.error('exportBackup failed', e)
    return false
  }
}

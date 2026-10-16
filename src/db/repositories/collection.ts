import type { Collection, EmojiRecord } from '../../types'
import { query, queryOne, run, uuid, now } from '../database'
import { toRecord, type EmojiRow } from './emoji'
import { buildFuzzyGlob } from '../../utils/confusable'

interface CollectionRow {
  id: string
  name: string
  is_default: number
  created_at: number
}

function toCollection(r: CollectionRow): Collection {
  return {
    id: r.id,
    name: r.name,
    isDefault: !!r.is_default,
    createdAt: r.created_at
  }
}

/** 确保"总收藏"存在（幂等） */
export async function ensureDefaultCollection(): Promise<Collection> {
  const row = await queryOne<CollectionRow>(
    'SELECT * FROM collections WHERE is_default = 1 LIMIT 1'
  )
  if (row) return toCollection(row)
  const id = 'col-favorite'
  await run(
    'INSERT INTO collections (id, name, is_default, created_at) VALUES (?, ?, 1, ?)',
    [id, '我的收藏', now()]
  )
  return { id, name: '我的收藏', isDefault: true, createdAt: now() }
}

export async function listCollections(): Promise<Collection[]> {
  const rows = await query<CollectionRow>(
    'SELECT * FROM collections ORDER BY is_default DESC, created_at DESC'
  )
  return rows.map(toCollection)
}

export async function getCollection(id: string): Promise<Collection | null> {
  const row = await queryOne<CollectionRow>(
    'SELECT * FROM collections WHERE id = ?',
    [id]
  )
  return row ? toCollection(row) : null
}

export async function createCollection(name: string): Promise<Collection> {
  const id = uuid()
  await run('INSERT INTO collections (id, name, is_default, created_at) VALUES (?, ?, 0, ?)', [
    id,
    name,
    now()
  ])
  return { id, name, isDefault: false, createdAt: now() }
}

export async function renameCollection(id: string, name: string): Promise<void> {
  await run('UPDATE collections SET name = ? WHERE id = ?', [name, id])
}

export async function deleteCollection(id: string): Promise<void> {
  await run('DELETE FROM collections WHERE id = ?', [id])
  await run('DELETE FROM collection_items WHERE collection_id = ?', [id])
}

export async function addToCollection(collectionId: string, emojiId: string): Promise<void> {
  await run(
    `INSERT OR IGNORE INTO collection_items (collection_id, emoji_id, position)
     VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM collection_items WHERE collection_id = ?))`,
    [collectionId, emojiId, collectionId]
  )
}

export async function removeFromCollection(collectionId: string, emojiId: string): Promise<void> {
  await run('DELETE FROM collection_items WHERE collection_id = ? AND emoji_id = ?', [
    collectionId,
    emojiId
  ])
}

export async function isInCollection(collectionId: string, emojiId: string): Promise<boolean> {
  const row = await queryOne(
    'SELECT 1 AS x FROM collection_items WHERE collection_id = ? AND emoji_id = ?',
    [collectionId, emojiId]
  )
  return row !== null
}

export async function getCollectionItems(
  collectionId: string,
  limit = 60,
  offset = 0
): Promise<EmojiRecord[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT e.* FROM emojis e
     JOIN collection_items ci ON ci.emoji_id = e.id
     WHERE ci.collection_id = ? AND e.deleted_at = 0
     ORDER BY e.is_favorite DESC, ci.position DESC LIMIT ? OFFSET ?`,
    [collectionId, limit, offset]
  )
  return rows.map((r) => ({
    id: r.id as string,
    path: r.path as string,
    thumbPath: (r.thumb_path as string) ?? '',
    mimeType: (r.mime_type as string) ?? 'image/*',
    size: (r.size as number) ?? 0,
    width: (r.width as number) ?? 0,
    height: (r.height as number) ?? 0,
    isGif: !!(r.is_gif as number),
    ocrText: (r.ocr_text as string) ?? '',
    tags: splitList(r.tags as string),
    isFavorite: !!(r.is_favorite as number),
    mtime: (r.mtime as number) ?? 0,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    deletedAt: (r.deleted_at as number) ?? 0
  }))
}

/** 收藏夹数量与封面缩略图 */
export async function getCollectionStats(
  id: string
): Promise<{ count: number; coverThumb: string }> {
  const row = await queryOne<{ c: number; cover: string | null }>(
    `SELECT COUNT(*) AS c,
      (SELECT e.thumb_path FROM collection_items ci
       JOIN emojis e ON e.id = ci.emoji_id
       WHERE ci.collection_id = ? AND e.deleted_at = 0 ORDER BY ci.position DESC LIMIT 1) AS cover
     FROM collection_items ci2
     JOIN emojis e2 ON e2.id = ci2.emoji_id
     WHERE ci2.collection_id = ? AND e2.deleted_at = 0`,
    [id, id]
  )
  return { count: row?.c ?? 0, coverThumb: row?.cover ?? '' }
}

/** 表情所属的收藏夹 id 列表 */
export async function getEmojiCollectionIds(emojiId: string): Promise<string[]> {
  const rows = await query<{ collection_id: string }>(
    'SELECT collection_id FROM collection_items WHERE emoji_id = ?',
    [emojiId]
  )
  return rows.map((r) => r.collection_id)
}

/**
 * 按收藏夹名称搜索：返回名称匹配的收藏夹内的表情。
 * 主匹配用 LIKE（精确），含易混淆字时额外用 GLOB 做近似匹配（同音/形近容错），二者取并集。
 * DISTINCT 去重（同一表情在多个命中收藏夹只出现一次）；统一过滤已软删表情。
 */
export async function searchEmojisByCollectionName(
  keyword: string,
  limit = 120
): Promise<EmojiRecord[]> {
  const kw = keyword.trim()
  if (!kw) return []
  const like = `%${kw}%`
  const glob = buildFuzzyGlob(kw)
  let sql =
    `SELECT DISTINCT e.* FROM emojis e\n` +
    `JOIN collection_items ci ON ci.emoji_id = e.id\n` +
    `JOIN collections c ON c.id = ci.collection_id\n` +
    `WHERE (c.name LIKE ?`
  const values: unknown[] = [like]
  if (glob) {
    sql += ` OR c.name GLOB ?`
    values.push(glob)
  }
  sql += `) AND e.deleted_at = 0\nORDER BY e.updated_at DESC LIMIT ?`
  values.push(limit)
  const rows = await query<EmojiRow>(sql, values)
  return rows.map(toRecord)
}

function splitList(s: string | null): string[] {
  if (!s) return []
  return s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
}

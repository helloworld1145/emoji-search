import type { EmojiRecord } from '../../types'
import { query, queryOne, run, executeBatch, now } from '../database'
import { EMOTION_LABELS, translateLabel } from '../labelDict'
import { ensureDefaultCollection } from './collection'
import { buildFuzzyGlob } from '../../utils/confusable'

/**
 * 把 AI 返回的英文物体标签列表映射成中文。
 * 统一走 labelDict 的静态词典（大小写不敏感、单复数兜底），
 * 未收录标签保留原文；去重后返回。
 */
export function mapLabelsToChinese(labels: string[]): string[] {
  const out: string[] = []
  for (const l of labels) {
    const cn = translateLabel(l)
    if (!cn) continue
    if (!out.includes(cn)) out.push(cn)
  }
  return out
}

/**
 * 把 AI 返回的情感英文 key（happy/sad/…）映射成中文标签。
 * neutral（中性）视为无情感信号，不生成标签；去重后返回。
 * 结果与 mapLabelsToChinese 的输出一起写入 emojis.tags 单列。
 */
export function mapEmotionsToChinese(emotions: string[]): string[] {
  const out: string[] = []
  for (const e of emotions) {
    if (!e || e === 'neutral') continue
    const cn = EMOTION_LABELS[e]
    if (cn && !out.includes(cn)) out.push(cn)
  }
  return out
}

export interface EmojiRow {
  id: string
  path: string
  thumb_path: string | null
  mime_type: string | null
  size: number
  width: number
  height: number
  is_gif: number
  ocr_text: string | null
  tags: string | null
  is_favorite: number
  recognized: number
  mtime: number
  created_at: number
  updated_at: number
  deleted_at: number
}

export function toRecord(r: EmojiRow): EmojiRecord {
  return {
    id: r.id,
    path: r.path,
    thumbPath: r.thumb_path ?? '',
    mimeType: r.mime_type ?? 'image/*',
    size: r.size ?? 0,
    width: r.width ?? 0,
    height: r.height ?? 0,
    isGif: !!r.is_gif,
    ocrText: r.ocr_text ?? '',
    tags: splitList(r.tags),
    isFavorite: !!r.is_favorite,
    mtime: r.mtime ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? 0
  }
}

export function splitList(s: string | null): string[] {
  if (!s) return []
  return s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
}

function joinList(list: string[]): string {
  return list.join(',')
}

/** SQL 字符串字面量转义 */
function esc(s: string): string {
  return String(s ?? '').replace(/'/g, "''")
}

/** 单条插入或更新（先 UPDATE 后 INSERT OR IGNORE，兼容旧版 SQLite 语法） */
export async function upsertEmoji(record: EmojiRecord): Promise<void> {
  const ts = now()
  await run(
    `UPDATE emojis SET
       thumb_path = ?, mime_type = ?, size = ?, width = ?, height = ?,
       is_gif = ?, mtime = ?, updated_at = ?
     WHERE path = ?`,
    [
      record.thumbPath,
      record.mimeType,
      record.size,
      record.width,
      record.height,
      record.isGif ? 1 : 0,
      record.mtime ?? 0,
      ts,
      record.path
    ]
  )
  await run(
    `INSERT OR IGNORE INTO emojis (id, path, thumb_path, mime_type, size, width, height, is_gif,
       ocr_text, tags, is_favorite, recognized, mtime, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      record.id,
      record.path,
      record.thumbPath,
      record.mimeType,
      record.size,
      record.width,
      record.height,
      record.isGif ? 1 : 0,
      record.ocrText,
      joinList(record.tags),
      record.isFavorite ? 1 : 0,
      record.mtime ?? 0,
      record.createdAt || ts,
      ts
    ]
  )
}

/** 批量插入（仅元数据，未识别；已存在的路径跳过，不覆盖用户数据） */
export async function upsertEmojisBatch(records: EmojiRecord[]): Promise<void> {
  if (records.length === 0) return
  const statements: string[] = []
  const ts = now()
  for (const r of records) {
    statements.push(
      `INSERT OR IGNORE INTO emojis (id, path, thumb_path, mime_type, size, width, height, is_gif,
         ocr_text, tags, is_favorite, recognized, mtime, created_at, updated_at)
       VALUES ('${esc(r.id)}', '${esc(r.path)}', '${esc(r.thumbPath)}', '${esc(r.mimeType)}',
         ${r.size}, ${r.width}, ${r.height}, ${r.isGif ? 1 : 0}, '', '', ${r.isFavorite ? 1 : 0},
         0, ${r.mtime ?? 0}, ${ts}, ${ts})`
    )
  }
  await executeBatch(statements)
}

export async function getById(id: string): Promise<EmojiRecord | null> {
  const row = await queryOne<EmojiRow>('SELECT * FROM emojis WHERE id = ?', [id])
  return row ? toRecord(row) : null
}

export async function getByPath(path: string): Promise<EmojiRecord | null> {
  const row = await queryOne<EmojiRow>('SELECT * FROM emojis WHERE path = ?', [path])
  return row ? toRecord(row) : null
}

/** 批量刷新已存在表情的缩略图路径（重新扫描时使用，避免缩略图缓存失效后无法加载）。
 *  仅更新 thumb_path，不触碰 ocr_text / tags / 收藏等用户数据。 */
export async function updateThumbPaths(
  updates: { path: string; thumbPath: string }[]
): Promise<void> {
  if (updates.length === 0) return
  const statements: string[] = []
  const ts = now()
  for (const u of updates) {
    statements.push(
      `UPDATE emojis SET thumb_path = '${esc(u.thumbPath)}', updated_at = ${ts} WHERE path = '${esc(u.path)}'`
    )
  }
  await executeBatch(statements)
}

/** 全量 path → mtime 映射，用于增量扫描比对 */
export async function getPathMtimeMap(): Promise<Map<string, number>> {
  const rows = await query<{ path: string; mtime: number }>(
    'SELECT path, mtime FROM emojis'
  )
  const map = new Map<string, number>()
  for (const r of rows) map.set(r.path, r.mtime)
  return map
}

/** 待识别队列（未识别且失败次数少于 3；排除已删除） */
export async function getPendingRecognize(limit: number): Promise<EmojiRecord[]> {
  const rows = await query<EmojiRow>(
    'SELECT * FROM emojis WHERE recognized = 0 AND fail_count < 3 AND deleted_at = 0 ORDER BY created_at ASC LIMIT ?',
    [limit]
  )
  return rows.map(toRecord)
}

export async function countPendingRecognize(): Promise<number> {
  const row = await queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM emojis WHERE recognized = 0 AND fail_count < 3 AND deleted_at = 0'
  )
  return row?.c ?? 0
}

/** 写入 AI 识别结果（保留用户手动修改的 tags，仅填充空值） */
export async function applyAiResult(
  id: string,
  result: { ocrText: string; tags: string[] }
): Promise<void> {
  await run(
    `UPDATE emojis SET
       ocr_text = CASE WHEN ocr_text = '' THEN ? ELSE ocr_text END,
       tags = CASE WHEN tags = '' THEN ? ELSE tags END,
       recognized = 1,
       fail_count = 0,
       updated_at = ?
     WHERE id = ?`,
    [result.ocrText, joinList(result.tags), now(), id]
  )
}

export async function markRecognizeFailed(id: string): Promise<void> {
  await run('UPDATE emojis SET fail_count = fail_count + 1 WHERE id = ?', [id])
}

/**
 * 重置「已失败退出识别队列」的记录（recognized=0 且 fail_count>=3），
 * 让它们重新进入待识别队列。返回重置条数。
 * 不动已识别成功与用户手改过的数据（applyAiResult 只填空值，双保险）。
 */
export async function resetFailedRecognition(): Promise<number> {
  const res = await run(
    'UPDATE emojis SET recognized = 0, fail_count = 0 WHERE recognized = 0 AND fail_count >= 3'
  )
  return res ?? 0
}

/** 用户手动修正标签/文字 */
export async function updateUserTags(
  id: string,
  data: { ocrText?: string; tags?: string[] }
): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = []
  if (data.ocrText !== undefined) {
    sets.push('ocr_text = ?')
    values.push(data.ocrText)
  }
  if (data.tags !== undefined) {
    sets.push('tags = ?')
    values.push(joinList(data.tags))
  }
  if (sets.length === 0) return
  sets.push('updated_at = ?')
  values.push(now())
  values.push(id)
  await run(`UPDATE emojis SET ${sets.join(', ')} WHERE id = ?`, values)
}

export async function toggleFavorite(id: string): Promise<boolean> {
  const row = await queryOne<{ is_favorite: number }>(
    'SELECT is_favorite FROM emojis WHERE id = ?',
    [id]
  )
  const next = row && row.is_favorite ? 0 : 1
  await run('UPDATE emojis SET is_favorite = ?, updated_at = ? WHERE id = ?', [next, now(), id])
  // 与「我的收藏」总收藏夹（默认收藏夹 col-favorite）保持一致：
  // 星标即加入总收藏夹，取消星标即从总收藏夹移除
  const favoriteId = (await ensureDefaultCollection()).id
  if (next === 1) {
    await run(
      `INSERT OR IGNORE INTO collection_items (collection_id, emoji_id, position)
       VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM collection_items WHERE collection_id = ?))`,
      [favoriteId, id, favoriteId]
    )
  } else {
    await run('DELETE FROM collection_items WHERE collection_id = ? AND emoji_id = ?', [
      favoriteId,
      id
    ])
  }
  return next === 1
}

export async function setFavorite(id: string, value: boolean): Promise<void> {
  await run('UPDATE emojis SET is_favorite = ?, updated_at = ? WHERE id = ?', [
    value ? 1 : 0,
    now(),
    id
  ])
}

export async function getFavorites(limit = 60, offset = 0): Promise<EmojiRecord[]> {
  const rows = await query<EmojiRow>(
    'SELECT * FROM emojis WHERE is_favorite = 1 AND deleted_at = 0 ORDER BY updated_at DESC LIMIT ? OFFSET ?',
    [limit, offset]
  )
  return rows.map(toRecord)
}

export async function getRecent(limit = 60, offset = 0): Promise<EmojiRecord[]> {
  const rows = await query<EmojiRow>(
    'SELECT * FROM emojis WHERE deleted_at = 0 ORDER BY is_favorite DESC, created_at DESC LIMIT ? OFFSET ?',
    [limit, offset]
  )
  return rows.map(toRecord)
}

/**
 * 记录一次表情发送（分享），用于沉淀"最近发送"。
 * 兼容老版本 SQLite（不支持 UPSERT）：先 INSERT OR IGNORE 再 UPDATE sent_at。
 */
export async function recordSend(id: string): Promise<void> {
  const ts = now()
  await run('INSERT OR IGNORE INTO recent_sends (emoji_id, sent_at) VALUES (?, ?)', [id, ts])
  await run('UPDATE recent_sends SET sent_at = ? WHERE emoji_id = ?', [ts, id])
}

/**
 * 搜索：文字关键词匹配 OCR 文本与标签。
 * 主匹配用 LIKE（精确）；当关键词含易混淆字时，额外用 GLOB 字符类做
 * 近似匹配（同音/形近错别字容错，如搜「我等者」可命中 OCR 结果「我等着」），
 * 二者取并集。模糊分支仅在确有可扩展字时才加入，普通查询行为不变。
 * 情感中文名（开心/悲伤…）与物体/自定义标签同存于 tags 列，直接命中。
 */
export async function search(params: {
  keyword?: string
  limit?: number
  offset?: number
}): Promise<EmojiRecord[]> {
  const kw = params.keyword?.trim()
  if (!kw) return []
  const like = `%${kw}%`
  const glob = buildFuzzyGlob(kw)
  let sql =
    `SELECT * FROM emojis\n` +
    `WHERE deleted_at = 0 AND (ocr_text LIKE ? OR tags LIKE ?`
  const values: unknown[] = [like, like]
  if (glob) {
    sql += ` OR COALESCE(ocr_text, '') GLOB ? OR COALESCE(tags, '') GLOB ?`
    values.push(glob, glob)
  }
  sql += `)\nORDER BY is_favorite DESC, updated_at DESC LIMIT ? OFFSET ?`
  values.push(params.limit ?? 60, params.offset ?? 0)
  const rows = await query<EmojiRow>(sql, values)
  return rows.map(toRecord)
}

/** 有效表情总数（不含已删除） */
export async function countAll(): Promise<number> {
  const row = await queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM emojis WHERE deleted_at = 0'
  )
  return row?.c ?? 0
}

export async function deleteById(id: string): Promise<void> {
  await run('DELETE FROM emojis WHERE id = ?', [id])
  await run('DELETE FROM collection_items WHERE emoji_id = ?', [id])
}

/** IN 占位符（参数化查询，避免手写转义） */
function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(',')
}

/**
 * 软删除：把表情移入「回收站」（仅 App 内隐藏，不删手机源文件）。
 * 单条 UPDATE 批量完成，保留 OCR/标签/收藏关联，恢复时零成本还原。
 */
export async function softDelete(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await run(
    `UPDATE emojis SET deleted_at = ?, updated_at = ? WHERE id IN (${placeholders(ids.length)})`,
    [now(), now(), ...ids]
  )
}

/** 从回收站恢复：清零删除标记，表情重新出现在各列表/搜索中 */
export async function restoreEmojis(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await run(
    `UPDATE emojis SET deleted_at = 0, updated_at = ? WHERE id IN (${placeholders(ids.length)})`,
    [now(), ...ids]
  )
}

/** 回收站列表（按删除时间倒序） */
export async function getDeleted(limit = 60, offset = 0): Promise<EmojiRecord[]> {
  const rows = await query<EmojiRow>(
    'SELECT * FROM emojis WHERE deleted_at > 0 ORDER BY deleted_at DESC LIMIT ? OFFSET ?',
    [limit, offset]
  )
  return rows.map(toRecord)
}

/** 回收站数量（首页角标用） */
export async function countDeleted(): Promise<number> {
  const row = await queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM emojis WHERE deleted_at > 0'
  )
  return row?.c ?? 0
}

/**
 * 彻底删除：移除数据库记录并清理收藏关联。
 * 注意：仍不删除手机上的源文件，用户重新扫描同一文件夹会再次入库。
 */
export async function purgeEmojis(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const inClause = `IN (${placeholders(ids.length)})`
  await run(`DELETE FROM emojis WHERE id ${inClause}`, ids)
  await run(`DELETE FROM collection_items WHERE emoji_id ${inClause}`, ids)
}

/** 清空回收站：彻底删除全部已删除表情 */
export async function purgeAllDeleted(): Promise<void> {
  const rows = await query<{ id: string }>('SELECT id FROM emojis WHERE deleted_at > 0')
  await purgeEmojis(rows.map((r) => r.id))
}

/** 清理已从设备删除的文件记录 */
export async function deletePathsNotIn(paths: string[]): Promise<number> {
  const existing = new Set(paths)
  const rows = await query<{ id: string; path: string }>('SELECT id, path FROM emojis')
  let removed = 0
  for (const r of rows) {
    if (!existing.has(r.path)) {
      await deleteById(r.id)
      removed++
    }
  }
  return removed
}

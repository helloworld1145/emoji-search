import { query, run, now } from '../database'

interface HistoryRow {
  id: number
  keyword: string
  created_at: number
}

/** 记录搜索关键词（去重，保留最近 20 条） */
export async function addSearchHistory(keyword: string): Promise<void> {
  const kw = keyword.trim()
  if (!kw) return
  await run('DELETE FROM search_history WHERE keyword = ?', [kw])
  await run('INSERT INTO search_history (keyword, created_at) VALUES (?, ?)', [kw, now()])
  const rows = await query<{ id: number }>(
    'SELECT id FROM search_history ORDER BY created_at DESC LIMIT 20 OFFSET 20'
  )
  for (const r of rows) {
    await run('DELETE FROM search_history WHERE id = ?', [r.id])
  }
}

export async function getRecentSearches(limit = 10): Promise<string[]> {
  const rows = await query<HistoryRow>(
    'SELECT keyword FROM search_history ORDER BY created_at DESC LIMIT ?',
    [limit]
  )
  return rows.map((r) => r.keyword)
}

export async function clearSearchHistory(): Promise<void> {
  await run('DELETE FROM search_history')
}

import { Capacitor } from '@capacitor/core'
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection
} from '@capacitor-community/sqlite'
import schema from './schema.sql?raw'
import { EMOTION_LABELS, LABEL_DICT_VERSION, translateLabel } from './labelDict'

const DB_NAME = 'emoji_ai'

let connection: SQLiteConnection | null = null
let db: SQLiteDBConnection | null = null
let initPromise: Promise<SQLiteDBConnection> | null = null

/** 初始化数据库（幂等）；Web 模式下自动注入 jeep-sqlite 元素 */
export async function initDatabase(): Promise<SQLiteDBConnection> {
  if (db) return db
  if (initPromise) return initPromise

  initPromise = (async () => {
    connection = new SQLiteConnection(CapacitorSQLite)
    if (!Capacitor.isNativePlatform()) {
      await ensureJeepSqliteElement()
      await connection.initWebStore()
    }
    const conn = await connection.createConnection(
      DB_NAME,
      false,
      'no-encryption',
      1,
      false
    )
    await conn.open()
    await initSchema(conn)
    await ensureDeletedAtColumn(conn)
    await ensureRecentSendsTable(conn)
    await migrateTagsToChinese(conn)
    await migrateToTagOnlyModel(conn)
    db = conn
    return conn
  })()

  return initPromise
}

/**
 * 建表（幂等）。
 *
 * ⚠️ 不能直接 conn.execute(整份 schema)：原生 @capacitor-community/sqlite 的 execute
 * 内部按 ";\n"（LF）拆分语句，而 schema.sql 为 CRLF 行尾时拆分失效，整份被当作
 * 一条语句交给 Android execSQL，只建成第一张表（emojis），categories 等全部缺失
 * （真机报 no such table: categories；Web 端 jeep-sqlite 能完整执行故不易发现）。
 *
 * 这里在 JS 侧按 ";" 拆分并剥离行注释后逐条 run()，与文件行尾无关，稳。
 */
async function initSchema(conn: SQLiteDBConnection): Promise<void> {
  const statements = schema
    .split(';')
    .map((block) =>
      block
        .split('\n')
        .map((line) => {
          const idx = line.indexOf('--')
          return (idx >= 0 ? line.slice(0, idx) : line).trim()
        })
        .filter((line) => line.length > 0)
        .join(' ')
    )
    .filter((stmt) => stmt.length > 0)
  for (const stmt of statements) {
    await conn.run(stmt)
  }
}

/**
 * 软删除列迁移（幂等）。
 *
 * schema.sql 用 CREATE TABLE IF NOT EXISTS，旧库不会自动获得新增的
 * deleted_at 列（真机旧库启动后读该列会报 no such column）。
 * 这里用 PRAGMA table_info 判断列存在性后按需 ALTER TABLE；
 * DEFAULT 0 会回填旧库已有行为 0（未删除），与新建库一致。
 */
async function ensureDeletedAtColumn(conn: SQLiteDBConnection): Promise<void> {
  const cols = await conn.query('PRAGMA table_info(emojis)')
  const hasColumn = (cols.values ?? []).some(
    (c: { name?: string }) => c.name === 'deleted_at'
  )
  if (hasColumn) return
  await conn.run('ALTER TABLE emojis ADD COLUMN deleted_at INTEGER DEFAULT 0')
  await conn.run('CREATE INDEX IF NOT EXISTS idx_emojis_deleted ON emojis(deleted_at)')
  }

  /**
  * 最近发送表迁移（幂等）。
  *
  * recent_sends 是新表（非新增列），schema.sql 的 IF NOT EXISTS 在每次启动
  * 重跑建表语句时即会创建；这里再用 sqlite_master 守卫做一次显式检查，
  * 与 ensureDeletedAtColumn 风格一致，作为双保险，确保旧库升级后该表一定存在。
  */
  async function ensureRecentSendsTable(conn: SQLiteDBConnection): Promise<void> {
  const res = await conn.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'recent_sends'"
  )
  const exists = (res.values ?? []).some(
    (r: { name?: string }) => r.name === 'recent_sends'
  )
  if (exists) return
  await conn.run(
    'CREATE TABLE IF NOT EXISTS recent_sends (emoji_id TEXT PRIMARY KEY, sent_at INTEGER DEFAULT 0)'
  )
  await conn.run('CREATE INDEX IF NOT EXISTS idx_recent_sends_time ON recent_sends(sent_at DESC)')
  }

/**
 * 历史英文标签 → 中文 一次性迁移（幂等，按词典版本触发）。
 *
 * 背景：早期版本 mapLabelsToChinese 词典很小，ML Kit 返回的英文标签
 * （如 Shoe/Sky）大量原样入库。这里在启动时把所有 emojis.tags 过一遍
 * translateLabel，命中词典的英文标签替换为中文，让存量数据也统一中文、
 * 可被中文关键词 LIKE 搜索命中。
 *
 * 实现要点：
 * - 用 app_meta 记录已迁移的 LABEL_DICT_VERSION，版本一致则跳过，
 *   避免每次启动全表扫描；词典扩充并提升版本号后会自动重跑。
 * - 只更新 tags 实际发生变化的行；分页查询 + 批量参数化 UPDATE，
 *   千级数据量一次启动内完成。
 * - 这里直接用传入的 conn，不能走 query/run 门面（初始化期间 db 未赋值，
 *   会与 initPromise 形成自等待死锁）。
 */
async function migrateTagsToChinese(conn: SQLiteDBConnection): Promise<void> {
  const version = String(LABEL_DICT_VERSION)
  const done = await conn.query(
    "SELECT value FROM app_meta WHERE key = 'label_dict_version'"
  )
  if ((done.values ?? []).some((r: { value?: string }) => r.value === version)) {
    return
  }

  const PAGE = 500
  let lastId = ''
  let updated = 0
  for (;;) {
    const res = await conn.query(
      "SELECT id, tags FROM emojis WHERE tags != '' AND id > ? ORDER BY id LIMIT ?",
      [lastId, PAGE]
    )
    const rows = (res.values ?? []) as { id: string; tags: string }[]
    if (rows.length === 0) break

    const statements: string[] = []
    for (const row of rows) {
      const original = row.tags ?? ''
      const translated = original
        .split(',')
        .map((t) => translateLabel(t))
        .filter((t) => t.length > 0)
        .join(',')
      if (translated === original) continue
      statements.push(
        `UPDATE emojis SET tags = '${String(translated).replace(/'/g, "''")}' WHERE id = '${String(
          row.id
        ).replace(/'/g, "''")}'`
      )
      updated++
    }
    // 每页一批 execute（UPDATE 不改 id 顺序，keyset 分页稳定）
    for (let i = 0; i < statements.length; i += 200) {
      await conn.execute(statements.slice(i, i + 200).join(';\n'))
    }

    lastId = rows[rows.length - 1].id
    if (rows.length < PAGE) break
  }

  await conn.run(
    "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('label_dict_version', ?)",
    [version]
  )
  if (updated > 0) {
    console.info(`[database] migrateTagsToChinese: translated ${updated} rows (v${version})`)
  }
}

/**
 * 「标签单列化」一次性迁移（幂等，按 app_meta 标记只跑一次）。
 *
 * 背景：更早版本把「分类」（categories/category_items 两表）与「情感」
 * （emojis.emotions 英文 key 列）作为独立概念存储；现统一收敛为
 * 「标签」单列（emojis.tags，全中文）+「收藏夹」两套用户概念。
 *
 * 步骤（新库按新 schema 建表，PRAGMA 守卫后全部跳过；仅老库有数据）：
 * 1. emotions 英文 key 经 EMOTION_LABELS 转中文、去重合并进 tags；
 * 2. DROP 两张分类表（历史分类数据按产品决策直接废弃，不迁移）；
 * 3. try/catch ALTER TABLE DROP COLUMN emotions（SQLite < 3.35 不支持
 *    DROP COLUMN，失败则保留死列——代码已不再引用，无副作用）；
 * 4. app_meta 写标记，后续启动跳过。
 *
 * 实现要点同 migrateTagsToChinese：直接用传入的 conn（初始化期间 db 未
 * 赋值，走 query/run 门面会与 initPromise 自等待死锁）；keyset 分页 +
 * 批量 execute。
 */
async function migrateToTagOnlyModel(conn: SQLiteDBConnection): Promise<void> {
  const FLAG = 'tag_only_model_v1'
  const done = await conn.query('SELECT value FROM app_meta WHERE key = ?', [FLAG])
  if ((done.values ?? []).some((r: { value?: string }) => r.value === '1')) return

  // 1) emotions → tags 回填（仅当旧库仍有 emotions 列）
  const cols = await conn.query('PRAGMA table_info(emojis)')
  const hasEmotions = (cols.values ?? []).some(
    (c: { name?: string }) => c.name === 'emotions'
  )
  if (hasEmotions) {
    const PAGE = 500
    let lastId = ''
    let updated = 0
    for (;;) {
      const res = await conn.query(
        "SELECT id, emotions, tags FROM emojis WHERE emotions != '' AND id > ? ORDER BY id LIMIT ?",
        [lastId, PAGE]
      )
      const rows = (res.values ?? []) as { id: string; emotions: string; tags: string }[]
      if (rows.length === 0) break

      const statements: string[] = []
      for (const row of rows) {
        const merged = mergeEmotionsIntoTags(row.emotions, row.tags)
        if (merged === (row.tags ?? '')) continue
        statements.push(
          `UPDATE emojis SET tags = '${merged.replace(/'/g, "''")}' WHERE id = '${String(
            row.id
          ).replace(/'/g, "''")}'`
        )
        updated++
      }
      // 每页一批 execute（UPDATE 不改 id 顺序，keyset 分页稳定）
      for (let i = 0; i < statements.length; i += 200) {
        await conn.execute(statements.slice(i, i + 200).join(';\n'))
      }

      lastId = rows[rows.length - 1].id
      if (rows.length < PAGE) break
    }
    if (updated > 0) {
      console.info(`[database] migrateToTagOnlyModel: merged emotions into tags for ${updated} rows`)
    }
  }

  // 2) 废弃分类表（历史数据不迁移）
  await conn.run('DROP TABLE IF EXISTS category_items')
  await conn.run('DROP TABLE IF EXISTS categories')

  // 3) 尝试删除 emotions 死列（老版本 SQLite 不支持则保留，无副作用）
  if (hasEmotions) {
    try {
      await conn.run('ALTER TABLE emojis DROP COLUMN emotions')
    } catch (e) {
      console.info(
        '[database] migrateToTagOnlyModel: DROP COLUMN emotions unsupported, dead column kept',
        e
      )
    }
  }

  // 4) 记录完成标记
  await conn.run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [FLAG, '1'])
}

/**
 * 把 emotions 列（英文 key 逗号串）转中文名、去重后合并进 tags 串。
 * neutral（中性）不生成标签，与 mapEmotionsToChinese 口径一致。
 */
function mergeEmotionsIntoTags(emotions: string, tags: string): string {
  const out: string[] = tags
    ? tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
    : []
  for (const key of (emotions ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)) {
    if (key === 'neutral') continue
    const cn = EMOTION_LABELS[key]
    if (cn && !out.includes(cn)) out.push(cn)
  }
  return out.join(',')
}

/** Web 模式：注入并注册 jeep-sqlite 自定义元素（SQLite WebAssembly 载体） */
async function ensureJeepSqliteElement(): Promise<void> {
  if (typeof customElements === 'undefined') return
  try {
    if (!customElements.get('jeep-sqlite')) {
      // 动态导入：仅 Web 调试模式加载，Android 原生包不包含此依赖
      const { defineCustomElements } = await import('jeep-sqlite/loader')
      defineCustomElements()
    }
    let el = document.querySelector('jeep-sqlite')
    if (!el) {
      el = document.createElement('jeep-sqlite')
      // wasm 文件位于 public/assets/sql-wasm.wasm，dev 与生产构建均以此为根路径
      el.setAttribute('wasmPath', '/assets')
      // 自动持久化到 IndexedDB，刷新页面后数据不丢失（便于调试）
      el.setAttribute('autoSave', 'true')
      document.body.appendChild(el)
    }
    await Promise.race([
      customElements.whenDefined('jeep-sqlite'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('jeep-sqlite define timeout')), 15000)
      )
    ])
  } catch (e) {
    console.error('ensureJeepSqliteElement failed', e)
    throw e
  }
}

/** 获取数据库实例（未初始化则先初始化） */
export async function getDb(): Promise<SQLiteDBConnection> {
  if (db) return db
  return initDatabase()
}

/** 查询多行 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  values?: unknown[]
): Promise<T[]> {
  const conn = await getDb()
  const res = await conn.query(sql, values ?? [])
  return (res.values ?? []) as T[]
}

/** 查询单行 */
export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  values?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, values)
  return rows.length > 0 ? rows[0] : null
}

/** 执行写操作，返回 changes 行数 */
export async function run(sql: string, values?: unknown[]): Promise<number> {
  const conn = await getDb()
  const res = await conn.run(sql, values ?? [])
  return res.changes?.changes ?? 0
}

/** 批量执行多条语句（单次 execute，减少桥接开销） */
export async function executeBatch(statements: string[]): Promise<void> {
  if (statements.length === 0) return
  const conn = await getDb()
  await conn.execute(statements.join(';\n'))
}

/** 生成 UUID（原生与 Web 一致） */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

/** 当前时间戳（毫秒） */
export function now(): number {
  return Date.now()
}

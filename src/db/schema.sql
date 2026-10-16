-- 表情搜搜 数据库 Schema（SQLite）
-- 说明：不使用 FTS5（Android 系统 SQLite 不保证启用），
-- 搜索改用 LIKE 查询，千级数据量下性能足够。
-- 概念模型：只有两套用户概念——「标签」（emojis.tags，全中文，含 AI 情感/AI 物体/用户自定义）
-- 与「收藏夹」（collections）。早期版本的「分类」表与 emotions 列已废弃并迁移移除。

-- 表情包主表
CREATE TABLE IF NOT EXISTS emojis (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  thumb_path TEXT,
  mime_type TEXT,
  size INTEGER DEFAULT 0,
  width INTEGER DEFAULT 0,
  height INTEGER DEFAULT 0,
  is_gif INTEGER DEFAULT 0,
  ocr_text TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  is_favorite INTEGER DEFAULT 0,
  recognized INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0,
  mtime INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT 0,
  updated_at INTEGER DEFAULT 0,
  deleted_at INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_emojis_favorite ON emojis(is_favorite);
CREATE INDEX IF NOT EXISTS idx_emojis_recognized ON emojis(recognized);
CREATE INDEX IF NOT EXISTS idx_emojis_gif ON emojis(is_gif);
CREATE INDEX IF NOT EXISTS idx_emojis_deleted ON emojis(deleted_at);

-- 收藏夹表：is_default = 1 表示"总收藏"
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_default INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT 0
);

-- 收藏夹成员（多对多，position 保序）
CREATE TABLE IF NOT EXISTS collection_items (
  collection_id TEXT NOT NULL,
  emoji_id TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  PRIMARY KEY (collection_id, emoji_id)
);
CREATE INDEX IF NOT EXISTS idx_collection_items_emoji ON collection_items(emoji_id);

-- 搜索历史
CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  created_at INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_search_history_time ON search_history(created_at DESC);

-- 应用元数据（键值对）：记录一次性迁移的完成版本，如英中标签词典版本
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);

-- 最近发送记录：悬浮窗"最近"快捷区的数据源；每次在悬浮窗/App 内分享表情后写入。
-- 仅记 emoji_id 与最近发送时间，按 sent_at 倒序取最近 N 条。
CREATE TABLE IF NOT EXISTS recent_sends (
  emoji_id TEXT PRIMARY KEY,
  sent_at INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_recent_sends_time ON recent_sends(sent_at DESC);

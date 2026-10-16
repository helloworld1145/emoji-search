---
name: AI情感标签搜索修复
overview: 修复搜索框输入中文情感标签（如“开心”）无法匹配对应表情的问题。根因：search 函数关键词分支只匹配 ocr_text 和 tags，未匹配 emotions 字段，且 emotions 存储的是英文 key 而非中文。修复方式：在 search 中把关键词中的中文情感标签/英文 key 反查为 emotion key，补充 emotions LIKE 匹配条件。
todos:
  - id: fix-emotion-search
    content: 修改 emoji.ts 的 search，补充中文情感反查的 emotions LIKE 条件
    status: completed
  - id: verify-search
    content: 本地校验“开心”等中文情感与英文 key 搜索均命中
    status: completed
    dependencies:
      - fix-emotion-search
---

## 用户需求

搜索表情时，输入 AI 情感标签的中文名（如“开心”“悲伤”）无法搜到对应的表情内容，期望输入情感中文标签即可匹配到该情感的表情。

## 产品概述

表情管理 App 的搜索功能支持按图片文字、标签和情感筛选。当前在搜索框直接输入中文情感名查不到结果，本需求修复该搜索缺陷，使中文情感名能与对应的英文情感 key 正确关联并匹配。

## 核心功能

- 关键词搜索支持中文情感标签（如“开心”）反查到英文情感 key（happy），从而匹配 emotions 字段。
- 保持原有 OCR 文字、通用标签搜索以及情感 chips 筛选（英文 key）行为不变。
- 兼容同时输入中文情感名 + 文字关键词的场景，以及英文 key（如“happy”）作为关键词的场景。

## 技术栈

- 前端：Vue 3 + TypeScript（Vite）
- 数据存储：SQLite（Capacitor 端侧数据库，封装于 src/db）
- 现有搜索入口：src/views/Search.vue → emojiRepo.search()

## 问题根因（已验证）

src/db/repositories/emoji.ts 的 `search` 函数（第 278-306 行）关键词分支仅生成 `(ocr_text LIKE ? OR tags LIKE ?)`，未匹配 `emotions` 字段；且 `emotions` 列存储的是英文 key（由 applyAiResult 第 181-197 行 `joinList(result.emotions)` 写入，如 `happy,love`），而用户搜索框输入的是中文（`EMOTION_LABELS`，如 开心）。

因此“开心”既不在 ocr_text/tags 中，也无法直接匹配英文 key 的 emotions 列，导致无结果。情感 chips 能用是因为它直接传英文 key 走 emotions 分支。

## 实现方案

### 策略

在 `search` 函数内新增“情感中文/英文反查”：对去掉首尾空格后的关键词，遍历 EMOTION_KEYS（排除 neutral），若关键词等于英文 key、或中文 label 包含关键词、或关键词包含中文 label，则收集命中的英文 key。将这些 key 作为额外 `emotions LIKE ?` 子条件，与现有 `ocr_text/tags` 用 OR 连接，整体并入关键词分支；emotions 入参（chips）的 AND 组合保持不变。

### 关键技术决策

- 反查用包含匹配（label.includes(kw) || kw.includes(label) || key===kw）而非仅全等，使“开”“心”等部分输入也能命中，提升容错；排除 neutral 避免“中性”等无意义匹配风暴。
- 不修改数据写入与存储结构，避免做数据迁移，风险最小、向后兼容。
- `emotions` 列以逗号分隔存储（如 `happy,love`），使用 `%key%` LIKE 匹配即可命中；由于 key 均为独立英文单词且短，误匹配概率极低。

### 性能与可靠性

- 反查仅 7 个枚举（排除 neutral）的常数级遍历，零额外 IO，无性能损耗。
- SQL 仍走现有参数化占位符（?），无注入风险；沿用现有 query 封装。
- 命中情感 key 时仅增加一个 LIKE 条件，索引未变，结果集规模与现有搜索同一量级。

## 实现要点（防回归）

- 仅修改 search 函数，保持其余函数（upsertEmoji/applyAiResult/updateUserTags 等）不动。
- 关键词分支生成的子条件形如：
`(ocr_text LIKE ? OR tags LIKE ? OR emotions LIKE ? OR emotions LIKE ? ...)`
其中新增的 emotions 条件值均为 `%<英文key>%`，与 keyword 同值占位。
- 当同时传入 emotions 入参（chips）时，两者以 AND 叠加，符合“文字 + 情感筛选”的预期。
- 复用文件顶部已有 `EMOTION_KEYS` 与 `EMOTION_LABELS`，不重复定义映射。

## 目录结构

```
src/db/repositories/emoji.ts   # [MODIFY] 修改 search 函数：关键词分支增加中文/英文情感反查，将命中英文 key 作为 emotions LIKE 条件以 OR 并入；emotions 入参分支逻辑不变。保持 EMOTION_KEYS/EMOTION_LABELS 复用，参数化防注入，无数据迁移。
```

（其余文件无需改动；Search.vue 调用层保持不变即可生效。）

## 关键代码结构（示意，仅接口级）

```ts
// 在 search 内新增的反查函数（位于 emoji.ts）
function resolveEmotionKeysFromText(text: string): string[] {
  const kw = text.trim().toLowerCase()
  if (!kw) return []
  const keys: string[] = []
  for (const k of EMOTION_KEYS) {
    if (k === 'neutral') continue
    const label = EMOTION_LABELS[k] ?? ''
    if (k === kw || label.includes(text.trim()) || text.trim().includes(label)) {
      keys.push(k)
    }
  }
  return keys
}
```
---
name: favorite-first-ordering
overview: 让带星标（收藏）的表情在所有浏览列表（首页网格、分类详情、收藏夹详情、搜索结果）中排在前面：通过修改 SQL 排序为「星标优先 + 原有次序」，并在首页 store 的收藏切换时做内存重排，保证即时生效。
todos:
  - id: sort-emoji-repo
    content: 修改 src/db/repositories/emoji.ts：getRecent/getByCategory/search 三处排序改为星标优先
    status: completed
  - id: sort-collection-repo
    content: 修改 src/db/repositories/collection.ts：getCollectionItems 排序改为星标优先
    status: completed
  - id: reorder-store
    content: 修改 src/stores/emoji.ts：toggleFavorite 后对已加载 items 按星标优先规则内存重排
    status: completed
    dependencies:
      - sort-emoji-repo
  - id: verify-build
    content: 运行 npm run build 验证类型检查，并回归四个列表星标置顶效果
    status: completed
    dependencies:
      - sort-collection-repo
      - reorder-store
---

## 用户需求

用户原话：「我想要带星标的图片能排在前面」。

已澄清范围：**所有浏览列表（首页网格、分类详情、收藏夹详情、搜索结果）统一星标优先**。

## 功能内容

- 在四个列表的查询排序中增加「星标（`is_favorite`）优先」规则：星标表情排在最前，非星标保持原有相对次序。
- 组内次序保持不变：
- 首页：组内按入库时间倒序（`created_at DESC`）
- 分类详情：组内按入库时间倒序（`created_at DESC`）
- 收藏夹详情：组内按加入收藏夹的位置倒序（`position DESC`）
- 搜索：组内按更新时间倒序（`updated_at DESC`）
- 即时生效：从详情页加/减星标返回首页时，该图片立即在已加载的首页网格中前移/回落，无需重新查库、不重置分页。

## 边界与说明

- 仅改 SQL `ORDER BY` 与内存排序，不动表结构、不加迁移、不改 `deleted_at = 0` 过滤逻辑。
- 分页大小 60 不变；DB 顺序即分页顺序，offset 语义不受影响。
- 回收站等非浏览列表不在本次范围内。

## 技术栈

- 现有栈：Vue 3 + TypeScript + Pinia + `@capacitor-community/sqlite`（SQLite）
- 复用现有 repository/store 分层，不引入新依赖、不改表结构

## 实现方案

核心思路：统一排序规则为「星标优先，组内保持原次序」，在 SQL 层改 `ORDER BY`；同时因首页 store 单例在从详情页返回时不重新查库（`init()` 有 `initialized` 早退守卫），在 `stores/emoji.ts` 的 `toggleFavorite` 中对已加载内存数组做同规则重排，保证即时生效。分类/收藏夹/搜索页在路由跳转后会重新查库，天然获得新顺序。

### 排序规则

| 列表 | 函数 | 新 ORDER BY |
| --- | --- | --- |
| 首页 | `getRecent` | `is_favorite DESC, created_at DESC` |
| 分类详情 | `getByCategory` | `e.is_favorite DESC, e.created_at DESC` |
| 收藏夹详情 | `getCollectionItems` | `e.is_favorite DESC, ci.position DESC` |
| 搜索 | `search` | `is_favorite DESC, updated_at DESC` |


### 关键决策与取舍

- 只改排序不改数据：零迁移、零回刷成本，旧版本升级后无需重建索引。
- 组内保持原次序：用户对现有「最新在前」心智不破坏，星标只做「置顶分组」。
- 内存重排而非重新 `loadGrid(true)`：避免取消/重置分页与滚动位置跳变，且只动 `items.value` 已加载部分，复杂度 O(n log n)，n 为已加载条数（≤ 数百），可忽略。
- 不改 `search` 的 `updated_at` 语义：`toggleFavorite` 本就刷新 `updated_at`，星标置顶与「最近更新在前」语义自洽。

## 架构与模块

数据流：用户点星标（`EmojiDetail.vue`）→ `stores/emoji.ts` 的 `toggleFavorite` → `emojiRepo.toggleFavorite` 写 `is_favorite` + `updated_at` → 内存项更新并按新规则重排 → 各列表下次查询按星标优先返回。

## 目录结构（改动文件）

```
d:/Code/emoji-ai/src/
├── db/repositories/emoji.ts        # [MODIFY] getRecent / getByCategory / search 三处 ORDER BY 增加星标优先
├── db/repositories/collection.ts   # [MODIFY] getCollectionItems 的 ORDER BY 增加 e.is_favorite 优先
└── stores/emoji.ts                 # [MODIFY] toggleFavorite 更新内存项后按「星标优先 + created_at DESC」重排 items
```

## 执行注意

- 改动仅限 `ORDER BY` 与 store 重排，blast radius 小；不要顺手改 `deleted_at` 过滤或字段映射（项目已知坑点：原生字段名差异）。
- 重排只对首页已加载数组生效；分类/收藏夹/搜索页靠重新查库获得新序，无需额外内存排序。
- 完成后跑 `npm run build`（vue-tsc 类型检查）；真机回归验证四个列表与分页连续性。
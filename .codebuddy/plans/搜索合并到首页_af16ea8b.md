---
name: 搜索合并到首页
overview: 将独立的搜索页（/search）功能合并进首页（/home）：底部导航移除「搜索」tab，仅保留「首页」「我的」；在首页"收藏夹快捷入口"区块下方新增搜索框；输入关键词时下方表情网格切换为搜索结果（收藏夹入口仍保留在搜索框上方），无关键词时沿用全部表情网格；保留"最近搜索"历史。删除 Search.vue 及其路由引用，并递增 App 版本号。
todos:
  - id: merge-search-into-home
    content: 将 Search 搜索逻辑迁入 Home：收藏夹下方加搜索框与历史，按关键词切换结果/全部网格
    status: completed
  - id: clean-nav-and-route
    content: App.vue 移除搜索 tab 与缓存项，router 删除 /search，删除 Search.vue
    status: completed
    dependencies:
      - merge-search-into-home
  - id: bump-version
    content: 递增 android/app/build.gradle 的 versionCode 与 versionName
    status: completed
  - id: verify-build-and-dev
    content: npm run build 类型检查通过，Web dev 回归搜索与首页合并效果
    status: completed
    dependencies:
      - merge-search-into-home
      - clean-nav-and-route
      - bump-version
---

## 用户需求

将独立的「搜索」页面合并进「首页」：底部导航移除「搜索」tab，仅保留「首页」「我的」；在首页的「收藏夹快捷入口」区块下方新增搜索框，使整体更简洁。

## 产品概述

搜索功能不再单独成页，而是作为首页顶部区块的一部分存在。首页自上而下依次为：标题栏（表情包 + 总数）→ 扫描进度 → 收藏夹快捷入口（横向 chip，始终保留）→ 搜索框 → 内容区（搜索时显示结果网格，平时显示全部表情网格）→ 长按操作 / 收藏夹选择等弹层。

## 核心功能

- 首页内嵌搜索框：输入关键词（文字/收藏夹名）实时（防抖）搜索表情。
- 有搜索词时：下方网格切换为搜索结果（保留上方收藏夹入口）；无搜索词时：沿用原有全部表情网格与分页。
- 保留「最近搜索」历史：无关键词时显示在搜索框下方，可点击复用、可清空；含形近/同音近似匹配提示。
- 搜索结果支持点击进详情、长按加入收藏夹（复用首页现有长按面板）。
- 底部导航仅剩「首页」「我的」两项；删除独立的 `/search` 页面与路由。

## 技术栈

- 沿用现有栈：Vue 3 + TypeScript + Vite + Pinia + Vue Router + Tailwind CSS（Capacitor Android 外壳不变）。
- 复用现有组件与仓储：`EmojiGrid`、`EmptyState`、`BaseSheet`、`CollectionPicker`、`emojiRepo`/`collectionRepo`/`searchRepo`、`isFuzzyKeyword`、`initDatabase`。

## 实现思路

将 `Search.vue` 的搜索状态、方法、模板片段整体迁入 `Home.vue`，置于「收藏夹快捷入口」区块之后、表情网格之前。搜索状态在 Home 内以局部 `ref` 维护（不新增 store，保持最小改动）。通过 `searched && hasQuery` 决定内容区渲染「搜索结果网格」还是「全部表情网格」，收藏夹区块始终在搜索框之上（符合用户确认）。删除 `Search.vue` 文件、移除 `/search` 路由、精简底部导航与 `keep-alive` 缓存列表。

## 关键决策与权衡

- **复用而非重建**：Home 已存在 `actionItem`/`pickerOpen`/`toast`/`onLongPress`/`onOpenPicker`/`onPicked`，搜索结果的长按直接复用同一套「加入收藏夹」逻辑，避免重复声明与冲突，符合 DRY。
- **两套网格分支而非单组件条件 props**：全部表情网格依赖分页（`load-more`/`loading`/`finished`/`selectable`/`selected-ids`/`toggle-select`），搜索结果网格一次性返回、无需分页与多选。用两个 `v-if` 分支更清晰、互不干扰，避免给同一组件塞互斥 props。
- **搜索态与全家态隔离**：关键词清空后恢复全部网格，不影响 `emojiStore.items` 分页状态。`getPathMtimeMap`/过滤 `deleted_at=0` 等既有约定不受影响（搜索复用 `emojiRepo.search` 的 LIKE 查询，已自带过滤）。
- **返回刷新一致性**：Home 的 `onActivated` 追加「若有搜索词则重跑 `runSearch()`」，与 Search 原行为一致（从详情页返回剔除已软删表情）。

## 实现注意（防回归）

- **命名冲突**：Search 的 `actionItem`/`pickerOpen`/`toast` 与 Home 同名，迁入时删除 Search 的声明，复用 Home 现有变量；仅新增 `keyword/results/searching/searched/history/debounceTimer` 与搜索相关方法。
- **多选模式**：搜索框在 `selecting`（多选）时隐藏，避免与批量操作栏 clutter；`v-if selecting` 的多选栏维持原样。
- **删除后刷新**：搜索态下若通过长按面板删除表情，应在 `confirmDelete` 中判断 `searched && hasQuery` 并重跑 `runSearch()`，避免结果残留已删项。
- **历史初始化**：Home `onMounted` 补充 `history.value = await searchRepo.getRecentSearches()` 与 `await initDatabase()`（幂等，确保安全）。
- **缓存列表**：`cachedViews` 移除 `'Search'`，保留 `Home/Collections/CollectionDetail/Trash`，维持返回滚动记忆。
- **版本号**：按 CODEBUDDY.md §6 强制约定，先读 `android/app/build.gradle` 确认当前 `versionCode 25`/`versionName "1.3.14"`，改为 `versionCode 26`/`versionName "1.4.0"`（新功能升次版本号），未递增不得打包。
- **删除引用**：删除 `/search` 路由前已确认全仓库仅 `router/index.ts` 与 `App.vue` 引用，删除安全；`Search.vue` 文件一并删除。

## 架构设计

```
App.vue (底部导航 tabs: 首页/我的；cachedViews 去 Search)
  └─ router-view → Home.vue (合并搜索)
        ├─ header: 标题栏 + 总数
        ├─ ScanProgress
        ├─ 收藏夹快捷入口 section (横向 chip，始终保留)
        ├─ 搜索框 + 最近搜索历史 (无关键词时显示)
        └─ 内容区 (二选一):
              ├─ 有搜索词 → EmojiGrid(:items=results, :finished=true) / 空状态
              └─ 无搜索词 → EmojiGrid(:items=emojiStore.items, 分页) / 空状态
        └─ 长按面板 / 收藏夹选择 / 文件夹管理 / 删除确认 等 BaseSheet
```

数据流：输入关键词 → 防抖 → `runSearch()`（`emojiRepo.search` + `collectionRepo.searchEmojisByCollectionName` 合并去重）→ `results` 渲染结果网格；清空 → 恢复 `emojiStore.items` 全部网格。

## 目录结构与文件清单

```
src/
├── App.vue                  # [MODIFY] tabs 移除「搜索」{path:'/search',...}；cachedViews 移除 'Search'
├── router/index.ts          # [MODIFY] 删除 {path:'/search', name:'search', component: Search.vue} 路由项
├── views/
│   ├── Home.vue             # [MODIFY] 迁入搜索状态/方法/模板：收藏夹区块下方新增搜索框+历史区；
│   │                         #          内容区按 searched&&hasQuery 切换结果网格/全部网格；
│   │                         #          onMounted 补 history/initDatabase；onActivated 补重跑搜索；
│   │                         #          confirmDelete 搜索态下重跑 runSearch；selecting 时隐藏搜索框
│   └── Search.vue           # [DELETE] 功能已并入 Home，整体删除
└── (db/repositories/search.ts, utils/confusable.ts 等仅被引用，无需改动)
android/app/build.gradle     # [MODIFY] versionCode 25→26；versionName "1.3.14"→"1.4.0"
```

## 验证方式

- `npm run build`：vue-tsc 类型检查 + Web 构建通过。
- `npm run dev`（Web 走 `USE_MOCK` mock）：验证首页出现搜索框于收藏夹下方；输入关键词切到结果网格、收藏夹入口仍在；清空恢复全部；最近搜索显示/点击/清空正常；长按结果可加入收藏夹；底部仅「首页/我的」。
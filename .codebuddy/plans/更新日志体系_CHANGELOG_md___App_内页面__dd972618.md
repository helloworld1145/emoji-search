---
name: 更新日志体系（CHANGELOG.md + App 内页面）
overview: 为项目新增「更新日志」体系：在仓库根目录创建标准 CHANGELOG.md（开发者/上架用），并在 App 内新增「更新日志」展示页，采用 Keep a Changelog 分类格式（新增/优化/修复）。仅从当前版本 1.2.0 起记录，不涉及 1.0.0 历史补全。所有文案使用简体中文。
design:
  architecture:
    framework: vue
  styleKeywords:
    - 温暖现代
    - 卡片化
    - 毛玻璃顶栏
    - 圆角轻阴影
    - 分类色标
    - 移动端
    - 入场微动效
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 22px
      weight: 600
    subheading:
      size: 16px
      weight: 600
    body:
      size: 14px
      weight: 400
  colorSystem:
    primary:
      - "#FF6B6B"
      - "#FF8E53"
    background:
      - "#F7F8FA"
      - "#FFFFFF"
    text:
      - "#1F2933"
      - "#6B7280"
      - "#9CA3AF"
    functional:
      - "#22C55E"
      - "#4ECDC4"
      - "#F59E0B"
      - "#EF4444"
todos:
  - id: create-changelog-data
    content: 创建 src/data/changelog.json 数据源（含 1.2.0 内容）
    status: completed
  - id: build-changelog-view
    content: 新建 src/views/Changelog.vue 更新日志页
    status: completed
    dependencies:
      - create-changelog-data
  - id: wire-route-nav
    content: 注册 /changelog 路由并在 App.vue 底部导航加「更新」入口
    status: completed
    dependencies:
      - build-changelog-view
  - id: gen-changelog-md
    content: 新建 CHANGELOG.md 与 scripts/gen-changelog.mjs 生成脚本
    status: completed
    dependencies:
      - create-changelog-data
  - id: update-docs
    content: 在 CODEBUDDY.md 记录「两处同步」维护约定
    status: completed
    dependencies:
      - gen-changelog-md
---

# 更新日志体系（CHANGELOG.md + App 内「我的」页集成）

## 用户需求与澄清

原始需求：「我想要有一个更新日志，每个版本都写写更新了什么」

已确认的三点：

1. **两种载体**：既建根目录 `CHANGELOG.md` 文档，也在 App 内做「更新日志」展示。
2. **历史范围**：仅从当前版本 **1.2.0** 起记录，不补全 1.0.0/1.1.0。
3. **风格**：Keep a Changelog 分类格式（新增 / 优化 / 修复），全部简体中文。

**新增约束（用户最新调整）**：更新日志**不放在底部 tabbar 新增项**。改为把底部导航的「收藏夹」入口**改为「我的」**，并在「我的」页里**集成收藏夹管理 + 更新日志**两大功能。底部导航仍为 3 个标签（首页 / 搜索 / 我的）。

## 产品概述

在原有表情包管理 App 基础上新增「版本更新日志」能力：开发侧一份结构化源数据，自动/手工产出标准 `CHANGELOG.md`；App 侧把更新日志与收藏夹一起收拢到新的「我的」页，用户在一个入口即可管理收藏夹并查看每个版本更新了什么。版本号与 `android/app/build.gradle` 的 `versionName` 保持一致。

## 核心特性

- **单一数据源**：`src/data/changelog.json` 为唯一可信源，App 页面与 `CHANGELOG.md` 均由此派生，避免两处不同步。
- **「我的」综合页（`/mine`）**：顶部标题「我的」，页面含两大模块：
- **收藏夹模块**：复用 `useCollectionStore`，展示总收藏 + 自定义收藏夹列表（含封面、数量、总收藏徽标），支持新建、重命名、删除、导出备份、点击进入收藏夹详情（`/collection/:id`）。逻辑等价于现有 `Collections.vue`。
- **更新日志模块**：内联渲染 `changelog.json`，展示版本卡片（最新在上，按「新增/优化/修复」分类色标 + 图标），并提供「查看全部」跳转 `/changelog` 独立页。
- **更新日志独立页（`/changelog`）**：完整展示所有版本 changelog，从「我的」页跳转进入。
- **底部导航调整**：`src/App.vue` 的 `tabs` 由 `[首页, 搜索, 收藏夹]` 改为 `[首页, 搜索, 我的]`，仍保持 `grid-cols-3`；「我的」使用 `User` 图标，路由 `/mine`。
- **标准 CHANGELOG.md**：根目录文档遵循 Keep a Changelog 中文分类格式，首条 1.2.0，含维护说明。
- **1.2.0 基线内容**：依据现有功能（手动 SAF 选文件夹、设备端中文 OCR+标签/情感、搜索、收藏夹、一键转发、回收站、标签修正、完全离线）整理首版条目，供用户核对补充。

## 技术栈

沿用现有前端栈：Vue 3 + TypeScript + Vite + Tailwind CSS + `lucide-vue-next` 图标 + 自定义色板（`primary/secondary/accent/surface/ink/success/warning/danger`）。

- 数据形式：纯 JSON 数据源（无新增依赖），Vite 原生 `import` 支持。
- 文档生成：零依赖 Node 脚本 `scripts/gen-changelog.mjs`。
- 复用的既有能力：`useCollectionStore`（收藏夹）、`BaseSheet`（弹层）、`EmptyState`、`toImageSrc`、`exportBackup`。

## 实现方案

**核心策略：单一数据源（JSON）+ 双消费方 + 「我的」页聚合。**

1. **数据源**：`src/data/changelog.json` = 版本数组，元素 `{ version, date, changes: { added?, changed?, fixed? } }`。首条 1.2.0。
2. **更新日志独立页**：`src/views/Changelog.vue` 读取 `changelog.json`，按版本倒序渲染；每版本含版本号+日期标题，按「新增/优化/修复」分类用不同色标（绿 `#22C55E`/青 `#4ECDC4`/橙 `#F59E0B`）与图标（Plus/Refresh/Wrench）区分；顶部 sticky 毛玻璃标题栏「更新日志」，右侧展示当前 App 版本小徽标。
3. **「我的」综合页**：`src/views/Mine.vue` 读取 `useCollectionStore` 与 `changelog.json`：

- 收藏夹模块：复制/复用 `Collections.vue` 的列表与新建/重命名/删除/导出/进入详情逻辑（`onMounted` 调 `store.loadCollections()`；`store.collections` 渲染；`store.create/rename/remove`；`exportBackup`；点击 `router.push('/collection/'+id)`）。使用 `.page`/`.card`/`.btn-*` 与现有色板。
- 更新日志模块：内联渲染 `changelog.json`（最新版本卡片或完整列表，复用与 `Changelog.vue` 一致的展示片段），底部「查看全部」按钮 `router.push('/changelog')`。
- `Collections.vue` 文件与 `/collections` 路由**保留**（深链/后续清理用），仅不再作为底部 tab 入口。

4. **路由**：`src/router/index.ts` 新增

- `{ path: '/mine', name: 'mine', component: () => import('../views/Mine.vue'), meta: { title: '我的' } }`
- `{ path: '/changelog', name: 'changelog', component: () => import('../views/Changelog.vue'), meta: { title: '更新日志' } }`
- 保留 `/collections`、`/collection/:id`。

5. **底部导航**：`src/App.vue` 中 `tabs` 改为 `[{首页,Home,/home},{搜索,Search,/search},{我的,User,/mine}]`，模板 `grid-cols-3` 保持不变（仍是三标签）。
6. **文档生成**：`scripts/gen-changelog.mjs` 读取 JSON，按 Keep a Changelog 规范生成根目录 `CHANGELOG.md`（顶部说明 + 中文分类标题 + 版本倒序）。更新版本只改 JSON 后运行脚本。
7. **维护约定**：实现后在 `CODEBUDDY.md` 第 8 节补充「更新日志：改 `src/data/changelog.json` 后运行 `node scripts/gen-changelog.mjs` 重新生成 `CHANGELOG.md`，两处必须同步」。

## 实现注意事项

- **单一数据源纪律**：所有版本内容只改 `changelog.json`，禁止在 `Changelog.vue`/`Mine.vue`/`CHANGELOG.md` 硬编码版本文字；改完 JSON 运行脚本再提交。
- **样式一致性**：复用 `.page`、`.card`、`.btn-*`、`text-primary`/`bg-surface`、毛玻璃顶栏与 `fade-up` 动画；分类色标与 `Changelog.vue` 完全一致，Mine 内联片段与独立页视觉统一。
- **向后兼容**：仅新增 `Mine.vue`/`Changelog.vue`/JSON/脚本/CHANGELOG.md，修改 `App.vue` 与 `router`；不改 store/原生逻辑；`package.json` 的 `version`(0.0.0) 仍不参与 App 版本。
- **收藏夹功能等价**：Mine 页收藏夹模块须覆盖 `Collections.vue` 的全部既有能力（新建/重命名/删除/导出/进入详情/空状态），避免功能回退。

## 目录结构（变更点）

```
src/
  data/
    changelog.json        # [NEW] 单一数据源：版本数组，首条 1.2.0 基线。
  views/
    Changelog.vue        # [NEW] 更新日志独立页（/changelog）。
    Mine.vue             # [NEW] 「我的」综合页（/mine）：收藏夹模块 + 更新日志模块。
    Collections.vue      # [KEEP] 保留文件与 /collections 深链，不再作为底部 tab。
  router/
    index.ts             # [MODIFY] 新增 /mine、/changelog 路由。
  App.vue                # [MODIFY] tabs 改为 [首页, 搜索, 我的]，grid-cols-3 不变。
scripts/
  gen-changelog.mjs      # [NEW] 零依赖脚本，读 JSON 生成 CHANGELOG.md。
CHANGELOG.md             # [NEW] 根目录标准更新日志文档，首条 1.2.0。
CODEBUDDY.md             # [MODIFY] 第 8 节补充「更新日志两处同步」约定。
```

## 关键代码结构

页面侧解析 JSON 的本地类型契约（Changelog.vue / Mine.vue 内定义）：

```ts
export interface ChangelogEntry {
  version: string
  date: string // YYYY-MM-DD
  changes: {
    added?: string[]
    changed?: string[]
    fixed?: string[]
  }
}
```

## 设计风格

延续 App 现有「温暖现代、卡片化」视觉（主色暖红橙 #FF6B6B / #FF8E53）。浅色 `surface` 背景、白色圆角卡片、轻阴影、毛玻璃顶栏；分类用色彩 + 图标强化可读性；列表项带细微入场动画。移动端单列布局，桌面预览不撑满。

## 页面规划（「我的」页，自上而下）

1. **顶栏**：`sticky top-0 z-20 bg-surface/90 backdrop-blur-md` 毛玻璃标题「我的」（text-[22px] font-semibold）。
2. **收藏夹模块**：小标题「我的收藏夹」+「导出备份 / 新建」按钮；下方 `space-y-2.5` 卡片列表（封面 + 名称 + 总收藏徽标 + 数量，点击进详情，操作区重命名/删除）；空状态用 `EmptyState`。
3. **更新日志模块**：小标题「更新日志」+「查看全部」跳转；下方内联版本卡片（最新在上，分类色标 + 图标 + 列表）。
4. **页脚说明**：`text-ink-faint text-xs` 注明更新内容由开发者维护。

## 验收

- 根目录 `CHANGELOG.md` 存在，Keep a Changelog 中文分类，首条 1.2.0。
- 底部导航第三项为「我的」（`/mine`）；「我的」页可管理收藏夹（等价原 Collections 能力）并查看更新日志；「查看全部」进入 `/changelog` 完整页。
- 新增版本只改 `changelog.json` + 运行脚本即同步两处；`CODEBUDDY.md` 记录维护约定。
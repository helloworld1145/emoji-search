---
name: 修复首页收藏夹筛选标签选中态样式
overview: 修复首页顶部「收藏夹」筛选标签（chip）的两个样式 bug：① 选中态红色外圈 ring 被标签容器 overflow 裁切，顶部边框被上方「收藏夹」标题区域遮挡；② 触屏上再次点击同一标签取消筛选后，因非选中态的 hover:text-primary 粘性悬停，标签文字仍保持红色而不恢复黑色。改动仅限 src/views/Home.vue。
todos:
  - id: fix-chip-overflow
    content: 调整 Home.vue 第305行 chips 容器纵向内边距，使选中 ring 不再被裁切
    status: completed
  - id: fix-chip-hover
    content: 将 Home.vue 第311-315行非选中态 hover:text-primary 限定为 hover-capable 设备
    status: completed
  - id: verify-chip-states
    content: 验证触屏点击切换标签红/黑正确且不残留红、外圈完整
    status: completed
    dependencies:
      - fix-chip-overflow
      - fix-chip-hover
---

## 用户需求

修复首页顶部「收藏夹」标题下那一排横向分类筛选标签（chip）的两个样式缺陷。

## 产品概述

这是表情搜搜 App 首页顶部的收藏夹快捷筛选区：一排可横向滚动的分类标签，点击某标签即按该收藏夹筛选表情，再次点击同一标签（toggle）取消筛选。

## 核心问题

- 问题1（上侧边框被标题盖住）：选中标签时出现的红色外圈（ring-1 ring-primary）与卡片阴影（shadow-card）在标签容器顶部被裁切，视觉上像被上方的「收藏夹」标题压住。
- 问题2（取消后仍红）：在触屏上，再次点击同一标签取消筛选后，标签文字仍保持红色而不恢复黑色。

## 技术栈

- 前端：Vue 3 + TypeScript + Vite + Tailwind CSS（与现有项目一致）
- 改动文件：仅 `src/views/Home.vue`（选中态/容器样式），`src/stores/emoji.ts` 的切换逻辑无需改动（已确认正确）

## 实现方案

### 根因与策略

1. **问题1根因**：标签容器（Home.vue 第 305 行）使用 `overflow-x-auto` 实现横向滚动。按 CSS 规范，当一轴为 `auto/scroll` 而另一轴为 `visible` 时，`visible` 会被降级计算为 `auto`，导致容器在纵向也进行裁剪，从而把选中标签的 `ring-1 ring-primary` 外圈和 `shadow-card` 在顶部裁掉。

- **修复**：将容器纵向内边距由 `pb-1` 调整为 `py-1.5`（保留 `-mx-1 px-1` 的横向滚动内缩），为 ring 外圈与阴影提供纵向容纳空间，使其不再被裁切，消除「被标题盖住」的观感。改动最小、不影响横向滚动与布局。

2. **问题2根因**：非选中态类为 `text-ink hover:text-primary`。触屏 tap 会留下"粘性 `:hover`"（tap 后 `:hover` 不释放），取消筛选后该标签仍处于 hover 态，文字保持 `text-primary` 红色。

- **修复**：将非选中态改为 `'text-ink [@media(hover:hover)]:hover:text-primary'`，即 hover 高亮仅在支持真实指针悬停的设备（桌面）生效，触屏不再有粘性红色。选中态 `'text-primary ring-1 ring-primary'` 保持不变。

### 性能与可靠性

- 纯样式层修改，无逻辑变更、无新增响应式依赖，不影响 `setCollectionFilter` 的 toggle 行为。
- 复用现有 Tailwind 原子类与 `chip` 组件类，不引入新样式体系，避免回归。
- `@media(hover:hover)` 为 Tailwind 原生支持的变体，无需额外配置。

## 实现要点

- 仅修改 Home.vue 两处：chips 容器的 class 与 chip 按钮的 `:class` 表达式，范围最小、可回退。
- 选区逻辑、计数刷新、滚动记忆等既有行为保持不变。

## 目录结构

```
src/views/Home.vue   # [MODIFY] 第305行容器 class 增加纵向内边距（pb-1→py-1.5）；第311-315行非选中态 hover 限定为 hover-capable 设备，消除触屏粘性红
```
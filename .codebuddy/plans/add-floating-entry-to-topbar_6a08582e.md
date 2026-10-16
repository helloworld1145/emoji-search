---
name: add-floating-entry-to-topbar
overview: 在首页顶栏快捷图标区新增「悬浮窗」图标按钮，复用现有 toggleFloating 逻辑实现一键开/关（含权限引导与 toast），运行中图标高亮，并借 keep-alive 的 onActivated 同步真实运行状态。
todos:
  - id: add-floating-topbar-icon
    content: 在 Home.vue 顶栏图标区插入 PictureInPicture2 悬浮窗按钮，绑定 toggleFloating，运行中 text-primary 高亮
    status: completed
  - id: sync-floating-state
    content: 在 Home.vue onActivated 中追加 FloatingWindow.isRunning() 刷新 floatingRunning 状态
    status: completed
    dependencies:
      - add-floating-topbar-icon
  - id: verify-build
    content: 执行 npm run build 验证 vue-tsc 类型检查与构建通过
    status: completed
    dependencies:
      - sync-floating-state
---

## 用户需求

在首页（`Home.vue`）顶栏快捷图标区新增「悬浮窗」入口，让用户可以一键开启/关闭悬浮窗快速发送功能，无需再进入「文件夹管理面板」深层查找开关。

## 补充说明（基于代码现状的合理假设）

- **入口行为**：顶栏图标点击后直接切换悬浮窗运行状态（复用现有 `toggleFloating`：运行中→关闭；未运行→启动；无「显示在其他应用上」权限时 toast 提示并跳系统设置页），不新增弹层面板。
- **并存关系**：文件夹管理面板内的「悬浮窗快速发送」开关保留，顶栏图标与面板开关两入口共用同一 `floatingRunning` 状态。
- **视觉反馈**：图标选用 lucide-vue-next 的 `PictureInPicture2`（已在 node_modules 确认存在）；悬浮窗运行中时图标以 `text-primary` 高亮，与收藏夹 chip 选中态视觉语言一致。
- **状态同步**：首页被 `<keep-alive>` 缓存，`onMounted` 仅首次执行；借现有 `onActivated` 顺带刷新 `FloatingWindow.isRunning()`，避免用户从通知栏/服务关掉悬浮球后返回 App 时顶栏图标状态失真（同时修复面板开关的同类滞后）。
- **不改动范围**：`nativeBridge.ts` 的 `FloatingWindow` 门面、原生 Java 插件、数据库、其他页面均不动。

## 技术栈

- 前端框架：Vue 3（`<script setup>`）+ TypeScript + Tailwind CSS
- 图标库：lucide-vue-next（复用现有 `PictureInPicture2`）
- 原生桥接：`src/services/nativeBridge.ts` 的 `FloatingWindow` 门面（`start`/`stop`/`isRunning`/`openSettings`，Web Mock 兜底），无需改动

## 实现方案

仅在 `src/views/Home.vue` 单文件内完成，零新增依赖、零新增组件：

1. **顶栏图标**：在第 310-327 行的 `<div class="flex items-center gap-2">` 图标区内、回收站按钮后插入一个 `btn btn-ghost h-9 w-9` 图标按钮，复用回收站按钮的样式规范（`!p-0 relative` 无需角标，可不加 `relative`）；`aria-label="悬浮窗"`；`:class` 按 `floatingRunning` 切换 `text-primary` / 默认 `text-ink-muted`；`@click="toggleFloating"` 直接复用现有函数（第 176-200 行，已含权限引导与 toast）。
2. **状态同步**：在现有 `onActivated`（第 69-75 行）内追加 `FloatingWindow.isRunning()` 刷新 `floatingRunning`，用 try/catch 兜底（与 `onMounted` 内初始化写法一致），不影响下拉刷新主逻辑。
3. **验证**：`npm run build`（vue-tsc 类型检查 + 构建）确认无类型错误。

## 注意事项

- 保持与回收站按钮完全一致的按钮结构（`type="button"` + `btn btn-ghost h-9 w-9 !p-0`），避免样式漂移。
- `onActivated` 内 `isRunning` 调用需 async 安全包裹失败场景（Web 环境 Mock 返回 false，不会抛错，但真机需兜底）。
- 无性能热点：图标渲染与一次轻量桥接调用，无额外开销。
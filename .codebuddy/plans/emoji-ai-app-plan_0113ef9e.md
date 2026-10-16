---
name: emoji-ai-app-plan
overview: 基于 Vue 3 + Capacitor 开发 Android 表情包管理 App：设备端 AI 自动分类（OCR 文字 + 情感）、搜索、收藏夹、系统分享转发微信/QQ，从零搭建 Android 打包环境并规划小米商店/网盘分发。
design:
  architecture:
    framework: vue
    component: tdesign
  styleKeywords:
    - Modern Minimalism
    - 圆角卡片
    - 明亮友好
    - 轻量动效
    - 底部导航
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 22px
      weight: 600
    subheading:
      size: 16px
      weight: 500
    body:
      size: 14px
      weight: 400
  colorSystem:
    primary:
      - "#FF6B6B"
      - "#FF8E53"
      - "#4ECDC4"
    background:
      - "#F7F8FA"
      - "#FFFFFF"
    text:
      - "#1F2933"
      - "#6B7280"
    functional:
      - "#22C55E"
      - "#EF4444"
      - "#F59E0B"
todos:
  - id: scaffold-project
    content: 初始化 Vue3+Vite+Capacitor 工程与 Android 原生项目，声明全部文件访问权限
    status: completed
  - id: native-scanner
    content: 实现 EmojiScanner 原生插件：权限引导、全设备文件遍历与缩略图生成
    status: completed
    dependencies:
      - scaffold-project
  - id: ondevice-ai
    content: 集成 ML Kit OCR 与情感分类，输出文字与情感标签
    status: completed
    dependencies:
      - native-scanner
  - id: data-layer
    content: 搭建 SQLite 数据层（表情/标签/分类/收藏夹+FTS5）与 Pinia 状态
    status: completed
    dependencies:
      - scaffold-project
  - id: ui-pages
    content: 实现权限引导、浏览、分类详情、收藏夹、搜索、详情页 UI
    status: completed
    dependencies:
      - data-layer
  - id: features-share
    content: 接入系统分享转发与收藏夹管理（添加/移除/重命名/删除/导出）
    status: completed
    dependencies:
      - ui-pages
      - ondevice-ai
  - id: build-publish
    content: 构建 APK，准备小米商店上架材料与网盘分发说明
    status: completed
    dependencies:
      - features-share
---

## 产品概述

一款 Android 原生 App（Vue 3 + Capacitor 包装），自动扫描手机本地的图片与 GIF 表情包，通过设备端 AI 进行文字（OCR）与情感（开心/悲伤/生气等）自动分类，支持按文字和情感搜索、收藏夹管理与一键转发到微信/QQ。优先上架小米应用商店，否则通过网盘分发 APK。

## 核心功能

- 申请全部文件访问权限，自动扫描整个设备内的图片与 GIF 表情包
- 设备端 AI 自动分类：OCR 识别图片文字 + 情感/语义分类，支持用户手动修正标签
- 搜索：按图片文字检索、按情感检索（本地 FTS5 全文索引）
- 收藏夹：总收藏列表 + 多个命名收藏夹；可基于自动分类一键创建；支持手动添加/移除（原图不动）/重命名/删除整个收藏夹
- 数据仅本机 SQLite 存储 + 可选导出/导入备份
- 转发：调起 Android 系统分享面板，用户点选微信/QQ 发送

## 技术栈选型

- 前端：Vue 3 + TypeScript + Vite + Pinia + Vue Router + tdesign-vue-next（移动端组件库）
- 原生包装：Capacitor 6（Android 平台）
- 原生能力：自定义 Capacitor 原生插件 `EmojiScanner`（Java），封装权限申请、文件遍历、缩略图、AI 推理
- 设备端 AI：Google ML Kit Text Recognition（OCR）、ML Kit Image Labeling / TensorFlow Lite（情感分类）
- 本地存储：capacitor-sqlite（SQLite，启用 FTS5 全文索引）
- 分享：@capacitor/share（系统分享面板）
- 构建/分发：Android Gradle 构建 APK；小米应用商店上架 / 网盘分发

## 实现方案

采用分层架构：Vue 3 UI 层 → Native Bridge 服务层（封装 Capacitor 插件调用）→ 自定义原生插件（文件与 AI）→ SQLite 数据层。

关键决策与权衡：

1. **自定义原生插件而非纯 Web**：Web 层（Capacitor WebView）无法直接访问任意文件路径，MANAGE_EXTERNAL_STORAGE 权限与递归遍历必须由原生层完成，再通过 Capacitor 桥返回结果。这是本方案的核心约束，决定了必须写 Java 原生插件。
2. **AI 情感分类的务实做法**：端侧"图像情感"精度有限，采用「ML Kit Image Labeling 生成通用标签 → 通过情感映射词表（EmotionMap）映射到开心/悲伤等 → 用户可修正」的兜底策略，保证可用性与可解释性。OCR 使用成熟的 ML Kit，精度可靠。
3. **增量扫描与缓存**：首次全量扫描后将文件元数据、缩略图路径、AI 标签写入 SQLite；再次扫描仅比对 mtime/哈希处理新增文件，避免重复推理与卡顿。
4. **搜索走 FTS5**：标签与 OCR 文字建 FTS5 虚拟表，支持中文分词模糊检索，避免前端全量过滤的性能问题。
5. **缩略图降内存**：网格只加载原生生成的缩略图，避免大图 OOM；详情页才加载原图。

性能与可靠性：

- 扫描与 AI 推理在原生后台线程执行，通过进度回调驱动 UI 进度条，避免阻塞主线程（复杂度 O(N) 文件数）。
- 瓶颈为首次全设备扫描 + 推理；通过增量扫描、并发受限的批处理、失败跳过（单文件异常不影响整体）缓解。
- 数据写入走事务批量提交。

## 实现要点（防回归）

- 权限：AndroidManifest 声明 `MANAGE_EXTERNAL_STORAGE` 与 `READ_EXTERNAL_STORAGE`；首次启动引导用户到系统设置授予，未授权时禁用扫描并给出明确提示。
- 兼容性：Android 11+ 的 `MANAGE_EXTERNAL_STORAGE` 行为；GIF 仅做文件级识别/缩略（首帧），不做逐帧 AI。
- 安全：仅本机数据，不联网；导出备份为本地文件，不携带隐私上传。
- 日志：复用 Android Log 与 Web console，分级，避免打印图片二进制与用户数据。

## 架构设计

```mermaid
flowchart TD
  UI[Vue3 UI 层 / Pinia] -->|调用| SVC[Native Bridge 服务]
  SVC -->|Capacitor 桥| PLG[EmojiScanner 原生插件]
  PLG --> FS[文件遍历 + 缩略图]
  PLG --> OCR[ML Kit OCR 文字识别]
  PLG --> EMO[情感分类 TFLite/Labeling]
  UI -->|读写| STORE[Pinia Store]
  STORE -->|SQL/FTS5| DB[(SQLite)]
  UI -->|分享| SHARE[@capacitor/share 系统分享面板]
  SHARE --> WXQQ[微信 / QQ]
```

## 目录结构

```
emoji-ai/
├── android/                                  # Capacitor 生成的 Android 原生工程
│   └── app/src/main/
│       ├── java/com/emoji/ai/
│       │   ├── MainActivity.java             # [MODIFY] 入口 Activity
│       │   ├── EmojiScannerPlugin.java       # [NEW] 自定义插件：权限申请+文件遍历+AI调度，暴露 scan/requestPermission/getThumbnails 给 JS
│       │   ├── ai/
│       │   │   ├── OcrRecognizer.java        # [NEW] ML Kit 文字识别，返回图片文字
│       │   │   ├── EmotionClassifier.java    # [NEW] 情感/语义分类，返回情感标签
│       │   │   └── EmotionMap.java           # [NEW] 标签→情感映射词表(开心/悲伤/生气…)
│       │   └── util/ThumbnailUtil.java       # [NEW] 生成并缓存缩略图
│       ├── res/                              # [NEW] 图标、权限引导文案资源
│       └── AndroidManifest.xml               # [MODIFY] 声明 MANAGE_EXTERNAL_STORAGE 等权限
├── src/
│   ├── main.ts                               # [NEW] 应用入口
│   ├── App.vue                               # [NEW] 根组件 + 底部导航
│   ├── router/index.ts                       # [NEW] 路由（6 个页面）
│   ├── types/index.ts                        # [NEW] EmojiRecord/Category/Collection/Tag 类型
│   ├── stores/
│   │   ├── emoji.ts                          # [NEW] 表情数据与扫描状态
│   │   ├── category.ts                       # [NEW] 自动分类状态
│   │   └── collection.ts                     # [NEW] 收藏夹状态
│   ├── services/
│   │   ├── nativeBridge.ts                   # [NEW] 封装 EmojiScanner 插件调用
│   │   ├── scanner.ts                        # [NEW] 扫描编排(增量/进度/并发)
│   │   ├── classifier.ts                     # [NEW] 处理原生 AI 结果→标签/情感
│   │   └── share.ts                          # [NEW] 系统分享封装
│   ├── db/
│   │   ├── database.ts                       # [NEW] SQLite 初始化(capacitor-sqlite)
│   │   ├── schema.sql                        # [NEW] 表结构 + FTS5 索引
│   │   └── repositories/                     # [NEW] emoji/category/collection 仓库层
│   ├── views/
│   │   ├── Onboarding.vue                    # [NEW] 权限引导页
│   │   ├── Home.vue                          # [NEW] 浏览页(分类/收藏 Tab)
│   │   ├── CategoryDetail.vue                # [NEW] 分类详情(一键存为收藏夹)
│   │   ├── Collections.vue                   # [NEW] 收藏夹管理
│   │   ├── Search.vue                        # [NEW] 搜索页(文字+情感)
│   │   └── EmojiDetail.vue                   # [NEW] 详情+分享
│   └── components/
│       ├── EmojiGrid.vue                     # [NEW] 表情网格
│       ├── EmojiCard.vue                     # [NEW] 表情卡片(长按加收藏)
│       └── TagEditor.vue                     # [NEW] 标签/情感手动修正
├── capacitor.config.ts                       # [NEW] Capacitor 配置
├── package.json                              # [NEW] 依赖与脚本
├── vite.config.ts                            # [NEW] 构建配置
└── tsconfig.json                             # [NEW] TS 配置
```

## 关键代码结构

```typescript
// src/types/index.ts
export interface EmojiRecord {
  id: string;
  path: string;          // 原图绝对路径
  thumbPath: string;     // 缩略图路径
  mimeType: string;      // image/* 或 image/gif
  ocrText: string;       // OCR 识别文字
  emotions: string[];    // 情感标签(开心/悲伤…)
  tags: string[];        // 用户/AI 通用标签
  createdAt: number;
}
export interface Collection {
  id: string;
  name: string;
  isFavorite: boolean;   // 总收藏标识
  emojiIds: string[];
}
```

## 设计概述

面向 Android 手机的表情包管理 App，采用现代简约 + 轻量动效风格，圆角卡片网格、明亮友好的配色、底部 Tab 导航与顶部标题栏，整体轻松活泼但信息清晰。使用 tdesign-vue-next 移动端组件，保证一致性与开发效率。

## 页面规划（6 屏）

### 1. 权限引导页 Onboarding

- 顶部：应用 Logo 与名称标语块。
- 权限说明块：图文说明需要"全部文件访问权限"的原因。
- 授权按钮块：点击跳转系统设置授予权限，未授权置灰提示。
- 底部：跳过/稍后提示块。

### 2. 浏览首页 Home

- 顶部导航：标题"表情包" + 扫码/搜索入口。
- 分类 Tab 块：自动分类（开心/悲伤/文字梗等）横向标签。
- 收藏 Tab 块：总收藏 + 各命名收藏夹入口。
- 表情网格块：EmojiGrid 瀑布/方格展示缩略图，滚动加载。
- 底部导航：首页 / 搜索 / 收藏夹 / 我的。

### 3. 分类详情页 CategoryDetail

- 顶部：返回 + 分类名 + "存为收藏夹"按钮。
- 分类说明块：该分类表情数量与情感分布。
- 表情网格块：该分类下全部表情。
- 批量操作块：多选后加入收藏夹/分享。

### 4. 收藏夹管理页 Collections

- 顶部：标题"收藏夹" + 新建按钮。
- 列表块：总收藏 + 各命名收藏夹卡片（数量、预览）。
- 操作块：重命名、删除（删除弹窗确认）、导出备份入口。
- 空状态块：无收藏时的引导。

### 5. 搜索页 Search

- 顶部：搜索框（支持文字输入）。
- 情感筛选块：开心/悲伤/生气等情感 chips 多选。
- 结果网格块：按相关度展示，高亮匹配文字。
- 历史/热门块：最近搜索与热门情感。

### 6. 表情详情/分享页 EmojiDetail

- 顶部：返回 + 分享按钮。
- 大图预览块：原图展示（GIF 动图播放）。
- 标签块：OCR 文字与情感标签，可手动增删修正。
- 操作块：加入收藏夹、系统分享到微信/QQ、复制路径。
---
name: 创建 CODEBUDDY.md 项目导航文档
overview: 在项目根目录 d:/Code/emoji-ai 创建 CODEBUDDY.md（CodeBuddy 每次新对话自动全文加载，兼容 AGENTS.md）。内容为面向 AI 协作的精炼「项目导航 + 改动指南」：技术栈、目录地图、改某功能去哪个文件的映射表、关键约定、常用命令。解决"每次新对话都要重新读取整个项目"的痛点。
todos:
  - id: explore-codebase
    content: 使用 [subagent:code-explorer] 探索 src/ 与 android/ 代码，建立功能到文件的准确映射表
    status: completed
  - id: write-codebuddy
    content: 基于映射表编写 CODEBUDDY.md：目录地图、改动地图、关键约定、常用命令
    status: completed
    dependencies:
      - explore-codebase
  - id: verify-accuracy
    content: 校验 CODEBUDDY.md 路径与文件名准确性，对照 README 去重并精简
    status: completed
    dependencies:
      - write-codebuddy
---

## 用户需求

用户发现每次开启新的对话，AI 都需要重新读取整个项目才能建立认知，希望有一种方式让 AI 能「快速且完整」地了解整个项目，避免重复探索。

经确认，方案为：在项目根目录创建 `CODEBUDDY.md`（CodeBuddy 会在每次新对话自动全文加载该文件，也兼容 `AGENTS.md`），内容聚焦「架构导航 + 改动指南」，使 AI 在新对话开局即获得项目全貌，无需再重读一遍源码。

## 产品概述

为 emoji-ai 项目创建一份面向 AI 协作的项目导航文档 `CODEBUDDY.md`，以精炼、结构化的方式沉淀项目的目录地图、功能到文件的改动映射、关键约定与常用命令。该文件被 CodeBuddy 自动注入上下文，解决「每开新对话都要重新读取整个项目」的痛点。

## 核心特性

- 技术栈与目录地图：一目了然的整体结构
- 功能 → 文件改动映射表：改某功能该去哪个文件
- 关键约定与取舍：搜索用 LIKE 而非 FTS5、情感分类兜底、离线 AI 等
- 常用命令速查：dev/build/cap sync/打包等

## 技术方案

### 技术机制

- 采用 CodeBuddy 的 **`CODEBUDDY.md` 自动加载机制**：位于项目根目录的纯 Markdown 文件，每次对话默认全文放入上下文；若根目录存在 `AGENTS.md` 且无 `CODEBUDDY.md` 时也会自动加载，兼容性良好。零配置，无需 frontmatter。
- 已有 `README.md` 详细覆盖功能、技术栈、目录结构、开发环境、上架与签名等部署细节，但**不会被自动加载**，因此本任务新建一份更聚焦「改代码去哪改」的 `CODEBUDDY.md`，与 README 互补（README 偏部署，CODEBUDDY.md 偏协作导航），不重复部署细节，必要时引用 README。

### 实施思路

1. 先用 `code-explorer` 子代理深入遍历 `src/`（views/components/stores/services/db）与 `android/` 原生插件，建立准确的「功能 → 文件」映射表（本任务核心价值所在）。
2. 基于映射表编写 `CODEBUDDY.md`，结构：项目一句话定位 → 技术栈 → 目录地图 → 改动地图（表格） → 关键约定与取舍 → 常用命令。
3. 校验所有文件路径、文件名真实存在，避免写出不存在的引用。

### 实施要点

- 内容精炼，控制每次对话的 token 占用：聚焦 AI 改代码最需要的信息，部署/签名等细节仅用一行链接指向 README。
- 路径与文件名必须准确，杜绝臆造；映射表需逐条对照实际代码确认。
- 原生层与前端桥接关系需点明：`services/nativeBridge` 对应 `android/.../EmojiScannerPlugin.java`，AI 调度（`ai/OcrRecognizer`、`EmotionClassifier`、`EmotionMap`、`AiEngine`）经此桥接调用。

### 目录结构

```
d:/Code/emoji-ai/
└── CODEBUDDY.md   # [NEW] 面向 AI 协作的项目导航文档。包含：项目定位、技术栈、
                   #   目录地图、功能→文件改动映射表、关键约定与取舍、常用命令。
                   #   每次新对话由 CodeBuddy 自动全文加载，使 AI 快速了解项目全貌。
```

## Agent Extensions

### SubAgent

- **code-explorer**
- Purpose: 深入探索 emoji-ai 的 `src/`（views/components/stores/services/db）与 `android/`（EmojiScannerPlugin、FileWalkerUtil、ThumbnailUtil、ai/*）代码，定位每个功能对应的具体文件，建立准确的「功能 → 文件」映射表。
- Expected outcome: 产出完整且准确的功能-文件映射，确保 `CODEBUDDY.md` 的改动指南与桥接关系描述无误、无臆造路径。
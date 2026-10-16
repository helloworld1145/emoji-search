---
name: rename-app-to-biaoqing-sousou
overview: 将 App 显示名从「表情包管家」统一改为「表情搜搜」（英文副标题 Emoji AI 保留，包名 com.emoji.ai 不动），覆盖 Android 原生名、Web 标题、引导页、启动图/图标脚本、数据库注释、README 与项目导航文档等所有引用位置。构建产物（dist/、android assets、build/）靠重新构建自动覆盖，不手动改。
todos:
  - id: rename-core-display
    content: 改 strings.xml、capacitor.config.ts、index.html、Onboarding.vue 显示名
    status: completed
  - id: rename-scripts-sql
    content: 改 gen-splash.ps1、gen-icons.ps1 注释与 schema.sql 注释
    status: completed
  - id: rename-docs
    content: 将 README.md 与 CODEBUDDY.md 中的旧名全部替换
    status: completed
  - id: rebuild-verify
    content: 执行 npm run build 与 cap copy 并真机校验
    status: completed
    dependencies:
      - rename-core-display
      - rename-scripts-sql
      - rename-docs
---

## 用户需求

将 App 显示名从「表情包管家」改为「表情搜搜」；英文副标题 Emoji AI 保留；包名 / 应用 ID（com.emoji.ai）保持不变。

## 产品概述

本次为纯显示名称变更，不涉及任何功能、数据结构、业务逻辑的改动。目标是把应用所有面向用户可见的名称，以及脚本、注释、文档中出现的旧名，统一替换为「表情搜搜」，保证桌面图标名、Web 标题、引导页标题、启动图文字与项目文档一致。

## 核心功能

- 替换 Android 原生应用中显示在桌面与系统设置里的应用名
- 替换 Web 端页面标题与引导页主标题
- 同步启动图绘制脚本、图标脚本注释、数据库 Schema 注释中的旧名
- 同步更新 README 与项目导航文档（CODEBUDDY.md）中的项目定位名称

## 技术栈

- 沿用现有项目技术栈：Vue 3 + Vite + Capacitor 6（Android）；原生资源 string、Powershell 脚本、Markdown 文档。本次不引入任何新技术与依赖。

## 实现方案

### 策略概述

采用「字符串精确替换」策略，按三类来源分别处理：①核心显示名（原生 string、Capacitor 配置、Web 标题、引导页 UI）；②生成脚本与代码注释；③项目文档。替换内容为固定的「表情包管家」→「表情搜搜」，副标题 Emoji AI 与包名 appId 一律保留。

### 关键决策与理由

- **只改显示名、不动包名**：包名 com.emoji.ai 关联应用安装、SQLite 数据库路径与 Capacitor 插件注册，改名会破坏已安装用户数据，故严格保留。
- **构建产物不手动改**：`dist/`、`android/app/src/main/assets/public/**`、`android/app/build/**` 均由 `npm run build` 与 `npx cap copy android` 生成覆盖，手动编辑会在下次构建被冲掉，列入禁用范围。
- **AndroidManifest 不改**：其 `android:label="@string/app_name"` 仅引用 string 资源，改 `strings.xml` 即全量生效。

### 性能与可靠性

- 本任务为轻量文本替换，无性能开销、无数据库迁移、无接口变更。
- 唯一风险点是漏改导致界面出现新旧名混用，因此通过全局检索「表情包管家」全量比对，并构建后真机校验。

## 实现注意事项

- **禁用 `npx cap sync`**：依据 CODEBUDDY.md 坑点 7，Capacitor 同步会触发 safe-delete 误删插件源文件；改用 `npx cap copy android` 仅同步 Web 资源。
- **启动图文字需重跑脚本才生效**：`gen-splash.ps1` 改的是绘制字符串，必须重新执行脚本才会更新 `splash.png`；若环境不支持 Powershell GDI+ 绘图，可仅改脚本留待后续构建。
- **版本号**：本次仅改名、非强制打包；若执行 `assembleDebug/Release` 须按 CODEBUDDY.md §6 递增 versionCode/versionName。
- **文档同步**：CODEBUDDY.md 约定每次改动后同步更新，故旧名一处不留，避免后续对话 AI 误用旧名。

## 架构设计

本次不涉及架构调整、组件新增或数据流变更，仅做字面量替换。改动前后系统结构、模块关系、数据流向完全一致，故不绘制架构图。

## 目录结构

本次仅修改既有文件，无新增文件。

```
android/app/src/main/res/values/strings.xml   # [MODIFY] app_name 从「表情包管家」改为「表情搜搜」，这是 Android 桌面/设置显示名的核心来源
capacitor.config.ts                            # [MODIFY] appName 字段由「表情包管家」改为「表情搜搜」，供 cap copy 注入
index.html                                     # [MODIFY] <title> 由「表情包管家」改为「表情搜搜」，构建后成为 Web/WebView 标题
src/views/Onboarding.vue                       # [MODIFY] 引导页 <h1> 主标题由「表情包管家」改为「表情搜搜」（用户可见）
scripts/gen-splash.ps1                         # [MODIFY] 启动图绘制字符串 "表情包管家" 改为 "表情搜搜"
scripts/gen-icons.ps1                          # [MODIFY] 脚本首行注释中的「表情包管家」改为「表情搜搜」
src/db/schema.sql                              # [MODIFY] 文件头注释「表情包管家 数据库 Schema」改为「表情搜搜 数据库 Schema」
README.md                                      # [MODIFY] 全文多处「表情包管家」引用统一替换为「表情搜搜」
CODEBUDDY.md                                   # [MODIFY] 项目导航文档中「表情包管家（Emoji AI）」项目定位同步改为「表情搜搜（Emoji AI）」
```
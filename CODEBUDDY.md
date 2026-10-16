# CODEBUDDY.md — emoji-ai 项目导航（给 AI 的协作指南）

> 本文件由 CodeBuddy 在**每次新对话自动加载**，目的是让你（AI）无需重新通读整个仓库即可快速建立项目全貌。
> 部署 / 上架 / 签名等运维细节见 `README.md`，本文不重复，仅在需要时引用。
> 约定：原生路径前缀 `android/app/src/main/java/com/emoji/ai/` 在下文简写为 `android/.../ai/`。

## 0. 语言与沟通约定（红线，最高优先级）

- **所有面向用户的回复、说明、计划、总结一律使用简体中文**，不得混用英文句子或英文段落（代码、命令、专有名词、库名、文件路径除外，例如 `Capacitor`、`SAF`、`EmojiScannerPlugin.java` 等可保留英文原名）。
- **所有计划（plan）、任务拆解、TODO、文档结论也用中文撰写**；不要输出英文版说明或英文小标题。
- 代码标识符（变量/函数/类名）按既有规范可保留英文，但注释与提交信息（commit message）建议用中文。
- 若用户用中文提问，则全程中文；即使用户夹杂英文术语，回复主体仍用中文组织。
- **对用户的提示词有不明白、含糊或存在多种理解的地方，必须先提问澄清，不得凭猜测臆测执行**；只有在不澄清会阻塞任务时才基于合理假设推进，并显式说明该假设。

## 1. 项目一句话定位

**表情搜搜（Emoji AI）**：Android 表情包管理 App。由用户**手动选择表情包文件夹**（SAF 授权）→ 仅扫描该目录图片/GIF → 设备端 AI（ML Kit 中文 OCR + 图像标签/情感识别）离线识别文字、物体与情感，统一转为中文「标签」→ 支持按文字/标签搜索、收藏夹管理、一键转发微信/QQ。**用户概念只有两个：标签 + 收藏夹**（早期版本的「分类」体系与 emotions 列已废弃移除，见 §5）。完全离线、不联网、不上传图片，且不申请全设备存储权限。

## 2. 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Vue 3 + TypeScript + Vite + Pinia + Vue Router + Tailwind CSS |
| 原生包装 | Capacitor 6（Android） |
| 原生插件 | 自研 `EmojiScanner`（Java）：SAF 手动选文件夹、缩略图、AI 调度、分享预处理（已移除 `MANAGE_EXTERNAL_STORAGE` 等全设备权限与自动扫描） |
| 设备端 AI | ML Kit Text Recognition（中文）+ Image Labeling（物体标签）+ 图像情感分类；识别结果统一由前端转为中文标签入库 |
| 存储 | `@capacitor-community/sqlite`（SQLite，Web 调试回退 jeep-sqlite） |
| 分享 | `@capacitor/share`（系统分享面板 + FileProvider 授权） |
| 系统返回键 | `@capacitor/app`（`backButton` 事件 + `exitApp`） |

## 3. 目录地图

```
src/
  views/        # 7 个页面（见 §4.1）
  components/   # 网格/卡片/标签编辑/收藏夹选择/底部弹层/进度/空状态
  stores/       # Pinia：emoji / collection / trash（回收站）
  services/     # nativeBridge(原生门面) / scanner(扫描编排) / share / backup / mockScanner
  db/           # schema.sql + database.ts + repositories/{emoji,collection,search}.ts
  types/index.ts  # 所有 TS 类型，含 EmojiScannerPlugin 原生接口契约
  utils/image.ts  # toImageSrc(file://→WebView 可加载)、formatSize/formatTime
  router/index.ts # 7 条路由，/ 重定向 /onboarding
  App.vue       # 底部 3 标签导航：首页/搜索/收藏夹
android/.../ai/
  EmojiScannerPlugin.java  # Capacitor 插件主类（@CapacitorPlugin name=EmojiScanner）
  FloatingWindowPlugin.java# Capacitor 插件（@CapacitorPlugin name=FloatingWindow）：start/stop/isRunning/openSettings 悬浮窗控制
  FloatingWindowService.java# 系统悬浮窗服务：WindowManager 悬浮球 + 表情面板（收藏/最近/全部、搜索、分享）
  FloatingDbHelper.java    # 悬浮窗直连 emoji_ai 数据库（只读查询 + 写 recent_sends），探测 files/databases 下库文件
  FileWalkerUtil.java      # ⚠️ 残留：仅保留 `ImageEntry` 数据结构供 FolderScannerUtil 复用；原 MediaStore 全设备遍历逻辑已弃用（见 §5 权限约定）
  FolderScannerUtil.java   # SAF(DocumentFile) 递归扫描已授权 treeUri 下图片
  FolderStore.java         # SAF 文件夹授权持久化（SharedPreferences + URI 权限）
  ThumbnailUtil.java       # 缩略图采样解码（file:// 与 content://）+ 磁盘缓存
  MainActivity.java        # registerPlugin(EmojiScannerPlugin.class) + registerPlugin(FloatingWindowPlugin.class)
  ai/AiEngine.java         # AI 统一调度单例（OCR+标签/情感）
  ai/OcrRecognizer.java    # ML Kit 中文 OCR
  ai/EmotionClassifier.java# ML Kit 图像标签
  ai/EmotionMap.java       # 标签→情感词表（8 类，情感英文 key 由前端 EMOTION_LABELS 转中文标签入库）
  ai/ImageLoader.java      # 统一图片解码（content:// 与 file:// 采样解码 + GIF 首帧），供 OCR / 图像标签复用
```

## 4. 改动地图：改某功能去哪个文件

### 4.1 页面（views/）

| 页面 | 文件 | 职责 |
| --- | --- | --- |
| 引导 | `src/views/Onboarding.vue` | 介绍功能、引导用户手动选择表情包文件夹（SAF 授权），不再申请全设备权限 |
| 首页 | `src/views/Home.vue` | 表情网格、收藏夹快捷入口、多选批量删除、文件夹管理（添加/扫描/移除）、长按操作、悬浮窗快速发送开关与权限引导 |
| 搜索 | `src/views/Search.vue` | 文字关键词（OCR 文字/标签，含收藏夹名命中）+ 搜索历史 |
| 详情 | `src/views/EmojiDetail.vue` | 大图预览、中文标签查看/修正、收藏、分享、复制路径 |
| 收藏夹列表 | `src/views/Collections.vue` | 新建/重命名/删除、导出备份 |
| 收藏夹详情 | `src/views/CollectionDetail.vue` | 重命名/删除/移出表情/分享 |
| 回收站 | `src/views/Trash.vue` | 已软删表情网格、单条恢复/彻底删除、清空回收站（均不删手机原图） |

### 4.2 功能 → 文件（核心价值）

| 功能 | 主要文件（相对路径） |
| --- | --- |
| **手动选择文件夹扫描（本机图片/GIF）** | 编排：`src/services/scanner.ts`（`scanFolderMetadata`/`scanFolderAndRecognize`）→ 桥接：`src/services/nativeBridge.ts`（`scanFolder`）→ 原生：`android/.../ai/EmojiScannerPlugin.java` + `FolderScannerUtil.java`（SAF 递归）；触发：`src/stores/emoji.ts`（`startFolderScan`/`addFolderAndScan`）、`Home.vue` 文件夹管理面板（顶栏「选择文件夹」与空状态按钮均打开该面板，不再直接调 SAF 选目录）、`Onboarding.vue` |
| **AI 识别 — OCR 文字** | 原生：`android/.../ai/OcrRecognizer.java`（经 `ai/ImageLoader.java` 统一解码 content:// 与 file:// 后走 `InputImage.fromBitmap`）、`EmojiScannerPlugin.java`（`recognizeBatch`）；前端调度：`src/services/scanner.ts`（`runRecognitionQueue`）+ `nativeBridge.ts`；失败重试入口：`scanner.ts`（`reRecognizeAll`）+ `stores/emoji.ts`（`reRecognizeFailed`）+ `Home.vue` 文件夹面板「重新识别失败表情」 |
| **AI 识别 — 标签生成（前端）** | 原生：`android/.../ai/EmotionClassifier.java`（图像标签）+ `EmotionMap.java`（标签→情感）+ `AiEngine.java`（`analyze` 统一入口）；前端 `src/services/scanner.ts`（`runRecognitionQueue`）把原生返回的 labels（物体）与 emotions（情感英文 key）分别经 `src/db/repositories/emoji.ts` 的 `mapLabelsToChinese`（走 `labelDict.ts` 词典）与 `mapEmotionsToChinese`（走 `labelDict.ts` 的 `EMOTION_LABELS`）转中文，合并去重后写入 `emojis.tags` 单列 |
| **AI 调度编排** | 前端：`src/services/scanner.ts`（`runRecognitionQueue` 取待识别队列→批量识别→写库，物体/情感标签统一转中文合并入库）；原生：`AiEngine.java` |
| **按文字搜索** | UI：`src/views/Search.vue`（关键词匹配 OCR 文字与标签，另合并收藏夹名命中结果）；SQL：`src/db/repositories/emoji.ts`（`search` 用 LIKE）；历史：`src/db/repositories/search.ts` |
| **标签修正（中文）** | UI：`src/views/EmojiDetail.vue`（标签区常开编辑，无「修正/保存」开关）+ `src/components/TagEditor.vue`（单一中文标签编辑区，新增 `saveTags`/`saveText` 事件即时落库）；交互：输入后点「添加」或回车即写库、点标签 X 即删除生效、OCR 文字失焦自动保存，全程即时持久化不丢改；写库：`src/stores/emoji.ts`（`updateTags`）+ `src/db/repositories/emoji.ts`（`updateUserTags`，仅 `ocrText`/`tags` 两字段，支持部分更新） |
| **收藏夹（总收藏 + 多自定义）增删改** | UI：`src/views/Collections.vue`、`CollectionDetail.vue`、`src/components/CollectionPicker.vue`；状态：`src/stores/collection.ts`；SQL：`src/db/repositories/collection.ts`（含 `ensureDefaultCollection`） |
| **一键转发 / 分享到微信/QQ** | `src/services/share.ts`（`shareEmoji`/`shareEmojis`）；原生拷贝缓存：`nativeBridge.ts`（`prepareForShare`）+ `EmojiScannerPlugin.java`；统一入口：`src/stores/emoji.ts`（`share`） |
| **删除表情（软删除 + 回收站）** | 入口：`src/views/Home.vue`（长按面板/多选操作栏「删除」+顶栏回收站图标角标）、`src/views/EmojiDetail.vue`（「删除」按钮）；页面：`src/views/Trash.vue`（恢复/彻底删除/清空）；状态：`src/stores/trash.ts`；SQL：`src/db/repositories/emoji.ts`（`softDelete`/`restoreEmojis`/`getDeleted`/`countDeleted`/`purgeEmojis`/`purgeAllDeleted`）；所有读查询（首页/收藏/搜索/统计/收藏夹数量）统一过滤 `deleted_at = 0` |
| **数据持久化（SQLite）** | 初始化：`src/db/database.ts`；建表：`src/db/schema.sql`；各表读写：`src/db/repositories/*.ts` |
| **引导 / 手动选文件夹** | `src/views/Onboarding.vue`（引导 + 调起 `addFolderAndScan`）；原生：`EmojiScannerPlugin.java`（`openFolderPicker`）；持久化：`FolderStore.java` |
| **系统返回键（二级页回退 / 无历史退出）** | 入口：`src/main.ts`（`setupBackButton`：`Capacitor.isNativePlatform()` 守卫 + `App.addListener('backButton')`）；浮层/多选拦截：`src/services/backHandler.ts`（LIFO 处理器栈，`pushBackHandler`/`consumeBackEvent`），接入方 `src/components/BaseSheet.vue`（弹层可见时注册）、`src/views/Home.vue`（多选模式注册）；根路径重定向 `replace`：`src/router/index.ts`。原生侧 `BridgeActivity` 默认不处理返回键（按返回即 finish 退出），须安装 `@capacitor/app` 并由 AppPlugin 的 `OnBackPressedCallback` 接管；新增官方插件需手工装配 `android/capacitor.settings.gradle` / `android/app/capacitor.build.gradle` / `android/app/src/main/assets/capacitor.plugins.json` 三处（勿用 `cap sync`，见 §7） |
| **缩略图生成与缓存** | 原生：`android/.../ai/ThumbnailUtil.java`（`getOrCreate`/`clear`）；前端仅引用返回的 `thumbPath`（`src/components/EmojiCard.vue`、`src/utils/image.ts`） |
| **Web 端调试（无原生环境）** | `src/services/mockScanner.ts`；由 `nativeBridge.ts` 的 `USE_MOCK = !Capacitor.isNativePlatform()` 自动切换 |
| **悬浮窗快速发送（系统悬浮球）** | 开关/权限引导：`src/views/Home.vue`（文件夹面板「悬浮窗快速发送」开关 + `toggleFloating`，无权限时引导 `openSettings`）→ 门面：`src/services/nativeBridge.ts`（`FloatingWindow`，Web Mock 兜底）+ 类型 `src/types/index.ts`（`FloatingWindowPlugin`）；原生插件：`android/.../ai/FloatingWindowPlugin.java`（`start` 前 `Settings.canDrawOverlays` 校验，`openSettings` 跳系统权限页）；核心 Service：`FloatingWindowService.java`（WindowManager 悬浮球 + 面板「收藏/最近/全部」、搜索 LIKE、**只有分享**=`ACTION_SEND` 系统面板，复制功能已实测无用并移除）；直连库：`FloatingDbHelper.java`（打开 `emoji_ai`，统一 `deleted_at=0`）；「最近发送」：`src/db/schema.sql` 的 `recent_sends` 表 + `database.ts` 的 `ensureRecentSendsTable` + `emoji.ts` 的 `recordSend`（App 内分享也沉淀）。需 `SYSTEM_ALERT_WINDOW` 本地权限（不联网/不上传），前台服务 `specialUse` 常驻 |

### 4.3 组件（components/）

| 组件 | 文件 | 职责 |
| --- | --- | --- |
| 表情网格 | `src/components/EmojiGrid.vue` | 网格 + 无限滚动（IntersectionObserver `load-more`）+ 多选支持 |
| 表情卡 | `src/components/EmojiCard.vue` | 缩略图（优先 `thumbPath`）、GIF 角标、收藏星标、长按计时 |
| 标签编辑器 | `src/components/TagEditor.vue` | 单一中文标签编辑区（AI 情感/物体 + 用户自定义）+ OCR 文本 |
| 收藏夹选择器 | `src/components/CollectionPicker.vue` | 可选中或现场新建收藏夹 |
| 底部弹层 | `src/components/BaseSheet.vue` | 通用 sheet（teleport body、ESC 关闭） |
| 扫描进度 | `src/components/ScanProgress.vue` | 百分比 + 阶段文案，订阅 `ScanProgress` |
| 空状态 | `src/components/EmptyState.vue` | 占位 |
| ⚠️ 残留 | `src/components/HelloWorld.vue` | create-vue 脚手架残留，**未被引用，勿作为功能组件** |

### 4.4 Pinia stores

- `src/stores/emoji.ts`：首页网格 `items/total/pendingCount/scanState`；动作 `init`/`addFolder`/`addFolderAndScan`/`startFolderScan`/`reRecognizeFailed`/`removeFolder`/`toggleFavorite`/`updateTags`/`share`（`share` 成功后经 `emojiRepo.recordSend` 沉淀「最近发送」，与悬浮窗共用 `recent_sends`）。
- `src/stores/collection.ts`：收藏夹 `collections`/`currentItems`；`create`/`rename`/`remove`/`addEmoji`/`removeEmoji`/`isIn`/`collectionsOf`（isDefault 时同步总收藏）。
- `src/stores/trash.ts`：回收站 `items/deletedCount`；`loadTrash`(分页)/`refreshCount`(首页角标)/`moveToTrash`/`restore`/`purge`/`clearAll`。删除/恢复动作会同步角标。

### 4.5 前端 ↔ 原生桥接（务必看清）

- 注册：`src/services/nativeBridge.ts` 用 `registerPlugin<EmojiScannerPlugin>('EmojiScanner')`，与 Java `@CapacitorPlugin(name = "EmojiScanner")` 严格对应。
- 注册（悬浮窗）：`nativeBridge.ts` 另注册 `registerPlugin<FloatingWindowPlugin>('FloatingWindow')`（`USE_MOCK` 时走内存 Mock 兜底），与 Java `@CapacitorPlugin(name = "FloatingWindow")` 对应；`MainActivity.java` 需 `registerPlugin(FloatingWindowPlugin.class)`。方法 `start`/`stop`/`isRunning`/`openSettings` 同名对应。
- 方法 1:1 映射（TS 契约在 `src/types/index.ts`）：`scanFolder`/`recognizeBatch`/`cancelScan`/`prepareForShare`/`openFolderPicker`/`listFolders`/`removeFolder` 同名对应；进度事件 `addListener('scanProgress', cb)` ↔ 原生 `notifyListeners("scanProgress", ...)`（由 `scanner.ts` 的 `onProgress` 订阅）。
- 字段归一化：`nativeBridge.ts` 的 `normalizeScanItem()` 统一原生（秒级 `mtime`/`mimeType`/`thumbPath`）与 Mock（毫秒 `mtime`/`mime`/`thumbUri`）差异。

## 5. 关键约定与取舍（改动前先读）

- **搜索用 `LIKE` 而非 FTS5**：规避 Android 系统 SQLite 未启用 FTS5 的兼容风险。见 `src/db/repositories/emoji.ts` 的 `search()`。
- **标签单列化（唯一标签存储）**：用户概念只有「标签 + 收藏夹」。`emojis.tags` 是唯一标签列（全中文）：AI 物体标签经 `mapLabelsToChinese`（`labelDict.ts` 词典）、AI 情感英文 key 经 `mapEmotionsToChinese`（`labelDict.ts` 的 `EMOTION_LABELS`，neutral 不生成标签）转换后在 `scanner.ts` 的识别入口合并去重写入；用户手动增删走 `EmojiDetail.vue` + `TagEditor.vue`。**不存在**分类表、分类页面、标签浏览入口与全局标签管理（重命名/合并/删除某标签均不支持，只能逐张表情改）。早期的 `categories`/`category_items` 表与 `emotions` 列已由 `database.ts` 的 `migrateToTagOnlyModel` 一次性迁移废弃（历史分类数据不迁移，emotions 中文名并入 tags）。
- **搜索即检索标签**：标签没有独立浏览页，搜索是唯一「按标签批量查看」的途径：`search()` 用 LIKE 匹配 `ocr_text` 与 `tags`（情感中文名与物体/自定义标签同列，直接命中）。
- **完全离线、不联网、不上传图片**：ML Kit 中文 OCR 模型随 APK（约 48MB Release 包），AI 在 Java 层完成。
- **首次识别串行后台**：所选文件夹图片首次 AI 识别串行处理（控内存），策略为「先出缩略图、后台识别」保证可浏览。
- **备份为收藏夹结构 + 文件路径引用**（不含图片本体）：同机恢复可直接定位，换机需路径一致。见 `src/services/backup.ts`。
- **权限**：不再申请 `MANAGE_EXTERNAL_STORAGE` 等全设备存储权限；仅通过 SAF（系统目录选择器 `openFolderPicker`）让用户手动授权表情包所在文件夹，App 只读取用户主动选择的目录，且不联网、不上传图片。
- **Mock 兜底**：非原生平台（`USE_MOCK`）走 `mockScanner.ts`，Web 可直接调试 UI。
- **删除=软删除（回收站）**：App 内「删除表情」一律只写 `emojis.deleted_at`（时间戳），不删手机源文件；首页/收藏/搜索/统计等所有读路径统一过滤 `deleted_at = 0`（新查询勿忘）。`getPathMtimeMap()` 故意不过滤，防止重新扫描时已删表情复活。`upsertEmoji`/`upsertEmojisBatch` 不写 `deleted_at`。彻底删除走 `purgeEmojis`（连 `collection_items` 一并清理），重新扫描同文件夹会再次入库。新增查询 emojis 的地方默认应加 `deleted_at = 0`。
- **页面缓存与滚动位置记忆（keep-alive）**：`App.vue` 的 `router-view` 用 `<keep-alive :include="['Home','Search','Collections','CollectionDetail','Trash']">` 缓存列表页（组件名 = SFC 文件名，`<script setup>` 由编译器注入 `__name`，真机/Web 均可用 `include` 匹配），详情页 `EmojiDetail` 等不缓存、每次进入全新实例。滚动容器是 `App.vue` 的 `<main class="flex-1 overflow-y-auto">`（非 window），位置记忆由 `App.vue` 的 `watch(route.fullPath)` 维护：离开页面前存 `scrollMemory` 并把容器清零，返回时在 `<transition>` 的 `@enter`/`@after-enter` 恢复（`mode="out-in"` 下内容在过渡结束后才最终就绪，`@after-enter` 必达）。**新增列表页若想享受「返回不回到顶部」，须把组件名加进 `cachedViews`，并补 `onActivated` 刷新**（Search/Collections/CollectionDetail/Trash 均已按旧行为「每次进入重拉数据」补齐）。首页故意不在 `onActivated` 全量重载（会重置分页、滚动恢复失效），跨页数据同步改走 store：删除走 `emojiStore.removeFromGrid(ids)`（`EmojiDetail`/`Home` 删除、`Trash` 恢复后 `loadGrid(true)`），收藏/标签改由 `toggleFavorite`/`updateTags` 原地更新 items。**勿给 `<keep-alive>` 加 `v-if` 条件包裹**：KeepAlive 自身卸载会清空缓存，往返二级页后依然回顶部。

## 6. 常用命令

```bash
npm run dev                  # 本地开发（Vite，host 0.0.0.0，手机可局域网访问）
npm run build                # vue-tsc 类型检查 + Web 构建
npx cap sync                 # 同步 Web 资源与插件到 Android 工程
npx cap open android         # 用 Android Studio 打开
cd android; .\gradlew.bat assembleDebug     # 调试包
cd android; .\gradlew.bat assembleRelease  # 发布包（需先配置签名，见 README）
```

> **⚠️ 每次改动必须递增版本号（强制，无论大小）**：这是用户明确要求的流程约定——**每完成任何一次代码改动（新功能 / 修复 / 优化，无论大小），收尾交付前都必须同步更新** `android/app/build.gradle` 第 18-19 行：`versionCode` 每次 **+1（只增不减、禁止重复）**，`versionName` 语义化递增（修 bug `1.0.0` → `1.0.1`，新功能升次版本号 `1.1.0`），两个字段在同一次构建内同步更新，不确定当前值时先读文件再改。**不得因改动小就跳过，也不得攒多次改动才升一次**；每次执行 `assembleDebug` / `assembleRelease` 打包也以此为前提，未递增不得打包，确保每个 APK 可辨识版本。`package.json` 的 `version` 为脚手架默认值，不参与 App 版本，无需改动。

> **⚠️ 覆盖安装（直接升级）前提**：用户下载新 APK 后须能直接覆盖安装旧版并保留数据（SQLite、收藏夹、SAF 授权由系统自动保留，业务代码无需改动）。三个硬性条件：① `applicationId` 固定 `com.emoji.ai`，永不得改；② release 必须用**同一把** `android/app/emoji-ai.keystore` 签名，**严禁重新生成或更换密钥库**（签名变 = 存量用户被迫卸载重装 = 数据全丢），`android/app/build.gradle` 已有 release 签名守卫 fail-fast；③ 每次打包 `versionCode` 只增不减（见上一条）。debug 包签名与 release 不同，切勿对外分发或与 release 混装。详见 README「覆盖安装（直接升级，无需卸载）」一节。

## 7. ⚠️ 已知坑点（改动前务必注意）

1. ~~**Android 工程当前无法编译**~~ **已修复**：原 `EmojiScannerPlugin.java` 引用了 `FolderScannerUtil` 与 `FolderStore` 两个不存在的类。现已补齐（见 `android/.../ai/FolderScannerUtil.java`、`FolderStore.java`）：`FolderStore` 用 SharedPreferences 持久化 SAF 文件夹授权（treeUri+名称）并管理 URI 权限；`FolderScannerUtil` 用 `DocumentFile` 递归扫描 treeUri 下图片（返回 content:// 路径）。同时补了 `app/build.gradle` 的 `androidx.documentfile:documentfile:1.0.1` 依赖，以及 `EmojiScannerPlugin` 的 `import android.app.Activity;`（用于 `Activity.RESULT_OK`）。`ThumbnailUtil` 已增强支持 content:// 缩略图解码。改动文件夹相关功能可直接进行。
   - ~~已知限制：SAF 返回 content:// 的原图显示/分享链路未适配~~ **已修复**：`FolderScannerUtil.scanTree` 对 `DocumentFile.listFiles()` 返回 null 时改用 `DocumentsContract.buildChildDocumentsUriUsingTree` 显式遍历兜底，并加诊断日志（`scanTree`/`scanFolder` 打印 persisted 权限、total、各层 found）；大图预览/分享经新增原生方法 `getViewableUrl`（`content://` → 缓存拷贝为 `file://`）与改造后的 `prepareForShare`（`ThumbnailUtil.copyToCache` 支持 content://）完成适配，前端 `utils/image.ts` 的 `toImageSrcAsync` 统一处理。仍需真机回归验证。
2. **`HelloWorld.vue` 为脚手架残留**，无任何引用，不要当作功能组件改动或引用。
3. **`src/db/schema.sql` 用 `?raw` 导入**（`database.ts` 中 `import './schema.sql?raw'`），改表结构后需重新 `cap sync` 并考虑旧库迁移。新增列（如 `deleted_at`）必须同时写幂等迁移：`database.ts` 的 `ensureDeletedAtColumn()` 用 `PRAGMA table_info` 判断后 `ALTER TABLE ADD COLUMN`（`CREATE TABLE IF NOT EXISTS` 不会给旧库加列，真机会报 `no such column`）。
4. **`emotions` 列与分类表已废弃移除，勿再引用**：早期版本 `emojis.emotions`（英文 key）与 `categories`/`category_items` 两表已从 schema 与代码中移除；老库由 `database.ts` 的 `migrateToTagOnlyModel` 一次性迁移（emotions 中文名并入 `tags`、删表、尝试 DROP COLUMN）。**新增任何标签/识别相关逻辑只写 `emojis.tags` 单列**；原生 `recognizeBatch` 仍返回英文 `emotions`，那是 AI 中间结果，前端转中文后入库，不要再建列或建表。
5. **真机扫描失败排查（Android 16 重点）**：扫描链路已内置诊断日志，失败时首页会显示红色警示条并携带原生错误码（不再静默）。抓日志：`adb logcat -v time FolderScannerUtil:V EmojiScanner:V FolderStore:V *:S`。三个易踩点：① 枚举**不能**以 `DocumentFile.exists()/isDirectory()` 作为前置门槛（部分 ROM 会对有效目录返回 `false` 导致直接判空），已改为 `DocumentsContract.buildChildDocumentsUriUsingTree` 主通道 + `DocumentFile` 兜底双通道；② 持久化授权需 `READ|WRITE` 掩码（Android 15+ 只传 READ 会抛 `SecurityException`）；③ `scanner.ts` 的 `addFolder()` 已区分「用户取消」与「真实异常」，真实异常上抛并写入 `scanState.phase='error'`。
6. **JS 侧 `undefined.replace` 反复坑**：所有手写 SQL 字符串拼接转义 `esc()`（`emoji.ts`）必须 `String(s ?? '').replace(...)`，且 `toRecord()` 对原生字段要给默认值（`item.mime ?? 'image/jpeg'` 等）——否则原生返回 `mimeType` 而前端读 `mime` 得到 `undefined`，`esc(undefined)` 直接 `Cannot read properties of undefined (reading 'replace')`，整批入库失败且 UI 表现为静默/红色错误条。**`nativeBridge.scanFolder` 的真机分支必须过 `normalizeScanItem`**（Mock 分支有、真机分支曾漏），否则字段名映射缺失必崩。识别结果（`recognizeBatch` 返回）字段（`ocrText`/`labels`/`emotions`）亦需 `??` 兜底，因真机原生返回形状可能与 Web 不同。
7. **schema.sql 严禁 CRLF 行尾**：原生 `@capacitor-community/sqlite` 的 `execute` 内部按 `split(";\n")`（LF）拆分语句（`UtilsSQLite.getStatementsArray`），CRLF 下拆分失效，整份 schema 被当作一条语句交给 Android `execSQL`，**只建成第一张表（emojis）**，`categories`/`collections` 等全部缺失 → 真机报 `no such table: categories`（Web 端 jeep-sqlite 能完整执行多语句，所以只有真机暴露）。已修复：`database.ts` 新增 `initSchema()` 在 JS 侧按 `;` 拆分、剥 `--` 行注释后**逐条 `conn.run()`**，与行尾无关；同时 `schema.sql` 已规范化为 LF 行尾（双保险）。新增 SQL 文件时保持 LF。
7. ~~**OCR / 图像标签在 SAF 场景下静默失效**~~ **已修复**：`OcrRecognizer`/`EmotionClassifier` 曾用 `new File(path).exists()` 作前置门槛，而 SAF 扫描入库的 path 全是 `content://`，恒判空导致识别全空（缩略图因 `ThumbnailUtil` 已适配 content:// 而正常，极具迷惑性）。现统一走 `ai/ImageLoader.java`（content:// 与 file:// 采样解码，GIF 取首帧）+ `InputImage.fromBitmap`。**今后新增任何「按路径读原图」的原生逻辑都必须同时支持 content://，禁止再用 `File.exists()` 一刀切**；存量失败数据经 `Home.vue` 文件夹面板「重新识别失败表情」重置 `fail_count` 后重新入队（`emojiRepo.resetFailedRecognition`）。
6. **打包勿用 `npx cap sync`**：本机 safe-delete 会拦截 >500 文件的批量删除，导致 `cap update` 中途失败并删掉 `android/capacitor-cordova-android-plugins` 的 gradle 源文件（`build.gradle` / `cordova.variables.gradle` / `src/`），使构建报 `Could not read script ... cordova.variables.gradle`。改用 `npx cap copy android` 只同步 Web 资源。若文件已缺失，从 `node_modules/@capacitor/cli/assets/capacitor-cordova-android-plugins.tar.gz` 解压还原，并补写 `cordova.variables.gradle`（模板见 `@capacitor/cli/dist/android/update.js`），同时在模块 `build.gradle` 末尾加 `apply from: "cordova.variables.gradle"`（否则报 `unknown property 'cdvPluginPostBuildExtras'`）。
8. ~~**点击「源文件已删除」的表情包即闪退**~~ **已修复**（2026-10-16）：根因是 SAF 场景下 `getViewableUrl` 拷贝失败时，前端回退逻辑把原始 `content://` 交给 `Capacitor.convertFileSrc()`，WebView 随即经 Capacitor 本地服务器（`/_capacitor_content_/…`）去打开一个**已不存在的 SAF 文档**；而 Capacitor 的 `WebViewLocalServer` 只捕获 `IOException`，部分 ROM 的 DocumentsProvider 对失效文档会抛**非 IOException 的运行时异常**，从 `shouldInterceptRequest` 逃出到 WebView IO 线程 → 进程未捕获异常 → 闪退。修复（三层防护）：① 原生 `EmojiScannerPlugin.getViewableUrl` 先用 `openInputStream` 探测源可读性（`isSourceReadable`），不可读/拷贝失败一律返回 `{ url: "", missing: true }`，**绝不回退 content://**；② `utils/image.ts` 的 `toImageSrcAsync` 收到 missing（或返回仍为 content://、或抛错）时返回空串，不再请求 `_capacitor_content_`；③ `EmojiDetail.vue` 对空 src / img `@error` 展示「源文件已删除或无法加载」占位图，分享按钮对缺失源直接提示。**今后任何把 URI 交回 WebView 的链路都必须先验证源可读，禁止把可能失效的 content:// 透传。**

## 8. 本文档的维护约定（给后续对话的 AI）

本文件随项目演进可能过时，**每次代码改动后应由 AI 同步更新对应小节**，保持"改动地图"准确；且按用户强制约定，**每次改动（无论大小）还必须同步递增版本号并更新更新日志**（见下文两条强制条款）。

- **更新映射**：新增/删除页面、组件、store、service、repository 或功能实现文件时，更新 §4 对应表格（§4.1 页面 / §4.2 功能→文件 / §4.3 组件 / §4.4 stores / §4.5 桥接）。
- **更新约定**：改了数据库表、技术栈、构建命令时，更新 §5 关键约定 / §2 技术栈 / §6 常用命令。
- **坑点修复后必须清**：§7 的"已知坑点"一旦被修复，立即将该条改为「已修复，见 `路径`」或删除，避免误导。
- **更新日志两处同步**：新增/修改版本内容时**只改唯一数据源** `src/data/changelog.json`（在数组最前面插入新版本；`version` 必须与 `android/app/build.gradle` 的 `versionName` 一致），然后运行 `node scripts/gen-changelog.mjs` 重新生成根目录 `CHANGELOG.md`；App 内展示由 `src/views/Changelog.vue` 与 `src/views/Mine.vue` 经 `src/components/ChangelogCard.vue` 从同一 JSON 派生。**禁止在页面或 CHANGELOG.md 中硬编码版本文字**。底部导航「我的」页（`/mine`，即 `Mine.vue`）集成了收藏夹管理与更新日志两大入口，原 `/collections` 路由与 `Collections.vue` 保留为深链。
- **版本号必须随每次改动递增（强制，无论大小，不得弱化）**：用户明确要求的流程约定——**每完成任何一次代码改动（新功能 / 修复 / 优化，无论大小），收尾交付前都必须**把 `android/app/build.gradle` 的 `versionCode` +1（只增不减、禁止重复）、`versionName` 按语义化递增（修 bug 升补丁号，新功能升次版本号），并与 `src/data/changelog.json` 新增条目的 `version` 保持一致（见上「更新日志两处同步」）。**不得以「改动小」为由跳过，也不得攒多次改动才升一次**；后续对话不得删除、跳过或降低该约定优先级，执行任何 gradle 打包前同样以此为前提。
- **版本号约定不得弱化**：§6 的「每次改动必须递增版本号」是用户明确要求的强制约定，后续对话不得删除、跳过或降低其优先级；执行任何 gradle 打包前必须先递增 `android/app/build.gradle` 的 `versionCode` / `versionName`。
- **更新日志必须随每次改动同步（强制，不得弱化）**：这是用户明确要求的流程约定。**每完成任何一次代码改动（新功能 / 修复 / 优化，无论大小），在收尾交付前都必须**按 §8「更新日志两处同步」的做法更新唯一数据源 `src/data/changelog.json`（追加对应版本条目，`version` 与 `android/app/build.gradle` 的 `versionName` 保持一致）并运行 `node scripts/gen-changelog.mjs` 重新生成根目录 `CHANGELOG.md`；不得跳过、不得改为在页面或 `CHANGELOG.md` 硬编码版本文字。若某次改动无用户可感知变化（如仅重构 / 文档 / 内部清理），也须在回复中显式说明本次为何不新增版本条目。
- **更新日志顺序：新内容在前、老内容在后（强制，不得弱化）**：`src/data/changelog.json` 与其生成的 `CHANGELOG.md` 都必须保持**最新版本在最前面（JSON 数组头部 / 文档顶部），最早版本在最后面**。每次新增版本条目一律**插入到数组最前面**（而非追加到末尾），生成后的 `CHANGELOG.md` 顶部应为最新版本；不得反向排列，也不得在已有条目之后追加导致顺序颠倒。
- **覆盖安装纪律不得弱化**：§6 的「覆盖安装前提」（同 `applicationId`、同一密钥库、`versionCode` 递增）是用户明确要求，后续对话**不得建议重新生成/更换密钥库、不得修改 `applicationId`**；对外分发 APK 前必须确认同签名且版本号已递增，避免存量用户被迫卸载重装丢数据。
- **红线**：保持精炼，不重复 `README.md` 的部署/签名/上架细节；写入的所有路径必须真实存在（更新后自查）；不膨胀成第二个 README。

<!-- 维护提示：技术栈/目录结构大改后，让 AI 重新探索 src/ 与 android/ 并刷新 §4 改动地图 -->

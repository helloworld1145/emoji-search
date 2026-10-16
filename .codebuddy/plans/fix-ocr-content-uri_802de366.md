---
name: fix-ocr-content-uri
overview: 修复设备端 OCR（及图像标签）在 SAF 扫描场景下完全失效的问题：根因是原生识别层只认 file:// 路径，对 SAF 扫描返回的 content:// URI 直接判空返回；同时为已被判失败踢出识别队列的历史数据提供"重新识别"入口。
todos:
  - id: fix-native-recognize
    content: 原生识别层适配 content://：新增 ImageLoader.java，改造 OcrRecognizer 与 EmotionClassifier 改用 InputImage.fromBitmap 并补日志
    status: completed
  - id: add-re-recognize-entry
    content: 前端新增重新识别入口：emoji.ts 重置失败计数、scanner.ts 编排、emoji store 动作、Home.vue 文件夹面板按钮
    status: completed
    dependencies:
      - fix-native-recognize
  - id: update-docs
    content: 更新 CODEBUDDY.md：§4.2 识别链路说明与 §7 坑点记录 content:// 已适配
    status: completed
    dependencies:
      - add-re-recognize-entry
  - id: build-verify
    content: 递增版本号（versionCode 3 / versionName 1.0.2），cap copy 后 gradle 打包，真机验证 OCR 与分类恢复
    status: completed
    dependencies:
      - update-docs
---

## 用户需求

真机上通过 SAF 选择表情包文件夹扫描入库后，OCR 文字识别完全无效：图片能正常加载显示，但 ocrText 全部为空，按文字搜索不到任何表情。

## 问题根因（已读码确认）

1. 核心根因：原生识别层 `OcrRecognizer.java` 与 `EmotionClassifier.java` 均用 `new File(imagePath).exists()` 作为前置门槛，再用 `InputImage.fromFilePath(context, Uri.fromFile(f))`。而 SAF 扫描入库的 path 全部是 `content://` URI（`FolderScannerUtil.scanTree`），`new File("content://...").exists()` 恒为 false，每张图直接返回空，OCR 与图像标签（AI 物体分类）实际全部失效。缩略图正常是因为 `ThumbnailUtil` 已单独适配 content://，只有识别链路漏改。
2. 次生问题：`runRecognitionQueue` 对无信号结果调用 `markRecognizeFailed`（fail_count+1），而 `getPendingRecognize` 条件是 `fail_count < 3`。用户库里已扫过的表情多数 fail_count 已大于等于 3，即使修好原生代码也不会再进识别队列，用户侧看不到任何变化，必须提供「重新识别」入口重置这些记录。
3. 次要改进：`InputImage.fromFilePath` 对 content:// 的 GIF/WebP 解码不稳，且原生 catch 块全部静默无日志，真机无法排查。

## 修复后效果

- 修复后重新扫描（或点「重新识别」）时，带文字的表情包能识别出中英文文字并入库，首页 AI 物体分类同时恢复，搜索页可按文字关键词搜到表情。
- 历史已入库但识别失败的表情可通过一次点击重新入队识别，无需删库重扫。

## 技术栈

- 原生层（改动核心）：Java + ML Kit（`text-recognition-chinese:16.0.1`、`image-labeling:17.0.9`，bundded 模型随 APK，无需联网，依赖已就位不改）
- 前端：Vue 3 + TypeScript + Pinia + SQLite（`@capacitor-community/sqlite`），沿用现有 repository / service / store 分层

## 实现方案

### 1. 原生识别层适配 content://（核心修复）

新增 `android/app/src/main/java/com/emoji/ai/ai/ImageLoader.java`，作为统一图片解码工具，提供 `load(Context, String path, int target)`：

- `content://`：经 `ContentResolver.openFileDescriptor` 两遍解码（先 `inJustDecodeBounds` 取边界算 `inSampleSize`，再采样解码），`BitmapFactory` 对 GIF 自动取首帧；
- `file://`：`BitmapFactory.decodeFile` 同款采样逻辑；
- 目标边长参数化：OCR 传 1280（保识别率），图像标签传 640；
- 失败返回 null 并打 `Log.w`（只含 path 尾段，避免泄露隐私）。

改造 `OcrRecognizer.recognize()` 与 `EmotionClassifier.classify()`：

- 删除 `new File(path).exists()` 前置门槛；
- 改用 `ImageLoader.load(...)` 得到 Bitmap，为 null 时返回空并记日志；
- 改走 `InputImage.fromBitmap(bmp)`（对 content:// 的 GIF/WebP 比 fromFilePath 更稳，且统一 file:// 与 content:// 两条路径），用后 `bmp.recycle()`；
- catch 块补 `Log.e/w`（TAG 分别为 `OcrRecognizer` / `EmotionClassifier`），不再静默。

### 2. 前端「重新识别」入口（让存量数据生效）

- `src/db/repositories/emoji.ts`：新增 `resetFailedRecognition()`，执行 `UPDATE emojis SET recognized = 0, fail_count = 0 WHERE recognized = 0 AND fail_count >= 3`，返回受影响行数（参数化 SQL，沿用现有 query/run 封装）。
- `src/services/scanner.ts`：新增 `reRecognizeAll()`：先调 `resetFailedRecognition()`，再复用现有 `runRecognitionQueue()`（识别编排、进度事件、写库逻辑完全不动）。
- `src/stores/emoji.ts`：新增 `reRecognizeFailed()` 动作，防重入，完成后 `refreshCounts()` + `loadGrid(true)`，失败写入 `scanState.phase='error'` 供首页红色警示条展示。
- `src/views/Home.vue`：在文件夹管理面板（第 330-376 行 BaseSheet 内）「添加文件夹」按钮上方新增「重新识别失败表情」按钮，点击调用 `emojiStore.reRecognizeFailed()`，复用现有 toast 与 `scanning` 禁用态。

## 关键取舍

- 用 `ImageLoader.load + InputImage.fromBitmap` 而非 `InputImage.fromFilePath`：fromFilePath 对 content:// GIF 依赖 provider 实现，部分 ROM 不稳；自行解码可控、可采样控内存、两条路径一套代码。
- OCR 目标边长取 1280 而非全尺寸：表情包文字通常较小，1280 足够；单张识别内存峰值约 6MB，配合现有单线程 executor 串行执行，内存安全。
- 「重新识别」只重置 `recognized=0 且 fail_count>=3` 的记录，不动已识别与用户手改过的数据（`applyAiResult` 本身也只填空值，双保险）。

## 执行注意

- 不引入新架构模式，沿用 ThumbnailUtil 既有解码策略与 scanner/store 现有分层。
- 打包验证前必须递增 `android/app/build.gradle`：versionCode 2 到 3，versionName "1.0.1" 到 "1.0.2"；同步用 `npx cap copy android`，禁用 `cap sync`（见 CODEBUDDY.md 坑点）。
- 真机验证抓日志：`adb logcat -v time OcrRecognizer:V EmotionClassifier:V EmojiScanner:V FolderScannerUtil:V *:S`。
- schema 无改动，无数据库迁移成本。
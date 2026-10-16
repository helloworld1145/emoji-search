---
name: ai-label-translate-cn
overview: 扩充前端「英文 AI 标签 → 中文」词典，使自动识别产生的英文标签统一翻译为中文入库，并对历史已入库的英文标签做一次性幂等迁移。
todos:
  - id: create-label-dict
    content: 新建 src/db/labelDict.ts：静态英中标签词典、LABEL_DICT_VERSION 与 translateLabel 归一化查询
    status: completed
  - id: refactor-emoji-map
    content: 改造 emoji.ts：mapLabelsToChinese 改用词典（单复数兜底、去重），保留 OBJECT_PRESETS 派生
    status: completed
    dependencies:
      - create-label-dict
  - id: add-tags-migration
    content: schema.sql 增加 app_meta 表，database.ts 接入按词典版本触发的历史英文标签批量迁移
    status: completed
    dependencies:
      - refactor-emoji-map
  - id: extend-mock-labels
    content: mockScanner 增加非预置英文标签，便于 Web 调试验证翻译效果
    status: completed
    dependencies:
      - refactor-emoji-map
  - id: verify-build
    content: npm run build 类型检查与 Web 验证；如需真机打包先递增版本号
    status: completed
    dependencies:
      - add-tags-migration
      - extend-mock-labels
---

## 用户需求

自动识别（ML Kit 图像标签）产生的英文标签，需要在入库时翻译成中文；用户原始诉求为「自动识别的标签如果是英文的话我想它能翻译成中文」。

## 补充与澄清（基于代码核实的合理假设）

- App 完全离线、不联网，不能调用在线翻译 API，只能通过静态英中词典实现，未收录的英文标签兜底保留原文。
- 迁移范围包含已入库的历史英文标签（一次性幂等迁移），保证存量数据也变为中文，后续 LIKE 中文搜索可命中。
- OCR 文字（已是中文）、情感标签（已由 EMOTION_LABELS 转中文）不在改动范围。
- 物体分类归并逻辑（OBJECT_PRESETS / assignLabelsToCategories）继续用原始英文 label 匹配，不受影响。

## 功能内容

- 扩充「英文 AI 标签 → 中文」静态词典，覆盖 ML Kit 基础模型常见标签（动物、食物、交通工具、自然、物品、服饰、人体、场所、活动等大类）。
- 识别写库路径统一走词典翻译（大小写不敏感、单复数兜底、去重）。
- 首次启动（或词典版本升级时）对 emojis.tags 历史英文标签做一次性批量迁移，分批写库、可重复执行。
- Web 调试（mockScanner）补充一个非预置英文标签，便于无真机验证翻译效果。

## 视觉影响

无界面设计变化；仅标签内容由中英混杂变为统一中文，标签编辑区与搜索筛选展示更一致。

## 技术栈（沿用现有项目）

- 前端：Vue 3 + TypeScript + Vite + Pinia
- 存储：@capacitor-community/sqlite（schema 迁移沿用 initSchema 逐条执行 + 幂等迁移模式）
- 约束：完全离线，禁止联网翻译；改动限于前端 TS 与 SQLite 迁移，不动原生 Java 识别链路

## 实现方案

核心思路：把「英文标签→中文」从 emoji.ts 内嵌小词典升级为独立、可版本化的静态词典模块，识别入库与历史数据迁移共用同一函数，保证行为一致。

关键决策：

1. 词典独立成文件 src/db/labelDict.ts：现有 LABEL_TO_CHINESE 仅在 emoji.ts 内部使用（已核实无外部引用），可安全迁出；词典带 LABEL_DICT_VERSION，支持后续扩充后重新触发迁移。
2. 查询归一化：小写去空格 → 精确命中 → 去尾复数（s）再命中 → 兜底保留原文；OBJECT_PRESETS 预置 label 仍优先生成为预置中文分类名，保证「猫/狗/食物」等与物体分类一致。
3. 历史迁移用 app_meta 表记录已迁移的词典版本（schema.sql 新增 CREATE TABLE IF NOT EXISTS app_meta，initSchema 每次启动执行，旧库自动获得该表）；database.ts 初始化末尾调用迁移，版本号不一致才重跑，避免每次启动全表扫描。
4. 迁移分批 UPDATE（复用 executeBatch，每批约 200 条），只更新 tags 实际发生变化的行，千级数据下一次完成，无性能瓶颈。

## 架构与数据流

识别链路：EmotionClassifier 英文 labels → scanner.ts runRecognitionQueue → labelDict.translateLabel → emojis.tags 中文入库；历史英文 tags 在 database.ts 启动时经同一 translateLabel 迁移，app_meta 记录词典版本控制重跑。

## 执行注意

- 迁移必须幂等可重复：以 app_meta 记录的词典版本为准，版本升级后自动重跑。
- 更新只写发生变化的行；SQL 拼接继续用 String(s ?? '').replace 转义（规避 undefined.replace 坑）。
- schema.sql 保持 LF 行尾，新增语句后需 npx cap sync 再打包。
- 若需真机打包验证，先按项目强制约定递增 android/app/build.gradle 的 versionCode/versionName。
- 词典未收录标签保留英文原文属预期兜底；后续扩充词典并提升 LABEL_DICT_VERSION 即可自动迁移存量数据。
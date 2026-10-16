---
name: codebuddy-md-version-iteration
overview: 在 CODEBUDDY.md 中新增一条打包约定：每次执行 assembleDebug/assembleRelease 前必须迭代 android/app/build.gradle 中的 versionCode 与 versionName，确保产出的 APK 可识别版本。
todos:
  - id: read-codebuddy-md
    content: 通读 CODEBUDDY.md，确认 §5/§6/§8 现有条目与插入位置
    status: completed
  - id: add-version-rule
    content: 在 §6 常用命令处新增「打包前必须迭代版本号」约定，写明 versionCode/versionName 位置与递增规则
    status: completed
    dependencies:
      - read-codebuddy-md
  - id: cross-ref-maintenance
    content: 在 §8 维护约定中交叉引用该条，确保后续对话不会遗漏或弱化
    status: completed
    dependencies:
      - add-version-rule
---

## 用户需求

在 `d:\Code\emoji-ai\CODEBUDDY.md` 中新增一条明确约定：**每次打包（`assembleDebug` / `assembleRelease`）前，必须先迭代版本号，确保产出的 APK 可辨识版本**。

## 关键事实

- 版本号唯一来源：`android/app/build.gradle` 第 18-19 行，`versionCode 1`（整数，Google Play 要求单调递增）与 `versionName "1.0.0"`（展示用，语义化版本）。
- `package.json` 的 `"version": "0.0.0"` 为脚手架默认值，不参与 App 版本，不纳入本次约定。
- CODEBUDDY.md 结构：§5 关键约定与取舍、§6 常用命令（含 `cd android; .\gradlew.bat assembleDebug/assembleRelease`）、§8 本文档的维护约定。

## 需求细化

1. 在 §6「常用命令」打包命令处新增强制要求：执行 gradle 打包前，先更新 `versionCode`（每次 +1，禁止重复）与 `versionName`（语义化递增，如 `1.0.0` → `1.0.1` / `1.1.0`），未递增不得打包。
2. 明确规则细节：`versionCode` 只增不减；同一次构建内两个字段同步更新；若不确定当前值，先读文件再改。
3. 在 §8「维护约定」中补充：本条属于「改了就要同步」的约定之一，后续对话不得删除或弱化。
4. 遵循项目红线：全中文、路径真实、不重复 README 的部署细节、保持文档精炼不膨胀。
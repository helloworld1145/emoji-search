---
name: apk-inplace-upgrade
overview: 让新版本 APK 能以覆盖安装方式直接升级旧版 App 并保留全部数据：核心是固化签名一致性（同一把 emoji-ai.keystore）、applicationId 不变、versionCode 严格递增，并在 release 构建加签名守卫防止误发不可覆盖的包，同时更新 README 与 CODEBUDDY.md 文档说明。
todos:
  - id: add-signing-guard
    content: 在 android/app/build.gradle 为 release 构建任务增加签名守卫，缺失签名配置时构建即失败并给出可操作提示
    status: completed
  - id: update-readme
    content: 修订 README：密钥库改为永久复用警示，新增覆盖安装三条件与数据保留说明，更新网盘分发说明
    status: completed
    dependencies:
      - add-signing-guard
  - id: update-codebuddy
    content: 同步更新 CODEBUDDY.md §6/§8：记录同签名、versionCode 递增是覆盖安装前提，密钥库禁止重新生成
    status: completed
    dependencies:
      - update-readme
  - id: verify-build
    content: 验证 assembleDebug 不受守卫影响、assembleRelease 正常签名产出，确认覆盖安装前提在构建层闭环
    status: completed
    dependencies:
      - add-signing-guard
---

## 用户需求

下载新版本 APK 后，在手机上**直接覆盖安装**旧版 App，**无需先卸载**，并且**完整保留原有数据**（SQLite 数据库中的表情/标签/收藏夹记录、SharedPreferences 中的 SAF 文件夹授权等）。

## 需求分析与补充说明

- 本项目完全离线、无应用内更新/下载功能，APK 由用户手动下载并安装，因此需要保证的是「手动安装新包时可被系统判定为同应用的升级」。
- Android 覆盖安装（in-place update）需同时满足三个系统条件：**applicationId 不变**、**签名密钥完全一致**、**versionCode 严格递增**。三者满足时系统自动执行覆盖安装，应用数据（SQLite、SharedPreferences、SAF 授权）全部保留，无需改动任何业务代码。
- 已核实现状：applicationId 固定为 `com.emoji.ai`（`android/app/build.gradle:15`）；versionCode 7 / versionName "1.2.0" 且 CODEBUDDY.md §6 已有强制递增规则。**最大隐患在签名**：README 96-104 行建议「上架前用自己的信息重新生成密钥库」，一旦重新生成或与 debug 包混装，系统判定签名不一致，强制卸载后才能安装且数据全丢——这正是「必须卸掉再更新」的根因。
- 本项目无 git 仓库，密钥库文件（`android/app/emoji-ai.keystore`、`android/keystore.properties`）是唯一签名凭据，需明确备份与禁用重新生成的纪律。
- 数据保留边界：`AndroidManifest.xml:6` 为 `android:allowBackup="false"`，无系统自动备份，与离线/隐私原则一致，本计划保持不动；仅在文档中说明「覆盖安装天然保留数据，只有签名不一致导致的卸载才会丢数据」。
- 交付物：构建脚本防护（防止误产不可覆盖安装的包）+ 文档纪律（签名复用规则、覆盖安装三条件说明），不改动应用功能代码。

## 技术栈

- 构建系统：Gradle（Android 应用模块 `android/app/build.gradle`）
- 签名体系：`android/keystore.properties` → `android/app/emoji-ai.keystore`（PKCS12）
- 无新增依赖、无新增架构模式，仅构建脚本 + 文档改动

## 实现方案

**核心思路**：覆盖安装能力不靠新增代码，而靠「守住签名一致性 + 版本号递增」两条纪律，并在构建层加一道 fail-fast 守卫，杜绝误分发不可覆盖安装的包（无签名/签名配置缺失的 release 包、密钥库被重新生成后产出的包）。

**关键决策与取舍**：

1. **签名守卫放在任务执行阶段（`doFirst`/任务图就绪时）而非 release 闭包内**：AGP 在配置阶段就会求值所有 buildType 闭包，若在 `release { }` 内直接 `throw`，会导致连 `assembleDebug` 都无法配置。守卫必须延迟到 release 相关任务（assembleRelease/bundleRelease/packageRelease）执行前检查，做到「只拦 release、不误伤 debug」。
2. **不重新生成密钥库，反而将其列为禁区**：README 原有的「上架前建议重新生成」建议与覆盖安装目标直接冲突，应改为警示：同一把密钥库必须永久复用并多处备份；丢失 = 所有存量用户被迫卸载重装。
3. **不改 `allowBackup`、不加应用内更新器**：前者与离线隐私原则冲突且覆盖安装场景下无必要；后者违反「完全离线、不联网」的项目红线（APK 走网盘/手动分发）。
4. **数据保留零代码改动**：同包名同签名升级时 SQLite 库、SharedPreferences、SAF 持久化授权均由系统自动保留；文档中说明即可，避免过度设计。

## 架构设计

不涉及应用架构变更。数据流不变：Gradle 签名配置 → 产出签名 APK → 用户手机安装器比对「包名 + 签名 + versionCode」→ 判定为升级则覆盖安装并保留 `/data/data/com.emoji.ai`（SQLite + SharedPreferences）。

## 目录结构

```
d:/Code/emoji-ai/
├── android/app/build.gradle        # [MODIFY] release 相关任务增加签名守卫：keystore.properties 缺失或 release 未配签名时，在执行阶段 fail 并输出可操作提示（为何 release 包会不可覆盖安装、如何修复）；不影响 debug 构建
├── README.md                       # [MODIFY] ① 签名章节：「重新生成密钥库」建议改为「永久复用同一密钥库 + 备份纪律」警示；② 新增「覆盖安装（直接升级）说明」小节：三条件（同 applicationId / 同签名 / versionCode 递增）+ 数据自动保留说明 + 常见失败原因（签名不一致、混装 debug 包、versionCode 回退）；③ 网盘分发章节补充「用户可直接覆盖安装、无需卸载」
└── CODEBUDDY.md                    # [MODIFY] §6 打包命令处补充「覆盖安装前提」：release 必须用同一把 emoji-ai.keystore、禁止重新生成、versionCode 只增不减；§8 维护约定随本次改动同步
```

## 执行细节与风险控制

- 守卫检查项：`hasKeystore` 为 false、或 `signingConfigs.release` 未应用到 release 构建类型时，在 release 任务执行前抛出带修复指引的 `GradleException`；提示信息需包含 `android/keystore.properties` 路径与 README 章节指引。
- 向后兼容：守卫只作用于 release 系任务；本地已有 keystore.properties，`assembleRelease` 行为不变，产出的 APK 仍可正常覆盖安装。
- 爆炸半径控制：仅改构建脚本与文档，不触碰 `src/` 与原生 Java 代码；不引入新依赖；不改变现有 debug/release 产物结构。
- 文档口径统一：README、CODEBUDDY.md 中关于「重新生成密钥库」与「版本号递增」的表述必须一致，避免后续对话的 AI 再次建议重新生成密钥库导致签名漂移。
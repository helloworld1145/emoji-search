# 表情搜搜（Emoji AI）

一款 Android 表情包管理 App：由用户**手动选择**表情包所在的文件夹，通过**设备端 AI** 识别图片文字（OCR）、物体与情感并自动生成中文标签，支持按文字与标签搜索、收藏夹管理，并可一键转发到微信 / QQ。仅在设备端处理、不联网、不上传图片。

## 功能特性

- **手动选择文件夹**：通过系统目录选择器（SAF）授权表情包所在目录，不再申请全设备存储权限，隐私可控
- **设备端 AI 标签**：ML Kit 中文 OCR 识别表情文字 + 图像标签与情感识别，统一转为中文标签（完全离线，不联网、不上传图片）
- **标签搜索**：按表情包上的文字或标签（如 猫、开心、打工）搜索
- **标签可修正**：AI 初判不准时，可手动修正标签与文字
- **收藏夹**：总收藏 + 多个自定义收藏夹；手动添加/移出/重命名/删除
- **一键转发**：调起系统分享面板，点选微信 / QQ 发送（支持批量）
- **本机存储**：SQLite 本地数据库，支持导出收藏夹备份（JSON 路径清单）

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Vue 3 + TypeScript + Vite + Pinia + Vue Router + Tailwind CSS |
| 原生包装 | Capacitor 6（Android） |
| 原生插件 | 自研 `EmojiScanner`（Java）：权限申请、文件遍历、缩略图、AI 调度、分享预处理 |
| 设备端 AI | ML Kit Text Recognition（中文）+ Image Labeling + 情感映射词表 |
| 存储 | capacitor-sqlite（SQLite） |
| 分享 | @capacitor/share（系统分享面板，FileProvider 授权） |

## 目录结构

```
src/
  views/          # 页面：引导/首页/收藏夹/收藏夹详情/搜索/详情
  components/     # 表情网格、卡片、标签编辑器、收藏夹选择器、底部弹层等
  stores/         # Pinia：emoji / collection
  services/       # nativeBridge / scanner / share / backup
  db/             # schema.sql + database + repositories
android/
  app/src/main/java/com/emoji/ai/
    EmojiScannerPlugin.java   # Capacitor 插件主类
    FileWalkerUtil.java       # MediaStore 查询 + 递归遍历兜底
    ThumbnailUtil.java        # 缩略图生成与磁盘缓存
    ai/                       # OcrRecognizer / EmotionClassifier / EmotionMap / AiEngine
```

## 开发环境搭建（从零开始）

### 1. 安装基础工具

- Node.js ≥ 18（开发用 22 LTS）
- JDK 17
- Android SDK：platforms android-34/35、build-tools 34+

配置环境变量：

```powershell
$env:ANDROID_HOME = "D:\Software\SDK"   # 你的 SDK 路径
```

### 2. Gradle 说明（重要）

本机无法直接访问 `services.gradle.org` 时，`gradlew` 会自动下载 Gradle 发行版。本项目已配置使用 **Gradle 8.11.1**，若你本机 Gradle 缓存（`~/.gradle/wrapper/dists` 或自定义 `GRADLE_USER_HOME`）中已有该版本即可离线构建；否则请提前下载 `gradle-8.11.1-all.zip` 并放入 `GRADLE_USER_HOME/wrapper/dists/gradle-8.11.1-all/<hash>/` 目录，或改为使用本机已安装的 Gradle：

```powershell
# 使用本机 Gradle 直接构建（示例）
& "D:\Software\gradle\wrapper\dists\gradle-8.11.1-all\xxx\gradle-8.11.1\bin\gradle.bat" assembleDebug
```

Maven 依赖（dl.google.com / repo.maven.apache.org）需保持可访问。

### 3. 安装依赖并构建

```bash
npm install
npm run build        # Web 构建（含 vue-tsc 类型检查）
npx cap sync         # 同步到 Android 工程
```

### 4. 构建 APK

```powershell
cd android
.\gradlew.bat assembleDebug      # 调试包
.\gradlew.bat assembleRelease    # 发布包（需先配置签名）
```

产物位置：`android/app/build/outputs/apk/`

### 5. 真机调试

```bash
npm run dev          # 启动 Vite（host 0.0.0.0，手机可局域网访问）
```

或在 Android Studio 中打开 `android/` 目录直接运行。

## Release 签名配置

> ⚠️ **签名即身份：永久复用同一把密钥库，严禁重新生成或更换。**
> 本项目已生成密钥库 `android/app/emoji-ai.keystore`（密码记录在
> `android/keystore.properties`，均已加入 `.gitignore`，切勿提交或外传）。
> 一旦重新生成密钥库，签名即改变，所有已安装旧版的用户都必须**先卸载再安装**，
> SQLite 数据库、收藏夹、SAF 文件夹授权将全部丢失（详见下方「覆盖安装」一节）。
> 请立即将 `emoji-ai.keystore` 与 `keystore.properties` 备份到多个安全位置。

`android/keystore.properties`（`storeFile` 相对于 `android/app/` 目录解析）：

```properties
storeFile=emoji-ai.keystore
storePassword=你的密码
keyAlias=emoji-ai
keyPassword=你的密码
```

> 以下命令仅在**密钥库彻底丢失、且确认放弃存量用户覆盖升级**时使用
> （在 `android/app/` 目录执行）：

```powershell
# 生成密钥库（库密码与密钥密码保持相同，避免 PKCS12 兼容问题）
keytool -genkeypair -v -keystore emoji-ai.keystore -alias emoji-ai -keyalg RSA -keysize 2048 -validity 10000 -storetype PKCS12 -dname "CN=EmojiAI, OU=Dev, O=EmojiAI, L=Beijing, S=Beijing, C=CN"
# 按提示输入并确认密码（store password / key password 设为同一个）
```

再次执行 `.\gradlew.bat assembleRelease` 即产出签名 APK：
`android/app/build/outputs/apk/release/app-release.apk`
（并会同步一份到项目根目录 `dist-apk/` 方便传到手机）

> `keystore.properties` 与 `*.keystore` 已加入 `.gitignore`，切勿提交。
> `android/app/build.gradle` 内置 **release 签名守卫**：`keystore.properties` 缺失、
> 配置项不完整、密钥库文件不存在或签名配置未应用时，release 构建会直接失败并
> 给出修复提示，防止误产不可覆盖安装的包（debug 构建不受影响）。

## 覆盖安装（直接升级，无需卸载）

新版本 APK 下载到手机后，可**直接覆盖安装**旧版 App，无需先卸载，且原有数据
（表情记录、标签、收藏夹、SAF 文件夹授权）全部保留。系统判定为「升级」需同时
满足三个条件：

| 条件 | 本项目保障 |
| --- | --- |
| ① `applicationId` 不变 | `android/app/build.gradle` 固定为 `com.emoji.ai`，任何版本不得修改 |
| ② 同一把密钥库签名 | release 必须用同一把 `android/app/emoji-ai.keystore`（见上一节），禁止重新生成；debug 包签名不同，切勿与 release 包混装分发 |
| ③ `versionCode` 严格递增 | 每次打包前按 CODEBUDDY.md §6 强制递增 `versionCode` / `versionName`（只增不减） |

三者满足时，系统自动执行覆盖安装，`/data/data/com.emoji.ai` 下的 SQLite 库、
SharedPreferences、SAF 持久化授权全部保留，**业务代码无需任何改动**。

常见「必须卸载才能装」的原因与规避：

- **签名不一致**（重新生成了密钥库、debug 与 release 包混装、更换签名文件）——
  最高发原因，规避见上一节；
- **`versionCode` 回退或不变**——被系统判定为降级/重复安装而拒绝，按 §6 递增即可；
- **`applicationId` 被改动**——等同于换了一个新应用，任何时候都不要改。

> 备注：`AndroidManifest.xml` 中 `android:allowBackup="false"`，无系统自动备份
> （与离线隐私原则一致）。覆盖安装天然保留数据；只有签名不一致导致的卸载才会丢数据，
> 日常重要收藏夹可用 App 内「导出备份」兜底。

## 上架小米应用商店

1. **准备材料**：签名 APK、应用图标（已内置）、应用截图（手机截图 3-5 张）、应用简介、
   隐私政策链接（需说明：仅本机处理图片、不联网收集数据）。
2. **权限合规**：应用**不再申请** `MANAGE_EXTERNAL_STORAGE` 等全设备存储权限，
   仅通过系统目录选择器（SAF）让用户手动授权表情包文件夹，App 只读取用户主动选择的目录。
   隐私政策中建议明确写入「仅本机处理、不联网、不收集上传数据」的边界。
3. **包体大小**：当前 Release 包约 48MB（含 ML Kit 中文 OCR 模型，完全离线）。
4. 在[小米开放平台](https://dev.mi.com/)注册开发者账号，创建应用并提交审核。

## 网盘分发（备选）

- 将签名后的 `app-release.apk` 上传网盘，分享链接即可。
- 用户安装时需允许「安装未知应用」。
- 用户**可直接覆盖安装**旧版，无需卸载，数据自动保留（前提见「覆盖安装」一节：
  同一密钥库签名 + `versionCode` 递增）。
- 建议随包附带简短安装说明与隐私说明，降低用户疑虑。

## 已知取舍与后续优化

- **情感标签精度**：端侧无成熟图像情感模型，采用「通用标签 → 情感词表映射」兜底生成中文情感标签，
  用户可手动修正。后续可引入更轻量的端侧表情识别模型。
- **首次识别耗时**：所选文件夹图片首次 AI 识别为串行处理（控制内存），
  大量图片时可能需要一段时间；采用「先出缩略图、后台识别」策略保证可浏览。
- **备份格式**：导出为收藏夹结构 + 文件路径引用（不含图片本体），
  同机恢复可直接定位；换机恢复需文件路径一致。
- **FTS5**：为规避 Android 系统 SQLite 未启用 FTS5 的兼容风险，搜索使用 LIKE 实现，
  千级数据量下性能足够；数据量增大后可迁移 FTS5。

## 常用命令速查

```bash
npm run dev                  # 本地开发
npm run build                # 类型检查 + Web 构建
npx cap sync                 # 同步 Web 资源与插件到 Android
npx cap open android         # 用 Android Studio 打开
cd android; .\gradlew.bat assembleRelease
```

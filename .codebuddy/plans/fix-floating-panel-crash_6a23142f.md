---
name: fix-floating-panel-crash
overview: 修复悬浮窗面板在小米手机（及所有 Service 主题被系统强制的设备）上加载失败的问题：面板布局中 AppCompat 私有主题属性 `?attr/selectableItemBackground` 在 Service 被强制使用的 `Theme.DeviceDefault` 下解析失败，导致 inflate 抛 `UnsupportedOperationException`、`panelView == null`，点击悬浮球只提示「加载失败」。修复为主线修改 + 点击自愈重试兜底，最后按项目规范升级版本号并出 debug 包回归。
todos:
  - id: fix-panel-theme-attr
    content: 修改 floating_panel.xml 第 39、143 行主题属性为 ?android:attr/selectableItemBackground
    status: completed
  - id: harden-panel-inflate
    content: FloatingWindowService 新增 themedInflater()，面板与网格项 inflate 统一走 AppTheme 上下文
    status: completed
    dependencies:
      - fix-panel-theme-attr
  - id: self-heal-and-empty-state
    content: togglePanel 面板为空时重试创建并修正提示文案，loadMore 补 db 不可用空态文案
    status: completed
    dependencies:
      - harden-panel-inflate
  - id: bump-version-and-build
    content: 递增 versionCode 13 与 versionName 1.3.2，更新 changelog.json 并重新生成 CHANGELOG.md
    status: completed
    dependencies:
      - self-heal-and-empty-state
  - id: package-and-regression
    content: 执行 assembleDebug 出包，输出真机回归清单（面板弹出、Tab、搜索、复制分享、开关自愈、App 外点击）
    status: completed
    dependencies:
      - bump-version-and-build
---

## 用户需求

修复悬浮窗「能显示但无法使用」的问题：悬浮球正常出现，但点击后面板无法加载——App 内点击提示「表情面板加载失败，请关闭后重试」，App 外点击无任何响应。要求悬浮窗面板恢复正常可用，并保证此类主题解析崩溃以后不会再次发生。

## 根因（日志已确认）

悬浮窗服务的上下文主题被系统强制为平台默认主题（`Theme.DeviceDefault.Light.DarkActionBar`），而面板布局中两个按钮使用了仅在 AppCompat 主题中定义的私有主题属性 `?attr/selectableItemBackground`，属性解析失败抛异常，导致面板创建失败、面板对象为空，悬浮球因降级保护仍正常显示。App 内点击只能得到失败提示（失败是确定性的，重开关无效），App 外因系统屏蔽后台提示而表现为「点了没反应」。

## 核心功能

- **面板正常打开**：点击悬浮球后面板弹出，标题栏、收藏/最近/全部三个快捷区、搜索框、表情网格、底部操作条全部可用。
- **点选表情**：显示预览图并弹出操作条，可复制到剪贴板或调起系统分享面板发送到微信/QQ，并沉淀「最近发送」。
- **失败可自愈**：面板创建失败时，点击悬浮球会现场重试创建；确实无法创建时才给出明确提示，不再出现「必须关闭后重试」的死路。
- **异常可读**：本地表情数据不可读取时，面板展示明确的空态说明文案，而不是空白无响应。

## 交付与验证

- 按项目规范递增版本号并产出调试包，覆盖安装升级。
- 覆盖更新日志：登记本次修复。
- 回归验证清单：面板弹出、三 Tab、搜索、复制、分享、开关自愈、App 外（聊天软件内）点击。

## 技术栈

沿用现有工程，不引入新依赖：

- Android 原生层：Java + Capacitor 6插件体系（`android/app/src/main/java/com/emoji/ai/`）
- 视图层：原生 XML 布局（`WindowManager` 悬浮窗 + `RecyclerView` 网格）
- 主题：`androidx.appcompat:appcompat`（`AppTheme` 继承 `Theme.AppCompat.Light.DarkActionBar`）
- 编译目标：`compileSdk 34 / targetSdk 34 / minSdk 22`

## 实现思路

本次不改任何架构，只做「一处根因修复 + 两处防御性加固 + 版本发布」：

1. **根因修复（必须）**：把 `res/layout/floating_panel.xml` 中两处 `android:background="?attr/selectableItemBackground"` 改为 `?android:attr/selectableItemBackground`。平台属性在 `Theme.DeviceDefault.*` 与 `Theme.AppCompat.*` 下都可解析，`ImageButton` 构造时不再抛 `UnsupportedOperationException`。全工程仅此两处 `?attr/` 引用，改完即消除该类崩溃。
2. **防御性兜底（推荐）**：`FloatingWindowService` 中所有 `LayoutInflater.from(this)` 改为 `LayoutInflater.from(new ContextThemeWrapper(this, R.style.AppTheme))`（`android.view.ContextThemeWrapper`，framework API1+），使悬浮窗视图始终在 App 自己的主题下 inflate。理由：Service 上下文的 themes 由系统强制，**不可依赖**其与 `application` 声明的主题一致；一旦后续有人在悬浮窗布局里再加 AppCompat 私有属性，同一崩溃必然复发。
3. **点击自愈**：`togglePanel()` 遇到 `panelView == null` 时，先走一次「懒创建/重试」（复用 `createPanel()`，内部已做 `removeViewQuietly` + 字段判空保护），成功则直接显示面板；仍失败才 `toast` 提示。把原本「请关闭后重试」的死路变成真正的重试，并让 MIUI 后台屏蔽 Toast 的场景下也能靠面板自身表现给出反馈。
4. **空态可读性**：`loadMore()` 在 `db == null`（数据库打开失败已降级）时直接切到空态展示并给出「无法读取本地数据，请重启 App 后重试」文案，避免当前「直接 return 导致网格与空态都不显示」的黑屏式无反馈。
5. **发布**：按 `CODEBUDDY.md` §6 强制递增版本号（`versionCode 12 → 13`、`versionName 1.3.1 → 1.3.2`，修 bug走补丁位），更新 `src/data/changelog.json` 后用 `node scripts/gen-changelog.mjs` 重新生成 `CHANGELOG.md`，再 `.\gradlew.bat assembleDebug` 出包。

## 关键技术决策

- **为什么不用 AppCompat 主题包一层就完事**：只包主题虽也能解决当前崩溃，但仍依赖「Service 能拿到 AppCompat 主题」这一不可控前提，且会把平台属性写法固化到私有属性上；把布局改为平台属性是零依赖、向后兼容（minSdk 22 完整支持）的最小正解，主题包装只作为第二道防线。
- **为什么保留现有 `try/catch Throwable` 降级架构**：`createPanel()` 失败仍保球、`removeViewQuietly()` 双重设防是既定设计（服务与 WebView 同进程，未捕获异常会连带杀死宿主 App），本次沿用，不改架构。
- **不投机改动 App 外触摸**：targetSdk ≥ 31 存在「App 不可见时系统可能拦截 overlay 触摸事件」机制，但当前 App 外无反应已被完整解释为「面板为空 + 后台 Toast 被屏蔽」。因此本次不改窗口 flag，先回归验证；若仍复现，再单独排查该兼容项，避免引入无依据的 flag 调整导致面板无法接收触摸或输入法失效。
- **爆炸半径控制**：不触碰 `FloatingDbHelper`、`FloatingWindowPlugin`、前端 `nativeBridge.ts`/`Home.vue`、数据库 schema 与 Capacitor 三处配置，也**不使用 `cap sync`**（仅新增官方插件时才需手工装配，本次无需求）。

## 执行注意事项

- `ContextThemeWrapper` 需新增 import（`android.view.ContextThemeWrapper`）；`R.style.AppTheme` 为 `res/values/styles.xml` 中已定义的公开样式，可直接引用。
- `createPanel()` 自愈重试时务必复用现有 `removeViewQuietly()`，避免同一 WindowManager 上重复 `addView` 抛 `IllegalArgumentException`。
- `loadMore()` 的空态切换需在主线程执行（沿用既有 `mainHandler.post` 模式），不可在后台线程直接改 View。
- 日志沿用现有 `Log.i/Log.e(TAG, ...)` 与中文提示文案，`create panel failed` 日志保留（便于下次回归时定位），但 toast 文案需体现「自动重试仍失败」的真实语义，避免误导。
- 打包前先读 `android/app/build.gradle` 第 18-19 行确认当前版本号，`versionCode` 只增不减；release 签名规则本次不涉及（仅出 debug 包）。
- 版本号与 changelog 不一致需注意：`build.gradle` 当前为 `1.3.1`，但 `src/data/changelog.json` 仅有 `1.2.0` 与 `1.3.0`（`1.3.1` 未登记）。本次仅在最前面插入 `1.3.2` 修复条目，是否补录 `1.3.1` 由用户决定。

## 调用链（修复后）

`悬浮球 BallTouchListener.onTouch(ACTION_UP)` → `togglePanel()`（面板为空则先重试 `createPanel()`）→ 面板可见 → `setMode/reload()/loadMore()`（`FloatingDbHelper` 读同一份 `emoji_ai` 库）→ `onEmojiSelected()` → `copySelected()/shareSelected()`（FileProvider + ClipboardManager / ACTION_SEND）

## 目录结构

```
d:/Code/emoji-ai/
├── android/app/src/main/res/layout/
│   └── floating_panel.xml                      # [MODIFY] 面板布局。第 39 行（closeBtn）与第 143 行（actionCancel）的
│                                              #          android:background 由 ?attr/selectableItemBackground 改为
│                                              #          ?android:attr/selectableItemBackground（平台属性，任意主题可解析）。
│                                              #          这是本次崩溃的唯一根因点，改动仅限这 2 行，不动控件结构与尺寸。
├── android/app/src/main/java/com/emoji/ai/
│   └── FloatingWindowService.java              # [MODIFY] 悬浮窗服务主类，四处改动：
│                                              #          ① 新增 import android.view.ContextThemeWrapper，提供 themedInflater()
│                                              #             私有方法，createPanel() 与 EmojiAdapter.onCreateViewHolder()
│                                              #             统一改用它，杜绝 Service 上下文被系统强制主题导致的属性解析失败；
│                                              #          ② togglePanel() 面板为空时先重试 createPanel()，成功即显示，失败才 toast；
│                                              #          ③ loadMore() 在 db == null 时直接展示 emptyTip 并给出「无法读取本地数据」
│                                              #             文案（主线程更新 View，沿用 mainHandler）；
│                                              #          ④ 保留 create panel failed 日志并微调失败提示文案语义。
│                                              #          不改数据库探测、前台服务晋升、复制/分享与分页逻辑。
├── android/app/build.gradle                    # [MODIFY] 仅第 18-19 行：versionCode 12 → 13、versionName 1.3.1 → 1.3.2。
│                                              #          applicationId、签名配置、依赖全部不动。
├── src/data/changelog.json                     # [MODIFY] 在数组最前面插入 1.3.2 条目，changes.fixed 写明「修复悬浮窗面板
│                                              #         加载失败（主题属性解析异常导致面板无法弹出）」；按需决定是否补录 1.3.1。
└── CHANGELOG.md                                # [MODIFY] 由 `node scripts/gen-changelog.mjs` 重新生成（严禁手工编辑）。
```

## 关键代码结构

```java
/** 用 App 自己的主题 inflate，避免 Service 上下文被系统强制为平台默认主题 */
private LayoutInflater themedInflater() {
    return LayoutInflater.from(new ContextThemeWrapper(this, R.style.AppTheme));
}

/** 面板为空时的自愈入口：现场重试创建，成功返回 true */
private boolean ensurePanel() {
    if (panelView != null) return true;
    boolean ok = createPanel();          // 内部已做 removeViewQuietly 与字段判空
    Log.i(TAG, ok ? "panel recreated on demand" : "panel recreate failed");
    return ok;
}
```
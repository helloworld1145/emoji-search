---
name: fix-floating-window-crash
overview: 修复小米 Android 16 上开启悬浮窗即闪退的问题：将 FloatingWindowService 启动链路改为「startService + 尽力晋升前台服务」的三级降级策略，全链路 try/catch 设防 + 诊断日志，杜绝任何路径杀死 App 进程；随后递增版本号重新打包验证。
todos:
  - id: fix-plugin-start
    content: 改造 FloatingWindowPlugin.start：改用 startService 启动，保留权限校验与运行态短路，消除 5 秒超时杀进程契约
    status: completed
  - id: harden-service
    content: 加固 FloatingWindowService：onCreate 三级降级晋升前台服务、通知改用 NotificationCompat、inflate 与 removeView 设防、补诊断日志
    status: completed
    dependencies:
      - fix-plugin-start
  - id: bump-version
    content: 递增版本号：versionCode 11→12、versionName 1.3.0→1.3.1（android/app/build.gradle）
    status: completed
    dependencies:
      - harden-service
  - id: build-verify
    content: 构建 debug 包并在小米 Android 16 真机验证：开启不闪退、悬浮球可拖拽、面板可展开、复制/分享正常、关闭后可停止
    status: completed
    dependencies:
      - bump-version
---

## 用户需求

用户反馈「悬浮窗目前无法正常使用，开启后只会退出 App」。经澄清确认：在小米 Android 16（API 36）真机上，点击首页文件夹面板中的「悬浮窗快速发送」开关后，**App 瞬间闪退**（并非操作悬浮球或按返回键才退出）。

## 问题定位结论

`FloatingWindowService` 与 Capacitor WebView 运行在**同一进程**，`onCreate()` 中任何未捕获异常都会直接杀死整个 App 进程。当前代码在服务启动链路上存在多处未设防的崩溃点：

1. **前台服务晋升失败即杀进程**：`FloatingWindowPlugin.start()` 使用 `startForegroundService()`，该 API 附带「5 秒内必须成功 `startForeground`」的硬契约，失败即抛 `RemoteServiceException` 杀进程；而 `startForeground(id, notif, FOREGROUND_SERVICE_TYPE_SPECIAL_USE)` 在 Android 14+ 需严格校验（权限 + manifest property），MIUI/HyperOS 框架校验更严，类型一旦被拒抛 `SecurityException` 同样杀进程。
2. **确定兼容性 bug**：`buildNotification()` 使用 `new Notification.Builder(this, channelId)` 双参构造，仅 API 26+ 存在，而 `minSdk=22`，API 22–25 必崩 `NoSuchMethodError`。
3. **布局 inflate 未设防**：`createBall()`/`createPanel()` 的 inflate 未包 try/catch。
4. **`onDestroy()` 的 `wm.removeView` 未设防**：对未附加的 view 抛 `IllegalArgumentException`。
5. 已排除的因素：安装包时间戳晚于合并清单（含 specialUse 声明），排除「旧包缺声明」；主题属性、drawable 资源经核查无崩溃点。

## 修复目标

开启悬浮窗开关时，无论前台服务晋升是否被系统/厂商框架拒绝，App 都**不得闪退**；悬浮球/面板功能在权限正常的小米 Android 16 上完整可用；服务启动失败时优雅降级并给出可诊断的日志。

## 技术栈

- 复用现有工程：Capacitor 6 + 自研 Java 插件（`FloatingWindowPlugin` / `FloatingWindowService`），`minSdk=22`、`targetSdk=34`（`android/variables.gradle`），依赖 `androidx.appcompat:appcompat:1.6.1`（含 `androidx.core.app.NotificationCompat`，可用于全 API 级别构建通知）。
- 前端链路（`Home.vue` → `nativeBridge.ts`）无需改动，插件方法契约保持不变。

## 核心方案：三级降级的前台服务晋升策略

根因是「`startForegroundService` + specialUse 晋升」这条单一路径在小米 Android 16 上不可靠，且失败即杀进程。改为：

1. **插件侧改用 `startService()` 启动**（而非 `startForegroundService`），彻底摆脱 5 秒超时契约——普通 startService 不存在该超时杀进程机制。
2. **服务侧尽力晋升前台服务**，按顺序尝试并在每级失败时安全降级：

- 一级：`startForeground(id, notif, FOREGROUND_SERVICE_TYPE_SPECIAL_USE)`（Android 14+ 保留常驻与存活能力）；
- 二级：失败（如厂商框架拒绝该类型）时降级为 `startForeground(id, notif)`（无类型参数，兼容旧行为）；
- 三级：仍失败则以**普通后台服务**继续运行，悬浮球功能不受影响，仅失去「系统更少杀后台」的常驻加成。

3. **通知构建改用 `NotificationCompat.Builder`**，消除 `minSdk=22` 上的 `NoSuchMethodError`（API 22–25 设备同样受益）。
4. **全链路设防**：`createBall()`/`createPanel()` 的 inflate 包 try/catch（失败即 `stopSelf()` 并 Toast，不崩进程）；`onDestroy()` 的 `wm.removeView` 加 `isAttachedToWindow` 判断 + try/catch。
5. **诊断日志**：在启动、晋升各级、降级点打 `Log.i/Log.e`（含异常堆栈），便于真机 `logcat` 回归定位，避免再次「盲修」。

## 关键设计决策与权衡

- **为什么优先「降级保命」而不是保留 FGS 强约束**：悬浮窗核心价值是悬浮球可见可用，FGS 只是增强存活。功能可用 > 常驻优化；任何路径都不应杀死与 WebView 同进程的宿主。
- **为什么不换成独立进程**：会引入 SQLite 多进程访问风险（`FloatingDbHelper` 直连同一库文件），违背现有架构约定，改动半径过大，不作为本方案。
- **复杂度评估**：服务启动为一次性路径，无热循环；改动集中在 `onCreate` 启动序列与通知构建，不影响数据加载、复制/分享等既有逻辑，回归面小。

## 架构与目录结构

```
android/app/src/main/java/com/emoji/ai/
├── FloatingWindowPlugin.java   # [MODIFY] start() 改 startService + 权限/运行态校验；stop/isRunning/openSettings 不变
├── FloatingWindowService.java  # [MODIFY] onCreate 三级晋升 + 全链路设防；onDestroy 安全移除 view；通知改 NotificationCompat
android/app/build.gradle        # [MODIFY] versionCode 11→12，versionName 1.3.0→1.3.1（打包强制约定）
```

## 执行注意事项

- `stop()` 保持 `stopService` 语义；`isRunning` 静态标志在晋升失败降级为普通服务时仍应为 true（功能在跑）。
- 降级日志需包含 Android 版本与厂商信息（`Build.MANUFACTURER`/`Build.MODEL`），便于区分 AOSP 与 MIUI 行为。
- 不引入新依赖；不改 manifest（现有 specialUse 声明+权限已正确，问题不在声明缺失）。
- 构建前必须递增版本号；验证用 debug 包，不影响覆盖安装三要素。
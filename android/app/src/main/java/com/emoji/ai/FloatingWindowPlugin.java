package com.emoji.ai;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 悬浮窗控制插件（与前端 nativeBridge 对应）。
 *
 * 方法：
 * - start：先校验 SYSTEM_ALERT_WINDOW 权限，未授权 reject 并引导前端跳转权限设置页；已授权则启动 Service。
 * - stop：停止 Service。
 * - isRunning：返回当前悬浮窗是否在运行。
 * - openSettings：跳转系统「显示在其他应用上」权限设置页。
 */
@CapacitorPlugin(name = "FloatingWindow")
public class FloatingWindowPlugin extends Plugin {

    private static final String TAG = "FloatingWindowPlugin";

    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && !Settings.canDrawOverlays(getContext())) {
            call.reject("NO_OVERLAY_PERMISSION", "需要授予「显示在其他应用上」权限");
            return;
        }
        if (FloatingWindowService.isRunning) {
            call.resolve(new JSObject().put("running", true));
            return;
        }
        Intent intent = new Intent(getContext(), FloatingWindowService.class);
        try {
            // 刻意使用 startService 而非 startForegroundService：
            // 后者附带「5 秒内必须成功 startForeground」的硬契约，晋升失败（例如厂商框架
            // 拒绝 specialUse 类型）会抛 RemoteServiceException 直接杀掉与 WebView 同进程的
            // 宿主 App。本服务改为在 onCreate 内「尽力晋升 + 逐级降级」，晋升失败也不崩进程。
            getContext().startService(intent);
            Log.i(TAG, "startService ok | api=" + Build.VERSION.SDK_INT
                    + " | " + Build.MANUFACTURER + " " + Build.MODEL);
            call.resolve(new JSObject().put("running", true));
        } catch (Throwable e) {
            // 捕获 Throwable：与 WebView 同进程，任何 Error（如 NoSuchMethodError）逃逸都会闪退
            Log.e(TAG, "start service failed", e);
            call.reject("START_FAILED", String.valueOf(e.getMessage()));
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), FloatingWindowService.class);
        getContext().stopService(intent);
        call.resolve(new JSObject().put("running", false));
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        call.resolve(new JSObject().put("running", FloatingWindowService.isRunning));
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent intent = new Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
        call.resolve();
    }
}

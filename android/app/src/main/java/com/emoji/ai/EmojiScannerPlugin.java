package com.emoji.ai;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.util.Log;
import androidx.core.content.FileProvider;

import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import com.emoji.ai.ai.AiEngine;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * EmojiScanner 原生插件。
 * 能力：手动选择文件夹（SAF）、缩略图生成、
 * 端侧 AI 识别（OCR + 图像标签 + 情感映射）、分享前缓存拷贝。
 * 事件：scanProgress（扫描/识别进度）。
 */
@CapacitorPlugin(name = "EmojiScanner")
public class EmojiScannerPlugin extends Plugin {

    private static final String TAG = "EmojiScanner";
    private static final String EVENT_SCAN_PROGRESS = "scanProgress";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    // ───────────────────────── 手动选择文件夹（SAF） ─────────────────────────

    /** 调起系统目录选择器，让用户手动挑选一个文件夹。 */
    @PluginMethod
    public void openFolderPicker(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
            | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "folderPickerResult");
    }

    @ActivityCallback
    public void folderPickerResult(PluginCall call, ActivityResult result) {
        Log.i(TAG, "folderPickerResult: resultCode=" + result.getResultCode());
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            Log.w(TAG, "folderPickerResult: cancelled or null data");
            call.reject("FOLDER_PICK_CANCELLED");
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) {
            Log.w(TAG, "folderPickerResult: uri is null");
            call.reject("NO_URI");
            return;
        }
        String name = "";
        try {
            DocumentFile df = DocumentFile.fromTreeUri(getContext(), uri);
            if (df != null && df.getName() != null) name = df.getName();
        } catch (Exception e) {
            Log.w(TAG, "read folder name failed", e);
        }
        FolderStore.add(getContext(), uri, name);
        Log.i(TAG, "folderPickerResult: picked name=" + name
            + " persisted=" + FolderScannerUtil.hasPersistedPermission(getContext(), uri));
        JSObject ret = new JSObject();
        ret.put("treeUri", uri.toString());
        ret.put("name", name);
        call.resolve(ret);
    }

    /** 返回用户已保存的全部文件夹。 */
    @PluginMethod
    public void listFolders(PluginCall call) {
        List<FolderStore.FolderMeta> folders = FolderStore.list(getContext());
        JSArray arr = new JSArray();
        for (FolderStore.FolderMeta f : folders) {
            JSObject o = new JSObject();
            o.put("treeUri", f.treeUri);
            o.put("name", f.name);
            arr.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("folders", arr);
        call.resolve(ret);
    }

    /** 移除一个已保存的文件夹。 */
    @PluginMethod
    public void removeFolder(PluginCall call) {
        String treeUri = call.getString("treeUri");
        if (treeUri == null || treeUri.isEmpty()) {
            call.reject("NO_TREE");
            return;
        }
        FolderStore.remove(getContext(), treeUri);
        call.resolve();
    }

    /**
     * 扫描某个已授权文件夹（分页）。
     * options: { treeUri, offset?, limit?, withThumbnails? }
     */
    @PluginMethod
    public void scanFolder(PluginCall call) {
        String treeUri = call.getString("treeUri");
        int offset = call.getInt("offset", 0);
        int limit = call.getInt("limit", 300);
        boolean withThumbs = call.getBoolean("withThumbnails", true);
        if (treeUri == null || treeUri.isEmpty()) {
            call.reject("NO_TREE");
            return;
        }
        executor.execute(() -> {
            try {
                Uri uri = Uri.parse(treeUri);
                List<FileWalkerUtil.ImageEntry> all =
                    FolderScannerUtil.scanTree(getContext(), uri);
                int total = all.size();
                Log.i(TAG, "scanFolder: persisted="
                    + FolderScannerUtil.hasPersistedPermission(getContext(), uri)
                    + " total=" + total);
                String name = "";
                DocumentFile df = DocumentFile.fromTreeUri(getContext(), uri);
                if (df != null && df.getName() != null) name = df.getName();

                JSArray items = new JSArray();
                int end = Math.min(offset + limit, total);
                for (int i = Math.max(offset, 0); i < end; i++) {
                    FileWalkerUtil.ImageEntry e = all.get(i);
                    JSObject o = new JSObject();
                    o.put("path", e.path);
                    o.put("mimeType", e.mimeType);
                    o.put("size", e.size);
                    o.put("width", e.width);
                    o.put("height", e.height);
                    o.put("isGif", "image/gif".equals(e.mimeType));
                    o.put("mtime", e.mtimeSec);
                    if (withThumbs) {
                        String thumb = ThumbnailUtil.get(getContext())
                            .getOrCreate(e.path, e.mtimeSec / 1000L);
                        o.put("thumbPath", thumb != null ? thumb : "");
                    }
                    items.put(o);
                }
                JSObject ret = new JSObject();
                ret.put("items", items);
                ret.put("total", total);
                ret.put("hasMore", end < total);
                ret.put("folderName", name);
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "scanFolder failed", e);
                call.reject("FOLDER_SCAN_FAILED", e);
            }
        });
    }

    /** 批量补生成缩略图：paths[] -> { path: file://uri } */
    @PluginMethod
    public void getThumbnails(PluginCall call) {
        JSArray paths = call.getArray("paths");
        if (paths == null || paths.length() == 0) {
            JSObject empty = new JSObject();
            call.resolve(empty);
            return;
        }
        executor.execute(() -> {
            try {
                JSObject map = new JSObject();
                for (int i = 0; i < paths.length(); i++) {
                    String p = paths.optString(i, "");
                    if (p.isEmpty()) {
                        continue;
                    }
                    File f = new File(p);
                    if (!f.exists()) {
                        continue;
                    }
                    String thumb = ThumbnailUtil.get(getContext())
                        .getOrCreate(p, f.lastModified() / 1000L);
                    if (thumb != null) {
                        map.put(p, thumb);
                    }
                }
                call.resolve(map);
            } catch (Exception e) {
                Log.e(TAG, "getThumbnails failed", e);
                call.reject("THUMB_FAILED", e);
            }
        });
    }

    @PluginMethod
    public void clearThumbnailCache(PluginCall call) {
        ThumbnailUtil.get(getContext()).clear();
        call.resolve();
    }

    /** 分享前把外部文件拷入应用缓存目录，返回 file:// URI（走 FileProvider 授权）。 */
    @PluginMethod
    public void prepareForShare(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("NO_PATH");
            return;
        }
        executor.execute(() -> {
            try {
                String name = "share_" + System.currentTimeMillis();
                int slash = path.lastIndexOf('/');
                if (slash >= 0) name = "share_" + path.substring(slash + 1);
                String cached = ThumbnailUtil.copyToCache(getContext(), path, "share", name);
                if (cached == null) {
                    call.reject("COPY_FAILED");
                    return;
                }
                JSObject ret = new JSObject();
                ret.put("uri", cached);
                ret.put("path", Uri.parse(cached).getPath());
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "prepareForShare failed", e);
                call.reject("COPY_FAILED", e);
            }
        });
    }

    /** FileProvider authority，须与 res/xml/file_paths.xml 及 FloatingWindowService 一致 */
    private static final String FILE_PROVIDER_AUTHORITY = "com.emoji.ai.fileprovider";

    /**
     * 直接拉起微信/QQ 转发界面（跳过系统分享面板），或回退系统面板。
     * options: { path, target: 'wechat' | 'qq' | 'system' }
     * 返回: { launched: boolean, reason?: 'NOT_INSTALLED' | 'LAUNCH_FAILED' }
     *   - launched:true 表示已成功拉起（直发或回退系统面板）
     *   - launched:false + reason='NOT_INSTALLED'：目标 App 未安装，由前端回退系统分享
     *   - 直发抛 ActivityNotFoundException 时本方法自动回退系统面板（launched:true）
     */
    @PluginMethod
    public void shareTo(PluginCall call) {
        String path = call.getString("path");
        String targetRaw = call.getString("target");
        if (path == null || path.isEmpty()) {
            call.reject("NO_PATH");
            return;
        }
        final String target = (targetRaw == null) ? "system" : targetRaw;
        executor.execute(() -> {
            try {
                String cached = ThumbnailUtil.copyToCache(
                    getContext(), path, "share", safeName(path));
                if (cached == null) {
                    call.reject("COPY_FAILED");
                    return;
                }
                File realFile = toRealFile(cached);
                if (realFile == null) {
                    call.reject("COPY_FAILED");
                    return;
                }
                Uri uri = FileProvider.getUriForFile(
                    getContext(), FILE_PROVIDER_AUTHORITY, realFile);

                // 系统兜底：直接走原 chooser 逻辑
                if ("system".equals(target)) {
                    launchChooser(call, uri, cached);
                    return;
                }

                // 直发微信/QQ：先判断是否安装，未装则告知前端回退
                String pkg = "wechat".equals(target)
                    ? "com.tencent.mm" : "com.tencent.mobileqq";
                try {
                    getContext().getPackageManager().getPackageInfo(pkg, 0);
                } catch (PackageManager.NameNotFoundException e) {
                    Log.w(TAG, "shareTo: " + pkg + " not installed, fallback");
                    JSObject ret = new JSObject();
                    ret.put("launched", false);
                    ret.put("reason", "NOT_INSTALLED");
                    call.resolve(ret);
                    return;
                }

                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType(guessMime(cached));
                intent.putExtra(Intent.EXTRA_STREAM, uri);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.setClipData(ClipData.newRawUri("emoji", uri));
                intent.setPackage(pkg);

                // startActivity 必须在主线程执行，失败（被拦截）则回退系统面板
                getActivity().runOnUiThread(() -> {
                    try {
                        getActivity().startActivity(intent);
                        JSObject ret = new JSObject();
                        ret.put("launched", true);
                        call.resolve(ret);
                    } catch (ActivityNotFoundException anfe) {
                        Log.w(TAG, "shareTo: launch " + pkg + " failed, fallback", anfe);
                        launchChooser(call, uri, cached);
                    }
                });
            } catch (Exception e) {
                Log.e(TAG, "shareTo failed", e);
                call.reject("SHARE_FAILED", e);
            }
        });
    }

    /** 弹出系统分享面板（兜底），成功后 resolve {launched:true} */
    private void launchChooser(PluginCall call, Uri uri, String cached) {
        try {
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType(guessMime(cached));
            intent.putExtra(Intent.EXTRA_STREAM, uri);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.setClipData(ClipData.newRawUri("emoji", uri));
            Intent chooser = Intent.createChooser(intent, "分享表情到");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            chooser.setClipData(ClipData.newRawUri("emoji", uri));
            getActivity().runOnUiThread(() -> {
                try {
                    getActivity().startActivity(chooser);
                    JSObject ret = new JSObject();
                    ret.put("launched", true);
                    call.resolve(ret);
                } catch (Exception e) {
                    Log.e(TAG, "launchChooser failed", e);
                    call.reject("SHARE_FAILED", e);
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "launchChooser failed", e);
            call.reject("SHARE_FAILED", e);
        }
    }

    /** 把 file:// URI（或裸路径）转成真实 File，便于 FileProvider 授权 */
    private File toRealFile(String uriOrPath) {
        if (uriOrPath == null || uriOrPath.isEmpty()) return null;
        String p = uriOrPath;
        if (p.startsWith("file://")) {
            p = Uri.parse(p).getPath();
            if (p == null || p.isEmpty()) return null;
        } else if (p.startsWith("content://")) {
            return null;
        }
        File f = new File(p);
        return f.exists() ? f : null;
    }

    /** 按扩展名猜 MIME，猜不到统一 image/* */
    private String guessMime(String path) {
        String p = path == null ? "" : path.toLowerCase();
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        return "image/*";
    }

    private String safeName(String path) {
        if (path == null || path.isEmpty()) return "emoji_" + System.currentTimeMillis();
        int slash = path.lastIndexOf('/');
        String name = slash >= 0 ? path.substring(slash + 1) : path;
        return name.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    /**
     * 返回可加载的 file:// URL：content:// 经缓存拷贝后返回，file:// 原样返回；
     * 源文件已删除 / 授权失效时返回 { url: "", missing: true }，由前端展示占位图。
     *
     * ⚠️ 不可读时绝不能把原始 content:// 交回前端：那会让 WebView 经 Capacitor
     * 本地服务器（/_capacitor_content_/…）去打开一个不存在的 SAF 文档，部分 ROM
     * 的 DocumentsProvider 会抛出非 IOException 的运行时异常，从
     * shouldInterceptRequest 逃出导致进程崩溃（表现为「点击源文件已删除的
     * 表情包就闪退」——WebViewLocalServer 只捕获 IOException）。
     */
    @PluginMethod
    public void getViewableUrl(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("NO_PATH");
            return;
        }
        if (!path.startsWith("content://")) {
            JSObject ret = new JSObject();
            ret.put("url", path);
            call.resolve(ret);
            return;
        }
        executor.execute(() -> {
            try {
                if (!isSourceReadable(path)) {
                    Log.w(TAG, "getViewableUrl: source missing or unreadable: " + path);
                    JSObject ret = new JSObject();
                    ret.put("url", "");
                    ret.put("missing", true);
                    call.resolve(ret);
                    return;
                }
                String name = "view_" + System.currentTimeMillis();
                int slash = path.lastIndexOf('/');
                if (slash >= 0) name = "view_" + path.substring(slash + 1);
                String cached = ThumbnailUtil.copyToCache(getContext(), path, "viewable", name);
                JSObject ret = new JSObject();
                ret.put("url", cached != null ? cached : "");
                ret.put("missing", cached == null);
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "getViewableUrl failed", e);
                JSObject ret = new JSObject();
                ret.put("url", "");
                ret.put("missing", true);
                call.resolve(ret);
            }
        });
    }

    /** 探测 content:// 源是否仍可读（文件已删除 / 授权失效均返回 false） */
    private boolean isSourceReadable(String contentUri) {
        try (InputStream in = getContext().getContentResolver()
                .openInputStream(Uri.parse(contentUri))) {
            return in != null;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 单张图片的端侧 AI 识别。
     * options: { path, withOcr?: boolean, withLabels?: boolean }
     * 返回: { ocrText, labels[], emotions[] }
     */
    @PluginMethod
    public void recognizeImage(PluginCall call) {
        String path = call.getString("path");
        boolean withOcr = call.getBoolean("withOcr", true);
        boolean withLabels = call.getBoolean("withLabels", true);
        if (path == null || path.isEmpty()) {
            call.reject("NO_PATH");
            return;
        }
        executor.execute(() -> {
            try {
                AiEngine.Result r = AiEngine.get()
                    .analyze(getContext(), path, withOcr, withLabels);
                call.resolve(resultToJson(r));
            } catch (Exception e) {
                Log.e(TAG, "recognizeImage failed: " + path, e);
                JSObject ret = new JSObject();
                ret.put("ocrText", "");
                ret.put("labels", new JSArray());
                ret.put("emotions", new JSArray().put("neutral"));
                call.resolve(ret);
            }
        });
    }

    /**
     * 批量识别（串行执行避免内存峰值，带进度事件）。
     * options: { paths: string[], withOcr?: boolean, withLabels?: boolean }
     * 返回: { results: [{ path, ocrText, labels[], emotions[] }] }
     */
    @PluginMethod
    public void recognizeBatch(PluginCall call) {
        JSArray paths = call.getArray("paths");
        boolean withOcr = call.getBoolean("withOcr", true);
        boolean withLabels = call.getBoolean("withLabels", true);
        if (paths == null || paths.length() == 0) {
            JSObject ret = new JSObject();
            ret.put("results", new JSArray());
            call.resolve(ret);
            return;
        }
        executor.execute(() -> {
            try {
                JSArray results = new JSArray();
                int total = paths.length();
                for (int i = 0; i < total; i++) {
                    String p = paths.optString(i, "");
                    if (p.isEmpty()) {
                        continue;
                    }
                    AiEngine.Result r = AiEngine.get()
                        .analyze(getContext(), p, withOcr, withLabels);
                    JSObject o = resultToJson(r);
                    o.put("path", p);
                    results.put(o);
                    if ((i + 1) % 5 == 0 || i == total - 1) {
                        notifyProgress(total, i + 1, p);
                    }
                }
                JSObject ret = new JSObject();
                ret.put("results", results);
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "recognizeBatch failed", e);
                call.reject("RECOGNIZE_FAILED", e);
            }
        });
    }

    private JSObject resultToJson(AiEngine.Result r) {
        JSObject o = new JSObject();
        o.put("ocrText", r.ocrText != null ? r.ocrText : "");
        JSArray labels = new JSArray();
        for (String l : r.labels) {
            labels.put(l);
        }
        JSArray emotions = new JSArray();
        for (String e : r.emotions) {
            emotions.put(e);
        }
        o.put("labels", labels);
        o.put("emotions", emotions);
        return o;
    }

    private void notifyProgress(int total, int processed, String currentPath) {
        JSObject data = new JSObject();
        data.put("phase", "recognizing");
        data.put("total", total);
        data.put("processed", processed);
        if (currentPath != null) {
            data.put("currentPath", currentPath);
        }
        notifyListeners(EVENT_SCAN_PROGRESS, data);
    }
}

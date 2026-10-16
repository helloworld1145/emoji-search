package com.emoji.ai;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;

/**
 * 持久化用户通过 SAF 手动授权的文件夹（treeUri + 名称）。
 * 用 SharedPreferences 保存，并在保存/移除时分别持久化或释放 SAF 的 URI 权限，
 * 以便应用重启后仍能访问这些目录。
 */
public final class FolderStore {
    private static final String TAG = "FolderStore";
    private static final String PREFS_NAME = "emoji_folder_store";
    private static final String KEY_PREFIX = "folder_";

    private FolderStore() {}

    /** 用户已授权文件夹的元数据。 */
    public static class FolderMeta {
        public final String treeUri;
        public final String name;

        public FolderMeta(String treeUri, String name) {
            this.treeUri = treeUri;
            this.name = name;
        }
    }

    /** 保存一个文件夹授权，并持久化 SAF URI 读取权限。 */
    public static void add(Context ctx, Uri uri, String name) {
        if (uri == null) {
            return;
        }
        try {
            // Android 15+(API 35/36) 要求同时声明 READ|WRITE 掩码，否则可能抛 SecurityException
            ctx.getContentResolver().takePersistableUriPermission(
                uri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception e) {
            Log.e(TAG, "takePersistableUriPermission failed", e);
        }
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_PREFIX + uri.toString(), name == null ? "" : name)
            .apply();
    }

    /** 返回全部已保存的文件夹。 */
    public static List<FolderMeta> list(Context ctx) {
        List<FolderMeta> out = new ArrayList<>();
        SharedPreferences sp = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        for (String key : sp.getAll().keySet()) {
            if (key.startsWith(KEY_PREFIX)) {
                String treeUri = key.substring(KEY_PREFIX.length());
                out.add(new FolderMeta(treeUri, sp.getString(key, "")));
            }
        }
        return out;
    }

    /** 移除一个文件夹授权，并释放其 SAF URI 持久权限。 */
    public static void remove(Context ctx, String treeUri) {
        if (treeUri == null || treeUri.isEmpty()) {
            return;
        }
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_PREFIX + treeUri)
            .apply();
        try {
            // 与 add 保持同一掩码，避免释放时抛异常
            ctx.getContentResolver().releasePersistableUriPermission(
                Uri.parse(treeUri),
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception e) {
            Log.e(TAG, "releasePersistableUriPermission failed", e);
        }
    }
}

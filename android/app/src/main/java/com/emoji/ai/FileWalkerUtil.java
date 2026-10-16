package com.emoji.ai;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * 设备图片枚举：优先走 MediaStore（快），为空时回退递归目录遍历（兜底）。
 */
public final class FileWalkerUtil {

    private static final String TAG = "FileWalkerUtil";
    private static final String[] MIME_TYPES = {
        "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/bmp"
    };
    private static final int WALK_LIMIT = 20000;

    /** 单张图片的元数据条目 */
    public static class ImageEntry {
        public String path;
        public String mimeType;
        public long size;
        public int width;
        public int height;
        public long mtimeSec;

        ImageEntry(String path, String mimeType, long size, int width, int height, long mtimeSec) {
            this.path = path;
            this.mimeType = mimeType;
            this.size = size;
            this.width = width;
            this.height = height;
            this.mtimeSec = mtimeSec;
        }
    }

    public static int countImages(Context ctx) {
        int total = 0;
        Cursor c = null;
        try {
            Uri uri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
            c = ctx.getContentResolver().query(
                uri,
                new String[] { MediaStore.Images.Media._ID },
                buildMimeSelection(),
                MIME_TYPES,
                null
            );
            if (c != null) {
                total = c.getCount();
            }
        } catch (Exception e) {
            Log.w(TAG, "count via MediaStore failed", e);
        } finally {
            if (c != null) {
                c.close();
            }
        }
        if (total == 0) {
            total = walkRoot(ctx).size();
        }
        return total;
    }

    /** 分页查询：按修改时间倒序，offset/limit 在内存中跳过（Cursor 惰性遍历，开销低）。 */
    public static List<ImageEntry> queryImages(Context ctx, int offset, int limit) {
        List<ImageEntry> all = queryMediaStore(ctx);
        if (all.isEmpty()) {
            all = walkRoot(ctx);
        }
        List<ImageEntry> page = new ArrayList<>();
        int end = Math.min(offset + limit, all.size());
        for (int i = Math.max(offset, 0); i < end; i++) {
            page.add(all.get(i));
        }
        return page;
    }

    private static List<ImageEntry> queryMediaStore(Context ctx) {
        List<ImageEntry> out = new ArrayList<>();
        Cursor c = null;
        try {
            Uri uri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
            String[] projection = {
                MediaStore.Images.Media.DATA,
                MediaStore.Images.Media.MIME_TYPE,
                MediaStore.Images.Media.SIZE,
                MediaStore.Images.Media.WIDTH,
                MediaStore.Images.Media.HEIGHT,
                MediaStore.Images.Media.DATE_MODIFIED
            };
            c = ctx.getContentResolver().query(
                uri,
                projection,
                buildMimeSelection(),
                MIME_TYPES,
                MediaStore.Images.Media.DATE_MODIFIED + " DESC"
            );
            if (c == null) {
                return out;
            }
            int idxPath = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATA);
            int idxMime = c.getColumnIndexOrThrow(MediaStore.Images.Media.MIME_TYPE);
            int idxSize = c.getColumnIndex(MediaStore.Images.Media.SIZE);
            int idxW = c.getColumnIndex(MediaStore.Images.Media.WIDTH);
            int idxH = c.getColumnIndex(MediaStore.Images.Media.HEIGHT);
            int idxDate = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_MODIFIED);
            while (c.moveToNext()) {
                String path = c.getString(idxPath);
                if (path == null || !new File(path).exists()) {
                    continue;
                }
                String mime = idxMime >= 0 ? c.getString(idxMime) : "image/*";
                long size = idxSize >= 0 ? c.getLong(idxSize) : 0;
                int w = idxW >= 0 ? c.getInt(idxW) : 0;
                int h = idxH >= 0 ? c.getInt(idxH) : 0;
                long mtime = c.getLong(idxDate) * 1000L;
                out.add(new ImageEntry(path, mime == null ? "image/*" : mime, size, w, h, mtime));
            }
        } catch (Exception e) {
            Log.w(TAG, "query MediaStore failed", e);
        } finally {
            if (c != null) {
                c.close();
            }
        }
        return out;
    }

    /** MIME_TYPE IN (?,?,...) 选择子 */
    private static String buildMimeSelection() {
        StringBuilder sb = new StringBuilder(MediaStore.Images.Media.MIME_TYPE + " IN (");
        for (int i = 0; i < MIME_TYPES.length; i++) {
            sb.append(i == 0 ? "?" : ",?");
        }
        sb.append(")");
        return sb.toString();
    }

    /** 兜底：递归遍历外部存储根目录，最多 WALK_LIMIT 张，避免极端耗时。 */
    private static List<ImageEntry> walkRoot(Context ctx) {
        List<ImageEntry> out = new ArrayList<>();
        File root = Environment.getExternalStorageDirectory();
        if (root == null || !root.canRead()) {
            return out;
        }
        walkDir(root, out);
        Log.i(TAG, "fallback walk found " + out.size() + " images");
        return out;
    }

    private static void walkDir(File dir, List<ImageEntry> out) {
        if (out.size() >= WALK_LIMIT) {
            return;
        }
        File[] files = dir.listFiles();
        if (files == null) {
            return;
        }
        for (File f : files) {
            if (out.size() >= WALK_LIMIT) {
                return;
            }
            if (f.isDirectory()) {
                String name = f.getName();
                // 跳过明显无关的系统目录，减少无效遍历
                if (name.startsWith(".") || name.equals("Android") || name.equals("LOST.DIR")) {
                    continue;
                }
                walkDir(f, out);
            } else if (isImageFile(f.getName())) {
                long mtime = f.lastModified();
                out.add(new ImageEntry(
                    f.getAbsolutePath(),
                    guessMime(f.getName()),
                    f.length(),
                    0,
                    0,
                    mtime
                ));
            }
        }
    }

    private static boolean isImageFile(String name) {
        if (name == null) {
            return false;
        }
        String lower = name.toLowerCase();
        return lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg")
            || lower.endsWith(".gif") || lower.endsWith(".webp") || lower.endsWith(".bmp");
    }

    private static String guessMime(String name) {
        String lower = name.toLowerCase();
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".bmp")) return "image/bmp";
        return "image/jpeg";
    }
}

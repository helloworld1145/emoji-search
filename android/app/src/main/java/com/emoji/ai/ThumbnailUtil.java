package com.emoji.ai;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;

/**
 * 缩略图生成与磁盘缓存。
 * 以「路径 + mtime」为键缓存 JPEG，保证原图更新后自动失效。
 * 支持 file:// 路径与 content:// URI（SAF 文件夹扫描）两种来源。
 */
public final class ThumbnailUtil {

    private static final String TAG = "ThumbnailUtil";
    private static final int THUMB_TARGET = 360;
    private static ThumbnailUtil instance;
    private final Context appContext;
    private final File cacheDir;

    private ThumbnailUtil(Context context) {
        appContext = context.getApplicationContext();
        cacheDir = new File(context.getCacheDir(), "thumbs");
        if (!cacheDir.exists()) {
            cacheDir.mkdirs();
        }
    }

    public static synchronized ThumbnailUtil get(Context context) {
        if (instance == null) {
            instance = new ThumbnailUtil(context.getApplicationContext());
        }
        return instance;
    }

    /**
     * 返回缩略图 file:// URI；解码失败返回 null（调用方回退原图）。
     */
    public String getOrCreate(String path, long mtimeSec) {
        if (path == null || path.isEmpty()) {
            return null;
        }
        File cached = new File(cacheDir, hash(path, mtimeSec) + ".jpg");
        if (cached.exists() && cached.length() > 0) {
            return Uri.fromFile(cached).toString();
        }
        Bitmap bmp;
        if (path.startsWith("content://")) {
            bmp = decodeContent(appContext, path, THUMB_TARGET);
        } else {
            bmp = decodeSampled(path, THUMB_TARGET);
        }
        if (bmp == null) {
            return null;
        }
        try (OutputStream os = new FileOutputStream(cached)) {
            bmp.compress(Bitmap.CompressFormat.JPEG, 85, os);
        } catch (Exception e) {
            Log.w(TAG, "compress thumb failed: " + path);
            return null;
        } finally {
            bmp.recycle();
        }
        return Uri.fromFile(cached).toString();
    }

    /** 清空缩略图缓存 */
    public void clear() {
        File[] files = cacheDir.listFiles();
        if (files != null) {
            for (File f : files) {
                f.delete();
            }
        }
    }

    /**
     * 把 content:// 或 file:// 源拷贝到应用缓存子目录，返回 file:// URI。
     * 供 getViewableUrl / prepareForShare 复用（让 WebView 与系统分享能加载 SAF 图片）。
     * 失败返回 null。
     */
    public static String copyToCache(Context ctx, String src, String subDir, String name) {
        if (ctx == null || src == null || src.isEmpty()) return null;
        try {
            File dir = new File(ctx.getCacheDir(), subDir);
            if (!dir.exists() && !dir.mkdirs()) {
                Log.w(TAG, "copyToCache: cannot create dir " + subDir);
                return null;
            }
            File dst = new File(dir, sanitize(name));
            if (src.startsWith("content://")) {
                try (InputStream in = ctx.getContentResolver().openInputStream(Uri.parse(src));
                     OutputStream out = new FileOutputStream(dst)) {
                    if (in == null) return null;
                    pipe(in, out);
                }
            } else {
                // src 可能是 file:// 前缀的字符串，直接 new File 会得到 /file:/... 而找不到文件
                String s0 = src.startsWith("file://") ? Uri.parse(src).getPath() : src;
                if (s0 == null || s0.isEmpty()) return null;
                File s = new File(s0);
                if (!s.exists()) return null;
                try (InputStream in = new FileInputStream(s);
                     OutputStream out = new FileOutputStream(dst)) {
                    pipe(in, out);
                }
            }
            return Uri.fromFile(dst).toString();
        } catch (Exception e) {
            Log.w(TAG, "copyToCache failed: " + name);
            return null;
        }
    }

    private static String sanitize(String name) {
        if (name == null || name.isEmpty()) return "file_" + System.currentTimeMillis();
        return name.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    private static void pipe(InputStream in, OutputStream out) throws java.io.IOException {
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) != -1) {
            out.write(buf, 0, n);
        }
    }

    /** 采样解码 file:// 路径，GIF 自动取首帧 */
    private static Bitmap decodeSampled(String path, int target) {
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(path, opts);
        if (opts.outWidth <= 0 || opts.outHeight <= 0) {
            return null;
        }
        int sample = 1;
        int max = Math.max(opts.outWidth, opts.outHeight);
        while (max / (sample * 2) >= target) {
            sample *= 2;
        }
        opts.inSampleSize = sample;
        opts.inJustDecodeBounds = false;
        opts.inPreferredConfig = Bitmap.Config.RGB_565;
        try {
            return BitmapFactory.decodeFile(path, opts);
        } catch (OutOfMemoryError e) {
            Log.w(TAG, "oom decoding: " + path);
            return null;
        }
    }

    /** 采样解码 content:// URI（SAF 授权目录），分两次打开 fd 以获得 bounds 与采样。 */
    private static Bitmap decodeContent(Context ctx, String uri, int target) {
        try {
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inJustDecodeBounds = true;
            try (ParcelFileDescriptor pfd =
                    ctx.getContentResolver().openFileDescriptor(Uri.parse(uri), "r")) {
                if (pfd == null) {
                    return null;
                }
                BitmapFactory.decodeFileDescriptor(pfd.getFileDescriptor(), null, opts);
            }
            if (opts.outWidth <= 0 || opts.outHeight <= 0) {
                return null;
            }
            int sample = 1;
            int max = Math.max(opts.outWidth, opts.outHeight);
            while (max / (sample * 2) >= target) {
                sample *= 2;
            }
            opts.inSampleSize = sample;
            opts.inJustDecodeBounds = false;
            opts.inPreferredConfig = Bitmap.Config.RGB_565;
            try (ParcelFileDescriptor pfd =
                    ctx.getContentResolver().openFileDescriptor(Uri.parse(uri), "r")) {
                if (pfd == null) {
                    return null;
                }
                return BitmapFactory.decodeFileDescriptor(pfd.getFileDescriptor(), null, opts);
            }
        } catch (Exception e) {
            Log.w(TAG, "decodeContent failed: " + uri);
            return null;
        }
    }

    private static String hash(String path, long mtimeSec) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            md.update((path + "#" + mtimeSec).getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : md.digest()) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            return String.valueOf((path + mtimeSec).hashCode());
        }
    }
}

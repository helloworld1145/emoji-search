package com.emoji.ai.ai;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.util.Log;

import java.io.File;

/**
 * 统一图片解码工具：把 SAF 扫描的 content:// URI 或普通 file:// 路径
 * 解码为采样后的 Bitmap，供 ML Kit（OCR / 图像标签）使用。
 *
 * - content://：经 ContentResolver.openFileDescriptor 两遍解码
 *   （先 inJustDecodeBounds 取边界算 inSampleSize，再采样解码）；
 *   BitmapFactory 对 GIF 自动取首帧。
 * - file://：BitmapFactory.decodeFile 同款采样逻辑。
 * - 失败返回 null 并打日志（只含路径尾段，避免泄露隐私）。
 *
 * 必须在非主线程调用。
 */
public final class ImageLoader {

    private static final String TAG = "ImageLoader";

    private ImageLoader() {}

    /**
     * 解码图片为不超过 target 目标边长的 Bitmap（长边 >= target*2 才降采样）。
     *
     * @param path content:// URI 或文件绝对路径
     * @param target 目标边长（OCR 建议 1280，图像标签建议 640）
     * @return Bitmap；失败返回 null
     */
    public static Bitmap load(Context context, String path, int target) {
        if (context == null || path == null || path.isEmpty()) {
            Log.w(TAG, "load: invalid args");
            return null;
        }
        try {
            if (path.startsWith("content://")) {
                return decodeContent(context, path, target);
            }
            return decodeFile(path, target);
        } catch (Exception e) {
            Log.w(TAG, "load failed: " + safeTail(path), e);
            return null;
        }
    }

    /** 采样解码 file:// 路径，GIF 自动取首帧 */
    private static Bitmap decodeFile(String path, int target) {
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(path, opts);
        if (opts.outWidth <= 0 || opts.outHeight <= 0) {
            Log.w(TAG, "decodeFile: bounds unavailable " + safeTail(path));
            return null;
        }
        applySample(opts, target);
        try {
            return BitmapFactory.decodeFile(path, opts);
        } catch (OutOfMemoryError e) {
            Log.w(TAG, "decodeFile oom: " + safeTail(path));
            return null;
        }
    }

    /** 采样解码 content:// URI（SAF 授权目录），分两次打开 fd 以获得 bounds 与采样 */
    private static Bitmap decodeContent(Context ctx, String uri, int target) {
        try {
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inJustDecodeBounds = true;
            try (ParcelFileDescriptor pfd =
                    ctx.getContentResolver().openFileDescriptor(Uri.parse(uri), "r")) {
                if (pfd == null) {
                    Log.w(TAG, "decodeContent: pfd=null " + safeTail(uri));
                    return null;
                }
                BitmapFactory.decodeFileDescriptor(pfd.getFileDescriptor(), null, opts);
            }
            if (opts.outWidth <= 0 || opts.outHeight <= 0) {
                Log.w(TAG, "decodeContent: bounds unavailable " + safeTail(uri));
                return null;
            }
            applySample(opts, target);
            try (ParcelFileDescriptor pfd =
                    ctx.getContentResolver().openFileDescriptor(Uri.parse(uri), "r")) {
                if (pfd == null) {
                    Log.w(TAG, "decodeContent: pfd=null (2nd pass) " + safeTail(uri));
                    return null;
                }
                return BitmapFactory.decodeFileDescriptor(pfd.getFileDescriptor(), null, opts);
            }
        } catch (Exception e) {
            Log.w(TAG, "decodeContent failed: " + safeTail(uri), e);
            return null;
        }
    }

    /** 按目标边长计算 inSampleSize（长边 >= target*2 时逐级除 2） */
    private static void applySample(BitmapFactory.Options opts, int target) {
        int sample = 1;
        int max = Math.max(opts.outWidth, opts.outHeight);
        while (max / (sample * 2) >= target) {
            sample *= 2;
        }
        opts.inSampleSize = sample;
        opts.inJustDecodeBounds = false;
    }

    /** 仅打印末段，避免泄露完整路径 */
    private static String safeTail(String path) {
        int slash = path.lastIndexOf('/');
        return slash >= 0 ? "…" + path.substring(slash) : path;
    }
}

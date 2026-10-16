package com.emoji.ai;

import android.content.Context;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Log;

import androidx.documentfile.provider.DocumentFile;

import java.util.ArrayList;
import java.util.List;

/**
 * 通过 SAF 递归扫描一个已授权 treeUri 下的图片。path 为 content:// URI。
 *
 * 采用双通道枚举以规避真机"扫描到 0 张"：
 * - 通道 1（主）：DocumentsContract.buildChildDocumentsUriUsingTree 显式查询子文档。
 *   之所以不用 DocumentFile 打头，是因为 DocumentFile.exists()/isDirectory() 内部会再查一次
 *   provider 属性，部分 ROM 上会对**有效目录返回 false**，旧实现据此直接判空，兜底永不触发。
 * - 通道 2（兜底）：主通道结果为空时，用 DocumentFile.listFiles() 再试一次。
 *
 * 两条通道覆盖同一目录，任一成功即可避免"假空"。
 */
public final class FolderScannerUtil {
    private static final String TAG = "FolderScannerUtil";
    private static final int WALK_LIMIT = 20000;
    private static final int SAMPLE_LIMIT = 5;

    private static final String[] IMAGE_EXTS = {
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"
    };

    private FolderScannerUtil() {}

    /** 单个目录的枚举统计，用于诊断"枚举到了但被过滤"这类静默归零场景 */
    private static final class Stats {
        int entries;   // 枚举到的原始条目数（文件 + 目录）
        int dirs;      // 目录数
        int images;    // 命中图片数
        int filtered;  // 因扩展名不匹配被过滤掉的文件数
        final List<String> samples = new ArrayList<>(); // 前若干条被过滤的 name|mime

        void absorb(Stats sub) {
            entries += sub.entries;
            dirs += sub.dirs;
            images += sub.images;
            filtered += sub.filtered;
            for (String s : sub.samples) {
                if (samples.size() < SAMPLE_LIMIT) samples.add(s);
            }
        }

        String summary() {
            String base = "entries=" + entries + " dirs=" + dirs
                + " images=" + images + " filtered=" + filtered;
            if (samples.isEmpty()) return base;
            return base + " sampleFiltered=" + samples;
        }
    }

    /** 递归扫描 treeUri 下的全部图片。 */
    public static List<FileWalkerUtil.ImageEntry> scanTree(Context ctx, Uri treeUri) {
        List<FileWalkerUtil.ImageEntry> out = new ArrayList<>();
        if (ctx == null || treeUri == null) {
            Log.w(TAG, "scanTree: ctx or treeUri is null");
            return out;
        }
        try {
            boolean persisted = hasPersistedPermission(ctx, treeUri);
            Log.i(TAG, "scanTree: start persisted=" + persisted + " tree=" + safeLog(treeUri));

            // ── 通道 1（主）：DocumentsContract 显式遍历 ──
            String rootDocId = DocumentsContract.getTreeDocumentId(treeUri);
            Log.i(TAG, "scanTree: channel1 rootDocId=" + rootDocId);
            Stats st = queryChildren(ctx, treeUri, rootDocId, out);

            // ── 通道 2（兜底）：主通道空结果时再用 DocumentFile ──
            if (out.isEmpty()) {
                Log.w(TAG, "scanTree: channel1 empty (" + st.summary() + "), trying DocumentFile");
                try {
                    DocumentFile root = DocumentFile.fromTreeUri(ctx, treeUri);
                    if (root != null) {
                        walkDocumentFile(ctx, treeUri, root, out);
                    } else {
                        Log.w(TAG, "scanTree: channel2 fromTreeUri returned null");
                    }
                } catch (Exception e) {
                    Log.e(TAG, "scanTree: channel2 failed", e);
                }
            }

            Log.i(TAG, "scanTree: done found=" + out.size());
        } catch (Exception e) {
            Log.e(TAG, "scanTree failed: " + safeLog(treeUri), e);
        }
        return out;
    }

    /** 该 treeUri 是否真正持有持久读取权限（诊断用） */
    public static boolean hasPersistedPermission(Context ctx, Uri uri) {
        try {
            for (UriPermission p : ctx.getContentResolver().getPersistedUriPermissions()) {
                if (p.getUri().toString().equals(uri.toString())) return true;
            }
        } catch (Exception e) {
            Log.w(TAG, "hasPersistedPermission failed", e);
        }
        return false;
    }

    /**
     * 通道 1：DocumentsContract 显式遍历。列：
     * document_id / display_name / mime_type / size / last_modified。
     */
    private static Stats queryChildren(Context ctx, Uri treeUri, String docId,
                                       List<FileWalkerUtil.ImageEntry> out) {
        Stats st = new Stats();
        if (out.size() >= WALK_LIMIT || docId == null) {
            return st;
        }
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId);
        String[] projection = new String[] {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED
        };
        try (Cursor c = ctx.getContentResolver().query(childrenUri, projection, null, null, null)) {
            if (c == null) {
                Log.w(TAG, "queryChildren: cursor=null docId=" + docId
                    + "（权限不足 / provider 不支持该查询）");
                return st;
            }
            int idxId = c.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
            int idxName = c.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            int idxMime = c.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
            int idxSize = c.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE);
            int idxMtime = c.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
            if (idxId < 0 || idxMime < 0) {
                Log.w(TAG, "queryChildren: required columns missing docId=" + docId);
                return st;
            }
            while (c.moveToNext() && out.size() < WALK_LIMIT) {
                st.entries++;
                String childDocId = c.getString(idxId);
                String name = idxName >= 0 ? c.getString(idxName) : null;
                String mime = c.getString(idxMime);
                long size = idxSize >= 0 && !c.isNull(idxSize) ? c.getLong(idxSize) : 0;
                long mtime = idxMtime >= 0 && !c.isNull(idxMtime) ? c.getLong(idxMtime) : 0;

                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    st.dirs++;
                    if (shouldSkipDir(name)) continue;
                    st.absorb(queryChildren(ctx, treeUri, childDocId, out));
                    continue;
                }

                if (name == null || !isImage(name)) {
                    st.filtered++;
                    if (st.samples.size() < SAMPLE_LIMIT) {
                        st.samples.add((name == null ? "<null>" : name) + "|" + mime);
                    }
                    continue;
                }
                if (mime == null || !mime.startsWith("image/")) {
                    mime = guessMime(name);
                }
                if (mtime == 0) mtime = System.currentTimeMillis();
                out.add(new FileWalkerUtil.ImageEntry(
                    DocumentsContract.buildDocumentUriUsingTree(treeUri, childDocId).toString(),
                    mime, size, 0, 0, mtime));
                st.images++;
            }
        } catch (Exception e) {
            Log.e(TAG, "queryChildren failed docId=" + docId, e);
        }
        Log.i(TAG, "queryChildren: docId=" + docId + " " + st.summary());
        return st;
    }

    /** 通道 2（兜底）：DocumentFile 递归，仅在主通道空结果时启用 */
    private static void walkDocumentFile(Context ctx, Uri treeUri, DocumentFile dir,
                                         List<FileWalkerUtil.ImageEntry> out) {
        if (out.size() >= WALK_LIMIT) return;
        DocumentFile[] children;
        try {
            children = dir.listFiles();
        } catch (Exception e) {
            Log.w(TAG, "walkDocumentFile: listFiles threw for " + dir.getName(), e);
            return;
        }
        if (children == null || children.length == 0) {
            Log.w(TAG, "walkDocumentFile: empty children for dir=" + dir.getName());
            return;
        }
        Log.d(TAG, "walkDocumentFile: dir=" + dir.getName() + " children=" + children.length);
        for (DocumentFile f : children) {
            if (out.size() >= WALK_LIMIT) return;
            if (f.isDirectory()) {
                if (shouldSkipDir(f.getName())) continue;
                walkDocumentFile(ctx, treeUri, f, out);
            } else if (f.isFile()) {
                String name = f.getName();
                if (name == null || !isImage(name)) continue;
                String mime = f.getType();
                if (mime == null) mime = guessMime(name);
                out.add(new FileWalkerUtil.ImageEntry(
                    f.getUri().toString(), mime, f.length(), 0, 0, f.lastModified()));
            }
        }
    }

    private static boolean shouldSkipDir(String name) {
        return name != null
            && (name.startsWith(".") || name.equals("Android") || name.equals("LOST.DIR"));
    }

    private static boolean isImage(String name) {
        String lower = name.toLowerCase();
        for (String ext : IMAGE_EXTS) {
            if (lower.endsWith(ext)) return true;
        }
        return false;
    }

    private static String guessMime(String name) {
        String lower = name.toLowerCase();
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".bmp")) return "image/bmp";
        return "image/jpeg";
    }

    /** 仅打印 authority + 末段，避免泄露完整路径与隐私 */
    private static String safeLog(Uri uri) {
        if (uri == null) return "null";
        String s = uri.toString();
        int slash = s.lastIndexOf('/');
        String tail = slash >= 0 ? s.substring(slash) : s;
        return uri.getAuthority() + " …" + tail;
    }
}

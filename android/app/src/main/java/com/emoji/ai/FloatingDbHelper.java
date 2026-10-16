package com.emoji.ai;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteException;
import android.util.Log;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * 悬浮窗数据库访问（直接打开主进程 Capacitor 所用的同一份 emoji_ai 数据库）。
 *
 * 设计：避开 WebView 桥接，原生层直接 openDatabase 同一文件。本工程加密模式为
 * no-encryption（即标准 SQLite 文件），可被 framework SQLite 直接打开。
 *
 * ⚠️ 目录与文件名必须与 @capacitor-community/sqlite 的真实产物一致（真机踩坑）：
 *  · 目录：插件 UtilsNCDatabase#getNCDatabasePath 用的是
 *    `new File(context.getFilesDir().getParentFile(), "databases")`，即
 *    /data/user/0/<pkg>/databases（等同 Context#getDatabasePath 的父目录），
 *    **不是** files/databases/；
 *  · 文件名：插件 CapacitorSQLite#createConnection 拼的是 `dbName + "SQLite.db"`，
 *    本工程库名 emoji_ai → 实际文件 emoji_aiSQLite.db。
 * 二者任一不匹配，openDatabase 都会抛异常，悬浮窗列表恒为空（真机表现：面板能弹出，
 * 但显示「无法读取本地数据」，重启无效）。
 *
 * 读写打开（库已存在，不新建）：既能查询，又能在发送后写 recent_sends。
 * 与主进程 Capacitor 连接同进程并存，SQLite 内部文件锁保证并发安全。
 */
public final class FloatingDbHelper {

    private static final String TAG = "FloatingDbHelper";
    private static final String DB_NAME = "emoji_ai";
    static final int PAGE = 60;

    /** 悬浮窗单条表情（仅展示与发送所需字段） */
    public static class EmojiItem {
        public String id;
        public String path;
        public String thumbPath;
        public String mimeType;
        public boolean isGif;

        EmojiItem() {}
    }

    private SQLiteDatabase db;

    private FloatingDbHelper(SQLiteDatabase db) {
        this.db = db;
    }

    /** 候选文件名：插件产物名在前，其余为历史/其他版本兼容 */
    private static final String[] FILE_NAMES = {
            DB_NAME + "SQLite.db", DB_NAME + ".db", DB_NAME, DB_NAME + ".sqlite"
    };

    /**
     * 打开数据库（库必存在，否则抛 SQLiteException 由调用方捕获）。
     *
     * 逐「目录 × 文件名」组合探测并尝试打开：某个组合存在但打不开（如锁冲突、
     * 文件损坏）时继续试下一个，不做「首个失败即抛」，避免一个坏候选直接让整个
     * 悬浮窗列表不可用；全部失败才抛异常，且异常信息带上尝试过的路径与目录实况，
     * 下次回归看日志即可定位。
     */
    public static FloatingDbHelper open(Context context) {
        List<File> dirs = new ArrayList<>();
        // 插件真实目录：Context#getDatabasePath 的父目录（<dataDir>/databases）
        File pluginDir = context.getDatabasePath(DB_NAME).getParentFile();
        if (pluginDir != null) dirs.add(pluginDir);
        // 兼容早期误判的 files/databases
        dirs.add(new File(context.getFilesDir(), "databases"));

        List<String> tried = new ArrayList<>();
        Throwable lastError = null;
        for (File dir : dirs) {
            for (String name : FILE_NAMES) {
                File f = new File(dir, name);
                if (!f.exists() || f.length() == 0) continue;
                tried.add(f.getAbsolutePath());
                try {
                    SQLiteDatabase database = SQLiteDatabase.openDatabase(
                            f.getAbsolutePath(), null, SQLiteDatabase.OPEN_READWRITE);
                    Log.i(TAG, "opened db: " + f.getAbsolutePath());
                    return new FloatingDbHelper(database);
                } catch (Throwable e) {
                    Log.e(TAG, "open failed: " + f.getAbsolutePath(), e);
                    lastError = e;
                }
            }
        }

        // 全部未命中：把两个目录的实际内容打进日志，避免下次再靠猜
        for (File dir : dirs) {
            String[] files = dir.list();
            Log.w(TAG, "db not found under " + dir.getAbsolutePath()
                    + " | files=" + Arrays.toString(files));
        }
        throw new SQLiteException("emoji_ai db not found or unopenable, tried=" + tried
                + (lastError != null ? ", lastError=" + lastError : ""));
    }

    public void close() {
        if (db != null && db.isOpen()) {
            db.close();
        }
    }

    private List<EmojiItem> mapRows(Cursor c) {
        List<EmojiItem> out = new ArrayList<>();
        int iId = c.getColumnIndexOrThrow("id");
        int iPath = c.getColumnIndexOrThrow("path");
        int iThumb = c.getColumnIndex("thumb_path");
        int iMime = c.getColumnIndex("mime_type");
        int iGif = c.getColumnIndex("is_gif");
        while (c.moveToNext()) {
            EmojiItem it = new EmojiItem();
            it.id = c.getString(iId);
            it.path = c.getString(iPath);
            it.thumbPath = iThumb >= 0 ? c.getString(iThumb) : null;
            it.mimeType = iMime >= 0 ? c.getString(iMime) : null;
            it.isGif = iGif >= 0 && c.getInt(iGif) != 0;
            out.add(it);
        }
        return out;
    }

    /** 收藏（is_favorite=1 且未软删）按更新时间倒序 */
    public List<EmojiItem> getFavorites(int offset) {
        Cursor c = db.query("emojis",
                new String[] { "id", "path", "thumb_path", "mime_type", "is_gif" },
                "is_favorite = 1 AND deleted_at = 0",
                null, null, null,
                "updated_at DESC",
                offset + ", " + PAGE);
        try {
            return mapRows(c);
        } finally {
            c.close();
        }
    }

    /** 最近发送：JOIN recent_sends，按 sent_at 倒序 */
    public List<EmojiItem> getRecentSends(int offset) {
        Cursor c = db.rawQuery(
                "SELECT e.id, e.path, e.thumb_path, e.mime_type, e.is_gif "
                        + "FROM emojis e JOIN recent_sends r ON e.id = r.emoji_id "
                        + "WHERE e.deleted_at = 0 ORDER BY r.sent_at DESC LIMIT ? OFFSET ?",
                new String[] { String.valueOf(PAGE), String.valueOf(offset) });
        try {
            return mapRows(c);
        } finally {
            c.close();
        }
    }

    /** 全部（未软删）按入库时间倒序 */
    public List<EmojiItem> getAll(int offset) {
        Cursor c = db.query("emojis",
                new String[] { "id", "path", "thumb_path", "mime_type", "is_gif" },
                "deleted_at = 0",
                null, null, null,
                "created_at DESC",
                offset + ", " + PAGE);
        try {
            return mapRows(c);
        } finally {
            c.close();
        }
    }

    /** 搜索：ocr_text 或 tags LIKE（与现有 search 语义一致） */
    public List<EmojiItem> search(String kw, int offset) {
        String like = "%" + kw + "%";
        Cursor c = db.query("emojis",
                new String[] { "id", "path", "thumb_path", "mime_type", "is_gif" },
                "deleted_at = 0 AND (ocr_text LIKE ? OR tags LIKE ?)",
                new String[] { like, like },
                null, null,
                "is_favorite DESC, updated_at DESC",
                offset + ", " + PAGE);
        try {
            return mapRows(c);
        } finally {
            c.close();
        }
    }

    /** 记录一次发送（分享）：兼容老 SQLite，先 INSERT OR IGNORE 再 UPDATE */
    public void recordSend(String emojiId) {
        long now = System.currentTimeMillis();
        db.execSQL(
                "INSERT OR IGNORE INTO recent_sends (emoji_id, sent_at) VALUES (?, ?)",
                new Object[] { emojiId, now });
        db.execSQL(
                "UPDATE recent_sends SET sent_at = ? WHERE emoji_id = ?",
                new Object[] { now, emojiId });
    }
}

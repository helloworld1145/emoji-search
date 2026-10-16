package com.emoji.ai;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.ContextThemeWrapper;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.FileProvider;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * 系统悬浮窗服务（常驻悬浮球 + 表情面板）。
 *
 * - 悬浮球可拖拽，点击展开/收起面板；面板含「收藏 / 最近 / 全部」Tab、搜索框与表情网格。
 *   默认进入「收藏」（贴合"收藏 + 最近优先"）；搜索时跨全部表情 LIKE 检索。
 * - 点选表情弹出底部操作条，提供「分享」（系统分享面板）动作。
 * - 所有数据直接读同一个 emoji_ai 数据库（FloatingDbHelper），发送后写入 recent_sends。
 *
 * 运行于主进程（与 Capacitor 同进程），以前台服务形式常驻，提升存活且避免多进程 SQLite 风险。
 */
public class FloatingWindowService extends Service {

    private static final String TAG = "FloatingWindowService";
    private static final String AUTHORITY = "com.emoji.ai.fileprovider";
    private static final int NOTIF_ID = 1001;
    private static final String CHANNEL_ID = "floating_window";

    /** 悬浮窗表情网格列数：一行 3 个正方形图片（尺寸见 floating_emoji_item.xml） */
    private static final int GRID_SPAN = 3;
    /** 面板宽度 320dp，右侧留 16dp 边距 */
    private static final int PANEL_WIDTH_DP = 320;
    /** 悬浮球直径 44dp（与 floating_ball.xml 一致），初始位置距屏幕右边 8dp */
    private static final int BALL_SIZE_DP = 16;
    private static final int BALL_MARGIN_DP = 8;

    /** 供 FloatingWindowPlugin 查询运行状态 */
    public static boolean isRunning = false;

    private WindowManager wm;
    private View ballView;
    private View panelView;
    private FloatingDbHelper db;

    private WindowManager.LayoutParams ballParams;
    private WindowManager.LayoutParams panelParams;

    private EditText searchInput;
    private RecyclerView grid;
    private TextView emptyTip;
    private View actionBar;
    private ImageView actionPreview;
    private TextView tabFav;
    private TextView tabRecent;
    private TextView tabAll;
    private EmojiAdapter adapter;
    /** 布局里 emptyTip 的默认文案（建面板时取一次），db 异常态结束后用它还原 */
    private String defaultEmptyText = "";

    private static final int MODE_FAV = 0;
    private static final int MODE_RECENT = 1;
    private static final int MODE_ALL = 2;
    private static final int MODE_SEARCH = 3;
    private int mode = MODE_FAV; // 默认进入收藏（优先）

    private String searchKw = "";
    private int offset = 0;
    private boolean hasMore = true;
    private boolean loading = false;
    private final List<FloatingDbHelper.EmojiItem> items = new ArrayList<>();
    @Nullable
    private FloatingDbHelper.EmojiItem selected;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "onCreate | android=" + Build.VERSION.RELEASE + " (api " + Build.VERSION.SDK_INT
                + ") | " + Build.MANUFACTURER + " " + Build.MODEL);

        wm = (WindowManager) getSystemService(WINDOW_SERVICE);

        // 数据库不可用只影响悬浮窗内的表情列表，不影响悬浮球本身，降级继续
        try {
            db = FloatingDbHelper.open(this);
        } catch (Throwable e) {
            Log.e(TAG, "open db failed, floating list will be empty", e);
            db = null;
        }

        // 通知构建同样设防：失败则跳过前台服务晋升（降级为普通服务），绝不抛出到 onCreate 之外
        Notification notif = null;
        try {
            notif = buildNotification();
        } catch (Throwable e) {
            Log.e(TAG, "build notification failed", e);
        }
        promoteToForeground(notif);

        if (!createBall()) {
            // 悬浮球都挂不上（权限被收回 / 窗口被系统拒绝），服务没有存在意义
            Log.w(TAG, "ball unavailable, stop self");
            stopSelf();
            return;
        }
        if (!createPanel()) {
            // 面板加载失败时保留悬浮球，尽量不中断已启动的服务
            Log.w(TAG, "panel unavailable, keep ball only");
        }
        isRunning = true;
    }

    /**
     * 尽力晋升为前台服务，逐级降级，**任何一级失败都不得抛出到 onCreate 之外**。
     *
     * 背景：服务与 Capacitor WebView 同进程，onCreate 内未捕获异常会直接杀死 App
     * （表现为「开启悬浮窗即闪退」）。厂商框架（如 MIUI/HyperOS）对 specialUse
     * 前台服务类型的校验比 AOSP 更严，一旦被拒会抛 SecurityException，故必须设防。
     *
     * 降级顺序：
     * 1. specialUse 类型（Android 14+，保留常驻存活能力）；
     * 2. 不带类型的 startForeground（Android 10 及以下的标准用法）；
     * 3. 放弃晋升，以普通服务继续运行——悬浮球/面板功能不受影响，仅失去系统保活加成。
     *
     * @return 是否晋升成功（仅用于日志与诊断）
     */
    private boolean promoteToForeground(Notification notif) {
        if (notif == null) {
            Log.w(TAG, "promote skipped: notification unavailable, run as normal service");
            return false;
        }
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                startForeground(NOTIF_ID, notif,
                        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
                Log.i(TAG, "promoted foreground (type=specialUse)");
                return true;
            } catch (Throwable t) {
                Log.e(TAG, "promote specialUse failed, fallback to no-type", t);
            }
        }
        try {
            startForeground(NOTIF_ID, notif);
            Log.i(TAG, "promoted foreground (no explicit type)");
            return true;
        } catch (Throwable t) {
            Log.e(TAG, "promote failed, degrade to normal service (ball still usable)", t);
            return false;
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        removeViewQuietly(ballView);
        removeViewQuietly(panelView);
        ballView = null;
        panelView = null;
        if (db != null) {
            try {
                db.close();
            } catch (Throwable e) {
                Log.e(TAG, "close db failed", e);
            }
            db = null;
        }
        isRunning = false;
        Log.i(TAG, "onDestroy");
    }

    /**
     * 安全移除悬浮窗 view：对未附加的窗口调用 removeView 会抛 IllegalArgumentException，
     * 关闭悬浮窗同样不能因为异常把宿主 App 带走，故双重设防。
     */
    private void removeViewQuietly(View v) {
        if (v == null || wm == null) return;
        try {
            if (v.getParent() != null || v.isAttachedToWindow()) {
                wm.removeView(v);
            }
        } catch (Throwable e) {
            Log.e(TAG, "removeView failed", e);
        }
    }

    // ───────────────────────── 通知（前台服务） ─────────────────────────

    private Notification buildNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "悬浮窗", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("表情搜搜悬浮窗运行中");
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getActivity(this, 0, intent, piFlags);
        // 用 NotificationCompat 而非 new Notification.Builder(context, channelId)：
        // 后者双参构造仅 API 26+ 存在，本工程 minSdk=22，在 Android 7.1 及以下会抛
        // NoSuchMethodError 并直接杀死与 WebView 同进程的 App。
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("表情搜搜")
                .setContentText("悬浮窗运行中，点击返回 App")
                .setSmallIcon(android.R.drawable.ic_dialog_email)
                .setContentIntent(pi)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    // ───────────────────────── 悬浮球 ─────────────────────────

    /**
     * 取带 App 主题的 LayoutInflater，悬浮窗所有视图都走它 inflate。
     *
     * 背景（真机踩坑）：Service 的上下文主题由系统强制（小米 Android 14 实测为
     * Theme.DeviceDefault.Light.DarkActionBar，日志 theme 标了 forced），**不是**
     * manifest 里 application 声明的 AppTheme。此类上下文中布局里若写了 AppCompat
     * 私有属性（如 ?attr/selectableItemBackground）会直接抛
     * UnsupportedOperationException: Failed to resolve attribute —— 悬浮窗面板曾因此
     * 整块 inflate 失败（面板为空、点悬浮球只会提示「加载失败」）。
     * 统一包一层 AppTheme 后，即便后续在悬浮窗布局里再用主题属性也不会复发。
     */
    private LayoutInflater themedInflater() {
        return LayoutInflater.from(new ContextThemeWrapper(this, R.style.AppTheme));
    }

    private boolean createBall() {
        try {
            ballView = themedInflater().inflate(R.layout.floating_ball, null);
            int type = overlayType();
            ballParams = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    type,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                    android.graphics.PixelFormat.TRANSLUCENT);
            ballParams.gravity = Gravity.TOP | Gravity.START;
            int[] screen = screenSize();
            ballParams.x = screen[0] - dp(BALL_SIZE_DP) - dp(BALL_MARGIN_DP);
            ballParams.y = screen[1] / 2;

            ballView.setOnTouchListener(new BallTouchListener());
            wm.addView(ballView, ballParams);
            return true;
        } catch (Throwable e) {
            // 权限被收回 / 厂商 ROM 拒绝悬浮窗时，addView 抛 BadTokenException；
            // inflate 也可能因资源问题抛异常——一律设防，改为提示并停止服务，不崩进程。
            Log.e(TAG, "create ball failed (overlay permission?)", e);
            ballView = null;
            toast("无法显示悬浮窗，请授予「显示在其他应用上」权限");
            return false;
        }
    }

    /**
     * 取屏幕宽高：API 30+ 用 WindowMetrics，避免已废弃的 getDefaultDisplay()。
     *
     * @return {widthPixels, heightPixels}
     */
    private int[] screenSize() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            android.graphics.Rect bounds = wm.getCurrentWindowMetrics().getBounds();
            return new int[] { bounds.width(), bounds.height() };
        }
        android.util.DisplayMetrics dm = new android.util.DisplayMetrics();
        wm.getDefaultDisplay().getMetrics(dm);
        return new int[] { dm.widthPixels, dm.heightPixels };
    }

    private class BallTouchListener implements View.OnTouchListener {
        private int downX, downY;
        private float downRawX, downRawY;
        private boolean moved;

        @Override
        public boolean onTouch(View v, MotionEvent event) {
            switch (event.getAction()) {
                case MotionEvent.ACTION_DOWN:
                    downX = ballParams.x;
                    downY = ballParams.y;
                    downRawX = event.getRawX();
                    downRawY = event.getRawY();
                    moved = false;
                    return true;
                case MotionEvent.ACTION_MOVE:
                    int dx = (int) (event.getRawX() - downRawX);
                    int dy = (int) (event.getRawY() - downRawY);
                    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
                    ballParams.x = downX + dx;
                    ballParams.y = downY + dy;
                    wm.updateViewLayout(ballView, ballParams);
                    return true;
                case MotionEvent.ACTION_UP:
                    if (!moved) togglePanel();
                    return true;
                default:
                    return false;
            }
        }
    }

    // ───────────────────────── 面板 ─────────────────────────

    private boolean createPanel() {
        try {
            panelView = themedInflater().inflate(R.layout.floating_panel, null);
            int type = overlayType();
            panelParams = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    type,
                    // 不设置 FLAG_NOT_FOCUSABLE，以便搜索框可输入；NOT_TOUCH_MODAL 让外部点击穿透
                    WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                    android.graphics.PixelFormat.TRANSLUCENT);
            panelParams.gravity = Gravity.TOP | Gravity.START;
            int[] screen = screenSize();
            panelParams.x = Math.max(8, screen[0] - dp(PANEL_WIDTH_DP) - dp(16));
            panelParams.y = dp(80);
            panelView.setVisibility(View.GONE);

            searchInput = panelView.findViewById(R.id.searchInput);
            grid = panelView.findViewById(R.id.grid);
            emptyTip = panelView.findViewById(R.id.emptyTip);
            actionBar = panelView.findViewById(R.id.actionBar);
            actionPreview = panelView.findViewById(R.id.actionPreview);
            tabFav = panelView.findViewById(R.id.tabFav);
            tabRecent = panelView.findViewById(R.id.tabRecent);
            tabAll = panelView.findViewById(R.id.tabAll);
            defaultEmptyText = emptyTip.getText().toString();

            // 一行 3 列；单项在 floating_emoji_item.xml 中固定 94dp × 94dp 正方形
            // （含左右 margin 共 100dp），网格区高度固定 150dp = 1.5 行，整板高度随之锁定。
            // 改列数/尺寸时必须同步 floating_emoji_item.xml、floating_panel.xml 与 panelParams.x 的预留宽度。
            grid.setLayoutManager(new GridLayoutManager(this, GRID_SPAN));
            adapter = new EmojiAdapter();
            grid.setAdapter(adapter);
            grid.addOnScrollListener(new GridScrollListener());

            panelView.findViewById(R.id.closeBtn).setOnClickListener(v -> hidePanel());
            tabFav.setOnClickListener(v -> setMode(MODE_FAV));
            tabRecent.setOnClickListener(v -> setMode(MODE_RECENT));
            tabAll.setOnClickListener(v -> setMode(MODE_ALL));

            searchInput.setOnEditorActionListener((v, actionId, event) -> {
                applySearch();
                return true;
            });
            searchInput.addTextChangedListener(new android.text.TextWatcher() {
                @Override public void beforeTextChanged(CharSequence s, int st, int c, int a) {}
                @Override public void onTextChanged(CharSequence s, int st, int b, int c) {}
                @Override public void afterTextChanged(android.text.Editable s) {
                    String kw = s.toString().trim();
                    if (kw.isEmpty()) {
                        if (mode == MODE_SEARCH) setMode(MODE_ALL);
                    } else {
                        mode = MODE_SEARCH;
                        searchKw = kw;
                        reload();
                    }
                }
            });

            panelView.findViewById(R.id.actionShare).setOnClickListener(v -> shareSelected());
            panelView.findViewById(R.id.actionCancel).setOnClickListener(v -> hideActionBar());

            wm.addView(panelView, panelParams);

            // 初次加载数据放到 addView 之后：面板已挂载，列表刷新才不会触发空指针
            setMode(MODE_FAV);
            return true;
        } catch (Throwable e) {
            Log.e(TAG, "create panel failed", e);
            removeViewQuietly(panelView);
            panelView = null;
            return false;
        }
    }

    private int overlayType() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private void togglePanel() {
        // 面板可能因 inflate/addView 失败而为空：此时不崩溃，也不只丢一句提示，
        // 而是先现场重试创建（失败原因多为确定性的，重开关服务也救不回来，
        // 旧文案「请关闭后重试」是死路），成功即直接展开。
        if (panelView == null && !ensurePanel()) {
            toast("表情面板加载失败，请进入 App 重新开启悬浮窗");
            return;
        }
        if (panelView.getVisibility() == View.VISIBLE) hidePanel();
        else panelView.setVisibility(View.VISIBLE);
    }

    /** 面板为空时的自愈入口：现场重试创建，成功返回 true（createPanel 内部已做视图与字段清理） */
    private boolean ensurePanel() {
        if (panelView != null) return true;
        boolean ok = createPanel();
        Log.i(TAG, ok ? "panel recreated on demand" : "panel recreate failed");
        return ok;
    }

    private void hidePanel() {
        if (panelView == null) return;
        panelView.setVisibility(View.GONE);
        hideActionBar();
    }

    /** 切换数据模式并刷新 Tab 高亮 */
    private void setMode(int newMode) {
        mode = newMode;
        searchKw = "";
        // 高亮处理：选中 Tab 用背景，未选中透明
        applyTabStyle(tabFav, newMode == MODE_FAV);
        applyTabStyle(tabRecent, newMode == MODE_RECENT);
        applyTabStyle(tabAll, newMode == MODE_ALL);
        reload();
    }

    private void applyTabStyle(TextView tv, boolean active) {
        tv.setBackgroundResource(active ? R.drawable.floating_tab_selected : android.R.color.transparent);
        tv.setTextColor(active ? 0xFFFFFFFF : 0xFFAAAAAA);
    }

    private void applySearch() {
        searchKw = searchInput.getText().toString().trim();
        mode = searchKw.isEmpty() ? MODE_ALL : MODE_SEARCH;
        reload();
    }

    // ───────────────────────── 数据加载 ─────────────────────────

    private void reload() {
        offset = 0;
        hasMore = true;
        items.clear();
        adapter.notifyDataSetChanged();
        loadMore();
    }

    private void loadMore() {
        if (loading || !hasMore) return;
        if (db == null) {
            // 数据库打不开（onCreate 已降级继续，悬浮球不受影响）：直接落到空态并说明原因，
            // 否则此处 return 会让网格与空态都不显示，用户只看到一块空白面板。
            hasMore = false;
            grid.setVisibility(View.GONE);
            emptyTip.setText("无法读取本地数据，请重启 App 后重试");
            emptyTip.setVisibility(View.VISIBLE);
            return;
        }
        loading = true;
        final int curOffset = offset;
        new Thread(() -> {
            List<FloatingDbHelper.EmojiItem> page;
            try {
                switch (mode) {
                    case MODE_RECENT:
                        page = db.getRecentSends(curOffset);
                        break;
                    case MODE_ALL:
                        page = db.getAll(curOffset);
                        break;
                    case MODE_SEARCH:
                        page = db.search(searchKw, curOffset);
                        break;
                    case MODE_FAV:
                    default:
                        page = db.getFavorites(curOffset);
                        break;
                }
            } catch (Exception e) {
                Log.e(TAG, "query failed", e);
                page = new ArrayList<>();
            }
            final List<FloatingDbHelper.EmojiItem> result = page;
            mainHandler.post(() -> {
                if (result.size() < FloatingDbHelper.PAGE) hasMore = false;
                items.addAll(result);
                offset = curOffset + result.size();
                adapter.notifyDataSetChanged();
                boolean empty = items.isEmpty();
                grid.setVisibility(empty ? View.GONE : View.VISIBLE);
                emptyTip.setText(defaultEmptyText);
                emptyTip.setVisibility(empty ? View.VISIBLE : View.GONE);
                loading = false;
            });
        }).start();
    }

    private class GridScrollListener extends RecyclerView.OnScrollListener {
        @Override
        public void onScrolled(@NonNull RecyclerView rv, int dx, int dy) {
            if (!hasMore || loading) return;
            GridLayoutManager lm = (GridLayoutManager) rv.getLayoutManager();
            if (lm == null) return;
            int last = lm.findLastVisibleItemPosition();
            if (last >= items.size() - 4) loadMore();
        }
    }

    // ───────────────────────── 选择 / 分享 ─────────────────────────

    private void onEmojiSelected(FloatingDbHelper.EmojiItem item) {
        selected = item;
        Bitmap bmp = decodeThumb(item.thumbPath);
        if (bmp != null) actionPreview.setImageBitmap(bmp);
        else actionPreview.setImageResource(android.R.color.darker_gray);
        actionBar.setVisibility(View.VISIBLE);
    }

    private void hideActionBar() {
        if (actionBar != null) actionBar.setVisibility(View.GONE);
        selected = null;
    }

    private void shareSelected() {
        if (selected == null || db == null) return;
        FloatingDbHelper.EmojiItem item = selected;
        try {
            String cached = ThumbnailUtil.copyToCache(this, item.path, "share", safeName(item.path));
            if (cached == null) {
                toast("分享失败：无法读取图片");
                return;
            }
            Uri uri = FileProvider.getUriForFile(this, AUTHORITY, toRealFile(cached));
            if (uri == null) {
                toast("分享失败：缓存文件无效");
                return;
            }
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType(guessMime(cached));
            intent.putExtra(Intent.EXTRA_STREAM, uri);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            // 部分 ROM 上 chooser 不传递 FLAG_GRANT_READ_URI_PERMISSION，用 clipData 兜底授权
            intent.setClipData(ClipData.newRawUri("emoji", uri));
            // ⚠️ Intent.createChooser 会造出一个全新的 chooser Intent，不会继承上面内层 intent 的 flag，
            // Service（非 Activity 上下文）启动 chooser 时必须在 chooser 自身带 NEW_TASK，否则抛
            //「Calling startActivity() from outside of an Activity context requires FLAG_ACTIVITY_NEW_TASK」
            Intent chooser = Intent.createChooser(intent, "分享表情到");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            chooser.setClipData(ClipData.newRawUri("emoji", uri));
            startActivity(chooser);
            db.recordSend(item.id);
            hideActionBar();
        } catch (Exception e) {
            Log.e(TAG, "share failed", e);
            toast("分享失败");
        }
    }

    // ───────────────────────── 工具 ─────────────────────────

    private Bitmap decodeThumb(String uriOrPath) {
        if (uriOrPath == null || uriOrPath.isEmpty()) return null;
        File f = toRealFile(uriOrPath);
        if (f == null) return null;
        try {
            return BitmapFactory.decodeFile(f.getAbsolutePath());
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 把 file:// URI（或裸路径）转成真实 File。
     *
     * ⚠️ ThumbnailUtil.copyToCache 返回的是 {@code Uri.fromFile(...).toString()}，
     * 即带 {@code file://} 前缀的字符串；若直接 new File(path)，路径会变成
     * {@code /file:/data/...}，FileProvider.getUriForFile 必然抛
     * 「Failed to find configured root that contains ...」。
     */
    private File toRealFile(String uriOrPath) {
        if (uriOrPath == null || uriOrPath.isEmpty()) return null;
        String path = uriOrPath;
        if (path.startsWith("file://")) {
            path = Uri.parse(path).getPath();
            if (path == null || path.isEmpty()) return null;
        } else if (path.startsWith("content://")) {
            return null; // content:// 不能当 File 处理
        }
        File f = new File(path);
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

    private void toast(String msg) {
        mainHandler.post(() -> Toast.makeText(this, msg, Toast.LENGTH_SHORT).show());
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density);
    }

    // ───────────────────────── 网格适配器 ─────────────────────────

    private class EmojiAdapter extends RecyclerView.Adapter<EmojiAdapter.VH> {
        class VH extends RecyclerView.ViewHolder {
            final ImageView thumb;
            final TextView gif;
            VH(View v) {
                super(v);
                thumb = v.findViewById(R.id.thumb);
                gif = v.findViewById(R.id.gifBadge);
            }
        }

        @NonNull
        @Override
        public VH onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            View v = themedInflater().inflate(R.layout.floating_emoji_item, parent, false);
            return new VH(v);
        }

        @Override
        public void onBindViewHolder(@NonNull VH h, int pos) {
            FloatingDbHelper.EmojiItem it = items.get(pos);
            Bitmap bmp = decodeThumb(it.thumbPath);
            if (bmp != null) {
                h.thumb.setImageBitmap(bmp);
            } else {
                h.thumb.setImageResource(android.R.color.darker_gray);
            }
            h.gif.setVisibility(it.isGif ? View.VISIBLE : View.GONE);
            h.itemView.setOnClickListener(v -> onEmojiSelected(it));
        }

        @Override
        public int getItemCount() {
            return items.size();
        }
    }
}

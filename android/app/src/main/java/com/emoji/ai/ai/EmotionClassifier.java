package com.emoji.ai.ai;

import android.content.Context;
import android.graphics.Bitmap;
import android.util.Log;

import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.label.ImageLabel;
import com.google.mlkit.vision.label.ImageLabeler;
import com.google.mlkit.vision.label.ImageLabeling;
import com.google.mlkit.vision.label.defaults.ImageLabelerOptions;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.ExecutionException;

/**
 * 端侧图像标签识别 + 情感映射（兜底策略）。
 * 端侧无成熟"图像情感"模型，先用 ML Kit 通用标签映射到情感类别。
 * 支持 SAF 扫描返回的 content:// URI 与普通 file:// 路径。
 */
public final class EmotionClassifier {

    private static final String TAG = "EmotionClassifier";
    /** 图像标签目标边长：640 足够（ML Kit 默认标签模型输入即 ~512） */
    private static final int TARGET_EDGE = 640;

    private static volatile EmotionClassifier instance;
    private final ImageLabeler labeler;
    private static final float CONFIDENCE_THRESHOLD = 0.6f;

    private EmotionClassifier() {
        labeler = ImageLabeling.getClient(
            new ImageLabelerOptions.Builder()
                .setConfidenceThreshold(CONFIDENCE_THRESHOLD)
                .build()
        );
    }

    public static EmotionClassifier get() {
        if (instance == null) {
            synchronized (EmotionClassifier.class) {
                if (instance == null) {
                    instance = new EmotionClassifier();
                }
            }
        }
        return instance;
    }

    /** 识别结果：通用标签列表 + 情感集合（按字母序稳定输出）。 */
    public static class Result {
        public List<String> labels = new ArrayList<>();
        public Set<String> emotions = new TreeSet<>();
    }

    /** 必须在非主线程调用。 */
    public Result classify(Context context, String imagePath) {
        Result result = new Result();
        if (context == null || imagePath == null || imagePath.isEmpty()) {
            result.emotions.add("neutral");
            return result;
        }
        Bitmap bmp = null;
        try {
            bmp = ImageLoader.load(context, imagePath, TARGET_EDGE);
            if (bmp == null) {
                Log.w(TAG, "classify: decode failed, skip " + imagePath);
                result.emotions.add("neutral");
                return result;
            }
            List<ImageLabel> labels = Tasks.await(labeler.process(InputImage.fromBitmap(bmp, 0)));
            List<String> names = new ArrayList<>();
            if (labels != null) {
                for (ImageLabel l : labels) {
                    if (l.getText() != null) {
                        names.add(l.getText());
                    }
                }
            }
            result.labels = names;
            result.emotions = EmotionMap.mapLabels(names);
        } catch (ExecutionException | InterruptedException e) {
            Log.w(TAG, "classify task failed: " + imagePath, e);
            result.emotions.add("neutral");
        } catch (Exception e) {
            Log.e(TAG, "classify failed: " + imagePath, e);
            result.emotions.add("neutral");
        } finally {
            if (bmp != null && !bmp.isRecycled()) {
                bmp.recycle();
            }
        }
        return result;
    }

    public void close() {
        try {
            labeler.close();
        } catch (Exception ignored) {
        }
    }
}

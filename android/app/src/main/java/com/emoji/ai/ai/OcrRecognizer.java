package com.emoji.ai.ai;

import android.content.Context;
import android.graphics.Bitmap;
import android.util.Log;

import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;

import java.util.concurrent.ExecutionException;

/**
 * ML Kit 中文 OCR（端侧，模型随 APK 打包，无需联网）。
 * 支持 SAF 扫描返回的 content:// URI 与普通 file:// 路径。
 */
public final class OcrRecognizer {

    private static final String TAG = "OcrRecognizer";
    /** OCR 目标边长：表情包文字通常较小，1280 足够保证识别率 */
    private static final int TARGET_EDGE = 1280;

    private static volatile OcrRecognizer instance;
    private final TextRecognizer recognizer;

    private OcrRecognizer() {
        recognizer = TextRecognition.getClient(
            new ChineseTextRecognizerOptions.Builder().build()
        );
    }

    public static OcrRecognizer get() {
        if (instance == null) {
            synchronized (OcrRecognizer.class) {
                if (instance == null) {
                    instance = new OcrRecognizer();
                }
            }
        }
        return instance;
    }

    /**
     * 识别图片中的文字，多行以换行拼接。
     * 无文字或失败返回空串。必须在非主线程调用（内部同步等待 Task）。
     */
    public String recognize(Context context, String imagePath) {
        if (context == null || imagePath == null || imagePath.isEmpty()) {
            return "";
        }
        Bitmap bmp = null;
        try {
            bmp = ImageLoader.load(context, imagePath, TARGET_EDGE);
            if (bmp == null) {
                Log.w(TAG, "recognize: decode failed, skip " + imagePath);
                return "";
            }
            Text text = Tasks.await(recognizer.process(InputImage.fromBitmap(bmp, 0)));
            if (text == null || text.getText() == null) {
                return "";
            }
            return text.getText().trim();
        } catch (ExecutionException | InterruptedException e) {
            Log.w(TAG, "recognize task failed: " + imagePath, e);
            return "";
        } catch (Exception e) {
            Log.e(TAG, "recognize failed: " + imagePath, e);
            return "";
        } finally {
            if (bmp != null && !bmp.isRecycled()) {
                bmp.recycle();
            }
        }
    }

    public void close() {
        try {
            recognizer.close();
        } catch (Exception ignored) {
        }
    }
}

package com.emoji.ai.ai;

import android.content.Context;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

/**
 * 设备端 AI 统一入口：OCR + 图像标签 + 情感映射。
 * 所有方法必须在非主线程调用（ML Kit Task 同步等待）。
 */
public final class AiEngine {

    private static volatile AiEngine instance;

    private AiEngine() {
    }

    public static AiEngine get() {
        if (instance == null) {
            synchronized (AiEngine.class) {
                if (instance == null) {
                    instance = new AiEngine();
                }
            }
        }
        return instance;
    }

    public static class Result {
        public String ocrText = "";
        public List<String> labels = new ArrayList<>();
        public Set<String> emotions = new TreeSet<>();
    }

    /**
     * 分析单张图片。
     *
     * @param withOcr    是否执行 OCR（文字梗表情用）
     * @param withLabels 是否执行图像标签与情感映射
     */
    public Result analyze(Context context, String imagePath, boolean withOcr, boolean withLabels) {
        Result result = new Result();
        result.emotions.add("neutral");
        if (imagePath == null || imagePath.isEmpty()) {
            return result;
        }
        if (withOcr) {
            result.ocrText = OcrRecognizer.get().recognize(context, imagePath);
        }
        if (withLabels) {
            EmotionClassifier.Result r = EmotionClassifier.get().classify(context, imagePath);
            result.labels = r.labels;
            result.emotions = r.emotions;
        }
        return result;
    }

    /** 释放 ML Kit 客户端资源 */
    public void close() {
        OcrRecognizer.get().close();
        EmotionClassifier.get().close();
    }
}

package com.emoji.ai.ai;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * ML Kit 通用标签 → 情感标签的映射词表。
 * 兜底策略：端侧无法直接判断"图像情感"，先将图像标签映射到情感类别。
 */
public final class EmotionMap {

    public static final List<String> ALL_EMOTIONS = Collections.unmodifiableList(Arrays.asList(
        "happy", "sad", "angry", "surprised", "fear", "disgust", "love", "neutral"
    ));

    private static final Map<String, Set<String>> KEYWORD_TO_EMOTIONS = buildMap();

    private EmotionMap() {
    }

    /**
     * 将一组标签映射为情感集合。
     * 无命中时返回包含 "neutral" 的集合。
     */
    public static Set<String> mapLabels(List<String> labels) {
        Set<String> emotions = new HashSet<>();
        if (labels == null || labels.isEmpty()) {
            emotions.add("neutral");
            return emotions;
        }
        for (String label : labels) {
            String key = label.toLowerCase(Locale.US).trim();
            // 直接命中或包含关键词
            Set<String> direct = KEYWORD_TO_EMOTIONS.get(key);
            if (direct != null) {
                emotions.addAll(direct);
                continue;
            }
            for (Map.Entry<String, Set<String>> entry : KEYWORD_TO_EMOTIONS.entrySet()) {
                if (key.contains(entry.getKey())) {
                    emotions.addAll(entry.getValue());
                }
            }
        }
        if (emotions.isEmpty()) {
            emotions.add("neutral");
        }
        return emotions;
    }

    private static Map<String, Set<String>> buildMap() {
        Map<String, Set<String>> map = new HashMap<>();
        map.put("smile", set("happy"));
        map.put("smiley", set("happy"));
        map.put("laugh", set("happy"));
        map.put("laughing", set("happy"));
        map.put("happy", set("happy"));
        map.put("happiness", set("happy"));
        map.put("joy", set("happy"));
        map.put("fun", set("happy"));
        map.put("party", set("happy"));
        map.put("celebration", set("happy"));
        map.put("celebrate", set("happy"));
        map.put("fireworks", set("happy"));
        map.put("festival", set("happy"));
        map.put("clown", set("happy", "sad"));
        map.put("toy", set("happy"));
        map.put("cartoon", set("happy"));
        map.put("sweet", set("happy", "love"));
        map.put("dessert", set("happy"));
        map.put("cake", set("happy"));
        map.put("gift", set("happy"));
        map.put("balloon", set("happy"));
        map.put("confetti", set("happy"));
        map.put("dance", set("happy"));
        map.put("dancing", set("happy"));
        map.put("music", set("happy"));

        map.put("sad", set("sad"));
        map.put("sadness", set("sad"));
        map.put("cry", set("sad"));
        map.put("crying", set("sad"));
        map.put("tear", set("sad"));
        map.put("tears", set("sad"));
        map.put("weep", set("sad"));
        map.put("grief", set("sad"));
        map.put("sorrow", set("sad"));
        map.put("rain", set("sad"));
        map.put("rainy", set("sad"));
        map.put("storm", set("sad"));
        map.put("funeral", set("sad"));
        map.put("tombstone", set("sad"));
        map.put("graveyard", set("sad"));
        map.put("broken", set("sad"));
        map.put("lonely", set("sad"));
        map.put("depressed", set("sad"));
        map.put("hospital", set("sad"));
        map.put("sick", set("sad"));

        map.put("angry", set("angry"));
        map.put("anger", set("angry"));
        map.put("rage", set("angry"));
        map.put("mad", set("angry"));
        map.put("furious", set("angry"));
        map.put("fight", set("angry"));
        map.put("fighting", set("angry"));
        map.put("punch", set("angry"));
        map.put("weapon", set("angry", "fear"));
        map.put("gun", set("angry", "fear"));
        map.put("knife", set("angry", "fear"));
        map.put("sword", set("angry"));
        map.put("bomb", set("angry", "fear"));
        map.put("fire", set("angry", "fear"));
        map.put("flame", set("angry"));
        map.put("explosion", set("angry", "surprised"));

        map.put("surprise", set("surprised"));
        map.put("surprised", set("surprised"));
        map.put("shock", set("surprised"));
        map.put("shocked", set("surprised"));
        map.put("wow", set("surprised"));
        map.put("astonished", set("surprised"));
        map.put("startled", set("surprised"));
        map.put("question", set("surprised"));
        map.put("magic", set("surprised"));

        map.put("fear", set("fear"));
        map.put("scared", set("fear"));
        map.put("scary", set("fear"));
        map.put("horror", set("fear"));
        map.put("halloween", set("fear"));
        map.put("skull", set("fear"));
        map.put("skeleton", set("fear"));
        map.put("ghost", set("fear"));
        map.put("zombie", set("fear"));
        map.put("monster", set("fear"));
        map.put("dark", set("fear"));
        map.put("nightmare", set("fear"));
        map.put("thunder", set("fear", "surprised"));
        map.put("lightning", set("fear", "surprised"));
        map.put("spider", set("fear", "disgust"));
        map.put("snake", set("fear"));
        map.put("bat", set("fear"));

        map.put("disgust", set("disgust"));
        map.put("gross", set("disgust"));
        map.put("vomit", set("disgust"));
        map.put("nausea", set("disgust"));
        map.put("dirty", set("disgust"));
        map.put("trash", set("disgust"));
        map.put("garbage", set("disgust"));
        map.put("sewage", set("disgust"));
        map.put("cockroach", set("disgust"));
        map.put("fly", set("disgust"));
        map.put("worm", set("disgust"));
        map.put("mold", set("disgust"));

        map.put("love", set("love"));
        map.put("heart", set("love"));
        map.put("hearts", set("love"));
        map.put("kiss", set("love"));
        map.put("kissing", set("love"));
        map.put("hug", set("love"));
        map.put("hugging", set("love"));
        map.put("romance", set("love"));
        map.put("romantic", set("love"));
        map.put("wedding", set("love"));
        map.put("bride", set("love"));
        map.put("groom", set("love"));
        map.put("valentine", set("love"));
        map.put("rose", set("love"));
        map.put("flower", set("love"));
        map.put("couple", set("love"));
        map.put("baby", set("love"));
        map.put("cute", set("love", "happy"));
        map.put("adorable", set("love"));
        return map;
    }

    private static Set<String> set(String... emotions) {
        return new HashSet<>(Arrays.asList(emotions));
    }
}

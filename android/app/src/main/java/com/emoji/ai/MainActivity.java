package com.emoji.ai;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 注册自定义原生插件：EmojiScanner + 悬浮窗
        registerPlugin(EmojiScannerPlugin.class);
        registerPlugin(FloatingWindowPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

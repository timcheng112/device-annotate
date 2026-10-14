package dev.deviceproof.fixture;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.TextView;

public class FixtureActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setDecorFitsSystemWindows(false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(15, 23, 41));
        setContentView(root);
        root.post(() -> {
            int w = root.getWidth(), h = root.getHeight();
            add(root, "top-left", 8, 100, 240, 96, 0x14B8A6);
            add(root, "top-right", w-248, 100, 240, 96, 0xF59E0B);
            add(root, "center", 80, 400, w-160, 200, 0x3B82F6);
            add(root, "partial-left", -40, 720, 240, 120, 0xA78BFA);
            add(root, "bottom-right", w-248, h-220, 240, 96, 0xFB7185);
            add(root, "partial-bottom", 80, h-40, 320, 120, 0x22C55E);
        });
    }
    private void add(FrameLayout root, String id, int x, int y, int w, int h, int color) {
        TextView box = new TextView(this);
        box.setId(getResources().getIdentifier(id.replace('-', '_'), "id", getPackageName()));
        box.setText(id);
        box.setContentDescription(id);
        box.setTextSize(12);
        box.setTextColor(Color.BLACK);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(0xFF000000 | color);
        box.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(w, h);
        params.leftMargin = x;
        params.topMargin = y;
        root.addView(box, params);
    }
}

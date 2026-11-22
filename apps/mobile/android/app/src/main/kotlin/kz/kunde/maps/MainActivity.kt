package kz.kunde.maps

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var notificationRequest: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "kz.kunde.maps/permissions")
            .setMethodCallHandler { call, result ->
                if (call.method != "navigationNotifications") {
                    result.notImplemented()
                } else if (
                    Build.VERSION.SDK_INT < 33 ||
                    checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
                ) {
                    result.success(true)
                } else if (notificationRequest != null) {
                    result.success(false)
                } else {
                    notificationRequest = result
                    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 610)
                }
            }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 610) {
            notificationRequest?.success(grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED)
            notificationRequest = null
        }
    }
}

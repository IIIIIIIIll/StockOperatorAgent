package expo.modules.soakeepalive

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SoaKeepAliveModule : Module() {

  // Android 13+ 通知权限系统框每进程最多弹一次的标志位(见 maybeRequestNotificationPermission)。
  private var notificationPermissionRequested = false

  override fun definition() = ModuleDefinition {
    Name("SoaKeepAlive")

    AsyncFunction("start") { title: String, body: String ->
      val context = appContext.reactContext
      if (context != null) {
        maybeRequestNotificationPermission(context)
        val intent = Intent(context, KeepAliveService::class.java)
          .putExtra(KeepAliveService.EXTRA_TITLE, title)
          .putExtra(KeepAliveService.EXTRA_BODY, body)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      }
      null
    }

    AsyncFunction("stop") {
      val context = appContext.reactContext
      if (context != null) {
        context.stopService(Intent(context, KeepAliveService::class.java))
      }
      null
    }
  }

  /**
   * Android 13+(TIRAMISU)起前台服务通知默认不可见,需运行时申请 POST_NOTIFICATIONS。
   * 语义:只发起请求,不等待授权结果、不阻塞启动 — 无论授予与否都照常 startForegroundService,
   * FGS 本身不依赖该权限,未授权仅意味着保活通知对用户不可见。
   * 每进程最多弹一次系统框;已授权或当前无前台 Activity 时不消耗本次机会。
   */
  private fun maybeRequestNotificationPermission(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || notificationPermissionRequested) {
      return
    }
    if (context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
      notificationPermissionRequested = true
      return
    }
    val activity = appContext.currentActivity ?: return
    notificationPermissionRequested = true
    activity.requestPermissions(
      arrayOf(Manifest.permission.POST_NOTIFICATIONS),
      REQUEST_POST_NOTIFICATIONS
    )
  }

  private companion object {
    // requestPermissions 回调码;本模块不注册结果处理器,取任意不冲突值。
    const val REQUEST_POST_NOTIFICATIONS = 47001
  }
}

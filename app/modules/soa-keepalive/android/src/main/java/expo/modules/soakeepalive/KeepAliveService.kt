package expo.modules.soakeepalive

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * 前台服务:分析期间保持进程为前台进程,豁免 Doze 冻结与 LMK 低优先级回收,
 * 使 JS 线程的 async 分析链在切后台/锁屏时继续执行。
 */
class KeepAliveService : Service() {

  companion object {
    const val CHANNEL_ID = "soa_analysis"
    const val NOTIFICATION_ID = 1001
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "正在分析"
    val body = intent?.getStringExtra(EXTRA_BODY) ?: "AI 分析进行中,可切到后台等待完成"
    startForegroundCompat(title, body)
    return START_NOT_STICKY
  }

  private fun startForegroundCompat(title: String, body: String) {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "分析进行中",
        NotificationManager.IMPORTANCE_LOW
      ).apply { setShowBadge(false) }
      nm.createNotificationChannel(channel)
    }
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(body)
      .setSmallIcon(android.R.drawable.ic_menu_compass)
      .setOngoing(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
    startForeground(NOTIFICATION_ID, notification)
  }
}

package expo.modules.soakeepalive

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
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

        /** PARTIAL_WAKE_LOCK 超时 30min:正常分析最长约 20min,超时是兜底 ——
         *  即便 JS 侧忘了 stop,也不会无限耗电。 */
        const val WAKE_LOCK_TIMEOUT_MS = 30 * 60 * 1000L
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: "正在分析"
        val body = intent?.getStringExtra(EXTRA_BODY) ?: "AI 分析进行中,可切到后台等待完成"
        startForegroundCompat(title, body)
        acquireWakeLock()
        return START_NOT_STICKY
    }

    /**
     * FGS 只把进程抬到前台优先级,不阻 CPU 挂起:屏幕灭 + 手机静止时 Doze 照样冻
     * 进程,JS 定时器停、socket 读取永远不返回 → 分析在锁屏期间静默断在半路。
     * PARTIAL_WAKE_LOCK 才是真正保 CPU 的东西(屏幕仍可关)。
     */
    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
        wakeLock =
            pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "soa:analysis").apply {
                setReferenceCounted(false)
                acquire(WAKE_LOCK_TIMEOUT_MS)
            }
    }

    override fun onDestroy() {
        // 不释放会持续耗电直到 30min 超时(或进程被杀)
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        super.onDestroy()
    }

    private fun startForegroundCompat(
        title: String,
        body: String,
    ) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel =
                NotificationChannel(
                    CHANNEL_ID,
                    "分析进行中",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply { setShowBadge(false) }
            nm.createNotificationChannel(channel)
        }
        val notification =
            NotificationCompat
                .Builder(this, CHANNEL_ID)
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

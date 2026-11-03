package expo.modules.soakeepalive

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.launch

class SoaKeepAliveModule : Module() {
    // Android 13+ 通知权限系统框每进程最多弹一次的标志位(见 maybeRequestNotificationPermission)。
    private var notificationPermissionRequested = false

    override fun definition() =
        ModuleDefinition {
            Name("SoaKeepAlive")

            AsyncFunction("start") { title: String, body: String ->
                val context = appContext.reactContext
                if (context != null) {
                    maybeRequestNotificationPermission(context)
                    val intent =
                        Intent(context, KeepAliveService::class.java)
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
     *
     * 两个必须的限制(实测:实机 1/5 概率出现「画面还在但点不动」的假死):
     *   1. requestPermissions 是主线程 API,而 AsyncFunction 跑在 modulesQueue
     *      (HandlerThread「expo.modules.AsyncFunctionQueue」)。后台线程直接调用时请求
     *      会排队到解锁/回前台才弹出 → 弹窗独占输入而 Activity 仅 paused →
     *      界面停在最后一帧、点不动也不 ANR,只能重启。
     *   2. Activity 不处于 resumed(锁屏、切后台、正在销毁)时绝不请求。
     * 未满足以上条件就放弃本次,不消耗「每进程一次」的机会。
     */
    private fun maybeRequestNotificationPermission(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || notificationPermissionRequested) {
            return
        }
        if (context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            notificationPermissionRequested = true
            return
        }
        appContext.mainQueue.launch {
            val activity = appContext.currentActivity
            if (activity == null || activity.isFinishing || activity.isDestroyed || !activity.hasWindowFocus()) {
                return@launch
            }
            notificationPermissionRequested = true
            activity.requestPermissions(
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                REQUEST_POST_NOTIFICATIONS,
            )
        }
    }

    private companion object {
        // requestPermissions 回调码;本模块不注册结果处理器,取任意不冲突值。
        const val REQUEST_POST_NOTIFICATIONS = 47001
    }
}

package expo.modules.soakeepalive

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SoaKeepAliveModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("SoaKeepAlive")

    AsyncFunction("start") { title: String, body: String ->
      val context = appContext.reactContext
      if (context != null) {
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
}

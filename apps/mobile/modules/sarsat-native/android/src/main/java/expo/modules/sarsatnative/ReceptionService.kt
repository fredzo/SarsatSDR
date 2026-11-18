package expo.modules.sarsatnative

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

class ReceptionService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel(CHANNEL, "SARSAT reception", NotificationManager.IMPORTANCE_LOW))
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val pending = launch?.let {
      android.app.PendingIntent.getActivity(this, 0, it, android.app.PendingIntent.FLAG_IMMUTABLE)
    }
    val notification = Notification.Builder(this, CHANNEL)
      .setContentTitle("SarsatSDR")
      .setContentText("Receiving RTL-SDR 406 MHz")
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setOngoing(true)
      .setContentIntent(pending)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
      startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
    else
      startForeground(1, notification)
    if (wakeLock == null) {
      wakeLock = getSystemService(PowerManager::class.java)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "sarsat:reception").apply { acquire() }
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    wakeLock?.release()
    wakeLock = null
    super.onDestroy()
  }

  companion object {
    const val CHANNEL = "sarsat-reception"
  }
}

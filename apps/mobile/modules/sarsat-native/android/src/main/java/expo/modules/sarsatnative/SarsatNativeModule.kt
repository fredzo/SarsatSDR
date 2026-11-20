package expo.modules.sarsatnative

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import kotlin.concurrent.thread

class SarsatNativeModule : Module() {
  private val context: Context get() = requireNotNull(appContext.reactContext)
  private val usb: UsbManager get() = context.getSystemService(UsbManager::class.java)
  private val samplesDir: File get() = File(context.filesDir, "samples").apply { mkdirs() }
  private var engine: Thread? = null
  private var connection: UsbDeviceConnection? = null
  private var fmTrack: AudioTrack? = null

  @Synchronized
  private fun resetFm() {
    fmTrack?.release()
    fmTrack = null
  }

  @Synchronized
  private fun setFmVolume(volume: Double) {
    fmTrack?.setVolume(volume.toFloat())
  }

  @Synchronized
  private fun writeFm(pcm: String, volume: Double) {
    val bytes = Base64.decode(pcm, Base64.NO_WRAP)
    val rate = 12000
    val encoding = AudioFormat.ENCODING_PCM_16BIT
    val channels = AudioFormat.CHANNEL_OUT_MONO
    val track = fmTrack ?: AudioTrack.Builder()
      .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
      .setAudioFormat(AudioFormat.Builder().setSampleRate(rate).setEncoding(encoding).setChannelMask(channels).build())
      .setTransferMode(AudioTrack.MODE_STREAM)
      .setBufferSizeInBytes(maxOf(rate * 2 / 4, AudioTrack.getMinBufferSize(rate, channels, encoding)))
      .build().also {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) it.setStartThresholdInFrames(rate / 50)
        fmTrack = it
      }
    track.setVolume(volume.toFloat())
    val written = track.write(bytes, 0, bytes.size, AudioTrack.WRITE_NON_BLOCKING)
    if (written < 0) {
      resetFm()
      throw CodedException("FM PCM output failed (AudioTrack code $written)")
    }
    if (written > 0 && track.playState != AudioTrack.PLAYSTATE_PLAYING) track.play()
  }

  private fun supported(device: UsbDevice) =
    NativeEngine.supportedIds().contains(device.vendorId shl 16 or device.productId)

  private fun location(device: UsbDevice): Pair<Int, Int> {
    val parts = device.deviceName.split('/')
    return (parts.getOrNull(parts.size - 2)?.toIntOrNull() ?: 0) to (parts.lastOrNull()?.toIntOrNull() ?: 0)
  }

  private fun devices() = usb.deviceList.values.filter(::supported)

  private fun runCapture(arguments: List<String>, promise: Promise, rtl: Boolean) {
    engine = thread(name = "sarsat-engine") {
      val sink = object : NativeEngine.Sink {
        override fun onLine(stream: Int, bytes: ByteArray) {
          sendEvent("onLine", mapOf("stream" to stream, "line" to String(bytes, Charsets.UTF_8)))
        }
      }
      var code = 1
      try {
        code = NativeEngine.run(arguments.toTypedArray(), sink)
      } catch (error: Throwable) {
        sendEvent("onLine", mapOf("stream" to 2, "line" to "cospas-cli: ${error.message}"))
      } finally {
        connection?.close()
        connection = null
        if (rtl) context.stopService(Intent(context, ReceptionService::class.java))
        engine = null
        sendEvent("onExit", mapOf("code" to code))
      }
    }
    promise.resolve(null)
  }

  private fun withUsbPermission(device: UsbDevice, granted: () -> Unit, denied: () -> Unit) {
    if (usb.hasPermission(device)) return granted()
    val action = "${context.packageName}.USB_PERMISSION"
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(receiverContext: Context, intent: Intent) {
        context.unregisterReceiver(this)
        if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) granted() else denied()
      }
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
      context.registerReceiver(receiver, IntentFilter(action), Context.RECEIVER_NOT_EXPORTED)
    else
      context.registerReceiver(receiver, IntentFilter(action))
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
    usb.requestPermission(device, PendingIntent.getBroadcast(context, 0, Intent(action).setPackage(context.packageName), flags))
  }

  override fun definition() = ModuleDefinition {
    Name("SarsatNative")
    Events("onLine", "onExit")

    Function("samplesDirectory") { samplesDir.absolutePath }

    Function("listSamples") {
      context.assets.list("samples")?.filter { it.endsWith(".wav") }?.sorted() ?: emptyList<String>()
    }

    Function("readAsset") { name: String ->
      context.assets.open("samples/$name").bufferedReader().use { it.readText() }
    }

    Function("devices") {
      devices().map { device ->
        val (bus, address) = location(device)
        mapOf("vendorId" to device.vendorId, "productId" to device.productId, "bus" to bus, "address" to address)
      }
    }

    AsyncFunction("settings") { promise: Promise ->
      thread {
        val lines = StringBuilder()
        val code = NativeEngine.run(arrayOf("settings", "--json"), object : NativeEngine.Sink {
          override fun onLine(stream: Int, bytes: ByteArray) {
            if (stream == 1) lines.append(String(bytes, Charsets.UTF_8))
          }
        })
        if (code == 0) promise.resolve(lines.toString()) else promise.reject(CodedException("Could not read native settings"))
      }
    }

    AsyncFunction("prepareSample") { name: String, promise: Promise ->
      thread {
        try {
          val target = File(samplesDir, name)
          if (!target.exists()) {
            val partial = File(samplesDir, "$name.part")
            context.assets.open("samples/$name").use { input -> partial.outputStream().use { input.copyTo(it, 1 shl 20) } }
            if (!partial.renameTo(target)) throw IllegalStateException("could not rename the file")
          }
          promise.resolve(target.absolutePath)
        } catch (error: Throwable) {
          promise.reject(CodedException("Could not copy the sample: ${error.message}"))
        }
      }
    }

    AsyncFunction("start") { arguments: List<String>, promise: Promise ->
      if (engine != null) return@AsyncFunction promise.reject(CodedException("Session already active"))
      if (arguments.firstOrNull() != "receive") return@AsyncFunction runCapture(arguments, promise, false)
      val bus = arguments.indexOf("--bus").takeIf { it >= 0 }?.let { arguments[it + 1].toInt() }
      val address = arguments.indexOf("--address").takeIf { it >= 0 }?.let { arguments[it + 1].toInt() }
      val candidates = devices().filter { bus == null || location(it) == (bus to address) }
      val device = candidates.singleOrNull()
        ?: return@AsyncFunction promise.reject(CodedException("Connect a single compatible RTL-SDR device (OTG)"))
      withUsbPermission(device, granted = {
        val opened = usb.openDevice(device)
          ?: return@withUsbPermission promise.reject(CodedException("Could not open the RTL-SDR USB device"))
        connection = opened
        val filtered = mutableListOf<String>()
        var n = 0
        while (n < arguments.size) {
          if (arguments[n] == "--bus" || arguments[n] == "--address") n += 2 else filtered += arguments[n++]
        }
        filtered += listOf("--usb-fd", opened.fileDescriptor.toString())
        val service = Intent(context, ReceptionService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(service) else context.startService(service)
        runCapture(filtered, promise, true)
      }, denied = { promise.reject(CodedException("USB permission denied")) })
    }

    Function("stop") { NativeEngine.stop() }
    Function("writeFm") { pcm: String, volume: Double -> writeFm(pcm, volume) }
    Function("setFmVolume") { volume: Double -> setFmVolume(volume) }
    Function("resetFm") { resetFm() }
    OnDestroy { resetFm() }
  }
}

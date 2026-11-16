package expo.modules.sarsatnative

object NativeEngine {
  interface Sink {
    fun onLine(stream: Int, bytes: ByteArray)
  }

  init {
    System.loadLibrary("sarsat-native")
  }

  external fun run(arguments: Array<String>, sink: Sink): Int
  external fun stop()
  external fun supportedIds(): IntArray
}

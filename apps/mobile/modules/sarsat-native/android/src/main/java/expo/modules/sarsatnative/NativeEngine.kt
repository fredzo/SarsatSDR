/*
 * SarsatSDR
 * Copyright (C) 2026 Frederic BORRY - F4JRX
 * Authors: Frederic BORRY - F4JRX and Copilot (AI-assisted development).
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

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
  external fun startRecording(descriptor: Int)
  external fun stopRecording()
  external fun supportedIds(): IntArray
}

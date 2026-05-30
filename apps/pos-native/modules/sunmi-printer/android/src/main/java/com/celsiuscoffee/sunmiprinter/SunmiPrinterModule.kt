package com.celsiuscoffee.sunmiprinter

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.util.Log

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

import com.sunmi.printerx.PrinterSdk
import com.sunmi.printerx.api.CommandApi
import com.sunmi.printerx.api.LineApi
import com.sunmi.printerx.api.QueryApi
import com.sunmi.printerx.enums.Align
import com.sunmi.printerx.enums.DividingLine
import com.sunmi.printerx.enums.PrinterInfo
import com.sunmi.printerx.style.BaseStyle
import com.sunmi.printerx.style.BitmapStyle
import com.sunmi.printerx.style.QrStyle
import com.sunmi.printerx.style.TextStyle

import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets

/**
 * Expo native module for the SUNMI D3 built-in 80mm thermal printer.
 *
 * This is a native (Expo Modules API) port of the Capacitor plugin
 * apps/pos/android/.../SunmiPrinterPlugin.java — same SUNMI PrinterX SDK
 * (com.sunmi:printerx), same LineApi line-parsing renderer, so receipts
 * and kitchen dockets look identical to the old WebView POS.
 *
 * The TS side (apps/pos-native/lib/printer.ts) formats the slip text via
 * lib/receipt-format.ts and calls printFormattedReceipt / printOrderDocket.
 */
class SunmiPrinterModule : Module() {

  private val TAG = "SunmiPrinter"
  private var selectedPrinter: PrinterSdk.Printer? = null
  private var connected = false
  private var logoBitmap: Bitmap? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("SunmiPrinter")

    OnCreate {
      try { loadLogo() } catch (e: Exception) { Log.w(TAG, "logo load: ${e.message}") }
      try { initPrinterSdk() } catch (e: Exception) { Log.e(TAG, "sdk init: ${e.message}", e) }
    }

    OnDestroy {
      try { PrinterSdk.getInstance().destroy() } catch (e: Exception) { Log.w(TAG, "destroy: ${e.message}") }
    }

    AsyncFunction("isConnected") {
      mapOf("connected" to (connected && selectedPrinter != null))
    }

    AsyncFunction("printerInit") {
      if (selectedPrinter == null) initPrinterSdk()
      mapOf("connected" to (connected && selectedPrinter != null))
    }

    AsyncFunction("getStatus") {
      statusMap()
    }

    // Plain text — used by the Settings "Test print" button and as a
    // last-ditch fallback.
    AsyncFunction("printText") { text: String ->
      printPlain(text)
    }

    AsyncFunction("printFormattedReceipt") { options: ReceiptOptions ->
      printFormattedReceipt(options)
    }

    AsyncFunction("printOrderDocket") { options: DocketOptions ->
      printOrderDocket(options)
    }
  }

  // ─── SDK lifecycle ───────────────────────────────────────

  private fun loadLogo() {
    val assets = context.assets
    assets.open("celsius-logo.png").use { input ->
      val original = BitmapFactory.decodeStream(input) ?: return
      val targetWidth = 200
      val targetHeight = (targetWidth.toFloat() / original.width * original.height).toInt()
      val scaled = Bitmap.createScaledBitmap(original, targetWidth, targetHeight, true)
      // Flatten alpha onto white — thermal heads render transparency as black.
      val flattened = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(flattened)
      canvas.drawColor(Color.WHITE)
      canvas.drawBitmap(scaled, 0f, 0f, null)
      scaled.recycle()
      logoBitmap = flattened
      Log.i(TAG, "Logo loaded ${targetWidth}x$targetHeight")
    }
  }

  private fun initPrinterSdk() {
    PrinterSdk.getInstance().getPrinter(context, object : PrinterSdk.PrinterListen {
      override fun onDefPrinter(printer: PrinterSdk.Printer?) {
        if (printer != null) {
          selectedPrinter = printer
          connected = true
          Log.i(TAG, "Default printer found")
        }
      }

      override fun onPrinters(printers: MutableList<PrinterSdk.Printer>?) {
        if (selectedPrinter == null && !printers.isNullOrEmpty()) {
          selectedPrinter = printers[0]
          connected = true
          Log.i(TAG, "Selected first available printer")
        }
      }
    })
  }

  private fun statusMap(): Map<String, Any?> {
    val ret = HashMap<String, Any?>()
    ret["connected"] = connected && selectedPrinter != null
    val p = selectedPrinter
    if (p != null) {
      try {
        val q: QueryApi? = p.queryApi()
        if (q != null) {
          val status = q.status
          ret["status"] = status?.toString() ?: "unknown"
          ret["name"] = q.getInfo(PrinterInfo.NAME)
          ret["paper"] = q.getInfo(PrinterInfo.PAPER)
        }
      } catch (e: Exception) {
        ret["status"] = "error: ${e.message}"
      }
    } else {
      ret["status"] = "disconnected"
    }
    return ret
  }

  // ─── ESC/POS fallback ────────────────────────────────────

  private fun buildEscReceipt(text: String): ByteArray {
    val baos = ByteArrayOutputStream()
    baos.write(byteArrayOf(0x1B, 0x40))               // ESC @ init
    baos.write(text.toByteArray(StandardCharsets.UTF_8))
    baos.write(byteArrayOf(0x0A,0x0A,0x0A,0x0A,0x0A,0x0A,0x0A,0x0A,0x0A,0x0A,0x0A,0x0A,0x0A,0x0A,0x0A,0x0A))
    baos.write(byteArrayOf(0x1D, 0x56, 0x01))         // GS V 1 partial cut
    return baos.toByteArray()
  }

  // ─── Print: plain text ───────────────────────────────────

  private fun printPlain(text: String) {
    val p = selectedPrinter ?: throw IllegalStateException("No printer")
    try {
      val cmd: CommandApi? = p.commandApi()
      if (cmd != null) {
        cmd.sendEscCommand(buildEscReceipt(text))
        return
      }
    } catch (e: Exception) { Log.e(TAG, "printPlain CommandApi: ${e.message}") }
    val line: LineApi = p.lineApi() ?: throw Exception("No print API")
    line.initLine(BaseStyle.getStyle())
    line.printText(text, TextStyle.getStyle())
    for (i in 0 until 4) line.printText(" ", TextStyle.getStyle().setTextSize(24))
    line.autoOut()
  }

  // ─── Print: formatted receipt ────────────────────────────

  private fun printFormattedReceipt(o: ReceiptOptions) {
    val p = selectedPrinter ?: throw IllegalStateException("No printer available")
    try {
      val line: LineApi = p.lineApi() ?: throw Exception("No LineApi")
      line.initLine(BaseStyle.getStyle().setAlign(Align.CENTER))

      // 1. Logo
      if (o.showLogo && logoBitmap != null) {
        val bs = BitmapStyle.getStyle(); bs.setAlign(Align.CENTER)
        line.printBitmap(logoBitmap, bs)
        line.printText(" ", TextStyle.getStyle().setTextSize(8))
      }

      // 2. Header (outlet name bold, then address/phone)
      if (o.header.isNotEmpty()) {
        val headerLines = o.header.split("\n")
        for ((i, raw) in headerLines.withIndex()) {
          val hl = raw.trim()
          if (hl.isEmpty()) continue
          if (i == 0) {
            line.printText(hl, TextStyle.getStyle().setAlign(Align.CENTER).enableBold(true).setTextSize(28))
          } else {
            line.printText(hl, TextStyle.getStyle().setAlign(Align.CENTER).setTextSize(22))
          }
        }
      }

      // 3. Body (parsed line-by-line)
      if (o.body.isNotEmpty()) {
        for (bl in o.body.split("\n")) {
          val t = bl.trim()
          when {
            t.startsWith("===") || t.startsWith("---") ->
              line.printDividingLine(DividingLine.DOTTED, 1)
            t == "QUEUE NUMBER" -> {
              line.printText(" ", TextStyle.getStyle().setTextSize(8))
              line.printText(t, TextStyle.getStyle().setAlign(Align.CENTER).enableBold(true).setTextSize(28))
            }
            t.startsWith("** ") && t.endsWith(" **") -> {
              val num = t.replace("**", "").trim()
              line.printText(num, TextStyle.getStyle().setAlign(Align.CENTER).enableBold(true).setTextSize(48))
              line.printText(" ", TextStyle.getStyle().setTextSize(8))
            }
            t.startsWith("TOTAL") ->
              line.printText(bl, TextStyle.getStyle().setAlign(Align.LEFT).enableBold(true).setTextSize(24))
            t.startsWith("Subtotal") || t.startsWith("Service Charge") || t.startsWith("Discount") || t.startsWith("Promo") ->
              line.printText(bl, TextStyle.getStyle().setAlign(Align.LEFT).setTextSize(24))
            t.matches(Regex("^\\d+x .+")) ->
              line.printText(bl, TextStyle.getStyle().setAlign(Align.LEFT).enableBold(true).setTextSize(24))
            t.startsWith("Order:") || t.startsWith("Date:") || t.startsWith("Time:") || t.startsWith("Type:") || t.startsWith("Table:") ->
              line.printText(bl, TextStyle.getStyle().setAlign(Align.LEFT).setTextSize(24))
            t.startsWith("Card") || t.startsWith("Cash") || t.startsWith("E-Wallet") ->
              line.printText(bl, TextStyle.getStyle().setAlign(Align.LEFT).setTextSize(24))
            bl.startsWith("   ") ->
              line.printText(bl, TextStyle.getStyle().setAlign(Align.LEFT).setTextSize(24))
            t.isNotEmpty() ->
              line.printText(bl, TextStyle.getStyle().setAlign(Align.LEFT).setTextSize(24))
          }
        }
      }

      // 4. Footer (centered)
      if (o.footer.isNotEmpty()) {
        line.printText(" ", TextStyle.getStyle().setTextSize(8))
        for (fl in o.footer.split("\n")) {
          val t = fl.trim()
          if (t.isNotEmpty()) line.printText(t, TextStyle.getStyle().setAlign(Align.CENTER).setTextSize(22))
        }
      }

      // 5. Promo banner
      if (o.promoText.isNotEmpty()) {
        line.printText(" ", TextStyle.getStyle().setTextSize(8))
        line.printDividingLine(DividingLine.DOTTED, 1)
        for (pl in o.promoText.split("\n")) {
          line.printText(pl, TextStyle.getStyle().setAlign(Align.CENTER).enableBold(true).setTextSize(26))
        }
        line.printDividingLine(DividingLine.DOTTED, 1)
      }

      // 6. QR code
      if (o.qrUrl.isNotEmpty()) {
        line.printText(" ", TextStyle.getStyle().setTextSize(12))
        if (o.qrLabel.isNotEmpty()) {
          line.printText(o.qrLabel, TextStyle.getStyle().setAlign(Align.CENTER).enableBold(true).setTextSize(24))
        }
        line.printText(" ", TextStyle.getStyle().setTextSize(8))
        val qr = QrStyle.getStyle(); qr.setAlign(Align.CENTER); qr.setDot(6)
        line.printQrCode(o.qrUrl, qr)
      }

      // 7. Feed + cut
      for (i in 0 until 4) line.printText(" ", TextStyle.getStyle().setTextSize(24))
      line.autoOut()
      return
    } catch (e: Exception) {
      Log.e(TAG, "printFormattedReceipt LineApi: ${e.message}", e)
    }

    // Fallback ESC/POS
    val cmd = p.commandApi() ?: throw Exception("All print methods failed")
    cmd.sendEscCommand(buildEscReceipt(o.header + "\n" + o.body + "\n" + o.footer))
  }

  // ─── Print: kitchen docket ───────────────────────────────

  private fun printOrderDocket(o: DocketOptions) {
    val p = selectedPrinter ?: throw IllegalStateException("No printer available")
    try {
      val line: LineApi = p.lineApi() ?: throw Exception("No LineApi")
      line.initLine(BaseStyle.getStyle().setAlign(Align.CENTER))

      // 1. Station header — BIG bold
      line.printText(o.station.uppercase(), TextStyle.getStyle().setAlign(Align.CENTER).enableBold(true).setTextSize(48))
      line.printDividingLine(DividingLine.DOTTED, 1)

      // 2. Order info
      line.printText("Order #${o.orderNumber}", TextStyle.getStyle().setAlign(Align.CENTER).enableBold(true).setTextSize(32))
      var typeLine = o.orderType
      if (o.tableNumber.isNotEmpty()) typeLine += "  |  Table ${o.tableNumber}"
      else if (o.queueNumber.isNotEmpty()) typeLine += "  |  Q: ${o.queueNumber}"
      line.printText(typeLine, TextStyle.getStyle().setAlign(Align.CENTER).enableBold(true).setTextSize(28))
      if (o.time.isNotEmpty()) line.printText(o.time, TextStyle.getStyle().setAlign(Align.CENTER).setTextSize(24))

      line.printDividingLine(DividingLine.DOTTED, 1)
      line.printText(" ", TextStyle.getStyle().setTextSize(8))

      // 3. Items
      if (o.items.isNotEmpty()) {
        for (il in o.items.split("\n")) {
          when {
            il.startsWith("---") -> {
              line.printText(" ", TextStyle.getStyle().setTextSize(8))
              line.printDividingLine(DividingLine.DOTTED, 1)
              line.printText(" ", TextStyle.getStyle().setTextSize(8))
            }
            il.startsWith("   ** ") && il.trim().endsWith("**") ->
              line.printText(il.trim().replace("**", "").trim(), TextStyle.getStyle().setAlign(Align.LEFT).enableBold(true).setTextSize(28))
            il.startsWith("   ") ->
              line.printText(il, TextStyle.getStyle().setAlign(Align.LEFT).setTextSize(26))
            il.isNotEmpty() ->
              line.printText(il, TextStyle.getStyle().setAlign(Align.LEFT).enableBold(true).setTextSize(36))
          }
        }
      }

      // 4. End + feed
      line.printText(" ", TextStyle.getStyle().setTextSize(8))
      line.printDividingLine(DividingLine.DOTTED, 1)
      line.printText("- END -", TextStyle.getStyle().setAlign(Align.CENTER).setTextSize(24))
      for (i in 0 until 4) line.printText(" ", TextStyle.getStyle().setTextSize(24))
      line.autoOut()
      return
    } catch (e: Exception) {
      Log.e(TAG, "printOrderDocket LineApi: ${e.message}", e)
    }

    val cmd = p.commandApi() ?: throw Exception("All print methods failed")
    val full = "** ${o.station.uppercase()} **\nOrder: ${o.orderNumber}\n${o.orderType}\nTime: ${o.time}\n" +
      "================================\n${o.items}\n-- END --\n"
    cmd.sendEscCommand(buildEscReceipt(full))
  }
}

// ─── Param records ─────────────────────────────────────────

class ReceiptOptions : Record {
  @Field var header: String = ""
  @Field var body: String = ""
  @Field var footer: String = ""
  @Field var showLogo: Boolean = true
  @Field var qrUrl: String = ""
  @Field var qrLabel: String = ""
  @Field var promoText: String = ""
}

class DocketOptions : Record {
  @Field var station: String = "KITCHEN"
  @Field var orderNumber: String = ""
  @Field var orderType: String = ""
  @Field var tableNumber: String = ""
  @Field var queueNumber: String = ""
  @Field var time: String = ""
  @Field var items: String = ""
}

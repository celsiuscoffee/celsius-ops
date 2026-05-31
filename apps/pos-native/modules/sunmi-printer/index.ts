import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * Typed JS handle to the native SunmiPrinter module (Android-only).
 *
 * Uses requireOptionalNativeModule so the app keeps running where the
 * native module isn't compiled in — Expo Go, the Metro web target, or a
 * non-SUNMI device — instead of throwing at import time. Callers must
 * null-check (lib/printer.ts does).
 */

export type ReceiptOptions = {
  header: string;
  body: string;
  footer: string;
  showLogo?: boolean;
  qrUrl?: string;
  qrLabel?: string;
  promoText?: string;
};

export type DocketOptions = {
  station: string;
  orderNumber: string;
  orderType: string;
  tableNumber?: string;
  queueNumber?: string;
  time: string;
  items: string;
};

export type PrinterStatus = {
  connected: boolean;
  status?: string;
  name?: string;
  paper?: string;
};

export type SunmiPrinterModule = {
  isConnected(): Promise<{ connected: boolean }>;
  printerInit(): Promise<{ connected: boolean }>;
  getStatus(): Promise<PrinterStatus>;
  printText(text: string): Promise<void>;
  printFormattedReceipt(options: ReceiptOptions): Promise<void>;
  printOrderDocket(options: DocketOptions): Promise<void>;
  /** Send a pre-built ESC/POS byte stream (0-255 values) to a LAN printer.
   *  Rejects on connect/write failure. */
  printNetworkRaw(
    host: string,
    port: number,
    data: number[],
    timeoutMs: number,
  ): Promise<{ ok: boolean; bytes?: number }>;
};

const SunmiPrinter = requireOptionalNativeModule<SunmiPrinterModule>("SunmiPrinter");

export default SunmiPrinter;

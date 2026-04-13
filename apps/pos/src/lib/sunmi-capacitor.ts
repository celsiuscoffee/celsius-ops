/**
 * Capacitor bridge to the native SunmiPrinter plugin.
 *
 * On Android (SUNMI device): calls the native Java plugin via Capacitor.
 * On web (dev/browser): falls back gracefully — all methods return false/noop.
 */
import { registerPlugin } from "@capacitor/core";
import type { Plugin } from "@capacitor/core";

export interface SunmiPrinterPlugin extends Plugin {
  isConnected(): Promise<{ connected: boolean }>;
  printerInit(): Promise<void>;
  printText(options: { text: string }): Promise<void>;
  printTextWithSize(options: { text: string; size: number }): Promise<void>;
  setAlignment(options: { alignment: number }): Promise<void>;
  setBold(options: { bold: boolean }): Promise<void>;
  lineWrap(options: { lines: number }): Promise<void>;
  cutPaper(): Promise<void>;
  printReceipt(options: { text: string }): Promise<void>;
  printLogo(): Promise<void>;
  printFormattedReceipt(options: {
    header: string;
    body: string;
    footer: string;
  }): Promise<void>;
  getPrinterStatus(): Promise<{
    connected: boolean;
    status: string;
    name: string;
    paper: string;
  }>;
  selfCheck(): Promise<{
    connected: boolean;
    sdkInitialized: boolean;
    status: string;
    name: string;
    paper: string;
    type: string;
    hasCommandApi: boolean;
    hasLineApi: boolean;
  }>;
}

// Register the plugin — Capacitor automatically routes to native on Android
const SunmiPrinter = registerPlugin<SunmiPrinterPlugin>("SunmiPrinter");

export default SunmiPrinter;

/**
 * Check if we're running inside the Capacitor native shell
 * (as opposed to a regular browser).
 */
export function isCapacitorNative(): boolean {
  return typeof (window as any)?.Capacitor?.isNativePlatform === "function"
    ? (window as any).Capacitor.isNativePlatform()
    : false;
}

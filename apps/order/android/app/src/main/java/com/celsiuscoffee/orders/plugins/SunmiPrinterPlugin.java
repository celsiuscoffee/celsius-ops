package com.celsiuscoffee.orders.plugins;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;
import android.os.RemoteException;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import woyou.aidlservice.jiuiv5.IWoyouService;

@CapacitorPlugin(name = "SunmiPrinter")
public class SunmiPrinterPlugin extends Plugin {

    private static final String TAG = "SunmiPrinter";
    private IWoyouService printerService;
    private boolean isConnected = false;

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            printerService = IWoyouService.Stub.asInterface(service);
            isConnected = true;
            Log.i(TAG, "Sunmi printer service connected");
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            printerService = null;
            isConnected = false;
            Log.w(TAG, "Sunmi printer service disconnected");
        }
    };

    @Override
    public void load() {
        super.load();
        bindPrinterService();
    }

    private void bindPrinterService() {
        try {
            Intent intent = new Intent();
            intent.setPackage("woyou.aidlservice.jiuiv5");
            intent.setAction("woyou.aidlservice.jiuiv5.IWoyouService");
            getContext().bindService(intent, connection, Context.BIND_AUTO_CREATE);
        } catch (Exception e) {
            Log.e(TAG, "Failed to bind Sunmi printer service", e);
        }
    }

    @PluginMethod
    public void isReady(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ready", isConnected && printerService != null);
        call.resolve(ret);
    }

    @PluginMethod
    public void printReceipt(PluginCall call) {
        if (!isConnected || printerService == null) {
            call.reject("Printer not connected");
            return;
        }

        String orderNumber = call.getString("orderNumber", "");
        String storeName = call.getString("storeName", "");
        String time = call.getString("time", "");
        String items = call.getString("items", "");
        String notes = call.getString("notes", "");
        String type = call.getString("type", "kitchen");
        String total = call.getString("total", "");
        String subtotal = call.getString("subtotal", "");
        String payment = call.getString("payment", "");

        String DASHES = "--------------------------------";

        try {
            Log.i(TAG, "Printing with AIDL methods, type=" + type + " order=#" + orderNumber);

            // Initialize printer
            printerService.printerInit(null);

            if (type.equals("kitchen")) {
                // --- Kitchen Slip ---
                printerService.setAlignment(1, null); // center
                printerService.setFontSize(24, null);
                printBold("KITCHEN ORDER");
                printerService.setFontSize(32, null);
                printLine("Celsius Coffee");
                printerService.setFontSize(24, null);
                printLine(storeName);
                printLine(DASHES);

                // Big order number
                printerService.setFontSize(48, null);
                printBold("#" + orderNumber);
                printerService.setFontSize(24, null);
                printLine(time);
                printLine(DASHES);

                // Items left-aligned
                printerService.setAlignment(0, null); // left
                printerService.setFontSize(24, null);
                printLine(items);

                // Notes
                if (notes != null && !notes.isEmpty()) {
                    printLine(DASHES);
                    printBold("NOTE: " + notes);
                }

                // Footer
                printerService.setAlignment(1, null); // center
                printLine(DASHES);
                printLine("SELF-PICKUP");

            } else {
                // --- Customer Receipt ---
                printerService.setAlignment(1, null); // center
                printerService.setFontSize(32, null);
                printLine("Celsius Coffee");
                printerService.setFontSize(24, null);
                printLine(storeName);
                printLine(time);
                printLine(DASHES);

                printerService.setFontSize(48, null);
                printBold("#" + orderNumber);
                printerService.setFontSize(24, null);
                printLine(DASHES);

                // Items left-aligned
                printerService.setAlignment(0, null); // left
                printLine(items);

                printLine(DASHES);
                printLine("Subtotal          " + subtotal);
                printLine(DASHES);

                printerService.setFontSize(32, null);
                printBold("TOTAL  " + total);
                printerService.setFontSize(24, null);
                printLine("Payment: " + payment);

                printerService.setAlignment(1, null); // center
                printLine(DASHES);
                printLine("Thank you!");
            }

            // Feed paper
            printerService.lineWrap(4, null);

            Log.i(TAG, "Print completed successfully");
            call.resolve();

        } catch (RemoteException e) {
            Log.e(TAG, "Print RemoteException", e);
            call.reject("Print error: " + e.getMessage());
        }
    }

    /** Print a line of text with newline */
    private void printLine(String text) throws RemoteException {
        printerService.printText(text + "\n", null);
    }

    /** Print bold text with newline, then turn bold off */
    private void printBold(String text) throws RemoteException {
        // Use sendRAWData for ESC E 1 (bold on) and ESC E 0 (bold off)
        printerService.sendRAWData(new byte[]{0x1B, 'E', 1}, null);
        printerService.printText(text + "\n", null);
        printerService.sendRAWData(new byte[]{0x1B, 'E', 0}, null);
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        try {
            getContext().unbindService(connection);
        } catch (Exception ignored) {}
    }
}

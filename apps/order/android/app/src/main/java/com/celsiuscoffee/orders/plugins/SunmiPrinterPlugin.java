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
    public void printText(PluginCall call) {
        if (!isConnected || printerService == null) {
            call.reject("Printer not connected");
            return;
        }

        String text = call.getString("text", "");
        int fontSize = call.getInt("fontSize", 24);
        boolean bold = call.getBoolean("bold", false);
        int align = call.getInt("align", 0); // 0=left, 1=center, 2=right

        try {
            printerService.setAlignment(align, null);
            if (bold) {
                printerService.printTextWithFont(text + "\n", "", fontSize, null);
            } else {
                printerService.setFontSize(fontSize, null);
                printerService.printOriginalText(text + "\n", null);
            }
            call.resolve();
        } catch (RemoteException e) {
            call.reject("Print error: " + e.getMessage());
        }
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
        String items = call.getString("items", ""); // JSON string of items
        String notes = call.getString("notes", "");
        String type = call.getString("type", "kitchen"); // kitchen | receipt
        String total = call.getString("total", "");
        String subtotal = call.getString("subtotal", "");
        String payment = call.getString("payment", "");

        try {
            Log.i(TAG, "Starting print job, type=" + type + " order=#" + orderNumber);
            printerService.printerInit(null);

            String DASHES = "--------------------------------\n";

            if (type.equals("kitchen")) {
                // Kitchen slip — use printText + setFontSize for V3 compatibility
                printerService.setAlignment(1, null);
                printerService.setFontSize(24, null);
                printerService.printText("KITCHEN ORDER\n", null);
                printerService.setFontSize(28, null);
                printerService.printText("Celsius Coffee\n", null);
                printerService.setFontSize(20, null);
                printerService.printText(storeName + "\n", null);
                printerService.printText(DASHES, null);
                printerService.setFontSize(48, null);
                printerService.printText("#" + orderNumber + "\n", null);
                printerService.setFontSize(20, null);
                printerService.printText(time + "\n", null);
                printerService.printText(DASHES, null);

                printerService.setAlignment(0, null);
                printerService.setFontSize(24, null);
                printerService.printText(items + "\n", null);

                if (notes != null && !notes.isEmpty()) {
                    printerService.printText(DASHES, null);
                    printerService.setFontSize(24, null);
                    printerService.printText("NOTE: " + notes + "\n", null);
                }

                printerService.setAlignment(1, null);
                printerService.setFontSize(20, null);
                printerService.printText(DASHES, null);
                printerService.printText("SELF-PICKUP\n", null);
            } else {
                // Receipt
                printerService.setAlignment(1, null);
                printerService.setFontSize(28, null);
                printerService.printText("Celsius Coffee\n", null);
                printerService.setFontSize(20, null);
                printerService.printText(storeName + "\n", null);
                printerService.setFontSize(18, null);
                printerService.printText(time + "\n", null);
                printerService.setFontSize(20, null);
                printerService.printText(DASHES, null);
                printerService.setFontSize(42, null);
                printerService.printText("#" + orderNumber + "\n", null);
                printerService.setFontSize(20, null);
                printerService.printText(DASHES, null);

                printerService.setAlignment(0, null);
                printerService.setFontSize(24, null);
                printerService.printText(items + "\n", null);

                printerService.setFontSize(20, null);
                printerService.printText(DASHES, null);
                printerService.printText("Subtotal          " + subtotal + "\n", null);
                printerService.printText(DASHES, null);
                printerService.setFontSize(28, null);
                printerService.printText("TOTAL  " + total + "\n", null);
                printerService.setFontSize(20, null);
                printerService.printText("Payment: " + payment + "\n", null);

                printerService.setAlignment(1, null);
                printerService.printText(DASHES, null);
                printerService.printText("Thank you!\n", null);
            }

            printerService.lineWrap(4, null);
            Log.i(TAG, "Print job sent successfully");
            call.resolve();
        } catch (RemoteException e) {
            call.reject("Print error: " + e.getMessage());
        }
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        try {
            getContext().unbindService(connection);
        } catch (Exception ignored) {}
    }
}

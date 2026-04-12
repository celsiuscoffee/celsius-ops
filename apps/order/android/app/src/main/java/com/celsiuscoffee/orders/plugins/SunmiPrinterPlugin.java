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

import java.io.ByteArrayOutputStream;
import java.io.IOException;

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

    // ---- ESC/POS command builders ----

    /** ESC @ — initialize printer */
    private byte[] cmdInit() {
        return new byte[]{ 0x1B, 0x40 };
    }

    /** ESC a n — set alignment: 0=left, 1=center, 2=right */
    private byte[] cmdAlign(int n) {
        return new byte[]{ 0x1B, 0x61, (byte) n };
    }

    /** GS ! n — character size (widthMult<<4 | heightMult) */
    private byte[] cmdCharSize(int widthMult, int heightMult) {
        int n = ((widthMult & 0x07) << 4) | (heightMult & 0x07);
        return new byte[]{ 0x1D, 0x21, (byte) n };
    }

    /** ESC E n — bold on/off */
    private byte[] cmdBold(boolean on) {
        return new byte[]{ 0x1B, 0x45, (byte)(on ? 1 : 0) };
    }

    /** ESC d n — feed n lines */
    private byte[] cmdFeedLines(int n) {
        return new byte[]{ 0x1B, 0x64, (byte) n };
    }

    /** Convert text to UTF-8 bytes */
    private byte[] text(String s) {
        try {
            return s.getBytes("UTF-8");
        } catch (Exception e) {
            return s.getBytes();
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
        String items = call.getString("items", "");
        String notes = call.getString("notes", "");
        String type = call.getString("type", "kitchen");
        String total = call.getString("total", "");
        String subtotal = call.getString("subtotal", "");
        String payment = call.getString("payment", "");

        String DASHES = "--------------------------------\n";

        try {
            Log.i(TAG, "Printing type=" + type + " order=#" + orderNumber);

            // Send each section as a separate sendRAWData call
            // so the printer processes them sequentially

            // Initialize
            printerService.sendRAWData(cmdInit(), null);

            if (type.equals("kitchen")) {
                // --- Kitchen Slip ---
                // Header centered
                sendRaw(cmdAlign(1));
                sendRaw(cmdCharSize(0, 0));
                sendRaw(cmdBold(true));
                sendText("KITCHEN ORDER\n");
                sendRaw(cmdBold(false));

                sendRaw(cmdCharSize(0, 1));
                sendText("Celsius Coffee\n");
                sendRaw(cmdCharSize(0, 0));
                sendText(storeName + "\n");
                sendText(DASHES);

                // Big order number
                sendRaw(cmdCharSize(1, 1));
                sendRaw(cmdBold(true));
                sendText("#" + orderNumber + "\n");
                sendRaw(cmdBold(false));
                sendRaw(cmdCharSize(0, 0));
                sendText(time + "\n");
                sendText(DASHES);

                // Items left-aligned
                sendRaw(cmdAlign(0));
                sendText(items + "\n");

                // Notes
                if (notes != null && !notes.isEmpty()) {
                    sendText(DASHES);
                    sendRaw(cmdBold(true));
                    sendText("NOTE: " + notes + "\n");
                    sendRaw(cmdBold(false));
                }

                // Footer
                sendRaw(cmdAlign(1));
                sendText(DASHES);
                sendText("SELF-PICKUP\n");

            } else {
                // --- Customer Receipt ---
                sendRaw(cmdAlign(1));
                sendRaw(cmdCharSize(0, 1));
                sendText("Celsius Coffee\n");
                sendRaw(cmdCharSize(0, 0));
                sendText(storeName + "\n");
                sendText(time + "\n");
                sendText(DASHES);

                sendRaw(cmdCharSize(1, 1));
                sendRaw(cmdBold(true));
                sendText("#" + orderNumber + "\n");
                sendRaw(cmdBold(false));
                sendRaw(cmdCharSize(0, 0));
                sendText(DASHES);

                // Items left-aligned
                sendRaw(cmdAlign(0));
                sendText(items + "\n");

                sendText(DASHES);
                sendText("Subtotal          " + subtotal + "\n");
                sendText(DASHES);

                sendRaw(cmdCharSize(0, 1));
                sendRaw(cmdBold(true));
                sendText("TOTAL  " + total + "\n");
                sendRaw(cmdBold(false));
                sendRaw(cmdCharSize(0, 0));
                sendText("Payment: " + payment + "\n");

                sendRaw(cmdAlign(1));
                sendText(DASHES);
                sendText("Thank you!\n");
            }

            // Feed paper
            sendRaw(cmdFeedLines(4));

            Log.i(TAG, "Print completed successfully");
            call.resolve();

        } catch (RemoteException e) {
            Log.e(TAG, "Print RemoteException", e);
            call.reject("Print error: " + e.getMessage());
        }
    }

    /** Send raw command bytes via sendRAWData */
    private void sendRaw(byte[] data) throws RemoteException {
        printerService.sendRAWData(data, null);
    }

    /** Send text as raw bytes via sendRAWData */
    private void sendText(String s) throws RemoteException {
        printerService.sendRAWData(text(s), null);
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        try {
            getContext().unbindService(connection);
        } catch (Exception ignored) {}
    }
}

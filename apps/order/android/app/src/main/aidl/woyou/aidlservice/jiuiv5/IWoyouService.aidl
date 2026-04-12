package woyou.aidlservice.jiuiv5;

import woyou.aidlservice.jiuiv5.ICallback;

/**
 * Sunmi V3 printer AIDL — method order matches service v6.6.39.
 * Transaction IDs are assigned sequentially from FIRST_CALL_TRANSACTION.
 * The order here MUST match the real service or calls go to wrong methods.
 */
interface IWoyouService {
    // FIRST+0
    void updateFirmware();
    // FIRST+1
    int getFirmwareStatus();
    // FIRST+2
    String getServiceVersion();

    // FIRST+3
    void printerInit(in ICallback callback);
    // FIRST+4
    void printerSelfChecking(in ICallback callback);
    // FIRST+5
    String getPrinterSerialNo();
    // FIRST+6
    String getPrinterVersion();
    // FIRST+7
    String getPrinterModal();
    // FIRST+8
    void getPrintedLength(in ICallback callback);

    // FIRST+9
    void lineWrap(int n, in ICallback callback);

    // FIRST+10
    void sendRAWData(in byte[] data, in ICallback callback);

    // FIRST+11
    void setAlignment(int alignment, in ICallback callback);
    // FIRST+12
    void setFontName(String typeface, in ICallback callback);
    // FIRST+13
    void setFontSize(float fontsize, in ICallback callback);

    // FIRST+14
    void printText(String text, in ICallback callback);
    // FIRST+15
    void printTextWithFont(String text, String typeface, float fontsize, in ICallback callback);

    // FIRST+16
    void printColumnsText(in String[] colsTextArr, in int[] colsWidthArr, in int[] colsAlign, in ICallback callback);

    // FIRST+17
    void printBitmap(in android.graphics.Bitmap bitmap, in ICallback callback);

    // FIRST+18
    void printBarCode(String data, int symbology, int height, int width, int textposition, in ICallback callback);
    // FIRST+19
    void printQRCode(String data, int modulesize, int errorlevel, in ICallback callback);

    // FIRST+20
    void printOriginalText(String text, in ICallback callback);

    // FIRST+21  — commitPrint uses TransBean[], stub as byte[] to keep slot
    void commitPrint(in byte[] transBeanData, in ICallback callback);

    // FIRST+22
    void commitPrinterBuffer();

    // FIRST+23
    void cutPaper(in ICallback callback);
    // FIRST+24
    int getCutPaperTimes();
    // FIRST+25
    void openDrawer(in ICallback callback);
    // FIRST+26
    int getOpenDrawerTimes();

    // FIRST+27
    void enterPrinterBuffer(boolean clean);
    // FIRST+28
    void exitPrinterBuffer(boolean commit);

    // FIRST+29  — tax uses special callback, stub with ICallback
    void tax(in byte[] data, in ICallback callback);

    // FIRST+30
    void getPrinterFactory(in ICallback callback);
    // FIRST+31
    void clearBuffer();

    // FIRST+32
    void commitPrinterBufferWithCallback(in ICallback callback);
    // FIRST+33
    void exitPrinterBufferWithCallback(boolean commit, in ICallback callback);

    // FIRST+34
    void printColumnsString(in String[] colsTextArr, in int[] colsWidthArr, in int[] colsAlign, in ICallback callback);

    // FIRST+35
    int updatePrinterState();

    // FIRST+36
    void sendLCDCommand(int flag);
    // FIRST+37
    void sendLCDString(String text, in ICallback callback);
    // FIRST+38
    void sendLCDBitmap(in android.graphics.Bitmap bitmap, in ICallback callback);

    // FIRST+39
    int getPrinterMode();
    // FIRST+40
    int getPrinterBBMDistance();

    // FIRST+41
    void printBitmapCustom(in android.graphics.Bitmap bitmap, int type, in ICallback callback);

    // FIRST+42
    int getForcedDouble();
    // FIRST+43
    boolean isForcedAntiWhite();
    // FIRST+44
    boolean isForcedBold();
    // FIRST+45
    boolean isForcedUnderline();
    // FIRST+46
    int getForcedRowHeight();
    // FIRST+47
    int getFontName();

    // FIRST+48
    void sendLCDDoubleString(String top, String bottom, in ICallback callback);

    // FIRST+49
    int getPrinterPaper();
    // FIRST+50
    boolean getDrawerStatus();

    // FIRST+51
    void sendLCDFillString(String text, int size, boolean fill, in ICallback callback);
    // FIRST+52
    void sendLCDMultiString(in String[] text, in int[] align, in ICallback callback);

    // FIRST+53
    int getPrinterDensity();

    // FIRST+54
    void print2DCode(String data, int symbology, int modulesize, int errorlevel, in ICallback callback);

    // FIRST+55
    void autoOutPaper(in ICallback callback);
    // FIRST+56
    void setPrinterStyle(int key, int value);

    // FIRST+57
    void labelLocate();
    // FIRST+58
    void labelOutput();
}

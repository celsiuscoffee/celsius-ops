"use client";

import { useState, useEffect } from "react";
import {
  Phone,
  Send,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface Diagnostics {
  provider: string;
  provider_raw_length?: number;
  provider_trimmed_length?: number;
  api_key_set: boolean;
  api_key_prefix: string | null;
  email_set: boolean;
  email_value?: string | null;
  sender_id: string;
  sms123_balance: number | null;
  balance_error: string | null;
  balance_raw_response?: Record<string, unknown>;
  recent_test_logs?: TestLog[];
}

interface TestLog {
  id: string;
  phone: string;
  message: string;
  status: string;
  provider: string;
  error: string | null;
  created_at: string;
}

interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  message_sent: string;
  diagnostics: Diagnostics;
}

function StatusIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 className="h-4 w-4 text-green-600" />
  ) : (
    <XCircle className="h-4 w-4 text-red-500" />
  );
}

export default function SmsTestPage() {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("Test SMS from Celsius Coffee backoffice.");
  const [senderId, setSenderId] = useState("CelsiusCoffee");
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [diagLoading, setDiagLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  const [testLogs, setTestLogs] = useState<TestLog[]>([]);

  // Load diagnostics on mount
  useEffect(() => {
    loadDiagnostics();
  }, []);

  async function loadDiagnostics() {
    setDiagLoading(true);
    try {
      const res = await fetch("/api/loyalty/sms/test");
      if (res.ok) {
        const data = await res.json();
        setDiagnostics(data);
        setTestLogs(data.recent_test_logs ?? []);
      }
    } catch {
      // ignore
    }
    setDiagLoading(false);
  }

  async function handleSend() {
    if (!phone.trim() || !message.trim()) return;
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch("/api/loyalty/sms/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phone.trim(),
          message: message.trim(),
          sender_id: senderId.trim() || undefined,
        }),
      });
      const data = await res.json();
      setSendResult(data);
      setDiagnostics(data.diagnostics);
      // Refresh logs
      loadDiagnostics();
    } catch {
      setSendResult({ success: false, error: "Network error", message_sent: "", diagnostics: diagnostics! });
    }
    setSending(false);
  }

  const smsPrefix = `RM0 [${senderId || "CelsiusCoffee"}] `;
  const previewMessage = message.startsWith("RM0 ") ? message : `${smsPrefix}${message}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/loyalty/engage"
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft className="h-5 w-5 text-gray-500" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">SMS Test Console</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Diagnose SMS123 configuration and send test messages
          </p>
        </div>
      </div>

      {/* Diagnostics Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">SMS123 Configuration</h2>
          <button
            onClick={loadDiagnostics}
            disabled={diagLoading}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <RefreshCw className={cn("h-4 w-4", diagLoading && "animate-spin")} />
            Refresh
          </button>
        </div>

        {diagLoading && !diagnostics ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading diagnostics...
          </div>
        ) : diagnostics ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Provider */}
            <div className="flex items-center gap-2">
              <StatusIcon ok={diagnostics.provider === "sms123"} />
              <span className="text-sm text-gray-600">Provider:</span>
              <span
                className={cn(
                  "text-sm font-mono px-2 py-0.5 rounded",
                  diagnostics.provider === "sms123"
                    ? "bg-green-50 text-green-700"
                    : "bg-red-50 text-red-700"
                )}
              >
                {diagnostics.provider}
              </span>
              {diagnostics.provider !== "sms123" && (
                <span className="text-xs text-red-500">
                  (should be &quot;sms123&quot;)
                </span>
              )}
            </div>

            {/* API Key */}
            <div className="flex items-center gap-2">
              <StatusIcon ok={diagnostics.api_key_set} />
              <span className="text-sm text-gray-600">API Key:</span>
              <span className="text-sm font-mono">
                {diagnostics.api_key_set ? diagnostics.api_key_prefix : "NOT SET"}
              </span>
            </div>

            {/* Email */}
            <div className="flex items-center gap-2">
              <StatusIcon ok={diagnostics.email_set} />
              <span className="text-sm text-gray-600">Email:</span>
              <span className="text-sm font-mono">
                {diagnostics.email_set ? diagnostics.email_value || "Set" : "NOT SET"}
              </span>
            </div>

            {/* Balance */}
            <div className="flex items-center gap-2">
              <StatusIcon ok={diagnostics.sms123_balance !== null && diagnostics.sms123_balance > 0} />
              <span className="text-sm text-gray-600">Balance:</span>
              <span className="text-sm font-semibold">
                {diagnostics.sms123_balance !== null
                  ? `${diagnostics.sms123_balance.toLocaleString()} credits`
                  : diagnostics.balance_error || "Unknown"}
              </span>
            </div>

            {/* Sender ID */}
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-500" />
              <span className="text-sm text-gray-600">Sender ID:</span>
              <span className="text-sm font-mono">{diagnostics.sender_id}</span>
            </div>

            {/* Raw length check */}
            {diagnostics.provider_raw_length !== undefined &&
              diagnostics.provider_raw_length !== diagnostics.provider_trimmed_length && (
                <div className="flex items-center gap-2 col-span-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <span className="text-sm text-amber-700">
                    SMS_PROVIDER env var has trailing whitespace/newline (raw length:{" "}
                    {diagnostics.provider_raw_length}, trimmed: {diagnostics.provider_trimmed_length})
                  </span>
                </div>
              )}
          </div>
        ) : (
          <p className="text-sm text-red-500">Failed to load diagnostics</p>
        )}

        {/* Warnings */}
        {diagnostics && diagnostics.provider !== "sms123" && (
          <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <p className="font-medium">SMS_PROVIDER is not set to &quot;sms123&quot;</p>
              <p className="mt-1">
                Messages are being logged to console only. Set the <code className="font-mono bg-amber-100 px-1 rounded">SMS_PROVIDER</code> environment variable to <code className="font-mono bg-amber-100 px-1 rounded">sms123</code> in your Vercel project settings to enable real sending.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Send Test SMS Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Send Test SMS</h2>

        <div className="space-y-4">
          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone Number
            </label>
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-gray-400" />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 0123456789 or 60123456789"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Sender ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Sender ID
            </label>
            <input
              type="text"
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
              placeholder="CelsiusCoffee"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Message */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Type your test message..."
            />
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-gray-400">
                {message.length} / 160 characters
              </p>
            </div>
          </div>

          {/* Preview */}
          <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-xs font-medium text-gray-500 mb-1">Message Preview (as sent)</p>
            <p className="text-sm font-mono text-gray-800 whitespace-pre-wrap break-all">
              {previewMessage}
            </p>
          </div>

          {/* Send Button */}
          <button
            onClick={handleSend}
            disabled={sending || !phone.trim() || !message.trim()}
            className={cn(
              "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors",
              sending || !phone.trim() || !message.trim()
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-blue-600 text-white hover:bg-blue-700"
            )}
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Send Test SMS
              </>
            )}
          </button>

          {/* Send Result */}
          {sendResult && (
            <div
              className={cn(
                "p-4 rounded-lg border",
                sendResult.success
                  ? "bg-green-50 border-green-200"
                  : "bg-red-50 border-red-200"
              )}
            >
              <div className="flex items-center gap-2 mb-2">
                {sendResult.success ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-500" />
                )}
                <span
                  className={cn(
                    "font-medium text-sm",
                    sendResult.success ? "text-green-800" : "text-red-800"
                  )}
                >
                  {sendResult.success ? "SMS sent successfully!" : "SMS failed to send"}
                </span>
              </div>
              {sendResult.messageId && (
                <p className="text-xs text-gray-600">
                  Message ID: <code className="font-mono">{sendResult.messageId}</code>
                </p>
              )}
              {sendResult.error && (
                <p className="text-sm text-red-700 mt-1">
                  Error: {sendResult.error}
                </p>
              )}
              <details className="mt-2">
                <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
                  Raw response
                </summary>
                <pre className="mt-1 text-xs font-mono bg-white/50 p-2 rounded overflow-auto max-h-40">
                  {JSON.stringify(sendResult, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>
      </div>

      {/* Recent Test Logs */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Test Logs</h2>

        {testLogs.length === 0 ? (
          <p className="text-sm text-gray-500">No test SMS logs yet. Send a test above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="pb-2 pr-4">Time</th>
                  <th className="pb-2 pr-4">Phone</th>
                  <th className="pb-2 pr-4">Provider</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {testLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2 pr-4 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">{log.phone}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{log.provider}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                          log.status === "sent"
                            ? "bg-green-50 text-green-700"
                            : "bg-red-50 text-red-700"
                        )}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-red-600 max-w-xs truncate">
                      {log.error || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

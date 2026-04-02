"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Delete,
  ArrowRight,
  ArrowLeft,
  Star,
  Gift,
  Loader2,
  TrendingUp,
  Award,
  ShieldCheck,
  User,
  ChevronRight,
  Check,
  Calendar,
  Mail,
} from "lucide-react";
import {
  fetchMemberByPhone,
  fetchTransactions,
  updateMemberProfile,
} from "@/lib/api";
import {
  cn,
  formatPoints,
  toStoragePhone,
  getTimeAgo,
} from "@/lib/utils";
import type { Member, MemberBrand, PointTransaction } from "@/types";
import Image from "next/image";

type Screen = "phone" | "otp" | "dashboard" | "profile";

export default function RewardsPage() {
  const [screen, setScreen] = useState<Screen>("phone");
  const [phone, setPhone] = useState("");
  const [member, setMember] = useState<Member | null>(null);
  const [memberBrand, setMemberBrand] = useState<MemberBrand | null>(null);
  const [transactions, setTransactions] = useState<PointTransaction[]>([]);
  const [loading, setLoading] = useState(false);

  // Profile edit state
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileBirthday, setProfileBirthday] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState("");

  // OTP state
  const [otpDigits, setOtpDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [otpTimer, setOtpTimer] = useState(60);
  const [otpError, setOtpError] = useState("");
  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // ─── Restore session from sessionStorage on mount ──
  useEffect(() => {
    try {
      const savedPhone = sessionStorage.getItem("celsius_phone");
      if (savedPhone) {
        setPhone(savedPhone.replace(/^\+?60/, "0").replace(/(\d{3})(\d{3,4})(\d{4})/, "$1-$2 $3"));
        setLoading(true);
        fetchMemberByPhone(savedPhone).then(async (memberData) => {
          if (memberData) {
            setMember(memberData);
            setMemberBrand(memberData.brand_data || null);
            const txns = await fetchTransactions(memberData.id);
            setTransactions(txns);
            setScreen("dashboard");
          } else {
            try { sessionStorage.removeItem("celsius_phone"); } catch {}
          }
          setLoading(false);
        }).catch(() => setLoading(false));
      }
    } catch {
      // sessionStorage not available (private browsing, etc.)
    }
  }, []);

  // ─── OTP timer countdown ─────────────────────────────
  useEffect(() => {
    if (screen !== "otp" || otpTimer <= 0) return;
    const interval = setInterval(() => {
      setOtpTimer((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [screen, otpTimer]);

  // ─── OTP auto-focus first input on screen change ─────
  useEffect(() => {
    if (screen === "otp") {
      setTimeout(() => otpInputRefs.current[0]?.focus(), 100);
    }
  }, [screen]);

  // ─── Phone keypad ─────────────────────────────────────
  const handleDigit = useCallback((digit: string) => {
    setPhone((prev) => (prev.length < 12 ? prev + digit : prev));
  }, []);

  const handleBackspace = useCallback(() => {
    setPhone((prev) => prev.slice(0, -1));
  }, []);

  const handleClear = useCallback(() => {
    setPhone("");
  }, []);

  const formatDisplayPhone = (digits: string) => {
    if (digits.length === 0) return "";
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)} ${digits.slice(6)}`;
  };

  const isValidPhone = phone.length >= 10;

  // ─── OTP handlers ─────────────────────────────────────
  const resetOtp = () => {
    setOtpDigits(["", "", "", "", "", ""]);
    setOtpTimer(60);
  };

  const handleOtpChange = (index: number, value: string) => {
    if (otpError) setOtpError("");
    // Handle paste of full code
    if (value.length > 1) {
      const digits = value.replace(/\D/g, "").slice(0, 6).split("");
      const newOtp = ["", "", "", "", "", ""];
      digits.forEach((d, i) => {
        newOtp[i] = d;
      });
      setOtpDigits(newOtp);
      // Focus last filled or the next empty
      const focusIdx = Math.min(digits.length, 5);
      otpInputRefs.current[focusIdx]?.focus();
      // Auto-submit if all 6 filled
      if (digits.length === 6) {
        setTimeout(() => handleOtpSubmit(newOtp), 150);
      }
      return;
    }

    const digit = value.replace(/\D/g, "");
    const newOtp = [...otpDigits];
    newOtp[index] = digit;
    setOtpDigits(newOtp);

    if (digit && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 filled
    if (digit && index === 5) {
      const allFilled = newOtp.every((d) => d !== "");
      if (allFilled) {
        setTimeout(() => handleOtpSubmit(newOtp), 150);
      }
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpSubmit = async (digits?: string[]) => {
    const code = (digits || otpDigits).join("");
    if (code.length !== 6) return;

    setLoading(true);
    setOtpError("");
    try {
      const storagePhone = toStoragePhone(phone);
      // Verify OTP via API
      const verifyRes = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: storagePhone, code, purpose: "login" }),
      });

      if (!verifyRes.ok) {
        setOtpError("Verification failed. Please try again.");
        setOtpDigits(["", "", "", "", "", ""]);
        otpInputRefs.current[0]?.focus();
        setLoading(false);
        return;
      }

      const verifyData = await verifyRes.json();

      if (!verifyData.success) {
        setOtpError("Invalid or expired code. Please try again.");
        setOtpDigits(["", "", "", "", "", ""]);
        otpInputRefs.current[0]?.focus();
        setLoading(false);
        return;
      }

      // Login OTP verified - proceed to dashboard
      try { sessionStorage.setItem("celsius_phone", storagePhone); } catch {}
      const memberData = await fetchMemberByPhone(storagePhone);
      if (memberData) {
        setMember(memberData);
        setMemberBrand(memberData.brand_data || null);
        const txns = await fetchTransactions(memberData.id);
        setTransactions(txns);
        setScreen("dashboard");
      } else {
        setMember(null);
        setMemberBrand(null);
        setScreen("dashboard");
      }
    } finally {
      setLoading(false);
      resetOtp();
    }
  };

  const handleResendOtp = async () => {
    setOtpError("");
    setOtpTimer(60);
    setOtpDigits(["", "", "", "", "", ""]);
    otpInputRefs.current[0]?.focus();
    try {
      const storagePhone = toStoragePhone(phone);
      await fetch("/api/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: storagePhone, purpose: "login" }),
      });
    } catch {
      // Silent — timer already reset
    }
  };

  // ─── Lookup — send OTP for login ─────────────────────
  const handleLookup = async () => {
    setLoading(true);
    try {
      const storagePhone = toStoragePhone(phone);
      const res = await fetch("/api/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: storagePhone, purpose: "login" }),
      });
      const data = await res.json();
      if (!data.success) {
        setOtpError("Failed to send OTP. Please try again.");
      }
    } catch {
      // Continue to OTP screen even if send fails (for dev/testing)
    }
    setLoading(false);
    resetOtp();
    setScreen("otp");
  };

  const handleReset = () => {
    try { sessionStorage.removeItem("celsius_phone"); } catch {}
    setScreen("phone");
    setPhone("");
    setMember(null);
    setMemberBrand(null);
    setTransactions([]);
    resetOtp();
  };

  // ─── Profile handlers ────────────────────────────────
  const openProfile = () => {
    setProfileName(member?.name || "");
    setProfileEmail(member?.email || "");
    setProfileBirthday(member?.birthday || "");
    setProfileSuccess(false);
    setProfileError("");
    setScreen("profile");
  };

  const handleProfileSave = async () => {
    if (!member) return;
    setProfileSaving(true);
    setProfileError("");
    setProfileSuccess(false);

    let storedPhone = "";
    try { storedPhone = sessionStorage.getItem("celsius_phone") || ""; } catch {}
    const storagePhone = storedPhone || toStoragePhone(phone);
    const result = await updateMemberProfile({
      member_id: member.id,
      phone: storagePhone,
      name: profileName.trim(),
      email: profileEmail.trim(),
      birthday: profileBirthday,
    });

    if (result.success && result.member) {
      setMember((prev) => prev ? { ...prev, ...result.member } : prev);
      setProfileSuccess(true);
      setTimeout(() => setScreen("dashboard"), 1200);
    } else {
      setProfileError(result.error || "Failed to save. Please try again.");
    }
    setProfileSaving(false);
  };

  // ─── OTP Screen Component (inline) ────────────────────
  const renderOtpScreen = () => {
    const title = "Verify Your Number";
    const subtitle = `OTP sent to ${formatDisplayPhone(phone)}`;

    return (
      <div className="flex min-h-screen flex-col bg-neutral-900">
        {/* Header */}
        <div className="w-full px-6 pt-8 pb-2 text-center">
          <Image
            src="/images/celsius-wordmark.png"
            alt="Celsius Coffee"
            width={180}
            height={40}
            className="mx-auto h-10 w-auto invert"
            priority
          />
        </div>

        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <div className="mx-auto w-full max-w-sm text-center">
            {/* Shield icon */}
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[#C2452D]/20">
              <ShieldCheck className="h-8 w-8 text-[#C2452D]" />
            </div>

            <h2 className="text-2xl font-bold text-white font-serif">{title}</h2>
            <p className="mt-2 text-sm text-neutral-500">{subtitle}</p>

            {/* OTP Input Boxes */}
            <div className="mt-8 flex items-center justify-center gap-2.5">
              {otpDigits.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => {
                    otpInputRefs.current[index] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  maxLength={index === 0 ? 6 : 1}
                  value={digit}
                  onChange={(e) => handleOtpChange(index, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(index, e)}
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
                    if (pasted.length > 1) {
                      e.preventDefault();
                      handleOtpChange(0, pasted);
                    }
                  }}
                  className="h-14 w-12 rounded-xl bg-neutral-800 text-center text-2xl font-bold font-sans text-white outline-none ring-1 ring-neutral-700 transition-all focus:ring-2 focus:ring-[#C2452D]"
                />
              ))}
            </div>

            {/* OTP Error */}
            {otpError && (
              <p className="mt-3 text-center text-sm font-medium text-red-500">{otpError}</p>
            )}

            {/* Verify Button */}
            <button
              onClick={() => handleOtpSubmit()}
              disabled={otpDigits.some((d) => !d) || loading}
              className={cn(
                "mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-lg font-bold transition-all active:scale-[0.98]",
                otpDigits.every((d) => d)
                  ? "bg-[#C2452D] text-white shadow-lg shadow-[#C2452D]/30 hover:bg-[#A33822]"
                  : "cursor-not-allowed bg-neutral-800 text-neutral-600"
              )}
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <ShieldCheck className="h-5 w-5" />
                  Verify
                </>
              )}
            </button>

            {/* Resend Timer */}
            <div className="mt-5 text-sm">
              {otpTimer > 0 ? (
                <span className="text-neutral-500">Resend OTP in {otpTimer}s</span>
              ) : (
                <span className="text-neutral-400">
                  Didn&apos;t receive?{" "}
                  <button
                    onClick={handleResendOtp}
                    className="font-semibold text-[#C2452D] hover:underline"
                  >
                    Resend OTP
                  </button>
                </span>
              )}
            </div>

            {/* Back link */}
            <button
              onClick={() => {
                resetOtp();
                setScreen("phone");
              }}
              className="mt-6 flex items-center justify-center gap-1 text-sm text-neutral-600 hover:text-neutral-400 transition-colors mx-auto"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Change number
            </button>
          </div>
        </div>

        <p className="pb-5 text-center text-xs text-neutral-700">
          Powered by Celsius Loyalty
        </p>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════
  // SCREEN 1: PHONE ENTRY
  // ═══════════════════════════════════════════════════════
  if (screen === "phone") {
    return (
      <div className="flex min-h-screen flex-col bg-neutral-900">
        {/* Header */}
        <div className="w-full px-6 pt-8 pb-2 text-center">
          <Image
            src="/images/celsius-wordmark.png"
            alt="Celsius Coffee"
            width={180}
            height={40}
            className="mx-auto h-10 w-auto invert"
            priority
          />
          <p className="mt-3 text-sm text-neutral-500">
            Check your points &amp; redeem rewards
          </p>
        </div>

        {/* Phone Display */}
        <div className="w-full px-6 py-5">
          <div className="mx-auto max-w-sm text-center font-sans">
            <span
              className={cn(
                "text-4xl font-bold tracking-wider",
                phone.length > 0 ? "text-white" : "text-neutral-600"
              )}
            >
              {phone.length > 0 ? formatDisplayPhone(phone) : "01X-XXX XXXX"}
            </span>
            {phone.length > 0 && phone.length < 10 && (
              <p className="mt-2 text-xs text-neutral-600">Enter at least 10 digits</p>
            )}
          </div>
        </div>

        {/* Keypad */}
        <div className="flex flex-1 flex-col items-center px-4 pb-6">
          <div className="mx-auto w-full max-w-sm">
            <div className="grid grid-cols-3 gap-2.5">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                <button
                  key={digit}
                  onClick={() => handleDigit(digit)}
                  className="flex h-[68px] items-center justify-center rounded-2xl bg-neutral-800 text-2xl font-bold font-sans text-white transition-all hover:bg-neutral-700 active:scale-95 active:bg-neutral-600"
                >
                  {digit}
                </button>
              ))}
              <button
                onClick={handleBackspace}
                className="flex h-[68px] items-center justify-center rounded-2xl bg-neutral-800 text-neutral-400 transition-all hover:bg-neutral-700 active:scale-95"
              >
                <Delete className="h-6 w-6" />
              </button>
              <button
                onClick={() => handleDigit("0")}
                className="flex h-[68px] items-center justify-center rounded-2xl bg-neutral-800 text-2xl font-bold font-sans text-white transition-all hover:bg-neutral-700 active:scale-95 active:bg-neutral-600"
              >
                0
              </button>
              <button
                onClick={handleClear}
                className="flex h-[68px] items-center justify-center rounded-2xl bg-neutral-800 text-sm font-semibold text-neutral-500 transition-all hover:bg-neutral-700 active:scale-95"
              >
                Clear
              </button>
            </div>

            <button
              onClick={handleLookup}
              disabled={!isValidPhone || loading}
              className={cn(
                "mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-lg font-bold transition-all active:scale-[0.98]",
                isValidPhone
                  ? "bg-[#C2452D] text-white shadow-lg shadow-[#C2452D]/30 hover:bg-[#A33822]"
                  : "cursor-not-allowed bg-neutral-800 text-neutral-600"
              )}
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  Check My Points
                  <ArrowRight className="h-5 w-5" />
                </>
              )}
            </button>
          </div>
        </div>

        <p className="pb-5 text-center text-xs text-neutral-700">
          Powered by Celsius Loyalty
        </p>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // SCREEN 2: OTP VERIFICATION (Login)
  // ═══════════════════════════════════════════════════════
  if (screen === "otp") {
    return renderOtpScreen();
  }

  // ═══════════════════════════════════════════════════════
  // SCREEN 3: EDIT PROFILE
  // ═══════════════════════════════════════════════════════
  if (screen === "profile") {
    return (
      <div className="flex min-h-screen flex-col bg-neutral-900">
        {/* Header */}
        <div className="w-full px-6 pt-8 pb-2 text-center">
          <Image
            src="/images/celsius-wordmark.png"
            alt="Celsius Coffee"
            width={180}
            height={40}
            className="mx-auto h-10 w-auto invert"
            priority
          />
        </div>

        <div className="flex flex-1 flex-col items-center px-6 pt-6">
          <div className="mx-auto w-full max-w-sm">
            {/* Back button */}
            <button
              onClick={() => setScreen("dashboard")}
              className="mb-6 flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to dashboard
            </button>

            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[#C2452D]/20">
              <User className="h-8 w-8 text-[#C2452D]" />
            </div>

            <h2 className="text-center text-2xl font-bold text-white font-serif">
              Edit Profile
            </h2>
            <p className="mt-1 text-center text-sm text-neutral-500">
              Update your personal details
            </p>

            {/* Form */}
            <div className="mt-8 space-y-4">
              {/* Name */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-neutral-400">
                  Name
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-600" />
                  <input
                    type="text"
                    placeholder="Your name"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    className="h-12 w-full rounded-xl bg-neutral-800 pl-11 pr-4 text-white placeholder:text-neutral-600 outline-none ring-1 ring-neutral-700 transition-all focus:ring-2 focus:ring-[#C2452D]"
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-neutral-400">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-600" />
                  <input
                    type="email"
                    placeholder="your@email.com"
                    value={profileEmail}
                    onChange={(e) => setProfileEmail(e.target.value)}
                    className="h-12 w-full rounded-xl bg-neutral-800 pl-11 pr-4 text-white placeholder:text-neutral-600 outline-none ring-1 ring-neutral-700 transition-all focus:ring-2 focus:ring-[#C2452D]"
                  />
                </div>
              </div>

              {/* Birthday */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-neutral-400">
                  Birthday
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-600" />
                  <input
                    type="date"
                    value={profileBirthday}
                    onChange={(e) => setProfileBirthday(e.target.value)}
                    className="h-12 w-full rounded-xl bg-neutral-800 pl-11 pr-4 text-white placeholder:text-neutral-600 outline-none ring-1 ring-neutral-700 transition-all focus:ring-2 focus:ring-[#C2452D] [color-scheme:dark]"
                  />
                </div>
              </div>
            </div>

            {/* Error */}
            {profileError && (
              <p className="mt-3 text-center text-sm font-medium text-red-500">
                {profileError}
              </p>
            )}

            {/* Success */}
            {profileSuccess && (
              <div className="mt-3 flex items-center justify-center gap-1.5 text-sm font-medium text-green-400">
                <Check className="h-4 w-4" />
                Profile updated!
              </div>
            )}

            {/* Save Button */}
            <button
              onClick={handleProfileSave}
              disabled={profileSaving || profileSuccess}
              className={cn(
                "mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-lg font-bold transition-all active:scale-[0.98]",
                profileSuccess
                  ? "bg-green-600 text-white"
                  : "bg-[#C2452D] text-white shadow-lg shadow-[#C2452D]/30 hover:bg-[#A33822]"
              )}
            >
              {profileSaving ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : profileSuccess ? (
                <>
                  <Check className="h-5 w-5" />
                  Saved
                </>
              ) : (
                "Save Changes"
              )}
            </button>
          </div>
        </div>

        <p className="pb-5 text-center text-xs text-neutral-700">
          Powered by Celsius Loyalty
        </p>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // SCREEN 4: DASHBOARD
  // ═══════════════════════════════════════════════════════
  if (screen === "dashboard") {
    if (!member || !memberBrand) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-900 px-6">
          <div className="mx-auto max-w-sm text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-800">
              <Star className="h-8 w-8 text-neutral-500" />
            </div>
            <h2 className="text-xl font-bold text-white">Phone Not Found</h2>
            <p className="mt-2 text-sm text-neutral-500">
              No account found for {formatDisplayPhone(phone)}. Visit any Celsius
              Coffee outlet to register.
            </p>
            <button
              onClick={handleReset}
              className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#C2452D] text-white font-bold hover:bg-[#A33822]"
            >
              <ArrowLeft className="h-4 w-4" />
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-neutral-900">
        {/* Header with points */}
        <div className="px-6 pb-6 pt-6">
          <div className="mx-auto max-w-sm">
            {/* Nav */}
            <div className="flex items-center justify-between">
              <Image
                src="/images/celsius-wordmark.png"
                alt="Celsius Coffee"
                width={108}
                height={24}
                className="h-6 w-auto invert"
              />
              <button
                onClick={() => { if (window.confirm("Log out of your account?")) handleReset(); }}
                className="flex items-center gap-1 text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
              >
                Log out
              </button>
            </div>

            {/* Points Card */}
            <div className="mt-6 rounded-2xl bg-gradient-to-br from-[#C2452D] to-[#8B2E1C] p-6 text-white shadow-xl">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white/70">
                    {member.name || formatDisplayPhone(phone)}
                  </p>
                  <div className="mt-1 flex items-baseline gap-2 font-sans">
                    <span className="text-5xl font-bold">
                      {formatPoints(memberBrand.points_balance)}
                    </span>
                    <span className="text-lg text-white/60">pts</span>
                  </div>
                </div>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15">
                  <Award className="h-7 w-7" />
                </div>
              </div>
              <p className="mt-2 text-xs text-white/50 font-sans">
                RM 1 spent = 1 point earned
              </p>
            </div>

            {/* Edit Profile Button */}
            <button
              onClick={openProfile}
              className="mt-4 flex w-full items-center gap-3 rounded-xl bg-neutral-800 px-4 py-3 text-left transition-colors hover:bg-neutral-700 active:scale-[0.99]"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#C2452D]/15">
                <User className="h-4 w-4 text-[#C2452D]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white">Edit Profile</p>
                <p className="text-xs text-neutral-500">
                  {member.name ? "Update name, email & birthday" : "Add your name & details"}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-neutral-600" />
            </button>

            {/* Stats */}
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-neutral-800 p-3 text-center">
                <p className="text-lg font-bold text-white font-sans">
                  {formatPoints(memberBrand.total_points_earned)}
                </p>
                <p className="text-[10px] text-neutral-500">Earned</p>
              </div>
              <div className="rounded-xl bg-neutral-800 p-3 text-center">
                <p className="text-lg font-bold text-white font-sans">
                  {formatPoints(memberBrand.total_points_redeemed)}
                </p>
                <p className="text-[10px] text-neutral-500">Redeemed</p>
              </div>
              <div className="rounded-xl bg-neutral-800 p-3 text-center">
                <p className="text-lg font-bold text-white font-sans">
                  {memberBrand.total_visits}
                </p>
                <p className="text-[10px] text-neutral-500">Visits</p>
              </div>
            </div>

            {/* Recent Transactions */}
            <div className="mt-6">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Recent Activity
              </h3>
              {transactions.length > 0 ? (
                <div className="space-y-2">
                  {transactions.map((txn) => {
                    return (
                      <div
                        key={txn.id}
                        className="flex items-center justify-between rounded-xl bg-neutral-800 px-4 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              "flex h-8 w-8 items-center justify-center rounded-full",
                              txn.type === "earn"
                                ? "bg-green-500/15 text-green-400"
                                : txn.type === "redeem"
                                ? "bg-orange-500/15 text-orange-400"
                                : "bg-blue-500/15 text-blue-400"
                            )}
                          >
                            {txn.type === "earn" ? (
                              <TrendingUp className="h-3.5 w-3.5" />
                            ) : txn.type === "redeem" ? (
                              <Gift className="h-3.5 w-3.5" />
                            ) : (
                              <Star className="h-3.5 w-3.5" />
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-white">
                              {txn.description}
                            </p>
                            <p className="text-xs text-neutral-500">
                              {getTimeAgo(txn.created_at)}
                            </p>
                          </div>
                        </div>
                        <span
                          className={cn(
                            "text-sm font-bold font-sans",
                            txn.points > 0 ? "text-green-400" : "text-orange-400"
                          )}
                        >
                          {txn.points > 0 ? "+" : ""}
                          {txn.points}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-neutral-600">
                  No transactions yet
                </p>
              )}
            </div>

            <p className="mt-6 pb-4 text-center text-xs text-neutral-700">
              Powered by Celsius Loyalty
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

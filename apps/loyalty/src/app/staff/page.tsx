"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Delete,
  Star,
  CheckCircle2,
  ArrowRight,
  RotateCcw,
  Info,
  Loader2,
  MapPin,
  ChevronDown,
  Zap,
  Gift,
  Coffee,
  ShieldCheck,
  Lock,
  LogOut,
} from "lucide-react";
import { fetchOutlets, fetchMemberByPhone, createMember, awardPoints, verifyStaffPin, fetchRewards, redeemReward } from "@/lib/api";
import { cn, formatPoints, toStoragePhone } from "@/lib/utils";
import type { Outlet, Reward } from "@/types";

type Screen = "login" | "phone" | "welcome" | "detecting" | "staff" | "success";
type DetectStatus = "loading" | "found" | "not_found" | "error";
type PortalMode = "award" | "redeem";
type RedeemStep = "phone" | "otp" | "rewards" | "confirmed";

interface StoreHubMatch {
  amount: number;
  items_summary: string;
  points: number;
  receipt_id?: string;
}

export default function PortalPage() {
  const [screen, setScreen] = useState<Screen>("login");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [staffName, setStaffName] = useState("");
  const [loginOutletOpen, setLoginOutletOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [memberName, setMemberName] = useState("");
  const [pointsBalance, setPointsBalance] = useState(0);
  const [isNewMember, setIsNewMember] = useState(false);
  const [amountDigits, setAmountDigits] = useState("");
  const [awardedPoints, setAwardedPoints] = useState(0);
  const [loading, setLoading] = useState(false);
  const [outletId, setOutletId] = useState("");
  const [showOutletPicker, setShowOutletPicker] = useState(false);
  const [detectStatus, setDetectStatus] = useState<DetectStatus>("loading");
  const [storeHubMatch, setStoreHubMatch] = useState<StoreHubMatch | null>(null);
  const [autoDetected, setAutoDetected] = useState(false);
  const [showSuccessAnim, setShowSuccessAnim] = useState(false);
  const [mode, setMode] = useState<PortalMode>("award");
  const currentMode: PortalMode = mode; // non-narrowed reference for UI rendering
  // ─── Redeem mode state ───
  const [redeemStep, setRedeemStep] = useState<RedeemStep>("phone");
  const [redeemPhone, setRedeemPhone] = useState("");
  const [redeemOtp, setRedeemOtp] = useState<string[]>(["", "", "", "", "", ""]);
  const [redeemOtpSending, setRedeemOtpSending] = useState(false);
  const [redeemOtpError, setRedeemOtpError] = useState("");
  const [redeemMember, setRedeemMember] = useState<{ id: string; name: string; phone: string; points_balance: number } | null>(null);
  const [redeemRewards, setRedeemRewards] = useState<Reward[]>([]);
  const [redeemConfirmedReward, setRedeemConfirmedReward] = useState<Reward | null>(null);
  const [redeemConfirmedCode, setRedeemConfirmedCode] = useState("");
  const [redeemConfirmingId, setRedeemConfirmingId] = useState<string | null>(null);
  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [memberId, setMemberId] = useState("");
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [pinLength, setPinLength] = useState<number | null>(null);
  const welcomeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const brand = { id: "brand-celsius", name: "Celsius Coffee", points_per_rm: 1 };
  const currentOutlet = outlets.find((o) => o.id === outletId) || outlets[0];

  useEffect(() => {
    fetchOutlets().then((data) => {
      setOutlets(data);
      setOutletId((prev) => prev || (data.length > 0 ? data[0].id : ''));
    });
    fetch("/api/settings/system").then((r) => r.json()).then((data) => setPinLength(data.pinLength === 6 ? 6 : 4)).catch(() => setPinLength(4));
  }, []);
  const isValidPhone = phone.length >= 10;

  // ─── Phone keypad handlers ─────────────────────────────
  const handleDigit = useCallback((digit: string) => {
    setPhone((prev) => (prev.length < 12 ? prev + digit : prev));
  }, []);

  const handleBackspace = useCallback(() => {
    setPhone((prev) => prev.slice(0, -1));
  }, []);

  const handleClear = useCallback(() => {
    setPhone("");
  }, []);

  // ─── Redeem mode handlers ───────────────────────────
  const handleRedeemPhoneDigit = useCallback((digit: string) => {
    setRedeemPhone((prev) => (prev.length < 12 ? prev + digit : prev));
  }, []);

  const handleRedeemPhoneBackspace = useCallback(() => {
    setRedeemPhone((prev) => prev.slice(0, -1));
  }, []);

  const handleRedeemPhoneClear = useCallback(() => {
    setRedeemPhone("");
  }, []);

  const handleRedeemSendOtp = async () => {
    if (redeemPhone.length < 10) return;
    setRedeemOtpSending(true);
    setRedeemOtpError("");
    const fullPhone = toStoragePhone(redeemPhone);

    try {
      // Check if member exists first
      const memberData = await fetchMemberByPhone(fullPhone);
      if (!memberData) {
        setRedeemOtpError("No member found with this number");
        setRedeemOtpSending(false);
        return;
      }
      setRedeemMember({
        id: memberData.id,
        name: memberData.name || formatDisplayPhone(redeemPhone),
        phone: fullPhone,
        points_balance: memberData.brand_data?.points_balance ?? 0,
      });

      // Send OTP
      const res = await fetch("/api/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: fullPhone, purpose: "redeem" }),
      });
      const data = await res.json();
      if (data.success) {
        setRedeemStep("otp");
      } else {
        setRedeemOtpError(data.error || "Failed to send OTP");
      }
    } catch {
      setRedeemOtpError("Network error");
    } finally {
      setRedeemOtpSending(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) value = value.slice(-1);
    if (value && !/^[0-9]$/.test(value)) return;
    const next = [...redeemOtp];
    next[index] = value;
    setRedeemOtp(next);
    if (value && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
    // Auto-submit when all 6 digits entered
    if (value && index === 5 && next.every((c) => c.length === 1)) {
      handleOtpVerify(next.join(""));
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !redeemOtp[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpVerify = async (codeOverride?: string) => {
    const code = codeOverride || redeemOtp.join("");
    if (code.length < 6) return;
    setLoading(true);
    setRedeemOtpError("");
    try {
      const res = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: redeemMember?.phone, code, purpose: "redeem" }),
      });
      const data = await res.json();
      if (data.success) {
        // Load rewards catalog
        const rewards = await fetchRewards();
        setRedeemRewards(rewards);
        // Re-fetch member to get latest points
        const memberData = await fetchMemberByPhone(redeemMember?.phone || "");
        if (memberData) {
          setRedeemMember({
            id: memberData.id,
            name: memberData.name || formatDisplayPhone(redeemPhone),
            phone: redeemMember?.phone || "",
            points_balance: memberData.brand_data?.points_balance ?? 0,
          });
        }
        setRedeemStep("rewards");
      } else {
        setRedeemOtpError("Invalid or expired code");
      }
    } catch {
      setRedeemOtpError("Verification failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRedeemReward = async (reward: Reward) => {
    if (!redeemMember) return;
    if (redeemMember.points_balance < reward.points_required) return;
    setRedeemConfirmingId(reward.id);
    try {
      const result = await redeemReward({
        member_id: redeemMember.id,
        reward_id: reward.id,
        outlet_id: outletId,
        staff_redeem: true,
      });
      if (result.success) {
        setRedeemConfirmedReward(reward);
        setRedeemConfirmedCode(result.code || "");
        setRedeemMember((prev) => prev ? { ...prev, points_balance: prev.points_balance - reward.points_required } : null);
        setRedeemStep("confirmed");
      } else {
        alert(result.error || "Redemption failed");
      }
    } catch {
      alert("Network error");
    } finally {
      setRedeemConfirmingId(null);
    }
  };

  const handleRedeemReset = () => {
    setRedeemStep("phone");
    setRedeemPhone("");
    setRedeemOtp(["", "", "", "", "", ""]);
    setRedeemOtpError("");
    setRedeemMember(null);
    setRedeemRewards([]);
    setRedeemConfirmedReward(null);
    setRedeemConfirmedCode("");
    setRedeemConfirmingId(null);
  };

  const handleRedeemAnother = () => {
    // Go back to rewards list (already verified)
    setRedeemConfirmedReward(null);
    setRedeemConfirmedCode("");
    setRedeemStep("rewards");
    // Re-fetch rewards and member points
    fetchRewards().then(setRedeemRewards);
    if (redeemMember) {
      fetchMemberByPhone(redeemMember.phone).then((memberData) => {
        if (memberData) {
          setRedeemMember((prev) => prev ? {
            ...prev,
            points_balance: memberData.brand_data?.points_balance ?? 0,
          } : null);
        }
      });
    }
  };

  const handleModeSwitch = (newMode: PortalMode) => {
    setMode(newMode);
    handleRedeemReset();
  };

  const formatDisplayPhone = (digits: string) => {
    if (digits.length === 0) return "";
    // Format: 013-903 0412
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)} ${digits.slice(6)}`;
  };

  /** Format for international display: strips leading 0 → 13-903 0412, so +60 13-903 0412 */
  const formatInternationalPhone = (digits: string) => {
    const d = digits.startsWith("0") ? digits.slice(1) : digits;
    if (d.length === 0) return "";
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}-${d.slice(2)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 5)} ${d.slice(5)}`;
  };

  // ─── Amount keypad handlers ────────────────────────────
  const handleAmountDigit = useCallback((digit: string) => {
    setAmountDigits((prev) => {
      if (digit === "." && prev.includes(".")) return prev;
      const decIdx = prev.indexOf(".");
      if (decIdx !== -1 && prev.length - decIdx > 2 && digit !== ".") return prev;
      if (prev.length >= 10) return prev;
      return prev + digit;
    });
  }, []);

  const handleAmountBackspace = useCallback(() => {
    setAmountDigits((prev) => prev.slice(0, -1));
  }, []);

  const formatAmountDisplay = (digits: string): string => {
    if (digits.length === 0) return "0.00";
    if (digits.includes(".")) {
      const [whole, dec] = digits.split(".");
      return `${whole || "0"}.${dec || ""}`;
    }
    return digits;
  };

  const parsedAmount = amountDigits ? parseFloat(amountDigits) : 0;
  const calculatedPoints = parsedAmount ? Math.floor(parsedAmount * (brand.points_per_rm || 1)) : 0;

  // ─── PIN login handlers ─────────────────────────────────
  const handlePinDigit = useCallback((digit: string) => {
    setPin((prev) => (prev.length < (pinLength ?? 6) ? prev + digit : prev));
    setPinError("");
  }, [pinLength]);

  const handlePinBackspace = useCallback(() => {
    setPin((prev) => prev.slice(0, -1));
    setPinError("");
  }, []);

  const handlePinClear = useCallback(() => {
    setPin("");
    setPinError("");
  }, []);

  const handleLogin = async () => {
    if (pin.length !== (pinLength ?? 6)) {
      setPinError(`Enter your ${pinLength ?? 6}-digit PIN`);
      return;
    }
    setLoading(true);
    const result = await verifyStaffPin(outletId, pin);
    setLoading(false);
    if (result.success) {
      setStaffName(result.staff_name || "Staff");
      setScreen("phone");
    } else {
      setPinError("Invalid PIN");
    }
  };

  const handleLogout = () => {
    setScreen("login");
    setPin("");
    setPinError("");
    setStaffName("");
    setPhone("");
    setMemberName("");
    setPointsBalance(0);
    setIsNewMember(false);
    setAmountDigits("");
    setAwardedPoints(0);
    setAutoDetected(false);
    setStoreHubMatch(null);
    setDetectStatus("loading");
    setShowSuccessAnim(false);
    setMode("award");
    handleRedeemReset();
    setMemberId("");
  };

  // ─── Screen transitions ────────────────────────────────
  const handleContinue = async () => {
    setLoading(true);
    const fullPhone = toStoragePhone(phone);

    try {
      const memberData = await fetchMemberByPhone(fullPhone);
      if (memberData) {
        setMemberName(memberData.name || formatDisplayPhone(phone));
        setPointsBalance(memberData.brand_data?.points_balance ?? 0);
        setIsNewMember(false);
        setMemberId(memberData.id);
      } else {
        const newMember = await createMember({ phone: fullPhone, outlet_id: outletId });
        if (!newMember?.id) {
          setLoading(false);
          alert("Failed to register member. Please try again.");
          return;
        }
        setMemberName(formatDisplayPhone(phone));
        setPointsBalance(newMember.brand_data?.points_balance ?? 0);
        setIsNewMember(true);
        setMemberId(newMember.id);
      }
      setLoading(false);
      setScreen("welcome");
      welcomeTimerRef.current = setTimeout(() => setScreen("detecting"), 3000);
    } catch {
      setLoading(false);
      setPhone("");
      alert("Failed to look up member. Please try again.");
    }
  };

  const handleSkipToStaff = () => {
    if (welcomeTimerRef.current) clearTimeout(welcomeTimerRef.current);
    setScreen("detecting");
  };

  useEffect(() => {
    return () => {
      if (welcomeTimerRef.current) clearTimeout(welcomeTimerRef.current);
    };
  }, []);

  // ─── StoreHub auto-detect ──────────────────────────────
  useEffect(() => {
    if (screen !== "detecting") return;
    setDetectStatus("loading");
    setStoreHubMatch(null);

    const controller = new AbortController();
    fetch("/api/storehub/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outlet_id: outletId }),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("API error");
        return res.json();
      })
      .then((data) => {
        if (data.success) {
          setStoreHubMatch({
            amount: data.amount,
            items_summary: data.items_summary,
            points: data.points,
            receipt_id: data.receipt_id,
          });
          setDetectStatus("found");
        } else {
          setDetectStatus("not_found");
        }
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        console.error("StoreHub match error:", err);
        setDetectStatus("error");
      });

    return () => controller.abort();
  }, [screen, outletId]);

  const handleConfirmAutoDetect = async () => {
    if (!storeHubMatch) return;
    setLoading(true);
    setAutoDetected(true);
    const result = await awardPoints({
      member_id: memberId,
      outlet_id: outletId,
      points: storeHubMatch.points,
      description: `Purchase - RM ${storeHubMatch.amount.toFixed(2)}`,
      amount: storeHubMatch.amount,
      multiplier: 1,
    });
    setLoading(false);
    if (result.success) {
      setAwardedPoints(storeHubMatch.points);
      setAmountDigits(storeHubMatch.amount.toFixed(2));
      setShowSuccessAnim(true);
      setScreen("success");
    } else {
      alert(result.error || "Failed to award points. Please try again.");
    }
  };

  const handleFallbackToManual = () => {
    setAutoDetected(false);
    setScreen("staff");
  };

  const handleAwardPoints = async () => {
    if (!parsedAmount || parsedAmount <= 0) return;
    setLoading(true);
    const result = await awardPoints({
      member_id: memberId,
      outlet_id: outletId,
      points: calculatedPoints,
      description: `Purchase - RM ${parsedAmount.toFixed(2)}`,
      amount: parsedAmount,
      multiplier: 1,
    });
    setLoading(false);
    if (result.success) {
      setAwardedPoints(calculatedPoints);
      setShowSuccessAnim(true);
      setScreen("success");
    } else {
      alert(result.error || "Failed to award points. Please try again.");
    }
  };

  const handleNextCustomer = () => {
    setScreen("phone");
    setPhone("");
    setMemberName("");
    setPointsBalance(0);
    setIsNewMember(false);
    setAmountDigits("");
    setAwardedPoints(0);
    setAutoDetected(false);
    setStoreHubMatch(null);
    setDetectStatus("loading");
    setShowSuccessAnim(false);
    setMode("award");
    handleRedeemReset();
    setMemberId("");
  };

  // Success animation trigger
  useEffect(() => {
    if (screen === "success" && showSuccessAnim) {
      const t = setTimeout(() => setShowSuccessAnim(false), 600);
      return () => clearTimeout(t);
    }
  }, [screen, showSuccessAnim]);

  // ═══════════════════════════════════════════════════════
  // SCREEN 0: PIN LOGIN
  // ═══════════════════════════════════════════════════════
  if (screen === "login") {
    return (
      <div className="portal-fixed flex flex-col bg-neutral-900 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <div className="flex flex-1 flex-col items-center justify-center px-6 pt-16">
          <div className="w-full max-w-sm">
            {/* Logo */}
            <div className="mb-8 text-center">
              <img
                src="/images/celsius-wordmark.png"
                alt="Celsius Coffee"
                className="mx-auto h-10 invert"
              />
              <p className="mt-2 text-sm text-neutral-500">Staff Login</p>
            </div>

            {/* Outlet Selector */}
            <div className="mb-6 relative">
              <button
                onClick={() => setLoginOutletOpen(!loginOutletOpen)}
                className="flex w-full items-center justify-between rounded-2xl bg-neutral-800 px-5 py-4 text-left transition-colors hover:bg-neutral-750"
              >
                <div className="flex items-center gap-3">
                  <MapPin className="h-5 w-5 text-[#C2452D]" />
                  <div>
                    <p className="text-xs text-neutral-500">Outlet</p>
                    <p className="text-sm font-medium text-white">{currentOutlet?.name}</p>
                  </div>
                </div>
                <ChevronDown className={cn("h-4 w-4 text-neutral-500 transition-transform", loginOutletOpen && "rotate-180")} />
              </button>
              {loginOutletOpen && (
                <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-800 shadow-2xl">
                  {outlets.map((outlet) => (
                    <button
                      key={outlet.id}
                      onClick={() => {
                        setOutletId(outlet.id);
                        setLoginOutletOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 px-5 py-3 text-left text-sm transition-colors",
                        outlet.id === outletId
                          ? "bg-[#C2452D]/10 text-[#C2452D] font-medium"
                          : "text-neutral-300 hover:bg-neutral-700"
                      )}
                    >
                      <MapPin className="h-4 w-4 flex-shrink-0" />
                      {outlet.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* PIN Display */}
            <div className="mb-6 text-center">
              <div className="flex items-center justify-center gap-3">
                {pinLength !== null && Array.from({ length: pinLength }).map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-4 w-4 rounded-full transition-all",
                      pin.length > i
                        ? "bg-[#C2452D] scale-110"
                        : "bg-neutral-700"
                    )}
                  />
                ))}
              </div>
              {pinError && (
                <p className="mt-3 text-sm text-red-400">{pinError}</p>
              )}
            </div>

            {/* PIN Keypad */}
            <div className="grid grid-cols-3 gap-2.5">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                <button
                  key={digit}
                  onClick={() => handlePinDigit(digit)}
                  className="flex h-[68px] items-center justify-center rounded-2xl bg-neutral-800 text-2xl font-bold text-white font-sans transition-all hover:bg-neutral-700 active:scale-95 active:bg-neutral-600"
                >
                  {digit}
                </button>
              ))}
              <button
                onClick={handlePinBackspace}
                className="flex h-[68px] items-center justify-center rounded-2xl bg-neutral-800 text-neutral-400 transition-all hover:bg-neutral-700 active:scale-95"
              >
                <Delete className="h-6 w-6" />
              </button>
              <button
                onClick={() => handlePinDigit("0")}
                className="flex h-[68px] items-center justify-center rounded-2xl bg-neutral-800 text-2xl font-bold text-white font-sans transition-all hover:bg-neutral-700 active:scale-95 active:bg-neutral-600"
              >
                0
              </button>
              <button
                onClick={handlePinClear}
                className="flex h-[68px] items-center justify-center rounded-2xl bg-neutral-800 text-sm font-semibold text-neutral-500 transition-all hover:bg-neutral-700 active:scale-95"
              >
                Clear
              </button>
            </div>

            {/* Login Button */}
            <button
              onClick={handleLogin}
              disabled={pin.length !== (pinLength ?? 6) || loading}
              className={cn(
                "mt-4 flex h-16 w-full items-center justify-center gap-2 rounded-2xl text-xl font-bold transition-all active:scale-[0.98]",
                pin.length === (pinLength ?? 6)
                  ? "bg-[#C2452D] text-white shadow-lg shadow-[#C2452D]/30 hover:bg-[#A33822]"
                  : "cursor-not-allowed bg-neutral-800 text-neutral-600"
              )}
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <Lock className="h-5 w-5" />
                  Login
                </>
              )}
            </button>
          </div>
        </div>

        <div className="pb-4 text-center">
          <p className="text-[10px] text-neutral-800 tracking-wide">Powered by Celsius Loyalty</p>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // SCREEN 1: PHONE ENTRY
  // ═══════════════════════════════════════════════════════
  if (screen === "phone") {
    return (
      <div className="portal-fixed flex flex-col bg-neutral-900 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        {/* Logo */}
        <div className="w-full bg-neutral-900 px-6 pt-14 pb-3">
          <div className="mx-auto max-w-md text-center">
            <img
              src="/images/celsius-wordmark.png"
              alt="Celsius Coffee"
              className="mx-auto h-10 invert"
            />
          </div>
        </div>

        {/* Location, staff & logout */}
        <div className="w-full bg-neutral-900 px-6 pb-2">
          <div className="mx-auto max-w-md flex items-center justify-center gap-2 text-xs font-medium text-neutral-500">
            <MapPin className="h-3 w-3 text-[#C2452D]" />
            <span>{currentOutlet?.name}</span>
            <span className="text-neutral-700">·</span>
            <span>{staffName || "Staff"}</span>
            <span className="text-neutral-700">·</span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-neutral-500 hover:text-white transition-colors"
              title="Logout"
            >
              <LogOut className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* ── Award Points mode (existing phone entry) ── */}
        {mode === "award" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5">
            {/* Mode Toggle */}
            <div className="w-full">
              <div className="mx-auto max-w-md">
                <div className="flex rounded-2xl bg-neutral-800/70 p-1">
                  <button
                    onClick={() => handleModeSwitch("award")}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200",
                      currentMode === "award"
                        ? "bg-[#C2452D] text-white shadow-lg shadow-[#C2452D]/20"
                        : "text-neutral-500 hover:text-neutral-300"
                    )}
                  >
                    <Star className="h-4 w-4" />
                    Award Points
                  </button>
                  <button
                    onClick={() => handleModeSwitch("redeem")}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200",
                      currentMode === "redeem"
                        ? "bg-[#C2452D] text-white shadow-lg shadow-[#C2452D]/20"
                        : "text-neutral-500 hover:text-neutral-300"
                    )}
                  >
                    <Gift className="h-4 w-4" />
                    Redeem Rewards
                  </button>
                </div>
              </div>
            </div>

            {/* Phone Display */}
            <div className="w-full">
              <div className="mx-auto max-w-md text-center">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.15em] text-neutral-600">
                  Customer phone number
                </p>
                <div className="font-sans">
                  <span
                    className={cn(
                      "text-4xl font-bold tracking-wide transition-colors duration-150",
                      phone.length > 0 ? "text-white" : "text-neutral-700"
                    )}
                  >
                    {phone.length > 0 ? formatDisplayPhone(phone) : "01X-XXXX XXXX"}
                  </span>
                </div>
                {phone.length > 0 && phone.length < 10 && (
                  <p className="mt-1 text-[11px] text-neutral-600">Enter at least 10 digits</p>
                )}
              </div>
            </div>

            {/* Keypad */}
            <div className="mx-auto w-full max-w-md">
              <div className="grid grid-cols-3 gap-2">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                  <button
                    key={digit}
                    onClick={() => handleDigit(digit)}
                    className="flex h-[68px] items-center justify-center rounded-2xl bg-neutral-800/80 border border-neutral-700/30 text-2xl font-bold text-white font-sans transition-all duration-100 hover:bg-neutral-700 active:scale-[0.96] active:bg-neutral-600"
                  >
                    {digit}
                  </button>
                ))}
                <button
                  onClick={handleBackspace}
                  className="flex h-[68px] items-center justify-center rounded-2xl bg-neutral-800/50 border border-neutral-700/20 text-neutral-400 transition-all duration-100 hover:bg-neutral-700 active:scale-[0.96] active:bg-neutral-600"
                >
                  <Delete className="h-6 w-6" />
                </button>
                <button
                  onClick={() => handleDigit("0")}
                  className="flex h-[68px] items-center justify-center rounded-2xl bg-neutral-800/80 border border-neutral-700/30 text-2xl font-bold text-white font-sans transition-all duration-100 hover:bg-neutral-700 active:scale-[0.96] active:bg-neutral-600"
                >
                  0
                </button>
                <button
                  onClick={handleClear}
                  className="flex h-[68px] items-center justify-center rounded-2xl bg-neutral-800/50 border border-neutral-700/20 text-xs font-semibold uppercase tracking-wide text-neutral-500 transition-all duration-100 hover:bg-neutral-700 active:scale-[0.96] active:bg-neutral-600"
                >
                  Clear
                </button>
              </div>

              {/* Continue Button */}
              <button
                onClick={handleContinue}
                disabled={!isValidPhone || loading}
                className={cn(
                  "mt-2 flex h-14 w-full items-center justify-center gap-3 rounded-2xl text-lg font-bold transition-all duration-200 active:scale-[0.98]",
                  isValidPhone
                    ? "bg-[#C2452D] text-white shadow-lg shadow-[#C2452D]/25 hover:bg-[#A33822]"
                    : "cursor-not-allowed bg-neutral-800/40 text-neutral-700 border border-neutral-800"
                )}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Looking up...
                  </span>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="h-5 w-5" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── Redeem Rewards mode ── */}
        {mode === "redeem" && (
          <div className="flex flex-1 flex-col bg-neutral-900">
            {/* Step 1: Phone Entry */}
            {redeemStep === "phone" && (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5">
                {/* Mode Toggle */}
                <div className="w-full">
                  <div className="mx-auto max-w-md">
                    <div className="flex rounded-2xl bg-neutral-800/70 p-1">
                      <button
                        onClick={() => handleModeSwitch("award")}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 text-neutral-500 hover:text-neutral-300"
                      >
                        <Star className="h-4 w-4" />
                        Award Points
                      </button>
                      <button
                        onClick={() => handleModeSwitch("redeem")}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 bg-[#C2452D] text-white shadow-lg shadow-[#C2452D]/20"
                      >
                        <Gift className="h-4 w-4" />
                        Redeem Rewards
                      </button>
                    </div>
                  </div>
                </div>

                <div className="w-full">
                  <div className="mx-auto max-w-md text-center">
                    <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.15em] text-neutral-600">
                      Customer phone number
                    </p>
                    <div className="font-sans">
                      <span
                        className={cn(
                          "text-4xl font-bold tracking-wide transition-colors duration-150",
                          redeemPhone.length > 0 ? "text-white" : "text-neutral-700"
                        )}
                      >
                        {redeemPhone.length > 0 ? formatDisplayPhone(redeemPhone) : "01X-XXXX XXXX"}
                      </span>
                    </div>
                    {redeemOtpError && (
                      <p className="mt-1.5 text-sm text-red-400 font-medium">{redeemOtpError}</p>
                    )}
                    {redeemPhone.length > 0 && redeemPhone.length < 10 && (
                      <p className="mt-1 text-[11px] text-neutral-600">Enter at least 10 digits</p>
                    )}
                  </div>
                </div>

                <div className="mx-auto w-full max-w-md">
                  <div className="grid grid-cols-3 gap-2">
                    {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                      <button
                        key={digit}
                        onClick={() => handleRedeemPhoneDigit(digit)}
                        className="flex h-[68px] items-center justify-center rounded-2xl bg-neutral-800/80 border border-neutral-700/30 text-2xl font-bold text-white font-sans transition-all duration-100 hover:bg-neutral-700 active:scale-[0.96] active:bg-neutral-600"
                      >
                        {digit}
                      </button>
                    ))}
                    <button
                      onClick={handleRedeemPhoneBackspace}
                      className="flex h-[68px] items-center justify-center rounded-2xl bg-neutral-800/50 border border-neutral-700/20 text-neutral-400 transition-all duration-100 hover:bg-neutral-700 active:scale-[0.96] active:bg-neutral-600"
                    >
                      <Delete className="h-6 w-6" />
                    </button>
                    <button
                      onClick={() => handleRedeemPhoneDigit("0")}
                      className="flex h-[68px] items-center justify-center rounded-2xl bg-neutral-800/80 border border-neutral-700/30 text-2xl font-bold text-white font-sans transition-all duration-100 hover:bg-neutral-700 active:scale-[0.96] active:bg-neutral-600"
                    >
                      0
                    </button>
                    <button
                      onClick={handleRedeemPhoneClear}
                      className="flex h-[68px] items-center justify-center rounded-2xl bg-neutral-800/50 border border-neutral-700/20 text-xs font-semibold uppercase tracking-wide text-neutral-500 transition-all duration-100 hover:bg-neutral-700 active:scale-[0.96] active:bg-neutral-600"
                    >
                      Clear
                    </button>
                  </div>

                  <button
                    onClick={handleRedeemSendOtp}
                    disabled={redeemPhone.length < 10 || redeemOtpSending}
                    className={cn(
                      "mt-2 flex h-14 w-full items-center justify-center gap-3 rounded-2xl text-lg font-bold transition-all duration-200 active:scale-[0.98]",
                      redeemPhone.length >= 10
                        ? "bg-[#C2452D] text-white shadow-lg shadow-[#C2452D]/25 hover:bg-[#A33822]"
                        : "cursor-not-allowed bg-neutral-800/40 text-neutral-700 border border-neutral-800"
                    )}
                  >
                    {redeemOtpSending ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Sending OTP...
                      </span>
                    ) : (
                      <>
                        Send OTP
                        <ArrowRight className="h-5 w-5" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: OTP Verification */}
            {redeemStep === "otp" && (
              <div className="flex flex-1 flex-col items-center px-6 py-6">
                <div className="mx-auto w-full max-w-md">
                  <div className="mb-6 text-center">
                    <Lock className="mx-auto mb-3 h-10 w-10 text-[#C2452D]" />
                    <h2 className="text-2xl font-bold text-white">
                      Enter OTP Code
                    </h2>
                    <p className="mt-1 text-sm text-neutral-500">
                      Ask customer for the 6-digit code sent to their phone
                    </p>
                    <p className="mt-1 text-xs text-neutral-600 font-sans">
                      {formatDisplayPhone(redeemPhone)}
                    </p>
                  </div>

                  {/* OTP Input Boxes */}
                  <div className="mb-4 flex justify-center gap-2">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <input
                        key={i}
                        ref={(el) => { otpInputRefs.current[i] = el; }}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={redeemOtp[i]}
                        onChange={(e) => handleOtpChange(i, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(i, e)}
                        autoFocus={i === 0}
                        className={cn(
                          "h-[64px] w-[48px] rounded-xl bg-neutral-800 text-center text-3xl font-bold text-white caret-[#C2452D] outline-none transition-all font-sans",
                          "border-2 focus:border-[#C2452D] focus:ring-0",
                          redeemOtp[i] ? "border-neutral-600" : "border-neutral-700"
                        )}
                      />
                    ))}
                  </div>

                  {redeemOtpError && (
                    <p className="mb-4 text-center text-sm text-red-400 font-medium">{redeemOtpError}</p>
                  )}

                  <button
                    onClick={() => handleOtpVerify()}
                    disabled={!redeemOtp.every((c) => c.length === 1) || loading}
                    className={cn(
                      "flex h-16 w-full items-center justify-center gap-3 rounded-2xl text-xl font-bold transition-all active:scale-[0.98]",
                      redeemOtp.every((c) => c.length === 1)
                        ? "bg-[#C2452D] text-white shadow-lg shadow-[#C2452D]/30 hover:bg-[#A33822]"
                        : "cursor-not-allowed bg-neutral-800 text-neutral-600"
                    )}
                  >
                    {loading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <ShieldCheck className="h-6 w-6" />
                        Verify
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => { setRedeemStep("phone"); setRedeemOtp(["", "", "", "", "", ""]); setRedeemOtpError(""); }}
                    className="mt-3 flex w-full items-center justify-center gap-2 py-3 text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-400"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Back
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Customer Profile + Rewards Catalog */}
            {redeemStep === "rewards" && redeemMember && (
              <div className="flex flex-1 flex-col px-4 py-4 overflow-y-auto">
                <div className="mx-auto w-full max-w-md">
                  {/* Customer Info Card */}
                  <div className="mb-4 overflow-hidden rounded-2xl bg-neutral-800">
                    <div className="flex items-center gap-4 px-5 py-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#C2452D] text-lg font-bold text-white">
                        {(redeemMember.name || "?").charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <p className="text-lg font-bold text-white">{redeemMember.name}</p>
                        <p className="text-sm text-neutral-400 font-sans">{formatDisplayPhone(redeemPhone)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-[#C2452D] font-sans">{formatPoints(redeemMember.points_balance)}</p>
                        <p className="text-xs text-neutral-500">points</p>
                      </div>
                    </div>
                  </div>

                  {/* Rewards List */}
                  <p className="mb-3 text-sm font-semibold text-neutral-400 uppercase tracking-wider">
                    Available Rewards
                  </p>
                  <div className="space-y-2.5 pb-4">
                    {redeemRewards
                      .filter((r) => r.reward_type === "points_shop" || r.reward_type === "standard")
                      .map((reward) => {
                        const canAfford = redeemMember.points_balance >= reward.points_required;
                        const isConfirming = redeemConfirmingId === reward.id;
                        const outOfStock = reward.stock !== null && reward.stock <= 0;
                        return (
                          <div
                            key={reward.id}
                            className={cn(
                              "overflow-hidden rounded-2xl bg-neutral-800 transition-all",
                              !canAfford && "opacity-50"
                            )}
                          >
                            <div className="flex items-center gap-4 px-5 py-4">
                              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-700">
                                {reward.category === "drink" ? (
                                  <Coffee className="h-5 w-5 text-[#C2452D]" />
                                ) : (
                                  <Gift className="h-5 w-5 text-[#C2452D]" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-white truncate">{reward.name}</p>
                                {reward.description && (
                                  <p className="text-xs text-neutral-500 truncate">{reward.description}</p>
                                )}
                                <p className="mt-0.5 text-sm font-bold text-[#C2452D] font-sans">
                                  {formatPoints(reward.points_required)} pts
                                </p>
                              </div>
                              <button
                                onClick={() => handleRedeemReward(reward)}
                                disabled={!canAfford || isConfirming || outOfStock}
                                className={cn(
                                  "flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-bold transition-all active:scale-95",
                                  canAfford && !outOfStock
                                    ? "bg-[#C2452D] text-white shadow-md shadow-[#C2452D]/30 hover:bg-[#A33822]"
                                    : "bg-neutral-700 text-neutral-500 cursor-not-allowed"
                                )}
                              >
                                {isConfirming ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : outOfStock ? (
                                  "Sold Out"
                                ) : canAfford ? (
                                  "Redeem"
                                ) : (
                                  "Not Enough"
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}

                    {redeemRewards.filter((r) => r.reward_type === "points_shop" || r.reward_type === "standard").length === 0 && (
                      <div className="py-10 text-center">
                        <Gift className="mx-auto mb-3 h-10 w-10 text-neutral-700" />
                        <p className="text-neutral-500">No rewards available</p>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleRedeemReset}
                    className="mt-2 flex w-full items-center justify-center gap-2 py-3 text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-400"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Different Customer
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: Redemption Confirmed */}
            {redeemStep === "confirmed" && redeemConfirmedReward && (
              <div className="flex flex-1 flex-col items-center justify-center px-6 py-6">
                <div className="mx-auto w-full max-w-md text-center">
                  <div className="mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-green-500/20">
                    <CheckCircle2 className="h-14 w-14 text-green-400" />
                  </div>
                  <h2 className="text-3xl font-bold text-white">
                    Redeemed!
                  </h2>
                  <p className="mt-2 text-lg text-neutral-400">
                    {redeemConfirmedReward.name}
                  </p>

                  {/* Details Card */}
                  <div className="mt-6 overflow-hidden rounded-2xl bg-neutral-800 text-left">
                    <div className="border-b border-dashed border-neutral-700 px-6 py-4">
                      <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Customer</p>
                      <p className="mt-1 text-lg font-bold text-white">{redeemMember?.name || "Member"}</p>
                    </div>
                    <div className="border-b border-dashed border-neutral-700 px-6 py-4">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Points Deducted</p>
                        <p className="text-2xl font-bold text-[#C2452D] font-sans">-{formatPoints(redeemConfirmedReward.points_required)}</p>
                      </div>
                    </div>
                    <div className="px-6 py-4">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Remaining Balance</p>
                        <p className="text-2xl font-bold text-white font-sans">{formatPoints(redeemMember?.points_balance ?? 0)}</p>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={handleRedeemAnother}
                    className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#C2452D] text-lg font-bold text-white shadow-lg shadow-[#C2452D]/30 transition-all hover:bg-[#A33822] active:scale-[0.98]"
                  >
                    <Gift className="h-5 w-5" />
                    Redeem Another
                  </button>

                  <button
                    onClick={handleRedeemReset}
                    className="mt-3 flex w-full items-center justify-center gap-2 py-3 text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-400"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="py-2 text-center">
          <p className="text-[10px] text-neutral-800 tracking-wide">Powered by Celsius Loyalty</p>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // SCREEN 2: WELCOME (customer-facing)
  // ═══════════════════════════════════════════════════════
  if (screen === "welcome") {
    return (
      <div className="portal-fixed flex flex-col items-center justify-center bg-neutral-900 px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <div className="w-full max-w-md text-center">
          {/* Animated checkmark */}
          <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-[#C2452D]/15 animate-[scale-in_0.4s_ease-out]">
            <CheckCircle2 className="h-14 w-14 text-[#C2452D]" />
          </div>

          {isNewMember ? (
            <>
              <h1 className="text-4xl font-bold text-white font-serif">
                Welcome!
              </h1>
              <p className="mt-2 text-xl text-neutral-400">
                You&apos;re now a member
              </p>
              <div className="mt-6 inline-flex items-center gap-2.5 rounded-full bg-[#C2452D] px-7 py-3.5 text-white shadow-lg shadow-[#C2452D]/30">
                <Star className="h-5 w-5" />
                <span className="text-xl font-bold font-sans">
                  {formatPoints(pointsBalance)} bonus points
                </span>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-4xl font-bold text-white font-serif">
                Welcome back!
              </h1>
              <p className="mt-2 text-xl text-neutral-400">{memberName}</p>
              <div className="mt-4 inline-flex items-center gap-2.5 rounded-full bg-[#C2452D] px-7 py-3.5 text-white shadow-lg shadow-[#C2452D]/30">
                <Star className="h-5 w-5" />
                <span className="text-xl font-bold font-sans">
                  {formatPoints(pointsBalance)} points
                </span>
              </div>
            </>
          )}

          {/* Hand back notice */}
          <div className="mt-10 rounded-2xl border border-neutral-700 bg-neutral-800 p-5">
            <div className="flex items-center justify-center gap-2 text-neutral-300">
              <Coffee className="h-5 w-5 text-[#C2452D]" />
              <p className="text-base font-medium">
                Please hand the device back to staff
              </p>
            </div>
          </div>

          {/* Loading dots */}
          <div className="mt-6 flex items-center justify-center gap-1.5">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-neutral-600" />
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-neutral-600 [animation-delay:200ms]" />
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-neutral-600 [animation-delay:400ms]" />
          </div>

          <button
            onClick={handleSkipToStaff}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-neutral-800 px-5 py-2.5 text-sm font-medium text-neutral-400 transition-all hover:bg-neutral-700 hover:text-white active:scale-[0.98]"
          >
            Continue
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // SCREEN 2.5: STOREHUB AUTO-DETECT (staff-facing)
  // ═══════════════════════════════════════════════════════
  if (screen === "detecting") {
    return (
      <div className="portal-fixed flex flex-col bg-neutral-900 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        {/* Header */}
        <div className="w-full border-b border-neutral-800 px-6 py-4">
          <div className="mx-auto flex max-w-md items-center justify-between">
            <img
              src="/images/celsius-wordmark.png"
              alt="Celsius Coffee"
              className="h-7 invert"
            />
            <div className="flex items-center gap-1.5 rounded-full bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-400">
              <MapPin className="h-3 w-3 text-[#C2452D]" />
              {currentOutlet?.name}
            </div>
          </div>
        </div>

        {/* Main Card */}
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <div className="w-full max-w-md">
            {/* Customer Info */}
            <div className="mb-5 flex items-center gap-3 rounded-2xl bg-neutral-800 px-5 py-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#C2452D] text-lg font-bold text-white">
                {memberName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="font-medium text-white">{memberName}</p>
                <p className="text-sm text-neutral-500 font-sans">
                  +60 {formatInternationalPhone(phone)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-neutral-500">Balance</p>
                <p className="text-lg font-bold text-white font-sans">
                  {formatPoints(pointsBalance)}
                  <span className="ml-0.5 text-xs font-normal text-neutral-500">pts</span>
                </p>
              </div>
            </div>

            {/* Detection Card */}
            <div className="rounded-2xl bg-neutral-800 p-6">
              {/* Loading */}
              {detectStatus === "loading" && (
                <div className="flex flex-col items-center py-8">
                  <div className="relative">
                    <div className="h-16 w-16 animate-spin rounded-full border-4 border-neutral-700 border-t-[#C2452D]" />
                    <Zap className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-[#C2452D]" />
                  </div>
                  <p className="mt-5 text-lg font-medium text-white">
                    Checking POS...
                  </p>
                  <p className="mt-1 text-sm text-neutral-500">
                    Looking for recent purchase at {currentOutlet?.name}
                  </p>
                </div>
              )}

              {/* Match Found */}
              {detectStatus === "found" && storeHubMatch && (
                <div className="flex flex-col items-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
                    <CheckCircle2 className="h-10 w-10 text-green-400" />
                  </div>
                  <p className="mt-3 text-xl font-bold text-green-400">
                    Purchase detected!
                  </p>

                  <div className="mt-5 w-full space-y-2">
                    <div className="flex items-center justify-between rounded-xl bg-neutral-700/40 px-4 py-3.5">
                      <span className="text-sm text-neutral-400">Amount</span>
                      <span className="text-2xl font-bold text-white font-sans">
                        RM {storeHubMatch.amount.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-neutral-700/40 px-4 py-3.5">
                      <span className="text-sm text-neutral-400">Items</span>
                      <span className="text-sm font-medium text-neutral-300">
                        {storeHubMatch.items_summary}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-[#C2452D]/15 px-4 py-3.5">
                      <span className="text-sm text-neutral-400">
                        Points to earn
                      </span>
                      <span className="text-2xl font-bold text-[#C2452D] font-sans">
                        +{formatPoints(storeHubMatch.points)}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={handleConfirmAutoDetect}
                    disabled={loading}
                    className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#C2452D] text-lg font-bold text-white shadow-lg shadow-[#C2452D]/30 transition-all hover:bg-[#A33822] active:scale-[0.98]"
                  >
                    {loading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle2 className="h-5 w-5" />
                        Confirm &amp; Award Points
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleFallbackToManual}
                    className="mt-3 text-sm font-medium text-neutral-500 underline underline-offset-2 transition-colors hover:text-neutral-300"
                  >
                    Not my purchase
                  </button>
                </div>
              )}

              {/* No Match */}
              {(detectStatus === "not_found" || detectStatus === "error") && (
                <div className="flex flex-col items-center py-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-700/50">
                    <Info className="h-9 w-9 text-neutral-500" />
                  </div>
                  <p className="mt-4 text-lg font-medium text-white">
                    {detectStatus === "error"
                      ? "Could not connect to POS"
                      : "No recent purchase found"}
                  </p>
                  <p className="mt-1 text-sm text-neutral-500">
                    Enter the purchase amount manually
                  </p>

                  <button
                    onClick={handleFallbackToManual}
                    className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#C2452D] text-lg font-bold text-white shadow-lg shadow-[#C2452D]/30 transition-all hover:bg-[#A33822] active:scale-[0.98]"
                  >
                    Enter amount manually
                    <ArrowRight className="h-5 w-5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="pb-4 text-center">
          <p className="text-[10px] text-neutral-800 tracking-wide">Powered by Celsius Loyalty</p>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // SCREEN 3: MANUAL AMOUNT ENTRY (staff fallback)
  // ═══════════════════════════════════════════════════════
  if (screen === "staff") {
    const isAmountValid = parsedAmount > 0;

    return (
      <div className="portal-fixed flex flex-col bg-neutral-900 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        {/* Header */}
        <div className="w-full border-b border-neutral-800 px-5 py-3.5">
          <div className="mx-auto flex max-w-md items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#C2452D] text-sm font-bold text-white">
                {memberName.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium text-white">{memberName}</p>
                <p className="text-xs text-neutral-500 font-sans">
                  +60 {formatInternationalPhone(phone)}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-neutral-500">Balance</p>
              <p className="text-lg font-bold text-white font-sans">
                {formatPoints(pointsBalance)}
                <span className="ml-0.5 text-xs font-normal text-neutral-500">pts</span>
              </p>
            </div>
          </div>
          {isNewMember && (
            <div className="mx-auto mt-3 max-w-md rounded-lg border border-amber-700/30 bg-amber-900/20 px-4 py-2 text-center">
              <p className="text-sm font-medium text-amber-400 font-sans">
                New member registered
              </p>
            </div>
          )}
        </div>

        {/* Amount Entry */}
        <div className="flex flex-1 flex-col items-center px-4 py-4">
          <div className="mx-auto w-full max-w-md">
            {/* Amount Display */}
            <div className="mb-3 rounded-2xl bg-neutral-800 p-5 text-center">
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-500">
                Purchase Amount
              </p>
              <div className="flex items-baseline justify-center gap-1 font-sans">
                <span className="text-xl font-medium text-neutral-500">RM</span>
                <span
                  className={cn(
                    "text-5xl font-bold tracking-tight",
                    amountDigits.length > 0 ? "text-white" : "text-neutral-600"
                  )}
                >
                  {formatAmountDisplay(amountDigits)}
                </span>
              </div>
            </div>

            {/* Points Preview */}
            <div className="mb-3 flex items-center justify-between rounded-xl bg-neutral-800/60 px-4 py-3">
              <span className="text-sm text-neutral-400">Points to award</span>
              <span className="text-xl font-bold text-[#C2452D] font-sans">
                +{formatPoints(calculatedPoints)}
              </span>
            </div>

            {/* Amount Keypad */}
            <div className="grid grid-cols-3 gap-2.5">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                <button
                  key={digit}
                  onClick={() => handleAmountDigit(digit)}
                  className="flex h-[68px] items-center justify-center rounded-2xl bg-neutral-800 text-2xl font-bold text-white font-sans transition-all hover:bg-neutral-700 active:scale-95 active:bg-neutral-600"
                >
                  {digit}
                </button>
              ))}
              <button
                onClick={() => handleAmountDigit(".")}
                className="flex h-[68px] items-center justify-center rounded-2xl bg-neutral-800 text-2xl font-bold text-white font-sans transition-all hover:bg-neutral-700 active:scale-95 active:bg-neutral-600"
              >
                .
              </button>
              <button
                onClick={() => handleAmountDigit("0")}
                className="flex h-[68px] items-center justify-center rounded-2xl bg-neutral-800 text-2xl font-bold text-white font-sans transition-all hover:bg-neutral-700 active:scale-95 active:bg-neutral-600"
              >
                0
              </button>
              <button
                onClick={handleAmountBackspace}
                className="flex h-[68px] items-center justify-center rounded-2xl bg-neutral-800 text-neutral-400 transition-all hover:bg-neutral-700 active:scale-95 active:bg-neutral-600"
              >
                <Delete className="h-6 w-6" />
              </button>
            </div>

            {/* Award Button */}
            <button
              onClick={handleAwardPoints}
              disabled={!isAmountValid || loading}
              className={cn(
                "mt-4 flex h-16 w-full items-center justify-center gap-2 rounded-2xl text-xl font-bold transition-all active:scale-[0.98]",
                isAmountValid
                  ? "bg-[#C2452D] text-white shadow-lg shadow-[#C2452D]/30 hover:bg-[#A33822]"
                  : "cursor-not-allowed bg-neutral-800 text-neutral-600"
              )}
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <Star className="h-6 w-6" />
                  Award Points
                </>
              )}
            </button>

            {/* Cancel */}
            <button
              onClick={handleNextCustomer}
              className="mt-3 flex w-full items-center justify-center gap-2 py-3 text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-400"
            >
              <RotateCcw className="h-4 w-4" />
              Cancel &amp; Start Over
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // SCREEN 4: SUCCESS
  // ═══════════════════════════════════════════════════════
  return (
    <div className="portal-fixed flex flex-col items-center justify-center bg-neutral-900 px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div
        className={cn(
          "w-full max-w-md text-center transition-all duration-500",
          showSuccessAnim ? "scale-95 opacity-0" : "scale-100 opacity-100"
        )}
      >
        {/* Success Icon */}
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-green-500/20">
          <CheckCircle2 className="h-12 w-12 text-green-400" />
        </div>

        <h1 className="text-3xl font-bold text-white font-serif">
          Points Awarded!
        </h1>

        {autoDetected && (
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-green-500/15 px-4 py-1.5 text-sm font-medium text-green-400">
            <Zap className="h-3.5 w-3.5" />
            Auto-detected from POS
          </div>
        )}

        {/* Receipt Card */}
        <div className="mt-6 overflow-hidden rounded-2xl bg-neutral-800">
          {/* Dotted border top like receipt */}
          <div className="border-b border-dashed border-neutral-700 px-6 py-4">
            <p className="text-sm text-neutral-500">Customer</p>
            <p className="text-lg font-bold text-white">{memberName}</p>
            <p className="text-sm text-neutral-500 font-sans">
              +60 {formatInternationalPhone(phone)}
            </p>
          </div>

          <div className="grid grid-cols-2 divide-x divide-neutral-700 border-b border-dashed border-neutral-700">
            <div className="px-6 py-4">
              <p className="text-xs text-neutral-500">Purchase</p>
              <p className="text-2xl font-bold text-white font-sans">
                RM {parsedAmount.toFixed(2)}
              </p>
            </div>
            <div className="px-6 py-4">
              <p className="text-xs text-neutral-500">Points Earned</p>
              <p className="text-2xl font-bold text-[#C2452D] font-sans">
                +{formatPoints(awardedPoints)}
              </p>
            </div>
          </div>

          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-neutral-500">New Balance</p>
              <div className="flex items-center gap-2">
                <Gift className="h-4 w-4 text-[#C2452D]" />
                <p className="text-2xl font-bold text-white font-sans">
                  {formatPoints(pointsBalance + awardedPoints)}
                  <span className="ml-1 text-sm font-normal text-neutral-500">pts</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Next Customer */}
        <button
          onClick={handleNextCustomer}
          className="mt-6 flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-[#C2452D] text-xl font-bold text-white shadow-lg shadow-[#C2452D]/30 transition-all hover:bg-[#A33822] active:scale-[0.98]"
        >
          <RotateCcw className="h-5 w-5" />
          Next Customer
        </button>

        <p className="mt-4 text-xs text-neutral-700">
          Powered by Celsius Loyalty
        </p>
      </div>
    </div>
  );
}

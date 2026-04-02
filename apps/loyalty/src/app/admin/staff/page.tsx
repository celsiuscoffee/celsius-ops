"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Pencil,
  Eye,
  EyeOff,
  RefreshCw,
  Key,
  MapPin,
  Shield,
  X,
  UserCircle,
  MoreHorizontal,
  Users,
  CheckCircle2,
  Store,
  Trash2,
} from "lucide-react";
import { fetchOutlets } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { StaffUser, Outlet } from "@/types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/* outletMap is built dynamically after fetching outlets */

const avatarColors = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-purple-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-indigo-500",
  "bg-teal-500",
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

function generatePin(): string {
  const arr = new Uint32Array(1);
  globalThis.crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000)); // 6-digit PIN
}

/** Demo "last active" labels */
const lastActiveMap: Record<string, string> = {
  "staff-1": "2h ago",
  "staff-2": "1d ago",
  "staff-3": "5h ago",
  "staff-4": "2 weeks ago",
};

/* ------------------------------------------------------------------ */
/*  Types for form                                                     */
/* ------------------------------------------------------------------ */

interface StaffForm {
  name: string;
  email: string;
  phone: string;
  outlet_ids: string[];
  role: "manager" | "staff";
  pin: string;
  is_active: boolean;
}

/* emptyForm is created dynamically using loaded outlets */

/* ------------------------------------------------------------------ */
/*  PIN Input Component                                                */
/* ------------------------------------------------------------------ */

function PinInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const digits = value.padEnd(6, "").split("").slice(0, 6);

  function handleChange(idx: number, char: string) {
    if (char && !/^\d$/.test(char)) return;
    const arr = digits.slice();
    arr[idx] = char;
    onChange(arr.join(""));
    // Auto-focus next
    if (char && idx < 5) {
      const next = document.getElementById(`pin-${idx + 1}`);
      next?.focus();
    }
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      const prev = document.getElementById(`pin-${idx - 1}`);
      prev?.focus();
    }
  }

  return (
    <div className="flex items-center gap-2">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <input
          key={i}
          id={`pin-${i}`}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digits[i] ?? ""}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          className="h-12 w-12 rounded-xl border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700/50 text-center text-lg font-bold text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#C2452D]/40 focus:border-[#C2452D] transition-colors"
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const emptyForm: StaffForm = {
    name: "",
    email: "",
    phone: "",
    outlet_ids: [],
    role: "staff",
    pin: "",
    is_active: true,
  };

  const [form, setForm] = useState<StaffForm>(emptyForm);

  const outletMap = Object.fromEntries(outlets.map((o) => [o.id, o.name]));

  useEffect(() => {
    Promise.all([
      fetch("/api/staff?brand_id=brand-celsius").then((r) => r.json()),
      fetchOutlets(),
    ]).then(([staffData, outletsData]) => {
      setStaff(staffData);
      setOutlets(outletsData);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, []);

  /* PIN visibility per staff row */
  const [visiblePins, setVisiblePins] = useState<Record<string, boolean>>({});

  /* Reset PIN flow */
  const [resetPinId, setResetPinId] = useState<string | null>(null);
  const [newPin, setNewPin] = useState<string | null>(null);
  const [pinCountdown, setPinCountdown] = useState(0);

  /* Actions dropdown */
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; flipUp: boolean }>({ top: 0, left: 0, flipUp: false });

  /* ─── KPI stats ─── */
  const totalStaff = staff.length;
  const activeStaff = staff.filter((s) => s.is_active).length;
  const uniqueOutlets = new Set(staff.flatMap((s) => s.outlet_ids?.length ? s.outlet_ids : s.outlet_id ? [s.outlet_id] : []));
  const totalOutlets = outlets.length;

  /* ─── Handlers ─── */

  function togglePinVisibility(id: string) {
    setVisiblePins((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function openAdd() {
    setEditingId(null);
    setForm(emptyForm);
    setShowModal(true);
  }

  function openEdit(s: StaffUser) {
    setEditingId(s.id);
    setForm({
      name: s.name,
      email: s.email,
      phone: "",
      outlet_ids: s.outlet_ids?.length ? s.outlet_ids : s.outlet_id ? [s.outlet_id] : [],
      role: s.role === "admin" ? "manager" : s.role,
      pin: "",
      is_active: s.is_active,
    });
    setShowModal(true);
    setOpenActionsId(null);
  }

  function handleSave() {
    if (!form.name.trim() || form.outlet_ids.length === 0) return;
    if (editingId) {
      const updated = {
        name: form.name,
        email: form.email,
        outlet_id: form.outlet_ids[0] ?? null,
        outlet_ids: form.outlet_ids,
        role: form.role,
        is_active: form.is_active,
      };
      setStaff((prev) =>
        prev.map((s) =>
          s.id === editingId
            ? { ...s, ...updated }
            : s
        )
      );
      // Persist to backend
      fetch("/api/staff/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staff_id: editingId, ...updated }),
      }).catch((err) => console.error("Staff update failed:", err));
      // Save PIN separately if provided (update route doesn't hash PINs)
      if (form.pin) {
        fetch("/api/staff/reset-pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ staff_id: editingId, new_pin: form.pin }),
        }).catch((err) => console.error("PIN save failed:", err));
      }
    } else {
      const tempPin = form.pin || generatePin();
      const newStaff: StaffUser = {
        id: `staff-${Date.now()}`,
        brand_id: "brand-celsius",
        outlet_id: form.outlet_ids[0] ?? null,
        outlet_ids: form.outlet_ids,
        name: form.name,
        email: form.email,
        role: form.role,
        pin_hash: null, // hashed server-side
        is_active: form.is_active,
        created_at: new Date().toISOString(),
      };

      // Also POST to backend with outlet_ids
      fetch("/api/staff/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand_id: "brand-celsius",
          outlet_ids: form.outlet_ids,
          name: form.name,
          email: form.email,
          role: form.role,
          pin: tempPin,
          is_active: form.is_active,
        }),
      }).catch(() => {});

      setStaff((prev) => [...prev, newStaff]);
    }
    setShowModal(false);
    setEditingId(null);
  }

  async function handleDeleteStaff(id: string) {
    try {
      const res = await fetch(`/api/staff?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setStaff((prev) => prev.filter((s) => s.id !== id));
      }
    } catch (err) {
      // silently fail
    }
    setDeleteConfirm(null);
    setOpenActionsId(null);
  }

  function handleDeactivate(id: string) {
    setStaff((prev) =>
      prev.map((s) => (s.id === id ? { ...s, is_active: !s.is_active } : s))
    );
    setOpenActionsId(null);
  }

  /* Reset PIN with countdown */
  const startResetPin = useCallback(async (id: string) => {
    const pin = generatePin();
    setResetPinId(id);
    setNewPin(pin);
    setPinCountdown(5);
    setOpenActionsId(null);

    try {
      await fetch("/api/staff/reset-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staff_id: id, new_pin: pin }),
      });
    } catch (err) {
      console.error("PIN reset failed:", err);
    }
  }, []);

  useEffect(() => {
    if (pinCountdown <= 0) return;
    const t = setTimeout(() => setPinCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [pinCountdown]);

  useEffect(() => {
    if (pinCountdown === 0 && resetPinId) {
      setResetPinId(null);
      setNewPin(null);
    }
  }, [pinCountdown, resetPinId]);

  /* Close actions dropdown on outside click */
  useEffect(() => {
    function handleClick() {
      setOpenActionsId(null);
      setDeleteConfirm(null);
    }
    if (openActionsId || deleteConfirm) {
      document.addEventListener("click", handleClick);
      return () => document.removeEventListener("click", handleClick);
    }
  }, [openActionsId, deleteConfirm]);

  /* ─── Render ─── */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="h-6 w-6 animate-spin text-[#C2452D]" />
          <p className="text-sm text-gray-400 dark:text-neutral-500">Loading staff...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      {/* ──── Header ──── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Staff Management
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
            Manage POS staff accounts and PIN-based login
          </p>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-2 rounded-xl bg-[#C2452D] hover:bg-[#A93B26] text-white font-semibold px-4 py-2.5 text-sm transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Add Staff
        </button>
      </div>

      {/* ──── KPI Cards ──── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Total Staff */}
        <div className="rounded-2xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-500/10">
              <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-neutral-400">
                Total Staff
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {totalStaff}
              </p>
            </div>
          </div>
        </div>

        {/* Active */}
        <div className="rounded-2xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-500/10">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-neutral-400">
                Active
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {activeStaff}
              </p>
            </div>
          </div>
        </div>

        {/* Outlets Covered */}
        <div className="rounded-2xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-500/10">
              <Store className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-neutral-400">
                Outlets Covered
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {uniqueOutlets.size}/{totalOutlets}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ──── Staff Table ──── */}
      <div className="rounded-2xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-neutral-800 text-left">
                <th className="px-5 py-3.5 font-semibold text-gray-500 dark:text-neutral-400">
                  Name
                </th>
                <th className="px-5 py-3.5 font-semibold text-gray-500 dark:text-neutral-400">
                  Outlet
                </th>
                <th className="px-5 py-3.5 font-semibold text-gray-500 dark:text-neutral-400">
                  Role
                </th>
                <th className="px-5 py-3.5 font-semibold text-gray-500 dark:text-neutral-400">
                  PIN
                </th>
                <th className="px-5 py-3.5 font-semibold text-gray-500 dark:text-neutral-400">
                  Status
                </th>
                <th className="px-5 py-3.5 font-semibold text-gray-500 dark:text-neutral-400">
                  Last Active
                </th>
                <th className="px-5 py-3.5 font-semibold text-gray-500 dark:text-neutral-400 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-neutral-800">
              {staff.map((s) => (
                <tr
                  key={s.id}
                  className="hover:bg-gray-50/50 dark:hover:bg-neutral-800/50 transition-colors"
                >
                  {/* Avatar + Name */}
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "flex h-9 w-9 items-center justify-center rounded-full text-white text-sm font-bold flex-shrink-0",
                          getAvatarColor(s.name)
                        )}
                      >
                        {s.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">
                          {s.name}
                        </p>
                        <p className="text-xs text-gray-400 dark:text-neutral-500">
                          {s.email}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Outlet */}
                  <td className="px-5 py-4">
                    {(() => {
                      const ids = s.outlet_ids?.length ? s.outlet_ids : s.outlet_id ? [s.outlet_id] : [];
                      if (!ids.length) return <span className="text-gray-400 dark:text-neutral-500">—</span>;
                      return (
                        <div className="flex flex-wrap items-center gap-1">
                          {ids.map((oid) => (
                            <span
                              key={oid}
                              className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-neutral-800 px-2 py-0.5 text-xs font-medium text-gray-700 dark:text-neutral-300"
                            >
                              <MapPin className="h-3 w-3 text-gray-400 dark:text-neutral-500" />
                              {outletMap[oid] ?? oid}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </td>

                  {/* Role */}
                  <td className="px-5 py-4">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        s.role === "manager"
                          ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400"
                          : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                      )}
                    >
                      <Shield className="h-3 w-3" />
                      {s.role === "manager" ? "Manager" : "Staff"}
                    </span>
                  </td>

                  {/* PIN */}
                  <td className="px-5 py-4">
                    {resetPinId === s.id && newPin ? (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-[#C2452D]">
                          {newPin}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-neutral-500">
                          ({pinCountdown}s)
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-sm text-gray-600 dark:text-neutral-300">
                          {visiblePins[s.id] ? (s as unknown as { pin?: string }).pin || "••••••" : "••••••"}
                        </span>
                        <button
                          onClick={() => togglePinVisibility(s.id)}
                          className="text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-300 transition-colors"
                        >
                          {visiblePins[s.id] ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-5 py-4">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 text-xs font-semibold",
                        s.is_active
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-gray-400 dark:text-neutral-500"
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          s.is_active
                            ? "bg-emerald-500"
                            : "bg-gray-300 dark:bg-neutral-600"
                        )}
                      />
                      {s.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>

                  {/* Last Active */}
                  <td className="px-5 py-4 text-gray-500 dark:text-neutral-400">
                    {lastActiveMap[s.id] ?? "—"}
                  </td>

                  {/* Actions */}
                  <td className="px-5 py-4 text-right">
                    <div className="relative inline-block">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (openActionsId === s.id) {
                            setOpenActionsId(null);
                          } else {
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            const menuH = 180; // approximate dropdown height
                            const flipUp = rect.bottom + menuH > window.innerHeight;
                            setDropdownPos({
                              top: flipUp ? rect.top : rect.bottom + 4,
                              left: rect.right - 176, // w-44 = 11rem = 176px
                              flipUp,
                            });
                            setOpenActionsId(s.id);
                          }
                        }}
                        className="rounded-lg p-1.5 text-gray-400 dark:text-neutral-500 hover:bg-gray-100 dark:hover:bg-neutral-800 hover:text-gray-600 dark:hover:text-neutral-300 transition-colors"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-gray-100 dark:divide-neutral-800">
          {staff.map((s) => (
            <div key={s.id} className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-full text-white text-sm font-bold",
                      getAvatarColor(s.name)
                    )}
                  >
                    {s.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {s.name}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-neutral-500">
                      {s.email}
                    </p>
                  </div>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 text-xs font-semibold",
                    s.is_active
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-gray-400 dark:text-neutral-500"
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      s.is_active
                        ? "bg-emerald-500"
                        : "bg-gray-300 dark:bg-neutral-600"
                    )}
                  />
                  {s.is_active ? "Active" : "Inactive"}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                {(() => {
                  const ids = s.outlet_ids?.length ? s.outlet_ids : s.outlet_id ? [s.outlet_id] : [];
                  return ids.length ? ids.map((oid) => (
                    <span key={oid} className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-neutral-800 px-2 py-0.5 font-medium text-gray-600 dark:text-neutral-300">
                      <MapPin className="h-3 w-3" />
                      {outletMap[oid] ?? oid}
                    </span>
                  )) : (
                    <span className="flex items-center gap-1 text-gray-500 dark:text-neutral-400">
                      <MapPin className="h-3 w-3" />
                      —
                    </span>
                  );
                })()}
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold",
                    s.role === "manager"
                      ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400"
                      : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                  )}
                >
                  <Shield className="h-3 w-3" />
                  {s.role === "manager" ? "Manager" : "Staff"}
                </span>
                <span className="text-gray-400 dark:text-neutral-500">
                  {lastActiveMap[s.id] ?? "—"}
                </span>
              </div>

              {/* PIN row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 dark:text-neutral-400">
                    PIN:
                  </span>
                  {resetPinId === s.id && newPin ? (
                    <span className="font-mono text-sm font-bold text-[#C2452D]">
                      {newPin}{" "}
                      <span className="text-xs text-gray-400">
                        ({pinCountdown}s)
                      </span>
                    </span>
                  ) : (
                    <>
                      <span className="font-mono text-sm text-gray-600 dark:text-neutral-300">
                        {visiblePins[s.id] ? (s as unknown as { pin?: string }).pin || "••••••" : "••••••"}
                      </span>
                      <button
                        onClick={() => togglePinVisibility(s.id)}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-neutral-300 transition-colors"
                      >
                        {visiblePins[s.id] ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </>
                  )}
                </div>

                {/* Mobile actions */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEdit(s)}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-800 hover:text-gray-600 dark:hover:text-neutral-300 transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => startResetPin(s.id)}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-800 hover:text-gray-600 dark:hover:text-neutral-300 transition-colors"
                  >
                    <Key className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeactivate(s.id)}
                    className={cn(
                      "rounded-lg p-1.5 transition-colors",
                      s.is_active
                        ? "text-gray-400 hover:text-red-500"
                        : "text-gray-400 hover:text-emerald-500"
                    )}
                  >
                    <UserCircle className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Reset PIN confirmation inline */}
              {resetPinId === s.id && newPin && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Staff member will need the new PIN to log in.
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ──── Reset PIN Inline Confirmation ──── */}
      {resetPinId && newPin && (
        <div className="hidden md:block rounded-2xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <Key className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                New PIN generated for{" "}
                {staff.find((s) => s.id === resetPinId)?.name}
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                PIN will be hidden in {pinCountdown}s. Staff member will need
                the new PIN to log in at the POS tablet.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ──── Fixed-position Actions Dropdown ──── */}
      {openActionsId && (() => {
        const s = staff.find((st) => st.id === openActionsId);
        if (!s) return null;
        return (
          <div
            className="fixed z-50 w-44 rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-lg shadow-gray-200/60 dark:shadow-black/40"
            style={{
              top: dropdownPos.flipUp ? undefined : dropdownPos.top,
              bottom: dropdownPos.flipUp ? window.innerHeight - dropdownPos.top + 4 : undefined,
              left: dropdownPos.left,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => openEdit(s)}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors rounded-t-xl"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
            <button
              onClick={() => startResetPin(s.id)}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
            >
              <Key className="h-3.5 w-3.5" />
              Reset PIN
            </button>
            <button
              onClick={() => handleDeactivate(s.id)}
              className={cn(
                "flex w-full items-center gap-2.5 px-4 py-2.5 text-sm transition-colors",
                s.is_active
                  ? "text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10"
                  : "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
              )}
            >
              <UserCircle className="h-3.5 w-3.5" />
              {s.is_active ? "Deactivate" : "Activate"}
            </button>
            <button
              onClick={() => {
                setOpenActionsId(null);
                setDeleteConfirm(s.id);
              }}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors rounded-b-xl"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        );
      })()}

      {/* ──── Fixed-position Delete Confirmation ──── */}
      {deleteConfirm && (
        <div
          className="fixed z-50 w-56 rounded-xl border border-red-200 dark:border-red-900 bg-white dark:bg-neutral-800 shadow-lg p-3"
          style={{
            top: dropdownPos.flipUp ? undefined : dropdownPos.top,
            bottom: dropdownPos.flipUp ? window.innerHeight - dropdownPos.top + 4 : undefined,
            left: dropdownPos.left - 48,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-sm text-gray-700 dark:text-neutral-300 mb-2">Delete this staff member?</p>
          <div className="flex gap-2">
            <button onClick={() => setDeleteConfirm(null)} className="flex-1 rounded-lg bg-gray-100 dark:bg-neutral-700 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-neutral-300">Cancel</button>
            <button onClick={() => handleDeleteStaff(deleteConfirm)} className="flex-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white">Delete</button>
          </div>
        </div>
      )}

      {/* ──── Add / Edit Modal ──── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 dark:bg-black/60"
            onClick={() => {
              setShowModal(false);
              setEditingId(null);
            }}
          />

          {/* Modal */}
          <div className="relative w-full max-w-md rounded-2xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 shadow-2xl max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-neutral-800">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                {editingId ? "Edit Staff" : "Add Staff"}
              </h2>
              <button
                onClick={() => {
                  setShowModal(false);
                  setEditingId(null);
                }}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-800 hover:text-gray-600 dark:hover:text-neutral-300 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Form */}
            <div className="px-6 py-5 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-neutral-400 mb-1.5">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="e.g. Faizal Rahman"
                  className="w-full rounded-xl border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700/50 px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#C2452D]/40 focus:border-[#C2452D] transition-colors"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-neutral-400 mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, email: e.target.value }))
                  }
                  placeholder="e.g. faizal@celsius.my"
                  className="w-full rounded-xl border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700/50 px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#C2452D]/40 focus:border-[#C2452D] transition-colors"
                />
              </div>

              {/* Phone */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-neutral-400 mb-1.5">
                  Phone
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, phone: e.target.value }))
                  }
                  placeholder="e.g. 012-345 6789"
                  className="w-full rounded-xl border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700/50 px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#C2452D]/40 focus:border-[#C2452D] transition-colors"
                />
              </div>

              {/* Outlets (multi-select) */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-neutral-400 mb-1.5">
                  Outlets <span className="font-normal text-gray-400 dark:text-neutral-500">(select one or more)</span>
                </label>
                <div className="max-h-44 overflow-y-auto rounded-xl border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700/50 divide-y divide-gray-100 dark:divide-neutral-600/50">
                  {outlets.map((o) => {
                    const checked = form.outlet_ids.includes(o.id);
                    return (
                      <label
                        key={o.id}
                        className={cn(
                          "flex items-center gap-3 px-4 py-2.5 cursor-pointer text-sm transition-colors",
                          checked
                            ? "bg-[#C2452D]/5 dark:bg-[#C2452D]/10"
                            : "hover:bg-gray-50 dark:hover:bg-neutral-700/50"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setForm((f) => ({
                              ...f,
                              outlet_ids: checked
                                ? f.outlet_ids.filter((id) => id !== o.id)
                                : [...f.outlet_ids, o.id],
                            }))
                          }
                          className="h-4 w-4 rounded border-gray-300 dark:border-neutral-600 text-[#C2452D] focus:ring-[#C2452D]/40 accent-[#C2452D]"
                        />
                        <span className={cn(
                          "text-gray-900 dark:text-white",
                          checked && "font-medium"
                        )}>
                          {o.name}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {form.outlet_ids.length === 0 && (
                  <p className="text-xs text-amber-500 mt-1">Please select at least one outlet</p>
                )}
              </div>

              {/* Role */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-neutral-400 mb-1.5">
                  Role
                </label>
                <select
                  value={form.role}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      role: e.target.value as "manager" | "staff",
                    }))
                  }
                  className="w-full rounded-xl border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700/50 px-4 py-2.5 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#C2452D]/40 focus:border-[#C2452D] transition-colors"
                >
                  <option value="staff">Staff</option>
                  <option value="manager">Manager</option>
                </select>
              </div>

              {/* PIN */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-neutral-400 mb-1.5">
                  PIN (6 digits)
                </label>
                <div className="flex flex-col gap-2">
                  <PinInput
                    value={form.pin}
                    onChange={(v) => setForm((f) => ({ ...f, pin: v }))}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => ({ ...f, pin: generatePin() }))
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 dark:border-neutral-600 bg-gray-50 dark:bg-neutral-800 px-3 py-2.5 text-xs font-semibold text-gray-600 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors whitespace-nowrap self-start"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Generate Random PIN
                  </button>
                </div>
              </div>

              {/* Status */}
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-gray-600 dark:text-neutral-400">
                  Status
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setForm((f) => ({ ...f, is_active: !f.is_active }))
                  }
                  className={cn(
                    "relative h-6 w-11 rounded-full transition-colors",
                    form.is_active
                      ? "bg-emerald-500"
                      : "bg-gray-300 dark:bg-neutral-600"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                      form.is_active && "translate-x-5"
                    )}
                  />
                </button>
              </div>
              <p className="text-xs text-gray-400 dark:text-neutral-500 -mt-2">
                {form.is_active ? "Active" : "Inactive"} — staff{" "}
                {form.is_active ? "can" : "cannot"} log in to the POS tablet
              </p>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-neutral-800">
              <button
                onClick={() => {
                  setShowModal(false);
                  setEditingId(null);
                }}
                className="rounded-xl border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-4 py-2.5 text-sm font-semibold text-gray-600 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!form.name.trim() || form.outlet_ids.length === 0}
                className="rounded-xl bg-[#C2452D] hover:bg-[#A93B26] disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2.5 text-sm font-semibold transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

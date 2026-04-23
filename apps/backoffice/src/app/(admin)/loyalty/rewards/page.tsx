"use client";

import { useState, useEffect } from "react";
import {
  Plus,
  X,
  Coffee,
  Cake,
  Tag,
  ShoppingBag,
  Pencil,
  Trash2,
  Link,
  Download,
} from "lucide-react";
import { fetchRewards } from "@/lib/loyalty/api";
import type { Reward } from "@/lib/loyalty/types";
import { formatPoints } from "@/lib/loyalty/utils";
import { cn } from "@/lib/utils";
import { exportToCSV } from "@/lib/loyalty/export";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const categoryIcons: Record<string, React.ElementType> = {
  drink: Coffee,
  food: Cake,
  voucher: Tag,
  merch: ShoppingBag,
};

const categoryColors: Record<string, string> = {
  drink: "bg-blue-50 text-blue-700",
  food: "bg-orange-50 text-orange-700",
  voucher: "bg-purple-50 text-purple-700",
  merch: "bg-emerald-50 text-emerald-700",
};

type RewardType = "standard" | "new_member" | "points_shop";

const rewardTypeLabels: Record<RewardType, string> = {
  standard: "Standard",
  new_member: "New Member Reward",
  points_shop: "Points Shop",
};

const rewardTypeBadgeColors: Record<RewardType, string> = {
  standard: "",
  new_member:
    "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  points_shop:
    "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

const rewardTypeBadgeLabels: Record<RewardType, string> = {
  standard: "",
  new_member: "New Member",
  points_shop: "Points Shop",
};

type TabKey = "all" | "new_member" | "points_shop";

const tabs: { key: TabKey; label: string }[] = [
  { key: "all", label: "All Rewards" },
  { key: "new_member", label: "New Member" },
  { key: "points_shop", label: "Points Shop" },
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function RewardsPage() {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [saving, setSaving] = useState(false);

  // Modal form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategory, setFormCategory] = useState("drink");
  const [formPoints, setFormPoints] = useState<number | "">("");
  const [formStock, setFormStock] = useState<number | "">("");
  const [formImageUrl, setFormImageUrl] = useState("");
  const [formRewardType, setFormRewardType] = useState<RewardType>("standard");
  const [formAutoIssue, setFormAutoIssue] = useState(false);
  const [formValidityDays, setFormValidityDays] = useState<number | "">("");
  // Pickup app discount fields
  const [formDiscountType, setFormDiscountType] = useState<string>("");
  const [formDiscountValue, setFormDiscountValue] = useState<number | "">("");
  const [formMaxDiscountValue, setFormMaxDiscountValue] = useState<number | "">("");
  const [formMinOrderValue, setFormMinOrderValue] = useState<number | "">("");
  const [formFreeProductName, setFormFreeProductName] = useState("");
  const [formApplicableCategories, setFormApplicableCategories] = useState("");
  const [formFulfillmentType, setFormFulfillmentType] = useState<string[]>([]);
  const [formBogoBuyQty, setFormBogoBuyQty] = useState<number | "">(1);
  const [formBogoFreeQty, setFormBogoFreeQty] = useState<number | "">(1);
  // Load rewards from API on mount
  useEffect(() => {
    fetchRewards().then((data) => {
      setRewards(data);
      setLoading(false);
    });
  }, []);

  const filteredRewards =
    activeTab === "all"
      ? rewards
      : rewards.filter((r) => r.reward_type === activeTab);

  function resetForm() {
    setFormName("");
    setFormDescription("");
    setFormCategory("drink");
    setFormPoints("");
    setFormStock("");
    setFormImageUrl("");
    setFormRewardType("standard");
    setFormAutoIssue(false);
    setFormValidityDays("");
    setFormDiscountType("");
    setFormDiscountValue("");
    setFormMaxDiscountValue("");
    setFormMinOrderValue("");
    setFormFreeProductName("");
    setFormApplicableCategories("");
    setFormFulfillmentType([]);
    setFormBogoBuyQty(1);
    setFormBogoFreeQty(1);
  }

  function populateForm(reward: Reward) {
    setFormName(reward.name);
    setFormDescription(reward.description ?? "");
    setFormCategory(reward.category);
    setFormPoints(reward.points_required);
    setFormStock(reward.stock ?? "");
    setFormImageUrl(reward.image_url ?? "");
    setFormRewardType((reward.reward_type || "standard") as RewardType);
    setFormAutoIssue(reward.auto_issue ?? false);
    setFormValidityDays(reward.validity_days ?? "");
    setFormDiscountType(reward.discount_type ?? "");
    setFormDiscountValue(reward.discount_value ?? "");
    setFormMaxDiscountValue(reward.max_discount_value ?? "");
    setFormMinOrderValue(reward.min_order_value ?? "");
    setFormFreeProductName(reward.free_product_name ?? "");
    setFormApplicableCategories((reward.applicable_categories ?? []).join(", "));
    setFormFulfillmentType(reward.fulfillment_type ?? []);
    setFormBogoBuyQty(reward.bogo_buy_qty ?? 1);
    setFormBogoFreeQty(reward.bogo_free_qty ?? 1);
  }

  async function handleToggleActive(id: string) {
    const reward = rewards.find((r) => r.id === id);
    if (!reward) return;
    await fetch("/api/loyalty/rewards", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, is_active: !reward.is_active }),
    });
    setRewards((prev) =>
      prev.map((r) => (r.id === id ? { ...r, is_active: !r.is_active } : r))
    );
  }

  function handleEdit(id: string) {
    const reward = rewards.find((r) => r.id === id);
    if (reward) populateForm(reward);
    setEditingId(id);
    setShowModal(true);
  }

  function handleCreate() {
    resetForm();
    setEditingId(null);
    setShowModal(true);
  }

  async function handleDelete(id: string) {
    await fetch(`/api/loyalty/rewards?id=${id}`, { method: "DELETE" });
    setRewards((prev) => prev.filter((r) => r.id !== id));
  }

  function handleCloseModal() {
    setShowModal(false);
    setEditingId(null);
  }

  async function handleSave() {
    setSaving(true);
    try {
      // Parse applicable_categories from comma-separated string
      const parsedCategories = formApplicableCategories
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const payload: Record<string, unknown> = {
        name: formName,
        description: formDescription || null,
        category: formCategory,
        points_required: typeof formPoints === "number" ? formPoints : 0,
        stock: typeof formStock === "number" ? formStock : null,
        image_url: formImageUrl || null,
        reward_type: formRewardType,
        auto_issue:
          formRewardType === "new_member"
            ? formAutoIssue
            : false,
        validity_days:
          typeof formValidityDays === "number" ? formValidityDays : null,
        // Pickup app discount fields
        discount_type: formDiscountType || null,
        discount_value: typeof formDiscountValue === "number" ? formDiscountValue : null,
        max_discount_value: typeof formMaxDiscountValue === "number" ? formMaxDiscountValue : null,
        min_order_value: typeof formMinOrderValue === "number" ? formMinOrderValue : null,
        free_product_name: formFreeProductName || null,
        applicable_categories: parsedCategories.length > 0 ? parsedCategories : null,
        fulfillment_type: formFulfillmentType.length > 0 ? formFulfillmentType : null,
        bogo_buy_qty: formDiscountType === "bogo" && typeof formBogoBuyQty === "number" ? formBogoBuyQty : null,
        bogo_free_qty: formDiscountType === "bogo" && typeof formBogoFreeQty === "number" ? formBogoFreeQty : null,
      };

      if (editingId) {
        // Edit
        const res = await fetch("/api/loyalty/rewards", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingId, ...payload }),
        });
        if (res.ok) {
          const updated = await res.json();
          setRewards((prev) =>
            prev.map((r) =>
              r.id === editingId ? { ...r, ...updated, ...payload } : r
            )
          );
        }
      } else {
        // Create
        const res = await fetch("/api/loyalty/rewards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const created = await res.json();
          setRewards((prev) => [...prev, created]);
        }
      }
      handleCloseModal();
    } finally {
      setSaving(false);
    }
  }

  // When reward type changes, auto-set auto_issue for birthday/new_member
  function handleRewardTypeChange(type: RewardType) {
    setFormRewardType(type);
    if (type === "new_member") {
      setFormAutoIssue(true);
    } else {
      setFormAutoIssue(false);
    }
  }

  const editing = editingId
    ? rewards.find((r) => r.id === editingId) ?? null
    : null;

  if (loading) {
    return (
      <div className="p-6 space-y-6 pb-20 md:pb-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Rewards
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
            Manage your offers catalog
          </p>
        </div>
        <div className="flex items-center justify-center py-20 text-gray-400 dark:text-neutral-500">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-6 pb-20 md:pb-0">
      {/* ---- Header ---- */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Rewards
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
            Manage your offers catalog
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const today = new Date().toISOString().split("T")[0];
              const rows = rewards.map((r) => ({
                name: r.name,
                category: r.category,
                reward_type: r.reward_type ?? "standard",
                points_required: r.points_required,
                stock: r.stock !== null ? r.stock : "Unlimited",
                status: r.is_active ? "Active" : "Inactive",
                description: r.description ?? "",
              }));
              exportToCSV(
                rows,
                [
                  { key: "name", label: "Reward Name" },
                  { key: "category", label: "Category" },
                  { key: "reward_type", label: "Reward Type" },
                  { key: "points_required", label: "Points Required" },
                  { key: "stock", label: "Stock" },
                  { key: "status", label: "Status" },
                  { key: "description", label: "Description" },
                ],
                `celsius-rewards-${today}`
              );
            }}
            className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2.5 text-sm text-gray-600 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-700 inline-flex items-center gap-1.5"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
          <button
            onClick={handleCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-[#C2452D] px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#A33822] transition-colors"
          >
            <Plus className="h-4 w-4" />
            Create new
          </button>
        </div>
      </div>

      {/* ---- Tabs ---- */}
      <div className="flex gap-1 rounded-lg border border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-800/50 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              activeTab === tab.key
                ? "bg-white dark:bg-neutral-700 text-gray-900 dark:text-white shadow-sm"
                : "text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-300"
            )}
          >
            {tab.label}
            <span
              className={cn(
                "ml-1.5 inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                activeTab === tab.key
                  ? "bg-[#C2452D]/10 text-[#C2452D]"
                  : "bg-gray-200 dark:bg-neutral-600 text-gray-500 dark:text-neutral-400"
              )}
            >
              {tab.key === "all"
                ? rewards.length
                : rewards.filter((r) => r.reward_type === tab.key).length}
            </span>
          </button>
        ))}
      </div>

      {/* ---- Table ---- */}
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800">
        {/* Desktop table */}
        <div className="hidden md:block">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-neutral-700 bg-gray-50/60 dark:bg-neutral-800">
                <th className="py-3 pl-5 pr-3 font-medium text-gray-500 dark:text-neutral-400">
                  Reward
                </th>
                <th className="px-3 py-3 font-medium text-gray-500 dark:text-neutral-400">
                  Category
                </th>
                <th className="px-3 py-3 font-medium text-gray-500 dark:text-neutral-400 text-right">
                  Points
                </th>
                <th className="px-3 py-3 font-medium text-gray-500 dark:text-neutral-400 text-right">
                  Stock
                </th>
                <th className="px-3 py-3 font-medium text-gray-500 dark:text-neutral-400 text-center">
                  Status
                </th>
                <th className="py-3 pl-3 pr-5 font-medium text-gray-500 dark:text-neutral-400 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-neutral-700/50">
              {filteredRewards.map((reward) => {
                const CategoryIcon =
                  categoryIcons[reward.category] ?? Tag;
                const rType = (reward.reward_type ?? "standard") as RewardType;
                return (
                  <tr
                    key={reward.id}
                    className="group hover:bg-gray-50/50 dark:hover:bg-neutral-700/50 transition-colors"
                  >
                    {/* Reward name + description + type badge */}
                    <td className="py-3.5 pl-5 pr-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                            categoryColors[reward.category] ??
                              "bg-gray-100 text-gray-600"
                          )}
                        >
                          <CategoryIcon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-gray-900 dark:text-white truncate">
                              {reward.name}
                            </p>
                            {rType !== "standard" && (
                              <span
                                className={cn(
                                  "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                  rewardTypeBadgeColors[rType]
                                )}
                              >
                                {rewardTypeBadgeLabels[rType]}
                              </span>
                            )}
                          </div>
                          {reward.description && (
                            <p className="text-xs text-gray-400 dark:text-neutral-500 truncate max-w-[260px]">
                              {reward.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Category badge */}
                    <td className="px-3 py-3.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
                          categoryColors[reward.category] ??
                            "bg-gray-100 text-gray-600"
                        )}
                      >
                        {reward.category}
                      </span>
                    </td>

                    {/* Points */}
                    <td className="px-3 py-3.5 text-right font-sans font-semibold text-gray-900 dark:text-white tabular-nums">
                      {formatPoints(reward.points_required)}
                    </td>

                    {/* Stock */}
                    <td className="px-3 py-3.5 text-right font-sans tabular-nums text-gray-500 dark:text-neutral-400">
                      {reward.stock !== null ? (
                        reward.stock
                      ) : (
                        <span className="text-gray-300 dark:text-neutral-600">
                          &infin;
                        </span>
                      )}
                    </td>

                    {/* Status toggle */}
                    <td className="px-3 py-3.5">
                      <div className="flex justify-center">
                        <button
                          onClick={() => handleToggleActive(reward.id)}
                          className={cn(
                            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
                            reward.is_active
                              ? "bg-green-500"
                              : "bg-gray-200 dark:bg-neutral-600"
                          )}
                        >
                          <span
                            className={cn(
                              "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
                              reward.is_active
                                ? "translate-x-[18px]"
                                : "translate-x-[3px]"
                            )}
                          />
                        </button>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 pl-3 pr-5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleEdit(reward.id)}
                          className="rounded-lg p-1.5 text-gray-400 dark:text-neutral-500 hover:bg-gray-100 dark:hover:bg-neutral-700 hover:text-gray-600 dark:hover:text-neutral-300 transition-colors"
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(reward.id)}
                          className="rounded-lg p-1.5 text-gray-400 dark:text-neutral-500 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile list */}
        <div className="divide-y divide-gray-100 dark:divide-neutral-700/50 md:hidden">
          {filteredRewards.map((reward) => {
            const CategoryIcon = categoryIcons[reward.category] ?? Tag;
            const rType = (reward.reward_type ?? "standard") as RewardType;
            return (
              <div
                key={reward.id}
                className="flex items-center gap-3 px-4 py-3.5"
              >
                {/* Icon */}
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                    categoryColors[reward.category] ??
                      "bg-gray-100 text-gray-600"
                  )}
                >
                  <CategoryIcon className="h-4 w-4" />
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900 dark:text-white truncate">
                      {reward.name}
                    </p>
                    {rType !== "standard" && (
                      <span
                        className={cn(
                          "inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                          rewardTypeBadgeColors[rType]
                        )}
                      >
                        {rewardTypeBadgeLabels[rType]}
                      </span>
                    )}
                    <span
                      className={cn(
                        "inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                        reward.is_active
                          ? "bg-green-50 text-green-700"
                          : "bg-gray-100 dark:bg-neutral-700 text-gray-500 dark:text-neutral-400"
                      )}
                    >
                      {reward.is_active ? "Active" : "Off"}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-400 dark:text-neutral-500">
                    <span className="font-sans font-semibold text-gray-900 dark:text-white tabular-nums">
                      {formatPoints(reward.points_required)} pts
                    </span>
                    <span>&middot;</span>
                    <span className="capitalize">{reward.category}</span>
                    {reward.stock !== null && (
                      <>
                        <span>&middot;</span>
                        <span className="font-sans tabular-nums">
                          {reward.stock} left
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => handleEdit(reward.id)}
                    className="rounded-lg p-1.5 text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-300"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(reward.id)}
                    className="rounded-lg p-1.5 text-gray-400 dark:text-neutral-500 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Empty state */}
        {filteredRewards.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Tag className="h-10 w-10 text-gray-200 dark:text-neutral-600" />
            <p className="mt-3 text-sm font-medium text-gray-900 dark:text-white">
              {activeTab === "all"
                ? "No rewards yet"
                : `No ${tabs.find((t) => t.key === activeTab)?.label ?? ""} rewards`}
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-neutral-500">
              Create your first reward to get started.
            </p>
          </div>
        )}
      </div>

      {/* ---- Create / Edit Modal ---- */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseModal();
          }}
        >
          <div className="w-full max-w-lg rounded-xl bg-white dark:bg-neutral-800 shadow-xl animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-neutral-700 px-6 py-4 shrink-0">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {editing ? "Edit Reward" : "Create New Reward"}
              </h2>
              <button
                onClick={handleCloseModal}
                className="rounded-lg p-1.5 text-gray-400 dark:text-neutral-500 hover:bg-gray-100 dark:hover:bg-neutral-700 hover:text-gray-600 dark:hover:text-neutral-300 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal body */}
            <div className="space-y-4 px-6 py-5 overflow-y-auto">
              {/* Name */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                  Name
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Free Cappuccino"
                  className="w-full rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-3.5 py-2.5 text-sm text-gray-900 dark:text-neutral-200 placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                />
              </div>

              {/* Description */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Short description of the reward"
                  className="w-full rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-3.5 py-2.5 text-sm text-gray-900 dark:text-neutral-200 placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D] resize-none"
                />
              </div>

              {/* Reward Type */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                  Reward Type
                </label>
                <select
                  value={formRewardType}
                  onChange={(e) =>
                    handleRewardTypeChange(e.target.value as RewardType)
                  }
                  className="w-full rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-3.5 py-2.5 text-sm text-gray-900 dark:text-neutral-200 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                >
                  {(
                    Object.entries(rewardTypeLabels) as [
                      RewardType,
                      string,
                    ][]
                  ).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Conditional fields based on reward type */}
              {formRewardType === "new_member" && (
                <div className="rounded-lg border border-green-200 dark:border-green-800/40 bg-green-50/50 dark:bg-green-900/10 p-4">
                  <p className="text-xs text-green-700 dark:text-green-400">
                    This reward is automatically issued when a new member
                    joins
                  </p>
                </div>
              )}

              {formRewardType === "points_shop" && (
                <div className="rounded-lg border border-blue-200 dark:border-blue-800/40 bg-blue-50/50 dark:bg-blue-900/10 p-4">
                  <p className="text-xs text-blue-700 dark:text-blue-400">
                    Members can exchange points for this reward in the
                    Points Shop
                  </p>
                </div>
              )}

              {/* Category + Points */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                    Category
                  </label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-3.5 py-2.5 text-sm text-gray-900 dark:text-neutral-200 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                  >
                    <option value="drink">Drink</option>
                    <option value="food">Food</option>
                    <option value="voucher">Voucher</option>
                    <option value="merch">Merch</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                    Points required
                  </label>
                  <input
                    type="number"
                    value={formPoints}
                    onChange={(e) =>
                      setFormPoints(
                        e.target.value === ""
                          ? ""
                          : Number(e.target.value)
                      )
                    }
                    placeholder="500"
                    className="w-full rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-3.5 py-2.5 text-sm font-sans text-gray-900 dark:text-neutral-200 placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                  />
                </div>
              </div>

              {/* Stock + Image URL */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                    Stock
                    <span className="ml-1 font-normal text-gray-400 dark:text-neutral-500">
                      (optional)
                    </span>
                  </label>
                  <input
                    type="number"
                    value={formStock}
                    onChange={(e) =>
                      setFormStock(
                        e.target.value === ""
                          ? ""
                          : Number(e.target.value)
                      )
                    }
                    placeholder="Unlimited"
                    className="w-full rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-3.5 py-2.5 text-sm font-sans text-gray-900 dark:text-neutral-200 placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                    Image URL
                    <span className="ml-1 font-normal text-gray-400 dark:text-neutral-500">
                      (optional)
                    </span>
                  </label>
                  <div className="relative">
                    <Link className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300 dark:text-neutral-600" />
                    <input
                      type="url"
                      value={formImageUrl}
                      onChange={(e) => setFormImageUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 pl-9 pr-3.5 py-2.5 text-sm text-gray-900 dark:text-neutral-200 placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                    />
                  </div>
                </div>
              </div>

              {/* ─── Pickup App Discount Settings ─── */}
              <div className="border-t border-gray-100 dark:border-neutral-700 pt-4 mt-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-neutral-500 mb-3">
                  Pickup App Discount
                </p>

                {/* Discount Type */}
                <div className="mb-4">
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                    Discount Type
                    <span className="ml-1 font-normal text-gray-400 dark:text-neutral-500">(for pickup apps)</span>
                  </label>
                  <select
                    value={formDiscountType}
                    onChange={(e) => setFormDiscountType(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-3.5 py-2.5 text-sm text-gray-900 dark:text-neutral-200 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                  >
                    <option value="">None (manual/in-store only)</option>
                    <option value="fixed_amount">Fixed Amount Off (e.g. RM5 off)</option>
                    <option value="percentage">Percentage Off (e.g. 20% off)</option>
                    <option value="free_item">Free Item</option>
                    <option value="bogo">Buy 1 Free 1</option>
                  </select>
                </div>

                {/* Conditional fields based on discount type */}
                {(formDiscountType === "fixed_amount" || formDiscountType === "percentage") && (
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                        {formDiscountType === "fixed_amount" ? "Amount (RM)" : "Percentage (%)"}
                      </label>
                      <input
                        type="number"
                        value={formDiscountValue}
                        onChange={(e) => setFormDiscountValue(e.target.value === "" ? "" : Number(e.target.value))}
                        placeholder={formDiscountType === "fixed_amount" ? "5.00" : "20"}
                        className="w-full rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-3.5 py-2.5 text-sm font-sans text-gray-900 dark:text-neutral-200 placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                      />
                    </div>
                    {formDiscountType === "percentage" && (
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                          Max Discount (RM)
                          <span className="ml-1 font-normal text-gray-400 dark:text-neutral-500">(cap)</span>
                        </label>
                        <input
                          type="number"
                          value={formMaxDiscountValue}
                          onChange={(e) => setFormMaxDiscountValue(e.target.value === "" ? "" : Number(e.target.value))}
                          placeholder="No cap"
                          className="w-full rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-3.5 py-2.5 text-sm font-sans text-gray-900 dark:text-neutral-200 placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                        />
                      </div>
                    )}
                  </div>
                )}

                {formDiscountType === "free_item" && (
                  <div className="mb-4">
                    <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                      Free Item Name
                    </label>
                    <input
                      type="text"
                      value={formFreeProductName}
                      onChange={(e) => setFormFreeProductName(e.target.value)}
                      placeholder="e.g. Any Hot Coffee, Iced Latte"
                      className="w-full rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-3.5 py-2.5 text-sm text-gray-900 dark:text-neutral-200 placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                    />
                  </div>
                )}

                {formDiscountType === "bogo" && (
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-neutral-300">Buy Qty</label>
                      <input
                        type="number" min={1} max={10}
                        value={formBogoBuyQty}
                        onChange={(e) => setFormBogoBuyQty(e.target.value === "" ? "" : Number(e.target.value))}
                        className="w-full rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-3.5 py-2.5 text-sm font-sans text-gray-900 dark:text-neutral-200 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-neutral-300">Free Qty</label>
                      <input
                        type="number" min={1} max={10}
                        value={formBogoFreeQty}
                        onChange={(e) => setFormBogoFreeQty(e.target.value === "" ? "" : Number(e.target.value))}
                        className="w-full rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-3.5 py-2.5 text-sm font-sans text-gray-900 dark:text-neutral-200 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                      />
                    </div>
                  </div>
                )}

                {/* Shared fields: min order, applicable categories, fulfillment */}
                {formDiscountType && (
                  <>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                          Min Order (RM)
                          <span className="ml-1 font-normal text-gray-400 dark:text-neutral-500">(optional)</span>
                        </label>
                        <input
                          type="number"
                          value={formMinOrderValue}
                          onChange={(e) => setFormMinOrderValue(e.target.value === "" ? "" : Number(e.target.value))}
                          placeholder="No minimum"
                          className="w-full rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-3.5 py-2.5 text-sm font-sans text-gray-900 dark:text-neutral-200 placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                          Product Categories
                          <span className="ml-1 font-normal text-gray-400 dark:text-neutral-500">(optional)</span>
                        </label>
                        <input
                          type="text"
                          value={formApplicableCategories}
                          onChange={(e) => setFormApplicableCategories(e.target.value)}
                          placeholder="hot-coffee, pastry"
                          className="w-full rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-3.5 py-2.5 text-sm text-gray-900 dark:text-neutral-200 placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                        />
                        <p className="mt-1 text-xs text-gray-400 dark:text-neutral-500">Comma-separated category slugs from pickup app</p>
                      </div>
                    </div>

                    {/* Fulfillment channels */}
                    <div className="mb-4">
                      <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                        Available on
                      </label>
                      <div className="flex gap-3">
                        {(["in_store", "pickup", "delivery"] as const).map((ch) => (
                          <label key={ch} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-neutral-300">
                            <input
                              type="checkbox"
                              checked={formFulfillmentType.includes(ch)}
                              onChange={(e) => {
                                setFormFulfillmentType((prev) =>
                                  e.target.checked ? [...prev, ch] : prev.filter((c) => c !== ch)
                                );
                              }}
                              className="rounded border-gray-300 dark:border-neutral-600 text-[#C2452D] focus:ring-[#C2452D]"
                            />
                            {ch === "in_store" ? "In-Store" : ch === "pickup" ? "Pickup" : "Delivery"}
                          </label>
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-gray-400 dark:text-neutral-500">Leave unchecked = available everywhere</p>
                    </div>
                  </>
                )}
              </div>

              {/* Validity Days */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                  Validity (days)
                  <span className="ml-1 font-normal text-gray-400 dark:text-neutral-500">
                    (optional)
                  </span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={180}
                  value={formValidityDays}
                  onChange={(e) =>
                    setFormValidityDays(
                      e.target.value === "" ? "" : Number(e.target.value)
                    )
                  }
                  placeholder="No expiry"
                  className="w-full rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-3.5 py-2.5 text-sm font-sans text-gray-900 dark:text-neutral-200 placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                />
                <p className="mt-1 text-xs text-gray-400 dark:text-neutral-500">
                  Number of days the reward is valid after being issued
                </p>
              </div>

              {/* Auto-issue toggle (only for new_member) */}
              {formRewardType === "new_member" && (
                <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-700/50 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-neutral-300">
                      Auto-issue
                    </p>
                    <p className="text-xs text-gray-400 dark:text-neutral-500">
                      Automatically issue when a new member joins
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFormAutoIssue(!formAutoIssue)}
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
                      formAutoIssue
                        ? "bg-[#C2452D]"
                        : "bg-gray-200 dark:bg-neutral-600"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
                        formAutoIssue
                          ? "translate-x-[18px]"
                          : "translate-x-[3px]"
                      )}
                    />
                  </button>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-3 border-t border-gray-100 dark:border-neutral-700 px-6 py-4 shrink-0">
              <button
                onClick={handleCloseModal}
                className="rounded-lg border border-gray-200 dark:border-neutral-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !formName.trim()}
                className={cn(
                  "rounded-lg bg-[#C2452D] px-4 py-2 text-sm font-medium text-white hover:bg-[#A33822] transition-colors",
                  (saving || !formName.trim()) &&
                    "opacity-50 cursor-not-allowed"
                )}
              >
                {saving
                  ? "Saving..."
                  : editing
                    ? "Save changes"
                    : "Create reward"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

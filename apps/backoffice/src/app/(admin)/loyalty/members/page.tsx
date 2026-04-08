"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Search, MoreHorizontal, X, Download, Eye, Pencil, Trash2, Store, AlertTriangle, Filter, ChevronDown, ChevronLeft, ChevronRight, Plus, Tag, Save, Bookmark, MessageSquare, Send, Phone, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchMembers, fetchMembersPage, fetchRewards } from "@/lib/loyalty/api";
import type { MemberWithBrand, Reward } from "@/lib/loyalty/types";
import {
  formatPhone,
  formatPoints,
  formatCurrency,
  getTimeAgo,
} from "@/lib/loyalty/utils";
import { exportToCSV } from "@/lib/loyalty/export";

// ─── Segment helpers ────────────────────────────────────
type Segment = "all" | "returning" | "new" | "eligible";

function isReturning(totalVisits: number) {
  return totalVisits >= 2;
}

function isNewCustomer(totalVisits: number) {
  return totalVisits <= 1;
}

function isEligibleToRedeem(pointsBalance: number, lowestRewardPoints: number) {
  return pointsBalance >= lowestRewardPoints;
}

// ─── Advanced filter types ──────────────────────────────
type FilterField = "total_spent" | "last_visit" | "points_balance" | "total_visits" | "joined_date" | "tag";
type FilterOp = ">" | "<" | "=" | ">=" | "<=";

interface MemberFilter {
  field: FilterField;
  op: FilterOp;
  value: string;
}

const filterFieldLabels: Record<FilterField, string> = {
  total_spent: "Purchase amount (RM)",
  last_visit: "Last purchase",
  points_balance: "Points balance",
  total_visits: "Total visits",
  joined_date: "Joined date",
  tag: "Tag",
};

const filterOpLabels: Record<FilterOp, string> = {
  ">": "greater than",
  "<": "less than",
  "=": "equals",
  ">=": "at least",
  "<=": "at most",
};

// ─── Saved segments ────────────────────────────────────
interface SavedSegment {
  id: string;
  name: string;
  filters: MemberFilter[];
  tagFilter?: string;
}

const SAVED_SEGMENTS_KEY = "celsius-saved-segments";

type MappedMember = { id: string; phone: string; name: string | null; email: string | null; birthday: string | null; preferred_outlet_id: string | null; created_at: string; updated_at: string; points_balance: number; total_visits: number; total_spent: number; joined_at: string; last_visit_at: string | null; tags: string[] };

function mapMember(m: MemberWithBrand): MappedMember {
  return {
    id: m.id,
    phone: m.phone,
    name: m.name,
    email: m.email,
    birthday: m.birthday,
    preferred_outlet_id: m.preferred_outlet_id,
    created_at: m.created_at,
    updated_at: m.updated_at,
    points_balance: m.brand_data?.points_balance ?? 0,
    total_visits: m.brand_data?.total_visits ?? 0,
    total_spent: m.brand_data?.total_spent ?? 0,
    joined_at: m.brand_data?.joined_at ?? m.created_at,
    last_visit_at: m.brand_data?.last_visit_at ?? null,
    tags: ((m as unknown as Record<string, unknown>).tags as string[]) || [],
  };
}

export default function MembersPage() {
  // Server-side paginated data (fast default view)
  const [serverMembers, setServerMembers] = useState<MappedMember[]>([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverTotalPages, setServerTotalPages] = useState(0);

  // Client-side full data (loaded on demand for filters/export/SMS)
  const [allMembers, setAllMembers] = useState<MappedMember[]>([]);
  const [allLoaded, setAllLoaded] = useState(false);
  const [allLoading, setAllLoading] = useState(false);

  const [lowestRewardPoints, setLowestRewardPoints] = useState(Infinity);
  const [loading, setLoading] = useState(true);

  const [segment, setSegment] = useState<Segment>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filters, setFilters] = useState<MemberFilter[]>([]);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const [editingMember, setEditingMember] = useState<{ id: string; name: string; phone: string; email: string; birthday: string; tags: string[]; newTag: string; sms_opt_out: boolean } | null>(null);
  const [tagFilter, setTagFilter] = useState<string>("");

  // Outlet filter
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([]);
  const [outletFilter, setOutletFilter] = useState<string>("");

  // Are we in client-side filter mode?
  const useClientMode = allLoaded && (filters.length > 0 || tagFilter !== "" || segment !== "all" || outletFilter !== "");

  // ─── Saved segments ────────────────────────────────
  const [savedSegments, setSavedSegments] = useState<SavedSegment[]>([]);
  const [activeCustomSegment, setActiveCustomSegment] = useState<string | null>(null);
  const [showSaveSegmentInput, setShowSaveSegmentInput] = useState(false);
  const [newSegmentName, setNewSegmentName] = useState("");
  const [deleteSegmentConfirm, setDeleteSegmentConfirm] = useState<string | null>(null);

  // Table pagination
  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  // Bulk SMS
  const [showSmsModal, setShowSmsModal] = useState(false);
  const [smsMessage, setSmsMessage] = useState("");
  const [smsSending, setSmsSending] = useState(false);
  const [smsResult, setSmsResult] = useState<{ sent: number; failed: number } | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showBulkTagModal, setShowBulkTagModal] = useState(false);
  const [bulkTagInput, setBulkTagInput] = useState("");
  const [bulkTagging, setBulkTagging] = useState(false);

  // ─── Debounce search for server-side queries ───────
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  // Load saved segments from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SAVED_SEGMENTS_KEY);
      if (stored) setSavedSegments(JSON.parse(stored));
    } catch {}
  }, []);

  // Persist saved segments
  function persistSegments(segments: SavedSegment[]) {
    setSavedSegments(segments);
    localStorage.setItem(SAVED_SEGMENTS_KEY, JSON.stringify(segments));
  }

  function saveCurrentAsSegment() {
    if (!newSegmentName.trim() || filters.length === 0) return;
    const seg: SavedSegment = {
      id: `seg-${Date.now()}`,
      name: newSegmentName.trim(),
      filters: [...filters],
      tagFilter: tagFilter || undefined,
    };
    persistSegments([...savedSegments, seg]);
    setNewSegmentName("");
    setShowSaveSegmentInput(false);
  }

  function loadSegment(seg: SavedSegment) {
    ensureAllLoaded();
    setFilters(seg.filters);
    setTagFilter(seg.tagFilter || "");
    setSegment("all");
    setActiveCustomSegment(seg.id);
    setShowFilterPanel(true);
  }

  function deleteSegment(id: string) {
    persistSegments(savedSegments.filter((s) => s.id !== id));
    if (activeCustomSegment === id) setActiveCustomSegment(null);
    setDeleteSegmentConfirm(null);
  }

  // ─── Load all members on demand (for filters/export/SMS) ───
  const ensureAllLoaded = useCallback(() => {
    if (allLoaded || allLoading) return;
    setAllLoading(true);
    fetchMembers("brand-celsius", { all: true }).then((members) => {
      setAllMembers(members.map(mapMember));
      setAllLoaded(true);
      setAllLoading(false);
    });
  }, [allLoaded, allLoading]);

  // ─── Initial fast load: server-side paginated ─────
  useEffect(() => {
    // Fetch outlets for filter/display
    fetch("/api/loyalty/outlets?brand_id=brand-celsius")
      .then((r) => r.ok ? r.json() : [])
      .then((data: { id: string; name: string }[]) => { if (Array.isArray(data)) setOutlets(data); })
      .catch(() => {});

    // Fetch rewards (non-blocking)
    fetchRewards().then((rewards) => {
      const activeRewards = rewards.filter((r) => r.is_active);
      if (activeRewards.length > 0) {
        setLowestRewardPoints(Math.min(...activeRewards.map((r) => r.points_required)));
      }
    });

    // Fast initial page load
    fetchMembersPage("brand-celsius", 0, 50).then((res) => {
      setServerMembers(res.members.map(mapMember));
      setServerTotal(res.total);
      setServerTotalPages(res.total_pages);
      setLoading(false);
    });

    // Start loading all members in background for segment counts & filters
    fetchMembers("brand-celsius", { all: true }).then((members) => {
      setAllMembers(members.map(mapMember));
      setAllLoaded(true);
    });
  }, []);

  // ─── Server-side pagination: refetch on page/search change ───
  useEffect(() => {
    if (useClientMode) return; // client-side mode handles its own pagination
    setLoading(true);
    fetchMembersPage("brand-celsius", currentPage, pageSize, debouncedSearch || undefined).then((res) => {
      setServerMembers(res.members.map(mapMember));
      setServerTotal(res.total);
      setServerTotalPages(res.total_pages);
      setLoading(false);
    });
  }, [currentPage, pageSize, debouncedSearch, useClientMode]);

  // Close menu on outside click
  useEffect(() => {
    if (!openMenu) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest('[data-member-menu]')) return;
      setOpenMenu(null);
      setDeleteConfirm(null);
      setMenuPos(null);
    }
    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("click", handleClick);
    };
  }, [openMenu]);

  // ─── All unique tags ────────────────────────────────
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    allMembers.forEach((m) => (m.tags || []).forEach((t) => tagSet.add(t)));
    return Array.from(tagSet).sort();
  }, [allMembers]);

  // Predefined tag suggestions
  const suggestedTags = ["VIP", "Staff Friend", "Influencer", "Corporate", "Student", "Frequent", "Inactive", "Birthday Club"];

  // ─── Segment counts ─────────────────────────────────
  const segmentCounts = useMemo(() => {
    const all = allMembers.length;
    const returning = allMembers.filter((m) =>
      isReturning(m.total_visits)
    ).length;
    const newCust = allMembers.filter((m) =>
      isNewCustomer(m.total_visits)
    ).length;
    const eligible = allMembers.filter((m) =>
      isEligibleToRedeem(m.points_balance, lowestRewardPoints)
    ).length;
    return { all, returning, new: newCust, eligible };
  }, [allMembers, lowestRewardPoints]);

  // ─── Filtered members ───────────────────────────────
  const filteredMembers = useMemo(() => {
    return allMembers.filter((m) => {
      // segment filter
      if (segment === "returning" && !isReturning(m.total_visits)) return false;
      if (segment === "new" && !isNewCustomer(m.total_visits)) return false;
      if (segment === "eligible" && !isEligibleToRedeem(m.points_balance, lowestRewardPoints)) return false;

      // search filter
      if (search) {
        const q = search.toLowerCase();
        const matchesName = m.name?.toLowerCase().includes(q) ?? false;
        const matchesPhone = m.phone.includes(search);
        if (!matchesName && !matchesPhone) return false;
      }

      // advanced filters
      for (const f of filters) {
        if (!f.value) continue;
        const num = parseFloat(f.value);

        if (f.field === "total_spent") {
          if (f.op === ">" && !(m.total_spent > num)) return false;
          if (f.op === "<" && !(m.total_spent < num)) return false;
          if (f.op === "=" && !(m.total_spent === num)) return false;
          if (f.op === ">=" && !(m.total_spent >= num)) return false;
          if (f.op === "<=" && !(m.total_spent <= num)) return false;
        }
        if (f.field === "points_balance") {
          if (f.op === ">" && !(m.points_balance > num)) return false;
          if (f.op === "<" && !(m.points_balance < num)) return false;
          if (f.op === "=" && !(m.points_balance === num)) return false;
          if (f.op === ">=" && !(m.points_balance >= num)) return false;
          if (f.op === "<=" && !(m.points_balance <= num)) return false;
        }
        if (f.field === "total_visits") {
          if (f.op === ">" && !(m.total_visits > num)) return false;
          if (f.op === "<" && !(m.total_visits < num)) return false;
          if (f.op === "=" && !(m.total_visits === num)) return false;
          if (f.op === ">=" && !(m.total_visits >= num)) return false;
          if (f.op === "<=" && !(m.total_visits <= num)) return false;
        }
        if (f.field === "last_visit") {
          const lastVisit = m.last_visit_at ? new Date(m.last_visit_at).getTime() : 0;
          const target = new Date(f.value).getTime();
          if (f.op === ">" && !(lastVisit > target)) return false;
          if (f.op === "<" && !(lastVisit < target)) return false;
          if (f.op === ">=" && !(lastVisit >= target)) return false;
          if (f.op === "<=" && !(lastVisit <= target)) return false;
        }
        if (f.field === "joined_date") {
          const joined = new Date(m.joined_at).getTime();
          const target = new Date(f.value).getTime();
          if (f.op === ">" && !(joined > target)) return false;
          if (f.op === "<" && !(joined < target)) return false;
          if (f.op === ">=" && !(joined >= target)) return false;
          if (f.op === "<=" && !(joined <= target)) return false;
        }
        if (f.field === "tag") {
          const memberTags = m.tags || [];
          if (f.op === "=" && !memberTags.some((t) => t.toLowerCase() === f.value.toLowerCase())) return false;
        }
      }

      // tag filter (from tag click)
      if (tagFilter) {
        const memberTags = m.tags || [];
        if (!memberTags.some((t) => t.toLowerCase() === tagFilter.toLowerCase())) return false;
      }

      // outlet filter
      if (outletFilter) {
        if (m.preferred_outlet_id !== outletFilter) return false;
      }

      return true;
    });
  }, [segment, search, allMembers, lowestRewardPoints, filters, tagFilter, outletFilter]);

  // Reset page when filters change
  useEffect(() => { setCurrentPage(0); }, [segment, search, filters, tagFilter, outletFilter, pageSize]);

  // In server mode: display serverMembers directly, use serverTotal for pagination
  // In client mode: display filtered slice, use filteredMembers.length for pagination
  const displayTotal = useClientMode ? filteredMembers.length : serverTotal;
  const totalPages = useClientMode ? Math.ceil(filteredMembers.length / pageSize) : serverTotalPages;
  const paginatedMembers = useMemo(() => {
    if (useClientMode) {
      const start = currentPage * pageSize;
      return filteredMembers.slice(start, start + pageSize);
    }
    return serverMembers;
  }, [useClientMode, filteredMembers, serverMembers, currentPage, pageSize]);

  // ─── Row selection helpers ──────────────────────────
  const pageAllSelected =
    paginatedMembers.length > 0 &&
    paginatedMembers.every((m) => selectedRows.has(m.id));

  const allFilteredSelected =
    filteredMembers.length > 0 &&
    filteredMembers.every((m) => selectedRows.has(m.id));

  function toggleAll() {
    if (pageAllSelected) {
      // Deselect only the current page
      setSelectedRows((prev) => {
        const next = new Set(prev);
        for (const m of paginatedMembers) next.delete(m.id);
        return next;
      });
    } else {
      // Select current page (add to existing selection)
      setSelectedRows((prev) => {
        const next = new Set(prev);
        for (const m of paginatedMembers) next.add(m.id);
        return next;
      });
    }
  }

  function selectAllFiltered() {
    ensureAllLoaded();
    if (useClientMode) {
      setSelectedRows(new Set(filteredMembers.map((m) => m.id)));
    } else {
      // In server mode, select all loaded allMembers
      setSelectedRows(new Set(allMembers.map((m) => m.id)));
    }
  }

  function toggleRow(id: string) {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addFilter() {
    ensureAllLoaded();
    setFilters((prev) => [...prev, { field: "total_spent", op: ">", value: "" }]);
    setShowFilterPanel(true);
  }

  function removeFilter(index: number) {
    setFilters((prev) => prev.filter((_, i) => i !== index));
  }

  function updateFilter(index: number, key: keyof MemberFilter, val: string) {
    setFilters((prev) => prev.map((f, i) => (i === index ? { ...f, [key]: val } : f)));
  }

  // Quick filter presets
  function applyPreset(preset: string) {
    ensureAllLoaded();
    switch (preset) {
      case "high_spender":
        setFilters([{ field: "total_spent", op: ">=", value: "100" }]);
        break;
      case "inactive_30":
        setFilters([{ field: "last_visit", op: "<", value: new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0] }]);
        break;
      case "inactive_60":
        setFilters([{ field: "last_visit", op: "<", value: new Date(Date.now() - 60 * 86400000).toISOString().split("T")[0] }]);
        break;
      case "high_points":
        setFilters([{ field: "points_balance", op: ">=", value: "500" }]);
        break;
      case "frequent":
        setFilters([{ field: "total_visits", op: ">=", value: "5" }]);
        break;
    }
    setShowFilterPanel(true);
  }

  // ─── Delete handler ────────────────────────────────
  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/loyalty/members?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setAllMembers((prev) => prev.filter((m) => m.id !== id));
        setServerMembers((prev) => prev.filter((m) => m.id !== id));
        setServerTotal((t) => Math.max(0, t - 1));
      }
    } catch (err) {
      // silently fail
    }
    setDeleteConfirm(null);
    setOpenMenu(null);
    setMenuPos(null);
  }

  function handleEditMember(id: string) {
    const m = allMembers.find((m) => m.id === id) || serverMembers.find((m) => m.id === id);
    if (!m) return;
    setEditingMember({
      id: m.id,
      name: m.name || "",
      phone: m.phone,
      email: m.email || "",
      birthday: m.birthday || "",
      tags: m.tags || [],
      newTag: "",
      sms_opt_out: !!(m as Record<string, unknown>).sms_opt_out,
    });
    setOpenMenu(null);
    setMenuPos(null);
  }

  async function handleSaveMember() {
    if (!editingMember) return;
    try {
      const res = await fetch(`/api/loyalty/members?id=${editingMember.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editingMember.name || null,
          email: editingMember.email || null,
          birthday: editingMember.birthday || null,
          tags: editingMember.tags,
          sms_opt_out: editingMember.sms_opt_out,
        }),
      });
      if (res.ok) {
        const updater = (prev: MappedMember[]) =>
          prev.map((m) =>
            m.id === editingMember.id
              ? { ...m, name: editingMember.name || null, email: editingMember.email || null, birthday: editingMember.birthday || null, tags: editingMember.tags }
              : m
          );
        setAllMembers(updater);
        setServerMembers(updater);
      } else {
        const result = await res.json();
        alert(`Failed to update: ${result.error || "Unknown error"}`);
        return;
      }
    } catch {
      alert("Failed to update member. Please try again.");
      return;
    }
    setEditingMember(null);
  }

  // ─── Bulk SMS handler ──────────────────────────────
  async function handleBulkSms() {
    if (!smsMessage.trim() || selectedRows.size === 0) return;
    setSmsSending(true);
    setSmsResult(null);
    const source = allLoaded ? allMembers : serverMembers;
    const phones = source
      .filter((m) => selectedRows.has(m.id))
      .map((m) => m.phone);
    try {
      const res = await fetch("/api/loyalty/sms/blast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand_id: "brand-celsius", phones, message: smsMessage }),
      });
      const data = await res.json();
      if (res.ok) {
        setSmsResult({ sent: data.sent, failed: data.failed });
      } else {
        alert(data.error || "Failed to send SMS");
      }
    } catch {
      alert("Failed to send SMS. Please try again.");
    }
    setSmsSending(false);
  }

  // ─── Bulk delete handler ──────────────────────────
  async function handleBulkDelete() {
    setBulkDeleting(true);
    const ids = Array.from(selectedRows);
    let deleted = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`/api/loyalty/members?id=${id}`, { method: "DELETE" });
        if (res.ok) deleted++;
      } catch {}
    }
    const deletedIds = selectedRows;
    setAllMembers((prev) => prev.filter((m) => !deletedIds.has(m.id)));
    setServerMembers((prev) => prev.filter((m) => !deletedIds.has(m.id)));
    setServerTotal((t) => Math.max(0, t - deleted));
    setSelectedRows(new Set());
    setBulkDeleteConfirm(false);
    setBulkDeleting(false);
  }

  // ─── Bulk tag handler ──────────────────────────────
  async function handleBulkTag() {
    const tag = bulkTagInput.trim();
    if (!tag) return;
    setBulkTagging(true);
    const ids = Array.from(selectedRows);
    for (const id of ids) {
      const member = [...serverMembers, ...allMembers].find((m) => m.id === id);
      if (!member) continue;
      const currentTags = member.tags || [];
      if (currentTags.includes(tag)) continue;
      const newTags = [...currentTags, tag];
      try {
        await fetch(`/api/loyalty/members?id=${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags: newTags }),
        });
      } catch {}
    }
    // Update local state
    const updater = (prev: MappedMember[]) =>
      prev.map((m) =>
        selectedRows.has(m.id) && !(m.tags || []).includes(tag)
          ? { ...m, tags: [...(m.tags || []), tag] }
          : m
      );
    setAllMembers(updater);
    setServerMembers(updater);
    setBulkTagging(false);
    setShowBulkTagModal(false);
    setBulkTagInput("");
  }

  // ─── Segment tab config ─────────────────────────────
  const tabs: { key: Segment; label: string; count: number }[] = [
    { key: "all", label: "All", count: segmentCounts.all },
    { key: "returning", label: "Returning", count: segmentCounts.returning },
    { key: "new", label: "New customers", count: segmentCounts.new },
    { key: "eligible", label: "Eligible to redeem", count: segmentCounts.eligible },
  ];

  // Count members matching each saved segment
  const savedSegmentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const seg of savedSegments) {
      counts[seg.id] = allMembers.filter((m) => {
        for (const f of seg.filters) {
          if (!f.value) continue;
          const num = parseFloat(f.value);
          if (f.field === "total_spent") {
            if (f.op === ">" && !(m.total_spent > num)) return false;
            if (f.op === "<" && !(m.total_spent < num)) return false;
            if (f.op === "=" && !(m.total_spent === num)) return false;
            if (f.op === ">=" && !(m.total_spent >= num)) return false;
            if (f.op === "<=" && !(m.total_spent <= num)) return false;
          }
          if (f.field === "points_balance") {
            if (f.op === ">" && !(m.points_balance > num)) return false;
            if (f.op === "<" && !(m.points_balance < num)) return false;
            if (f.op === "=" && !(m.points_balance === num)) return false;
            if (f.op === ">=" && !(m.points_balance >= num)) return false;
            if (f.op === "<=" && !(m.points_balance <= num)) return false;
          }
          if (f.field === "total_visits") {
            if (f.op === ">" && !(m.total_visits > num)) return false;
            if (f.op === "<" && !(m.total_visits < num)) return false;
            if (f.op === "=" && !(m.total_visits === num)) return false;
            if (f.op === ">=" && !(m.total_visits >= num)) return false;
            if (f.op === "<=" && !(m.total_visits <= num)) return false;
          }
          if (f.field === "last_visit") {
            const lastVisit = m.last_visit_at ? new Date(m.last_visit_at).getTime() : 0;
            const target = new Date(f.value).getTime();
            if (f.op === ">" && !(lastVisit > target)) return false;
            if (f.op === "<" && !(lastVisit < target)) return false;
            if (f.op === ">=" && !(lastVisit >= target)) return false;
            if (f.op === "<=" && !(lastVisit <= target)) return false;
          }
          if (f.field === "joined_date") {
            const joined = new Date(m.joined_at).getTime();
            const target = new Date(f.value).getTime();
            if (f.op === ">" && !(joined > target)) return false;
            if (f.op === "<" && !(joined < target)) return false;
            if (f.op === ">=" && !(joined >= target)) return false;
            if (f.op === "<=" && !(joined <= target)) return false;
          }
          if (f.field === "tag") {
            const memberTags = m.tags || [];
            if (f.op === "=" && !memberTags.some((t) => t.toLowerCase() === f.value.toLowerCase())) return false;
          }
        }
        if (seg.tagFilter) {
          const memberTags = m.tags || [];
          if (!memberTags.some((t) => t.toLowerCase() === seg.tagFilter!.toLowerCase())) return false;
        }
        return true;
      }).length;
    }
    return counts;
  }, [savedSegments, allMembers]);

  if (loading) {
    return (
      <div className="p-6 space-y-0 pb-20 md:pb-0">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Members</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
            Manage your loyalty program members
          </p>
        </div>
        <div className="flex items-center justify-center py-20 text-gray-400 dark:text-neutral-500">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-0 pb-20 md:pb-0">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Members</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
          Manage your loyalty program members
        </p>
      </div>

      {/* Segment Tabs */}
      <div className="border-b border-gray-200 dark:border-neutral-700">
        <nav className="-mb-px flex gap-0 overflow-x-auto" aria-label="Segments">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { if (tab.key !== "all") ensureAllLoaded(); setSegment(tab.key); setActiveCustomSegment(null); setFilters([]); setTagFilter(""); }}
              className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                segment === tab.key && !activeCustomSegment
                  ? "border-gray-900 dark:border-white text-gray-900 dark:text-white"
                  : "border-transparent text-gray-500 dark:text-neutral-400 hover:border-gray-300 dark:hover:border-neutral-600 hover:text-gray-700 dark:hover:text-neutral-200"
              }`}
            >
              {tab.label}{" "}
              <span
                className={`ml-1 rounded-full px-1.5 py-0.5 text-xs ${
                  segment === tab.key && !activeCustomSegment
                    ? "bg-gray-900 dark:bg-white text-white dark:text-neutral-900"
                    : "bg-gray-100 dark:bg-neutral-700 text-gray-500 dark:text-neutral-400"
                }`}
              >
                {tab.count.toLocaleString()}
              </span>
            </button>
          ))}
          {/* Saved custom segments */}
          {savedSegments.map((seg) => (
            <div key={seg.id} className="relative flex items-center">
              <button
                onClick={() => loadSegment(seg)}
                className={`whitespace-nowrap border-b-2 pl-4 pr-1 py-3 text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  activeCustomSegment === seg.id
                    ? "border-[#C2452D] text-[#C2452D]"
                    : "border-transparent text-gray-500 dark:text-neutral-400 hover:border-gray-300 dark:hover:border-neutral-600 hover:text-gray-700 dark:hover:text-neutral-200"
                }`}
              >
                <Bookmark className="h-3 w-3" />
                {seg.name}{" "}
                <span
                  className={`ml-0.5 rounded-full px-1.5 py-0.5 text-xs ${
                    activeCustomSegment === seg.id
                      ? "bg-[#C2452D]/10 text-[#C2452D]"
                      : "bg-gray-100 dark:bg-neutral-700 text-gray-500 dark:text-neutral-400"
                  }`}
                >
                  {savedSegmentCounts[seg.id] ?? 0}
                </span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setDeleteSegmentConfirm(deleteSegmentConfirm === seg.id ? null : seg.id); }}
                className="mr-2 rounded-full p-0.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {/* Delete segment confirmation */}
          {deleteSegmentConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setDeleteSegmentConfirm(null)}>
              <div className="w-64 rounded-xl border border-red-200 dark:border-red-900 bg-white dark:bg-neutral-800 shadow-lg p-4" onClick={(e) => e.stopPropagation()}>
                <p className="text-sm text-gray-700 dark:text-neutral-300 mb-3">Delete this segment?</p>
                <div className="flex gap-2">
                  <button onClick={() => setDeleteSegmentConfirm(null)} className="flex-1 rounded-lg bg-gray-100 dark:bg-neutral-700 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-neutral-300">Cancel</button>
                  <button onClick={() => deleteSegment(deleteSegmentConfirm)} className="flex-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white">Delete</button>
                </div>
              </div>
            </div>
          )}
        </nav>
      </div>

      {/* Filters + Search */}
      <div className="flex items-center justify-between gap-3 py-3">
        {/* Quick filters + Filter button */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowFilterPanel(!showFilterPanel)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              filters.length > 0
                ? "border-[#C2452D] bg-[#C2452D]/5 text-[#C2452D]"
                : "border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-gray-600 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700"
            )}
          >
            <Filter className="h-3 w-3" />
            Filters {filters.length > 0 && `(${filters.length})`}
          </button>
          {/* Tag filter dropdown */}
          {allTags.length > 0 && (
            <div className="relative">
              <select
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                className={cn(
                  "appearance-none rounded-full border pl-7 pr-6 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                  tagFilter
                    ? "border-[#C2452D] bg-[#C2452D]/5 text-[#C2452D]"
                    : "border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-gray-600 dark:text-neutral-300"
                )}
              >
                <option value="">All tags</option>
                {allTags.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <Tag className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          )}
          {tagFilter && (
            <button
              onClick={() => setTagFilter("")}
              className="inline-flex items-center gap-1 rounded-full border border-[#C2452D]/30 bg-[#C2452D]/5 px-2.5 py-1.5 text-xs font-medium text-[#C2452D]"
            >
              Tag: {tagFilter}
              <X className="h-3 w-3" />
            </button>
          )}
          {/* Outlet filter dropdown */}
          {outlets.length > 0 && (
            <div className="relative">
              <select
                value={outletFilter}
                onChange={(e) => { setOutletFilter(e.target.value); if (e.target.value) ensureAllLoaded(); }}
                className={cn(
                  "appearance-none rounded-full border pl-7 pr-6 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                  outletFilter
                    ? "border-[#C2452D] bg-[#C2452D]/5 text-[#C2452D]"
                    : "border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-gray-600 dark:text-neutral-300"
                )}
              >
                <option value="">All outlets</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              <Store className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          )}
          {outletFilter && (
            <button
              onClick={() => setOutletFilter("")}
              className="inline-flex items-center gap-1 rounded-full border border-[#C2452D]/30 bg-[#C2452D]/5 px-2.5 py-1.5 text-xs font-medium text-[#C2452D]"
            >
              Outlet: {outlets.find((o) => o.id === outletFilter)?.name || outletFilter}
              <X className="h-3 w-3" />
            </button>
          )}
          {/* Quick preset chips */}
          {filters.length === 0 && (
            <>
              <button onClick={() => applyPreset("high_spender")} className="inline-flex items-center gap-1 rounded-full border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700">
                High spender
              </button>
              <button onClick={() => applyPreset("inactive_30")} className="inline-flex items-center gap-1 rounded-full border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700">
                Inactive 30d
              </button>
              <button onClick={() => applyPreset("high_points")} className="inline-flex items-center gap-1 rounded-full border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700">
                High points
              </button>
            </>
          )}
          {/* Active filter tags */}
          {filters.map((f, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full border border-[#C2452D]/30 bg-[#C2452D]/5 px-3 py-1.5 text-xs font-medium text-[#C2452D]"
            >
              {filterFieldLabels[f.field]} {f.op} {f.field === "tag" ? `"${f.value}"` : f.value}
              <button onClick={() => removeFilter(i)} className="ml-0.5 hover:text-red-700"><X className="h-3 w-3" /></button>
            </span>
          ))}
          {filters.length > 0 && (
            <button
              onClick={() => { setFilters([]); setShowFilterPanel(false); }}
              className="text-xs text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-200 underline"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Search toggle + Export */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const today = new Date().toISOString().split("T")[0];
              const rows = filteredMembers.map((m) => ({
                phone: formatPhone(m.phone),
                name: m.name ?? "No Name",
                status: isReturning(m.total_visits) ? "Returning" : "New",
                points_balance: m.points_balance,
                total_visits: m.total_visits,
                total_spent: m.total_spent,
                last_visit: m.last_visit_at ? m.last_visit_at.split("T")[0] : "",
                joined: m.joined_at.split("T")[0],
                tags: (m.tags || []).join(", "),
              }));
              exportToCSV(rows, [
                { key: "phone", label: "Phone Number" },
                { key: "name", label: "Name" },
                { key: "status", label: "Status" },
                { key: "points_balance", label: "Points Balance" },
                { key: "total_visits", label: "Total Visits" },
                { key: "total_spent", label: "Total Spent" },
                { key: "last_visit", label: "Last Visit" },
                { key: "joined", label: "Joined Date" },
                { key: "tags", label: "Tags" },
              ], `celsius-members-${today}`);
            }}
            className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-gray-600 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-700 inline-flex items-center gap-1.5"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
          {searchOpen ? (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-neutral-500" />
              <input
                autoFocus
                type="text"
                placeholder="Search phone or name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onBlur={() => {
                  if (!search) setSearchOpen(false);
                }}
                className="w-56 rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 py-2 pl-9 pr-8 text-sm text-gray-900 dark:text-neutral-200 placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:border-gray-400 dark:focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-gray-400 dark:focus:ring-neutral-500"
              />
              <button
                onClick={() => {
                  setSearch("");
                  setSearchOpen(false);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-300"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-2 text-gray-500 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-700 hover:text-gray-700 dark:hover:text-neutral-200"
            >
              <Search className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Advanced Filter Panel */}
      {showFilterPanel && (
        <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-sm p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-neutral-300">
              <Filter className="h-4 w-4" />
              Custom filters
              <span className="text-xs text-gray-400 dark:text-neutral-500">(all conditions must match)</span>
            </div>
            <button onClick={() => setShowFilterPanel(false)} className="text-gray-400 hover:text-gray-600 dark:text-neutral-500 dark:hover:text-neutral-300">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-2">
            {filters.map((filter, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <select
                  value={filter.field}
                  onChange={(e) => updateFilter(idx, "field", e.target.value)}
                  className="rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-2 py-1.5 text-sm dark:text-neutral-200"
                >
                  {Object.entries(filterFieldLabels).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <select
                  value={filter.op}
                  onChange={(e) => updateFilter(idx, "op", e.target.value)}
                  className="rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-2 py-1.5 text-sm dark:text-neutral-200 w-20"
                >
                  {filter.field === "tag" ? (
                    <option value="=">=</option>
                  ) : (
                    Object.entries(filterOpLabels).map(([k, v]) => (
                      <option key={k} value={k}>{k}</option>
                    ))
                  )}
                </select>
                {filter.field === "last_visit" || filter.field === "joined_date" ? (
                  <input
                    type="date"
                    value={filter.value}
                    onChange={(e) => updateFilter(idx, "value", e.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-2 py-1.5 text-sm dark:text-neutral-200"
                  />
                ) : filter.field === "tag" ? (
                  <select
                    value={filter.value}
                    onChange={(e) => updateFilter(idx, "value", e.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-2 py-1.5 text-sm dark:text-neutral-200"
                  >
                    <option value="">Select tag</option>
                    {allTags.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                    {suggestedTags.filter((t) => !allTags.includes(t)).map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    value={filter.value}
                    onChange={(e) => updateFilter(idx, "value", e.target.value)}
                    placeholder="Value"
                    className="flex-1 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-2 py-1.5 text-sm dark:text-neutral-200"
                  />
                )}
                <button
                  onClick={() => removeFilter(idx)}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button
              onClick={addFilter}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 dark:border-neutral-600 px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-neutral-400 hover:border-gray-400 dark:hover:border-neutral-500 hover:text-gray-700 dark:hover:text-neutral-200"
            >
              <Plus className="h-3 w-3" />
              Add filter
            </button>
            {filters.length > 0 && !showSaveSegmentInput && (
              <button
                onClick={() => setShowSaveSegmentInput(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#C2452D]/30 bg-[#C2452D]/5 px-3 py-1.5 text-xs font-medium text-[#C2452D] hover:bg-[#C2452D]/10"
              >
                <Bookmark className="h-3 w-3" />
                Save as segment
              </button>
            )}
            {showSaveSegmentInput && (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={newSegmentName}
                  onChange={(e) => setNewSegmentName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveCurrentAsSegment(); if (e.key === "Escape") setShowSaveSegmentInput(false); }}
                  placeholder="Segment name..."
                  className="w-40 rounded-lg border border-[#C2452D]/30 px-2.5 py-1.5 text-xs focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D] dark:bg-neutral-700 dark:text-white"
                />
                <button
                  onClick={saveCurrentAsSegment}
                  disabled={!newSegmentName.trim()}
                  className="rounded-lg bg-[#C2452D] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#A33822] disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => { setShowSaveSegmentInput(false); setNewSegmentName(""); }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-neutral-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Quick presets */}
          <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 dark:border-neutral-700 pt-3">
            <span className="text-xs text-gray-400 dark:text-neutral-500 self-center mr-1">Presets:</span>
            <button onClick={() => applyPreset("high_spender")} className="rounded-full bg-gray-100 dark:bg-neutral-700 px-2.5 py-1 text-xs text-gray-600 dark:text-neutral-300 hover:bg-gray-200 dark:hover:bg-neutral-600">Spent ≥ RM100</button>
            <button onClick={() => applyPreset("inactive_30")} className="rounded-full bg-gray-100 dark:bg-neutral-700 px-2.5 py-1 text-xs text-gray-600 dark:text-neutral-300 hover:bg-gray-200 dark:hover:bg-neutral-600">Inactive 30d</button>
            <button onClick={() => applyPreset("inactive_60")} className="rounded-full bg-gray-100 dark:bg-neutral-700 px-2.5 py-1 text-xs text-gray-600 dark:text-neutral-300 hover:bg-gray-200 dark:hover:bg-neutral-600">Inactive 60d</button>
            <button onClick={() => applyPreset("high_points")} className="rounded-full bg-gray-100 dark:bg-neutral-700 px-2.5 py-1 text-xs text-gray-600 dark:text-neutral-300 hover:bg-gray-200 dark:hover:bg-neutral-600">Points ≥ 500</button>
            <button onClick={() => applyPreset("frequent")} className="rounded-full bg-gray-100 dark:bg-neutral-700 px-2.5 py-1 text-xs text-gray-600 dark:text-neutral-300 hover:bg-gray-200 dark:hover:bg-neutral-600">5+ visits</button>
          </div>
        </div>
      )}

      {/* Bulk Action Bar */}
      {selectedRows.size > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-sm px-4 py-3 space-y-2">
          <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            {selectedRows.size} selected
          </span>
          {!allFilteredSelected && displayTotal > selectedRows.size && (
            <button
              onClick={selectAllFiltered}
              className="text-xs text-[#C2452D] hover:text-[#A33822] underline"
            >
              Select all {displayTotal.toLocaleString()} members
            </button>
          )}
          <div className="h-4 w-px bg-gray-200 dark:bg-neutral-700" />
          <button
            onClick={() => { setShowSmsModal(true); setSmsMessage(""); setSmsResult(null); }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#C2452D] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#A33822] transition-colors"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Send SMS
          </button>
          <button
            onClick={() => { setShowBulkTagModal(true); setBulkTagInput(""); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-neutral-600 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
          >
            <Tag className="h-3.5 w-3.5" />
            Tag
          </button>
          <button
            onClick={() => setBulkDeleteConfirm(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-900 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
          <button
            onClick={() => setSelectedRows(new Set())}
            className="ml-auto text-xs text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-200 underline"
          >
            Clear selection
          </button>
          </div>
        </div>
      )}

      {/* Members Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-auto">
            <thead>
              <tr className="border-b border-gray-200 dark:border-neutral-700 bg-gray-50/80 dark:bg-neutral-800">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={pageAllSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-gray-300 dark:border-neutral-600 text-gray-900 focus:ring-gray-500"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400 whitespace-nowrap">
                  Phone number
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400">
                  Status
                </th>
                <th className="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400 sm:table-cell">
                  Outlet
                </th>
                <th className="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400 sm:table-cell">
                  Tags
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400">
                  Progress
                </th>
                <th className="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400 md:table-cell">
                  Time
                </th>
                <th className="hidden px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400 lg:table-cell">
                  Total spend
                </th>
                <th className="w-12 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-neutral-700/50">
              {paginatedMembers.map((member) => {
                const returning = isReturning(member.total_visits);
                return (
                  <tr
                    key={member.id}
                    className="transition-colors hover:bg-gray-50/60 dark:hover:bg-neutral-700/50"
                  >
                    {/* Checkbox */}
                    <td className="px-4 py-3.5">
                      <input
                        type="checkbox"
                        checked={selectedRows.has(member.id)}
                        onChange={() => toggleRow(member.id)}
                        className="h-4 w-4 rounded border-gray-300 dark:border-neutral-600 text-gray-900 focus:ring-gray-500"
                      />
                    </td>

                    {/* Phone */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <button className="font-sans text-sm text-blue-600 dark:text-blue-400 underline decoration-blue-300 dark:decoration-blue-600 underline-offset-2 hover:text-blue-800 dark:hover:text-blue-300 tabular-nums">
                        {formatPhone(member.phone)}
                      </button>
                    </td>

                    {/* Name */}
                    <td className="px-4 py-3.5 font-sans text-gray-900 dark:text-white">
                      {member.name ?? "No Name"}
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          returning
                            ? "bg-orange-50 text-orange-700"
                            : "bg-green-50 text-green-700"
                        }`}
                      >
                        {returning ? "Returning" : "New"}
                      </span>
                    </td>

                    {/* Outlet */}
                    <td className="hidden px-4 py-3.5 sm:table-cell">
                      <span className="text-xs text-gray-500 dark:text-neutral-400">
                        {member.preferred_outlet_id
                          ? outlets.find((o) => o.id === member.preferred_outlet_id)?.name || member.preferred_outlet_id
                          : "—"}
                      </span>
                    </td>

                    {/* Tags */}
                    <td className="hidden px-4 py-3.5 sm:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {(member.tags || []).map((tag) => (
                          <button
                            key={tag}
                            onClick={() => setTagFilter(tagFilter === tag ? "" : tag)}
                            className={cn(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer",
                              tagFilter === tag
                                ? "bg-[#C2452D] text-white"
                                : "bg-gray-100 dark:bg-neutral-700 text-gray-600 dark:text-neutral-300 hover:bg-gray-200 dark:hover:bg-neutral-600"
                            )}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </td>

                    {/* Progress (points) */}
                    <td className="px-4 py-3.5 font-sans text-gray-900 dark:text-white">
                      {formatPoints(member.points_balance)} pts
                    </td>

                    {/* Time (relative) */}
                    <td className="hidden px-4 py-3.5 font-sans text-gray-500 dark:text-neutral-400 md:table-cell">
                      {getTimeAgo(member.joined_at)}
                    </td>

                    {/* Total Spend */}
                    <td className="hidden px-4 py-3.5 text-right font-sans text-gray-900 dark:text-white lg:table-cell">
                      {formatCurrency(member.total_spent)}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5 text-center">
                      <div className="relative" data-member-menu>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (openMenu === member.id) {
                              setOpenMenu(null);
                              setMenuPos(null);
                              setDeleteConfirm(null);
                            } else {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const spaceBelow = window.innerHeight - rect.bottom;
                              setMenuPos(spaceBelow < 140
                                ? { bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right }
                                : { top: rect.bottom + 4, right: window.innerWidth - rect.right }
                              );
                              setOpenMenu(member.id);
                              setDeleteConfirm(null);
                            }
                          }}
                          className="rounded-lg p-1.5 text-gray-400 dark:text-neutral-500 hover:bg-gray-100 dark:hover:bg-neutral-700 hover:text-gray-600 dark:hover:text-neutral-300"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {paginatedMembers.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-16 text-center text-gray-400 dark:text-neutral-500"
                  >
                    No members found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ─── Pagination ─── */}
        <div className="flex items-center justify-between border-t border-gray-100 dark:border-neutral-700 px-4 py-3">
          <div className="flex items-center gap-3">
            <p className="text-xs text-gray-500 dark:text-neutral-400">
              Showing {displayTotal > 0 ? currentPage * pageSize + 1 : 0}–{Math.min((currentPage + 1) * pageSize, displayTotal)} of {displayTotal.toLocaleString()}
            </p>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="rounded-md border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-xs text-gray-600 dark:text-neutral-300 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
            >
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
              <option value={200}>200 / page</option>
            </select>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(0)}
                disabled={currentPage === 0}
                className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-neutral-700 disabled:opacity-30"
              >
                First
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-neutral-700 disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs font-medium text-gray-600 dark:text-neutral-300 px-2">
                {currentPage + 1} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage >= totalPages - 1}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-neutral-700 disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => setCurrentPage(totalPages - 1)}
                disabled={currentPage >= totalPages - 1}
                className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-neutral-700 disabled:opacity-30"
              >
                Last
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ─── Fixed-position action dropdown ─── */}
      {openMenu && menuPos && !deleteConfirm && (
        <div
          data-member-menu
          style={{ position: "fixed", top: menuPos.top, bottom: menuPos.bottom, right: menuPos.right, zIndex: 50 }}
          className="w-40 overflow-hidden rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-lg"
        >
          <button
            onClick={(e) => { e.stopPropagation(); handleEditMember(openMenu!); setOpenMenu(null); setMenuPos(null); }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700"
          >
            <Eye className="h-3.5 w-3.5" />
            View Details
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleEditMember(openMenu!); }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setDeleteConfirm(openMenu); }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setDeleteConfirm(null); setOpenMenu(null); setMenuPos(null); }}>
          <div className="w-72 rounded-2xl bg-white dark:bg-neutral-800 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <h3 className="text-base font-bold text-gray-900 dark:text-white">Delete member</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-neutral-400 mb-4">This will permanently delete this member and all their data. This cannot be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={() => { setDeleteConfirm(null); setOpenMenu(null); setMenuPos(null); }}
                className="flex-1 rounded-lg bg-gray-100 dark:bg-neutral-700 px-3 py-2 text-sm font-medium text-gray-600 dark:text-neutral-300 hover:bg-gray-200 dark:hover:bg-neutral-600"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── SMS Blast Modal ──────────────────────────── */}
      {showSmsModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 pt-10 pb-10">
          <div className="relative w-full max-w-md rounded-2xl bg-white dark:bg-neutral-800 p-6 shadow-xl">
            <button
              onClick={() => setShowSmsModal(false)}
              className="absolute right-4 top-4 rounded-lg p-1 text-gray-400 dark:text-neutral-500 hover:bg-gray-100 dark:hover:bg-neutral-700"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <MessageSquare className="h-5 w-5 text-[#C2452D]" />
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Send SMS</h2>
            </div>

            <p className="text-sm text-gray-500 dark:text-neutral-400 mb-4">
              Sending to <span className="font-medium text-gray-900 dark:text-white">{selectedRows.size}</span> member{selectedRows.size > 1 ? "s" : ""}
            </p>

            {smsResult ? (
              <div className="space-y-3">
                <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4 text-center">
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{smsResult.sent.toLocaleString()}</p>
                  <p className="text-sm text-green-700 dark:text-green-300">SMS sent successfully</p>
                  {smsResult.failed > 0 && (
                    <p className="mt-1 text-xs text-red-500">{smsResult.failed.toLocaleString()} failed</p>
                  )}
                </div>
                <button
                  onClick={() => { setShowSmsModal(false); setSelectedRows(new Set()); }}
                  className="w-full rounded-lg bg-gray-100 dark:bg-neutral-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-neutral-300 hover:bg-gray-200 dark:hover:bg-neutral-600"
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-neutral-300">Message</label>
                  <textarea
                    rows={4}
                    value={smsMessage}
                    onChange={(e) => setSmsMessage(e.target.value)}
                    placeholder="Type your message here..."
                    className="w-full rounded-lg border border-gray-300 dark:border-neutral-600 px-3 py-2 text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D] dark:bg-neutral-700 dark:text-white"
                  />
                  <p className="mt-1 text-xs text-gray-400 dark:text-neutral-500">
                    {smsMessage.length} characters · ~{Math.ceil(smsMessage.length / 160) || 1} SMS per recipient · {selectedRows.size * (Math.ceil(smsMessage.length / 160) || 1)} credits total
                  </p>
                </div>
                <div className="flex items-center justify-end gap-3">
                  <button
                    onClick={() => setShowSmsModal(false)}
                    className="rounded-lg border border-gray-300 dark:border-neutral-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleBulkSms}
                    disabled={smsSending || !smsMessage.trim()}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#C2452D] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#A33822] disabled:opacity-50"
                  >
                    {smsSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {smsSending ? "Sending..." : `Send to ${selectedRows.size}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Bulk Delete Confirmation ───────────────────── */}
      {bulkDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !bulkDeleting && setBulkDeleteConfirm(false)}>
          <div className="w-80 rounded-2xl bg-white dark:bg-neutral-800 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Delete members</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-neutral-400 mb-5">
              Are you sure you want to delete <span className="font-medium text-gray-900 dark:text-white">{selectedRows.size}</span> member{selectedRows.size > 1 ? "s" : ""}? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setBulkDeleteConfirm(false)}
                disabled={bulkDeleting}
                className="flex-1 rounded-lg border border-gray-300 dark:border-neutral-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {bulkDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {bulkDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Tag Modal ─────────────────────────────── */}
      {showBulkTagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !bulkTagging && setShowBulkTagModal(false)}>
          <div className="w-96 rounded-2xl bg-white dark:bg-neutral-800 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-2">
              <Tag className="h-5 w-5 text-[#C2452D]" />
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Tag {selectedRows.size} member{selectedRows.size > 1 ? "s" : ""}</h3>
            </div>
            <div className="mb-3">
              <input
                type="text"
                placeholder="Enter tag name..."
                value={bulkTagInput}
                onChange={(e) => setBulkTagInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleBulkTag()}
                className="w-full rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-neutral-500 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                autoFocus
              />
            </div>
            {suggestedTags.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {suggestedTags.map((t) => (
                  <button
                    key={t}
                    onClick={() => setBulkTagInput(t)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs transition-colors",
                      bulkTagInput === t
                        ? "bg-[#C2452D] text-white"
                        : "bg-gray-100 dark:bg-neutral-700 text-gray-600 dark:text-neutral-300 hover:bg-gray-200 dark:hover:bg-neutral-600"
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setShowBulkTagModal(false)}
                disabled={bulkTagging}
                className="flex-1 rounded-lg border border-gray-300 dark:border-neutral-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkTag}
                disabled={bulkTagging || !bulkTagInput.trim()}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#C2452D] px-4 py-2 text-sm font-medium text-white hover:bg-[#A33822] disabled:opacity-50"
              >
                {bulkTagging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4" />}
                {bulkTagging ? "Tagging..." : "Apply Tag"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Member Modal ─────────────────────────── */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 pt-10 pb-10">
          <div className="relative w-full max-w-md rounded-2xl bg-white dark:bg-neutral-800 p-6 shadow-xl">
            <button
              onClick={() => setEditingMember(null)}
              className="absolute right-4 top-4 rounded-lg p-1 text-gray-400 dark:text-neutral-500 hover:bg-gray-100 dark:hover:bg-neutral-700"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="mb-5 text-lg font-bold text-gray-900 dark:text-white">Edit member</h2>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-neutral-300">Phone</label>
                <input
                  value={editingMember.phone}
                  disabled
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 dark:bg-neutral-700 dark:border-neutral-600 px-3 py-2 text-sm text-gray-500 dark:text-neutral-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-neutral-300">Name</label>
                <input
                  value={editingMember.name}
                  onChange={(e) => setEditingMember({ ...editingMember, name: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 dark:border-neutral-600 px-3 py-2 text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D] dark:bg-neutral-700 dark:text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-neutral-300">Email</label>
                <input
                  type="email"
                  value={editingMember.email}
                  onChange={(e) => setEditingMember({ ...editingMember, email: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 dark:border-neutral-600 px-3 py-2 text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D] dark:bg-neutral-700 dark:text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-neutral-300">Birthday</label>
                <input
                  type="date"
                  value={editingMember.birthday}
                  onChange={(e) => setEditingMember({ ...editingMember, birthday: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 dark:border-neutral-600 px-3 py-2 text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D] dark:bg-neutral-700 dark:text-white"
                />
              </div>

              {/* Tags */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                  <Tag className="inline h-3.5 w-3.5 mr-1" />
                  Tags / Segments
                </label>
                {/* Current tags */}
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {editingMember.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-[#C2452D]/10 px-2.5 py-1 text-xs font-medium text-[#C2452D]"
                    >
                      {tag}
                      <button
                        onClick={() =>
                          setEditingMember({
                            ...editingMember,
                            tags: editingMember.tags.filter((t) => t !== tag),
                          })
                        }
                        className="hover:text-red-700"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  {editingMember.tags.length === 0 && (
                    <span className="text-xs text-gray-400 dark:text-neutral-500 italic">No tags yet</span>
                  )}
                </div>
                {/* Add tag input */}
                <div className="flex gap-2">
                  <input
                    value={editingMember.newTag}
                    onChange={(e) => setEditingMember({ ...editingMember, newTag: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && editingMember.newTag.trim()) {
                        e.preventDefault();
                        const tag = editingMember.newTag.trim();
                        if (!editingMember.tags.includes(tag)) {
                          setEditingMember({ ...editingMember, tags: [...editingMember.tags, tag], newTag: "" });
                        }
                      }
                    }}
                    placeholder="Type tag and press Enter..."
                    className="flex-1 rounded-lg border border-gray-300 dark:border-neutral-600 px-3 py-1.5 text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D] dark:bg-neutral-700 dark:text-white"
                  />
                  <button
                    onClick={() => {
                      const tag = editingMember.newTag.trim();
                      if (tag && !editingMember.tags.includes(tag)) {
                        setEditingMember({ ...editingMember, tags: [...editingMember.tags, tag], newTag: "" });
                      }
                    }}
                    disabled={!editingMember.newTag.trim()}
                    className="rounded-lg bg-gray-100 dark:bg-neutral-700 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-neutral-300 hover:bg-gray-200 dark:hover:bg-neutral-600 disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
                {/* Suggested tags */}
                <div className="mt-2 flex flex-wrap gap-1">
                  {suggestedTags
                    .filter((t) => !editingMember.tags.includes(t))
                    .slice(0, 6)
                    .map((tag) => (
                      <button
                        key={tag}
                        onClick={() => setEditingMember({ ...editingMember, tags: [...editingMember.tags, tag] })}
                        className="rounded-full border border-dashed border-gray-300 dark:border-neutral-600 px-2 py-0.5 text-[10px] text-gray-500 dark:text-neutral-400 hover:border-[#C2452D] hover:text-[#C2452D]"
                      >
                        + {tag}
                      </button>
                    ))}
                </div>
              </div>
            </div>

            {/* SMS Marketing Opt-out */}
            <div className="mt-4 flex items-center justify-between rounded-lg border border-gray-200 dark:border-neutral-600 px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-neutral-300">SMS Marketing Opt-out</p>
                <p className="text-xs text-gray-400">Member will not receive promotional SMS</p>
              </div>
              <button
                onClick={() => setEditingMember({ ...editingMember, sms_opt_out: !editingMember.sms_opt_out })}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                  editingMember.sms_opt_out ? "bg-red-500" : "bg-gray-200 dark:bg-neutral-600"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform",
                    editingMember.sms_opt_out ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-gray-100 dark:border-neutral-700 pt-4">
              <button
                onClick={() => setEditingMember(null)}
                className="rounded-lg border border-gray-300 dark:border-neutral-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveMember}
                className="rounded-lg bg-[#C2452D] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#A33822]"
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

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Shield,
  ShieldCheck,
  UserCircle,
  MoreHorizontal,
  X,
  ChevronDown,
  Eye,
  EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────
   Types
───────────────────────────────────────────── */
type Role = "Admin" | "Manager" | "Staff";
type Status = "Active" | "Inactive";

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: Status;
  lastLogin: string;
  outlets: string[];
}

/* ─────────────────────────────────────────────
   Helpers: map Supabase row to UI type
───────────────────────────────────────────── */
function mapRole(role: string): Role {
  if (role === "admin") return "Admin";
  if (role === "manager") return "Manager";
  return "Staff";
}

function mapRoleBack(role: Role): string {
  return role.toLowerCase();
}

function formatLastLogin(ts: string | null): string {
  if (!ts) return "Never";
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} weeks ago`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSupabaseUser(row: any): AdminUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: mapRole(row.role),
    status: row.is_active ? "Active" : "Inactive",
    lastLogin: formatLastLogin(row.last_login_at),
    outlets: row.outlets || [],
  };
}

const allOutlets = ["Shah Alam", "Conezion", "Tamarind Square"];

const avatarColors: Record<string, string> = {
  A: "#C2452D",
  F: "#2563eb",
  S: "#16a34a",
};

function getAvatarColor(name: string) {
  const letter = name.charAt(0).toUpperCase();
  return avatarColors[letter] || "#6b7280";
}

/* ─────────────────────────────────────────────
   Role & Status Badges
───────────────────────────────────────────── */
const roleBadgeClasses: Record<Role, string> = {
  Admin:
    "bg-[#C2452D]/10 text-[#C2452D] dark:bg-[#C2452D]/20 dark:text-[#e8765f]",
  Manager: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
  Staff: "bg-green-50 text-green-600 dark:bg-green-500/15 dark:text-green-400",
};

function RoleBadge({ role }: { role: Role }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        roleBadgeClasses[role]
      )}
    >
      {role === "Admin" ? (
        <ShieldCheck className="h-3 w-3" />
      ) : role === "Manager" ? (
        <Shield className="h-3 w-3" />
      ) : (
        <UserCircle className="h-3 w-3" />
      )}
      {role}
    </span>
  );
}

function StatusDot({ status }: { status: Status }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          status === "Active"
            ? "bg-green-500"
            : "bg-gray-300 dark:bg-neutral-600"
        )}
      />
      <span
        className={
          status === "Active"
            ? "text-green-600 dark:text-green-400"
            : "text-gray-400 dark:text-neutral-500"
        }
      >
        {status}
      </span>
    </span>
  );
}

/* ─────────────────────────────────────────────
   Add / Edit Modal
───────────────────────────────────────────── */
interface ModalProps {
  user: AdminUser | null; // null = adding new
  onClose: () => void;
  onSave: (user: AdminUser, password?: string) => void;
}

function UserModal({ user, onClose, onSave }: ModalProps) {
  const isEdit = !!user;
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "Staff");
  const [status, setStatus] = useState<Status>(user?.status ?? "Active");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [selectedOutlets, setSelectedOutlets] = useState<string[]>(
    user?.outlets ?? []
  );

  const toggleOutlet = (outlet: string) => {
    setSelectedOutlets((prev) =>
      prev.includes(outlet)
        ? prev.filter((o) => o !== outlet)
        : [...prev, outlet]
    );
  };

  const handleSave = () => {
    const saved: AdminUser = {
      id: user?.id ?? `user-${Date.now()}`,
      name,
      email,
      role,
      status,
      lastLogin: user?.lastLogin ?? "Never",
      outlets: role === "Admin" ? allOutlets : selectedOutlets,
    };
    onSave(saved, password || undefined);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 shadow-2xl shadow-gray-300/40 dark:shadow-black/50 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-neutral-700">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">
            {isEdit ? "Edit User" : "Add New User"}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-700 hover:text-gray-600 dark:hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-neutral-400 mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@celsiuscoffee.com"
              className="w-full rounded-xl border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700/50 px-4 py-2.5 text-sm font-sans text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#C2452D]/40 focus:border-[#C2452D] transition-colors"
            />
          </div>

          {/* Role */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-neutral-400 mb-1.5">
              Role
            </label>
            <div className="relative">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="w-full appearance-none rounded-xl border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700/50 px-4 py-2.5 pr-10 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#C2452D]/40 focus:border-[#C2452D] transition-colors"
              >
                <option value="Admin">Admin</option>
                <option value="Manager">Manager</option>
                <option value="Staff">Staff</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-neutral-500" />
            </div>
          </div>

          {/* Status Toggle */}
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-gray-600 dark:text-neutral-400">
              Status
            </label>
            <button
              type="button"
              onClick={() =>
                setStatus((s) => (s === "Active" ? "Inactive" : "Active"))
              }
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200",
                status === "Active"
                  ? "bg-green-500"
                  : "bg-gray-300 dark:bg-neutral-600"
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200",
                  status === "Active" ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
          </div>

          {/* Password (new user) / Reset Password (edit) */}
          {isEdit ? (
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-neutral-400 mb-1.5">
                Password
              </label>
              <button
                type="button"
                className="rounded-xl border border-gray-200 dark:border-neutral-600 px-4 py-2.5 text-sm font-medium text-[#C2452D] hover:bg-[#C2452D]/5 dark:hover:bg-[#C2452D]/10 transition-colors"
              >
                Reset Password
              </button>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-neutral-400 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="w-full rounded-xl border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700/50 px-4 pr-10 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#C2452D]/40 focus:border-[#C2452D] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-300 transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Outlets Access (Manager/Staff only) */}
          {role !== "Admin" && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-neutral-400 mb-2">
                Outlets Access
              </label>
              <div className="space-y-2">
                {allOutlets.map((outlet) => (
                  <label
                    key={outlet}
                    className="flex items-center gap-2.5 cursor-pointer group"
                  >
                    <input
                      type="checkbox"
                      checked={selectedOutlets.includes(outlet)}
                      onChange={() => toggleOutlet(outlet)}
                      className="h-4 w-4 rounded border-gray-300 dark:border-neutral-600 text-[#C2452D] focus:ring-[#C2452D]/40 dark:bg-neutral-700"
                    />
                    <span className="text-sm text-gray-700 dark:text-neutral-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
                      {outlet}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-neutral-700 bg-gray-50/50 dark:bg-neutral-800/50">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded-xl bg-[#C2452D] hover:bg-[#A93B26] px-5 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            {isEdit ? "Save Changes" : "Add User"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Role Permissions Section
───────────────────────────────────────────── */
function RolePermissions() {
  const [open, setOpen] = useState(false);

  const permissions = [
    {
      role: "Admin",
      icon: ShieldCheck,
      color: "text-[#C2452D]",
      desc: "Full access to all features",
    },
    {
      role: "Manager",
      icon: Shield,
      color: "text-blue-600 dark:text-blue-400",
      desc: "Can manage members, rewards, campaigns. Cannot manage users or billing.",
    },
    {
      role: "Staff",
      icon: UserCircle,
      color: "text-green-600 dark:text-green-400",
      desc: "POS access only. Cannot access admin dashboard.",
    },
  ];

  return (
    <div className="mt-8 rounded-2xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-neutral-750 transition-colors"
      >
        <span className="text-sm font-semibold text-gray-900 dark:text-white">
          Role Permissions
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-gray-400 dark:text-neutral-500 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="border-t border-gray-100 dark:border-neutral-700 px-5 py-4 space-y-4">
          {permissions.map((p) => (
            <div key={p.role} className="flex items-start gap-3">
              <p.icon className={cn("h-5 w-5 mt-0.5 flex-shrink-0", p.color)} />
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  {p.role}
                </p>
                <p className="text-sm text-gray-500 dark:text-neutral-400 mt-0.5">
                  {p.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Actions Dropdown
───────────────────────────────────────────── */
function ActionsDropdown({
  user,
  onEdit,
  onDelete,
}: {
  user: AdminUser;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-700 hover:text-gray-600 dark:hover:text-white transition-colors"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-lg shadow-gray-200/60 dark:shadow-black/40 overflow-hidden">
            <button
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
            <button
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
            >
              <Shield className="h-3.5 w-3.5" />
              Reset Password
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Main Page
───────────────────────────────────────────── */
export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin-users");
      const data = await res.json();
      if (Array.isArray(data)) {
        setUsers(data.map(mapSupabaseUser));
      }
    } catch (err) {
      console.error("Failed to load users:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const openAdd = () => {
    setEditingUser(null);
    setModalOpen(true);
  };

  const openEdit = (user: AdminUser) => {
    setEditingUser(user);
    setModalOpen(true);
  };

  const handleSave = async (saved: AdminUser, password?: string) => {
    const isEdit = users.some((u) => u.id === saved.id);

    try {
      if (isEdit) {
        // PUT update
        await fetch("/api/admin-users", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: saved.id,
            name: saved.name,
            email: saved.email,
            role: mapRoleBack(saved.role),
            is_active: saved.status === "Active",
            outlets: saved.outlets,
            ...(password ? { password } : {}),
          }),
        });
      } else {
        // POST create
        if (!password) return;
        await fetch("/api/admin-users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: saved.name,
            email: saved.email,
            password,
            role: mapRoleBack(saved.role),
            is_active: saved.status === "Active",
            outlets: saved.outlets,
          }),
        });
      }
      await fetchUsers();
    } catch (err) {
      console.error("Failed to save user:", err);
    }

    setModalOpen(false);
    setEditingUser(null);
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/admin-users?id=${id}`, { method: "DELETE" });
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } catch (err) {
      console.error("Failed to delete user:", err);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            User Management
          </h1>
          <p className="text-sm text-gray-500 dark:text-neutral-400 mt-1">
            Manage admin dashboard users and permissions
          </p>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-2 rounded-xl bg-[#C2452D] hover:bg-[#A93B26] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add User
        </button>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-left">
            <thead>
              <tr className="border-b border-gray-100 dark:border-neutral-700 bg-gray-50/60 dark:bg-neutral-800/60">
                <th className="px-5 py-3.5 text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider whitespace-nowrap">
                  User
                </th>
                <th className="px-5 py-3.5 text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider whitespace-nowrap">
                  Email
                </th>
                <th className="px-5 py-3.5 text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider whitespace-nowrap">
                  Role
                </th>
                <th className="px-5 py-3.5 text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider whitespace-nowrap">
                  Status
                </th>
                <th className="px-5 py-3.5 text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider whitespace-nowrap">
                  Last Login
                </th>
                <th className="px-5 py-3.5 text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider text-right whitespace-nowrap">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-neutral-700">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-gray-400 dark:text-neutral-500">
                    Loading users...
                  </td>
                </tr>
              )}
              {!loading && users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-gray-400 dark:text-neutral-500">
                    No users found
                  </td>
                </tr>
              )}
              {!loading && users.map((user) => (
                <tr
                  key={user.id}
                  className="hover:bg-gray-50/50 dark:hover:bg-neutral-750/50 transition-colors"
                >
                  {/* Avatar + Name */}
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-9 w-9 items-center justify-center rounded-full text-white text-sm font-bold flex-shrink-0"
                        style={{
                          backgroundColor: getAvatarColor(user.name),
                        }}
                      >
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white whitespace-nowrap">
                        {user.name}
                      </span>
                    </div>
                  </td>

                  {/* Email */}
                  <td className="px-5 py-4">
                    <span className="text-sm font-sans text-gray-600 dark:text-neutral-400 whitespace-nowrap">
                      {user.email}
                    </span>
                  </td>

                  {/* Role */}
                  <td className="px-5 py-4">
                    <RoleBadge role={user.role} />
                  </td>

                  {/* Status */}
                  <td className="px-5 py-4">
                    <StatusDot status={user.status} />
                  </td>

                  {/* Last Login */}
                  <td className="px-5 py-4">
                    <span className="text-sm font-sans text-gray-500 dark:text-neutral-400 whitespace-nowrap">
                      {user.lastLogin}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(user)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-700 hover:text-gray-600 dark:hover:text-white transition-colors"
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(user.id)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <ActionsDropdown
                        user={user}
                        onEdit={() => openEdit(user)}
                        onDelete={() => handleDelete(user.id)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Role Permissions */}
      <RolePermissions />

      {/* Modal */}
      {modalOpen && (
        <UserModal
          user={editingUser}
          onClose={() => {
            setModalOpen(false);
            setEditingUser(null);
          }}
          onSave={handleSave}
        />
      )}
    </>
  );
}

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { FEATURE_KEYS, FEATURE_LABELS, type FeatureKey } from "../lib/features";
import { Panel } from "../components/ui/Panel";
import { Modal } from "../components/ui/Modal";
import {
  UsersIcon,
  TrashIcon,
  PlusIcon,
  KeyIcon,
  ShieldCheckIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";

interface UserDTO {
  id: number;
  username: string;
  role: string;
  created_at?: string;
}

interface RoleDTO {
  id: string;
  label: string;
  features: string[];
  locked: boolean;
}

export function Users() {
  const { show } = useToast();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";

  const [familyUsers, setFamilyUsers] = useState<UserDTO[]>([]);
  const [roles, setRoles] = useState<RoleDTO[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState("member");
  const [creatingUser, setCreatingUser] = useState(false);

  const [resetPasswordUser, setResetPasswordUser] = useState<UserDTO | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);

  const [confirmDeleteUser, setConfirmDeleteUser] = useState<UserDTO | null>(null);
  const [confirmDeleteRole, setConfirmDeleteRole] = useState<RoleDTO | null>(null);

  const [newRoleId, setNewRoleId] = useState("");
  const [newRoleLabel, setNewRoleLabel] = useState("");
  const [creatingRole, setCreatingRole] = useState(false);
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);

  function loadData() {
    setLoadingUsers(true);
    Promise.all([
      api<UserDTO[]>("/users"),
      api<{ roles: RoleDTO[]; featureKeys: string[] }>("/roles"),
    ])
      .then(([u, r]) => {
        setFamilyUsers(u);
        setRoles(r.roles);
      })
      .catch((err) => show(err instanceof Error ? err.message : "Failed to load users", "error"))
      .finally(() => setLoadingUsers(false));
  }

  useEffect(() => {
    if (!isAdmin) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function createUser() {
    if (!newUsername.trim() || !newUserPassword) {
      show("Username and password are required", "warning");
      return;
    }
    setCreatingUser(true);
    try {
      const created = await api<UserDTO>("/users", {
        method: "POST",
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newUserPassword,
          role: newUserRole,
        }),
      });
      setFamilyUsers((prev) => [...prev, created]);
      setNewUsername("");
      setNewUserPassword("");
      show(`User ${created.username} created`, "success");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to create user", "error");
    } finally {
      setCreatingUser(false);
    }
  }

  async function changeUserRole(u: UserDTO, nextRole: string) {
    try {
      const updated = await api<UserDTO>(`/users/${u.id}`, {
        method: "PUT",
        body: JSON.stringify({ role: nextRole }),
      });
      setFamilyUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
      show(`Updated ${u.username} to ${nextRole}`, "success");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to change role", "error");
    }
  }

  async function submitResetPassword() {
    if (!resetPasswordUser || !resetPasswordValue) return;
    setResettingPassword(true);
    try {
      await api(`/users/${resetPasswordUser.id}`, {
        method: "PUT",
        body: JSON.stringify({ password: resetPasswordValue }),
      });
      show(`Password reset for ${resetPasswordUser.username}`, "success");
      setResetPasswordUser(null);
      setResetPasswordValue("");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to reset password", "error");
    } finally {
      setResettingPassword(false);
    }
  }

  async function submitDeleteUser() {
    if (!confirmDeleteUser) return;
    try {
      await api(`/users/${confirmDeleteUser.id}`, { method: "DELETE" });
      setFamilyUsers((prev) => prev.filter((x) => x.id !== confirmDeleteUser.id));
      show(`Removed ${confirmDeleteUser.username}`, "success");
      setConfirmDeleteUser(null);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to delete user", "error");
    }
  }

  async function toggleRoleFeature(r: RoleDTO, feature: FeatureKey) {
    if (r.locked) return;
    const nextFeatures = r.features.includes(feature)
      ? r.features.filter((f) => f !== feature)
      : [...r.features, feature];
    setSavingRoleId(r.id);
    try {
      const updated = await api<RoleDTO>(`/roles/${r.id}`, {
        method: "PUT",
        body: JSON.stringify({ features: nextFeatures }),
      });
      setRoles((prev) => prev.map((x) => (x.id === r.id ? updated : x)));
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to update role", "error");
    } finally {
      setSavingRoleId(null);
    }
  }

  async function createRole() {
    if (!newRoleId.trim() || !newRoleLabel.trim()) {
      show("Role ID and label are required", "warning");
      return;
    }
    setCreatingRole(true);
    try {
      const created = await api<RoleDTO>("/roles", {
        method: "POST",
        body: JSON.stringify({ id: newRoleId.trim(), label: newRoleLabel.trim(), features: [] }),
      });
      setRoles((prev) => [...prev, created]);
      setNewRoleId("");
      setNewRoleLabel("");
      show(`Role ${created.label} added`, "success");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to create role", "error");
    } finally {
      setCreatingRole(false);
    }
  }

  async function submitDeleteRole() {
    if (!confirmDeleteRole) return;
    try {
      await api(`/roles/${confirmDeleteRole.id}`, { method: "DELETE" });
      setRoles((prev) => prev.filter((x) => x.id !== confirmDeleteRole.id));
      show(`Role ${confirmDeleteRole.label} deleted`, "success");
      setConfirmDeleteRole(null);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to delete role", "error");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
            <UsersIcon className="w-7 h-7 text-blue-400" />
            Users & Roles
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">
            Manage user accounts, passwords, and role-based feature access (RBAC)
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {/* User Accounts Panel */}
        <Panel title={`Family accounts (${familyUsers.length})`}>
          <p className="text-xs text-gray-500 mb-4">
            Accounts log in independently and can only access modules granted by their assigned role.
          </p>

          {loadingUsers ? (
            <p className="text-sm text-gray-500 py-4">Loading accounts...</p>
          ) : (
            <div className="space-y-2 mb-6">
              {familyUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/5 hover:bg-white/7 rounded-xl p-3.5 border border-white/5 transition"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-xs uppercase shrink-0">
                      {u.username.slice(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-200 truncate">{u.username}</span>
                        {u.id === currentUser?.id && (
                          <span className="text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded font-mono">
                            You
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-500 font-mono mt-0.5">Role: {u.role}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">
                    <select
                      value={u.role}
                      onChange={(e) => changeUserRole(u, e.target.value)}
                      className="input-field !py-1 text-xs"
                      disabled={u.id === currentUser?.id}
                    >
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>

                    <button
                      className="btn-secondary !py-1 !px-2.5 text-xs flex items-center gap-1"
                      onClick={() => {
                        setResetPasswordUser(u);
                        setResetPasswordValue("");
                      }}
                      title="Reset password"
                    >
                      <KeyIcon className="w-3.5 h-3.5" />
                      <span>Reset</span>
                    </button>

                    {u.id !== currentUser?.id && (
                      <button
                        className="btn-danger !py-1 !px-2 text-xs"
                        onClick={() => setConfirmDeleteUser(u)}
                        title="Remove user"
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add New User */}
          <div className="pt-4 border-t border-white/10">
            <p className="text-xs font-semibold text-gray-300 mb-3 flex items-center gap-1.5">
              <UserPlusIcon className="w-4 h-4 text-blue-400" />
              Add new account
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Username"
                className="input-field text-sm"
              />
              <input
                type="password"
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                placeholder="Password"
                className="input-field text-sm"
              />
              <select
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value)}
                className="input-field text-sm"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="btn-primary text-xs disabled:opacity-60 flex items-center gap-1.5"
              onClick={createUser}
              disabled={creatingUser}
            >
              <PlusIcon className="w-3.5 h-3.5" />
              {creatingUser ? "Creating..." : "Create user account"}
            </button>
          </div>
        </Panel>

        {/* Roles & Permissions Matrix */}
        <Panel title="Role permissions matrix (RBAC)">
          <p className="text-xs text-gray-500 mb-4">
            Granular permission matrix. Check or uncheck features to grant or restrict access per role.
          </p>

          <div className="space-y-4">
            {roles.map((r) => (
              <div key={r.id} className="bg-white/5 rounded-xl p-4 border border-white/5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheckIcon className="w-5 h-5 text-blue-400" />
                    <span className="text-sm font-bold text-gray-100">{r.label}</span>
                    <span className="text-xs text-gray-500 font-mono">({r.id})</span>
                    {r.locked && (
                      <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full font-mono">
                        Superuser · Locked
                      </span>
                    )}
                  </div>
                  {!r.locked && (
                    <button
                      className="text-gray-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-500/10 transition"
                      onClick={() => setConfirmDeleteRole(r)}
                      title="Delete role"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {!r.locked ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {FEATURE_KEYS.map((key: FeatureKey) => {
                      const hasFeature = r.features.includes(key);
                      return (
                        <label
                          key={key}
                          className={`flex items-center gap-2 text-xs rounded-lg p-2.5 cursor-pointer transition border select-none ${
                            hasFeature
                              ? "bg-blue-600/15 border-blue-500/30 text-blue-200"
                              : "bg-black/30 border-white/5 text-gray-400 hover:bg-black/50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={hasFeature}
                            disabled={savingRoleId === r.id}
                            onChange={() => toggleRoleFeature(r, key)}
                            className="rounded accent-blue-500"
                          />
                          <span className="truncate">{FEATURE_LABELS[key]}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 italic">
                    Admin role has unrestricted access to all current and future modules.
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Add Role */}
          <div className="flex flex-col sm:flex-row gap-2 mt-4 pt-4 border-t border-white/10">
            <input
              value={newRoleId}
              onChange={(e) => setNewRoleId(e.target.value.trim().toLowerCase().replace(/\s+/g, "-"))}
              placeholder="role-id (e.g. kids)"
              className="input-field flex-1 text-xs font-mono"
            />
            <input
              value={newRoleLabel}
              onChange={(e) => setNewRoleLabel(e.target.value)}
              placeholder="Display Name (e.g. Kids Profile)"
              className="input-field flex-1 text-xs"
            />
            <button
              className="btn-secondary text-xs disabled:opacity-60 shrink-0 flex items-center gap-1.5"
              onClick={createRole}
              disabled={creatingRole}
            >
              <PlusIcon className="w-3.5 h-3.5" />
              {creatingRole ? "Adding..." : "Add role"}
            </button>
          </div>
        </Panel>
      </div>

      {/* Modals */}
      {resetPasswordUser && (
        <Modal title={`Reset password for ${resetPasswordUser.username}`} onClose={() => setResetPasswordUser(null)}>
          <p className="text-xs text-gray-400 mb-3">Enter a new password for this account:</p>
          <input
            type="password"
            value={resetPasswordValue}
            onChange={(e) => setResetPasswordValue(e.target.value)}
            placeholder="New password"
            className="input-field w-full text-sm mb-4"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              className="btn-primary flex-1 text-xs disabled:opacity-60"
              onClick={submitResetPassword}
              disabled={resettingPassword || !resetPasswordValue}
            >
              {resettingPassword ? "Saving..." : "Save password"}
            </button>
            <button className="btn-secondary flex-1 text-xs" onClick={() => setResetPasswordUser(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {confirmDeleteUser && (
        <Modal title="Remove account" onClose={() => setConfirmDeleteUser(null)}>
          <p className="text-sm text-gray-300">
            Remove user <span className="font-semibold text-gray-100">{confirmDeleteUser.username}</span>? They will be
            signed out immediately.
          </p>
          <div className="flex gap-2 mt-5">
            <button className="btn-danger flex-1 text-xs" onClick={submitDeleteUser}>
              Remove user
            </button>
            <button className="btn-secondary flex-1 text-xs" onClick={() => setConfirmDeleteUser(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {confirmDeleteRole && (
        <Modal title="Delete role" onClose={() => setConfirmDeleteRole(null)}>
          <p className="text-sm text-gray-300">
            Delete role <span className="font-semibold text-gray-100">{confirmDeleteRole.label}</span>? Any user
            assigned to it must be moved to another role first.
          </p>
          <div className="flex gap-2 mt-5">
            <button className="btn-danger flex-1 text-xs" onClick={submitDeleteRole}>
              Delete role
            </button>
            <button className="btn-secondary flex-1 text-xs" onClick={() => setConfirmDeleteRole(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

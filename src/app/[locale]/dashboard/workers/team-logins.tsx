"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { TEAM_ROLES, type TeamRole } from "@/lib/auth/permissions";
import {
  createTeamLogin,
  resetTeamLoginPassword,
  revokeTeamLogin,
  setTeamLoginActive,
} from "./actions";
import { generatePassword } from "./password";
import { ConfirmDialog } from "../_components/confirm-dialog";
import { ErrorToast } from "../_components/toast";

// Reception and finance logins, below the staff list. What each role can then
// reach is decided server-side (lib/auth/permissions); the hints here only say
// so plainly, so the owner knows what they are handing over.

export type TeamLoginRow = {
  id: string;
  role: TeamRole;
  name: string;
  email: string;
  active: boolean;
  /** The branch a reception login is pinned to; null for finance, which spans the account. */
  branch: string | null;
  /** The employee the login is linked to, if any. */
  employeeName: string | null;
};

export type TeamSection = {
  logins: TeamLoginRow[];
  /** Which roles this owner's plan lets them hand out. */
  assignable: Record<TeamRole, boolean>;
  /** Active employees of this branch without a login, for the optional link. */
  linkable: { id: string; name: string }[];
  multiBranch: boolean;
};

const inputCls =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint-foreground focus:border-rose-500 focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";
const actionCls =
  "text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-60";

const PLAN_NOTE = {
  ADMIN: "team.planAdmin",
  FINANCE: "team.planFinance",
} as const satisfies Record<TeamRole, string>;

export function TeamLogins({ logins, assignable, linkable, multiBranch }: TeamSection) {
  const t = useTranslations("Workers");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [resetFor, setResetFor] = useState<TeamLoginRow | null>(null);
  const [revokeFor, setRevokeFor] = useState<TeamLoginRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function toggle(login: TeamLoginRow) {
    startTransition(async () => {
      const res = await setTeamLoginActive(login.id, !login.active);
      if (!res.ok) setToast(res.error);
      router.refresh();
    });
  }

  function revoke(login: TeamLoginRow) {
    startTransition(async () => {
      const res = await revokeTeamLogin(login.id);
      if (!res.ok) setToast(res.error);
      setRevokeFor(null);
      router.refresh();
    });
  }

  return (
    <section className="mt-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{t("team.title")}</h2>
          <p className="mt-0.5 max-w-xl text-sm text-faint-foreground">{t("team.subtitle")}</p>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-secondary-foreground transition hover:bg-hover"
          >
            {t("team.add")}
          </button>
        )}
      </div>

      {adding && (
        <CreateTeamLogin
          assignable={assignable}
          linkable={linkable}
          onClose={() => setAdding(false)}
        />
      )}

      {logins.length === 0 ? (
        !adding && (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-faint-foreground">
            {t("team.empty")}
          </p>
        )
      ) : (
        <ul className="space-y-2">
          {logins.map((login) => (
            <li
              key={login.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-3.5"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-medium text-foreground">{login.name}</p>
                  <span className="rounded-full border border-border-strong px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {t(`team.roles.${login.role}`)}
                  </span>
                  {!login.active && (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {t("team.disabled")}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-sm text-faint-foreground">
                  {login.email}
                  {multiBranch && (
                    <>
                      <span> · </span>
                      {login.branch ?? t("team.allBranches")}
                    </>
                  )}
                  {login.employeeName && (
                    <>
                      <span> · </span>
                      {t("team.linkedTo", { name: login.employeeName })}
                    </>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button onClick={() => setResetFor(login)} disabled={pending} className={actionCls}>
                  {t("team.resetPassword")}
                </button>
                <button onClick={() => toggle(login)} disabled={pending} className={actionCls}>
                  {login.active ? t("deactivate") : t("activate")}
                </button>
                <button
                  onClick={() => setRevokeFor(login)}
                  disabled={pending}
                  className="text-sm text-rose-700 transition hover:text-rose-400 disabled:opacity-60 dark:text-rose-400/80"
                >
                  {t("access.revoke")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {resetFor && <ResetTeamPassword login={resetFor} onClose={() => setResetFor(null)} />}
      {revokeFor && (
        <ConfirmDialog
          title={t("access.revoke")}
          body={t("team.revokeConfirm", { name: revokeFor.name })}
          pending={pending}
          onConfirm={() => revoke(revokeFor)}
          onClose={() => setRevokeFor(null)}
        />
      )}
      {toast && <ErrorToast message={toast} onClose={() => setToast(null)} />}
    </section>
  );
}

function CreateTeamLogin({
  assignable,
  linkable,
  onClose,
}: Pick<TeamSection, "assignable" | "linkable"> & { onClose: () => void }) {
  const t = useTranslations("Workers");
  const tc = useTranslations("Common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [role, setRole] = useState<TeamRole>(
    TEAM_ROLES.find((r) => assignable[r]) ?? TEAM_ROLES[0],
  );
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Shown once, so the owner can copy it before handing it over.
  const [issued, setIssued] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIssued(null);
    if (!fullName.trim()) return setError(t("team.errors.nameRequired"));
    if (!email.trim()) return setError(t("access.errors.emailRequired"));
    if (!password) return setError(t("access.errors.passwordRequired"));

    startTransition(async () => {
      const res = await createTeamLogin({
        role,
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        employeeId: employeeId || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setIssued(password);
      setFullName("");
      setEmail("");
      setPassword("");
      setEmployeeId("");
      router.refresh();
    });
  }

  return (
    <div className="mb-4 rounded-xl border border-border bg-card p-5">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelCls}>{t("team.role")}</label>
          <div className="grid gap-2 sm:grid-cols-2">
            {TEAM_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                disabled={!assignable[r]}
                aria-pressed={role === r}
                onClick={() => setRole(r)}
                className={
                  "rounded-lg border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60 " +
                  (role === r
                    ? "border-rose-500/50 bg-rose-500/10"
                    : "border-border hover:bg-hover")
                }
              >
                <span className="block text-sm font-medium text-foreground">
                  {t(`team.roles.${r}`)}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {assignable[r] ? t(`team.roleHint.${r}`) : t(PLAN_NOTE[r])}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>{t("team.fullName")}</label>
            <input
              className={inputCls + " w-full"}
              placeholder={t("team.fullNamePlaceholder")}
              maxLength={120}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>{t("access.email")}</label>
            <input
              type="email"
              autoComplete="off"
              className={inputCls + " w-full"}
              maxLength={200}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>{t("access.password")}</label>
          <PasswordInput value={password} onChange={setPassword} />
        </div>

        {linkable.length > 0 && (
          <div>
            <label className={labelCls}>{t("team.employee")}</label>
            <select
              className={inputCls + " w-full"}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">{t("team.employeeNone")}</option>
              {linkable.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-faint-foreground">{t("team.employeeHint")}</p>
          </div>
        )}

        {error && <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={pending || !assignable[role]}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-60"
          >
            {pending ? t("saving") : t("team.create")}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-secondary-foreground transition hover:bg-hover disabled:opacity-60"
          >
            {issued ? tc("close") : tc("cancel")}
          </button>
        </div>
      </form>

      {issued && <IssuedPassword key={issued} password={issued} />}
    </div>
  );
}

function ResetTeamPassword({ login, onClose }: { login: TeamLoginRow; onClose: () => void }) {
  const t = useTranslations("Workers");
  const tc = useTranslations("Common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIssued(null);
    if (!password) return setError(t("access.errors.passwordRequired"));
    startTransition(async () => {
      const res = await resetTeamLoginPassword({ membershipId: login.id, password });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setIssued(password);
      setPassword("");
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">
            {t("access.titleFor", { name: login.name })}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tc("close")}
            title={tc("close")}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-hover hover:text-foreground"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <label className={labelCls}>{t("access.email")}</label>
            <p className="rounded-lg bg-muted px-3 py-2 font-mono text-sm text-secondary-foreground">
              {login.email}
            </p>
          </div>
          <div>
            <label className={labelCls}>{t("access.newPassword")}</label>
            <PasswordInput value={password} onChange={setPassword} />
          </div>
          {error && <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-60"
          >
            {pending ? t("saving") : t("access.resetSubmit")}
          </button>
        </form>

        {issued && <IssuedPassword key={issued} password={issued} />}
      </div>
    </div>
  );
}

function PasswordInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations("Workers");
  return (
    <div className="flex gap-2">
      <input
        type="text"
        autoComplete="off"
        className={inputCls + " w-full font-mono"}
        maxLength={200}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() => onChange(generatePassword())}
        className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-medium text-secondary-foreground transition hover:bg-hover"
      >
        {t("access.generate")}
      </button>
    </div>
  );
}

function IssuedPassword({ password }: { password: string }) {
  const t = useTranslations("Workers");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      // Clipboard access needs a secure context and can simply be refused; the
      // password is on screen either way, so this is not worth an error.
    }
  }

  return (
    <div className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2.5">
      <p className="text-sm text-emerald-700 dark:text-emerald-300">{t("team.issued")}</p>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <code className="min-w-0 truncate text-sm text-foreground">{password}</code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 text-xs font-medium text-emerald-700 transition hover:underline dark:text-emerald-300"
        >
          {copied ? t("access.copied") : t("access.copy")}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-faint-foreground">{t("access.issuedNote")}</p>
    </div>
  );
}

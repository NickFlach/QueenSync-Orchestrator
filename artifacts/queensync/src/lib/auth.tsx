import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Role = "operator" | "viewer";

export interface SessionInfo {
  role: Role | null;
  source?: string;
  authConfigured: boolean;
  passwordLoginAvailable: boolean;
  requireAuthForReads: boolean;
}

interface AuthContextValue {
  session: SessionInfo | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  login: (password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthContextValue | null>(null);

const SESSION_URL = "/api/auth/session";
const LOGIN_URL = "/api/auth/login";
const LOGOUT_URL = "/api/auth/logout";

async function fetchSession(): Promise<SessionInfo> {
  const r = await fetch(SESSION_URL, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  if (r.status === 401) {
    const body = (await r.json().catch(() => ({}))) as Partial<SessionInfo>;
    return {
      role: null,
      authConfigured: body.authConfigured ?? true,
      passwordLoginAvailable: body.passwordLoginAvailable ?? false,
      requireAuthForReads: body.requireAuthForReads ?? false,
    };
  }
  if (!r.ok) {
    throw new Error(`session check failed: ${r.status}`);
  }
  const body = (await r.json()) as SessionInfo;
  return {
    role: body.role ?? null,
    source: body.source,
    authConfigured: body.authConfigured ?? false,
    passwordLoginAvailable: body.passwordLoginAvailable ?? false,
    requireAuthForReads: body.requireAuthForReads ?? false,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const info = await fetchSession();
      setSession(info);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(
    async (password: string): Promise<{ ok: boolean; error?: string }> => {
      const r = await fetch(LOGIN_URL, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: body.error ?? `login failed (${r.status})` };
      }
      await refresh();
      return { ok: true };
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await fetch(LOGOUT_URL, {
      method: "POST",
      credentials: "same-origin",
    }).catch(() => undefined);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({ session, loading, error, refresh, login, logout }),
    [session, loading, error, refresh, login, logout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}

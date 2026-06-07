import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { auth } from '../lib/firebase';

interface AuthState {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // onIdTokenChanged fires both on sign-in/out AND when custom claims refresh,
    // so admin status updates without needing the user to re-login after promotion.
    const unsub = onIdTokenChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Token presence: we can derive a fresh raw JWT to confirm the
        // user genuinely has a token (not just a stale user object).
        let rawTokenLength = 0;
        try {
          const raw = await u.getIdToken();
          rawTokenLength = raw.length;
        } catch {
          rawTokenLength = -1; // indicates getIdToken threw
        }
        const token = await u.getIdTokenResult();
        // [auth-debug] Snapshot of auth state at the moment the rule
        // would evaluate. The `role` and `uid` here are EXACTLY what the
        // server-side rule sees as `request.auth.token.role` and
        // `request.auth.uid`. If your uid doesn't match the allowlisted
        // UID in firestore.rules / storage.rules, the rule denies and
        // every read fails. `tokenPresent: false` means no JWT at all
        // (request.auth would be null server-side).
        // eslint-disable-next-line no-console
        console.log('[auth-debug] auth state changed (signed in):', {
          uid: u.uid,
          email: u.email,
          emailVerified: u.emailVerified,
          providerId: u.providerData[0]?.providerId ?? '(none)',
          tokenPresent: rawTokenLength > 0,
          rawTokenLength,
          role: token.claims.role ?? '(missing)',
          isAdminComputed: token.claims.role === 'admin',
          issuedAt: token.issuedAtTime,
          expirationTime: token.expirationTime,
          authTime: token.authTime,
          allClaims: token.claims,
        });
        setIsAdmin(token.claims.role === 'admin');
      } else {
        // eslint-disable-next-line no-console
        console.log('[auth-debug] auth state changed (signed out): no user — request.auth would be null server-side.');
        setIsAdmin(false);
      }
      setLoading(false);
    });

    // [DEBUG] window.__forceTokenRefresh() — call from DevTools to force a token
    // refresh from Firebase Auth's servers. Use this if the admin claim was set
    // via the seed script AFTER your current session signed in: passing
    // forceRefresh=true to getIdToken triggers a server round-trip that picks
    // up new custom claims without requiring sign-out + sign-in. The
    // subsequent onIdTokenChanged callback will re-log the claims.
    (window as unknown as { __forceTokenRefresh?: () => Promise<void> }).__forceTokenRefresh =
      async () => {
        const u = auth.currentUser;
        if (!u) {
          // eslint-disable-next-line no-console
          console.warn('[auth] __forceTokenRefresh: no signed-in user');
          return;
        }
        // eslint-disable-next-line no-console
        console.log('[auth] __forceTokenRefresh: requesting fresh token…');
        await u.getIdToken(true);
        // onIdTokenChanged will fire and re-log the claims.
      };

    return unsub;
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      isAdmin,
      loading,
      signIn: async (email, password) => {
        await signInWithEmailAndPassword(auth, email, password);
      },
      signOut: async () => {
        await fbSignOut(auth);
      },
    }),
    [user, isAdmin, loading],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

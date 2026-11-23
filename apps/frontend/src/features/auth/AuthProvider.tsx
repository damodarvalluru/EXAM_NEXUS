import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  AuthenticatedResult,
  LoginResult,
  StepUpResult,
  UserView,
} from '@examnexus/shared';
import {
  apiGet,
  apiPost,
  getAccessToken,
  publicPost,
  setAccessToken,
  subscribeAccessToken,
} from '../../lib/api-client';
import { queryClient } from '../../lib/query-client';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  user: UserView | null;
  status: AuthStatus;
  challengeToken: string | null;
  login: (identifier: string, password: string) => Promise<LoginResult>;
  pinLogin: (identifier: string, pin: string) => Promise<LoginResult>;
  verifyMfa: (code?: string, recoveryCode?: string) => Promise<AuthenticatedResult>;
  stepUp: (input: { password?: string; pin?: string; code?: string }) => Promise<StepUpResult>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function applyAuthenticated(result: AuthenticatedResult): void {
  setAccessToken(result.accessToken);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserView | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [challengeToken, setChallengeToken] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    try {
      const current = await apiGet<UserView>('/auth/me');
      setUser(current);
      setStatus('authenticated');
    } catch {
      setUser(null);
      setStatus('unauthenticated');
      setAccessToken(null);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  useEffect(
    () =>
      subscribeAccessToken(() => {
        if (!getAccessToken()) {
          setUser(null);
          setStatus('unauthenticated');
        }
      }),
    [],
  );

  const acceptLoginResult = useCallback((result: LoginResult): LoginResult => {
    if (result.status === 'AUTHENTICATED') {
      setChallengeToken(null);
      applyAuthenticated(result);
      setUser(result.user);
      setStatus('authenticated');
    } else {
      setChallengeToken(result.challengeToken);
    }
    return result;
  }, []);

  const login = useCallback(
    async (identifier: string, password: string) =>
      acceptLoginResult(await publicPost<LoginResult>('/auth/login', { identifier, password })),
    [acceptLoginResult],
  );

  const pinLogin = useCallback(
    async (identifier: string, pin: string) =>
      acceptLoginResult(await publicPost<LoginResult>('/auth/pin', { identifier, pin })),
    [acceptLoginResult],
  );

  const verifyMfa = useCallback(async (code?: string, recoveryCode?: string) => {
    if (!challengeToken) throw new Error('No MFA challenge is active. Sign in again.');
    const result = await publicPost<AuthenticatedResult>('/auth/mfa/verify', {
      challengeToken,
      ...(code ? { code } : {}),
      ...(recoveryCode ? { recoveryCode } : {}),
    });
    applyAuthenticated(result);
    setChallengeToken(null);
    setUser(result.user);
    setStatus('authenticated');
    return result;
  }, [challengeToken]);

  const stepUp = useCallback(async (input: { password?: string; pin?: string; code?: string }) => {
    const result = await apiPost<StepUpResult>('/auth/step-up', input);
    setAccessToken(result.accessToken);
    return result;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiPost('/auth/logout');
    } catch {
      // Clear local state even when the server session is already gone.
    }
    setAccessToken(null);
    setChallengeToken(null);
    queryClient.clear();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, challengeToken, login, pinLogin, verifyMfa, stepUp, logout, refreshUser }),
    [user, status, challengeToken, login, pinLogin, verifyMfa, stepUp, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

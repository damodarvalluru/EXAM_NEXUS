import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MfaEnrollment, RecoveryCodesResult, SessionView, UserView } from '@examnexus/shared';
import { KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { apiGet, apiPost } from '../../lib/api-client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ErrorBanner, LoadingRows, PageHeader } from '../../components/ui/DataState';

const STEP_UP_WINDOW_MS = 10 * 60 * 1000;

export function ProfilePage() {
  const { user, stepUp, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [codes, setCodes] = useState<RecoveryCodesResult | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [stepUpInput, setStepUpInput] = useState({ password: '', pin: '', code: '' });
  const [stepUpAt, setStepUpAt] = useState<number | null>(null);
  const [newPin, setNewPin] = useState('');
  const [passwordInput, setPasswordInput] = useState({ currentPassword: '', newPassword: '' });
  const [phoneCode, setPhoneCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const me = useQuery({
    queryKey: ['profile', 'me'],
    queryFn: ({ signal }) => apiGet<UserView>('/auth/me', { signal }),
  });
  const sessions = useQuery({
    queryKey: ['profile', 'sessions'],
    queryFn: ({ signal }) => apiGet<SessionView[]>('/auth/sessions', { signal }),
  });

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['profile'] }),
      refreshUser(),
    ]);
  };

  const enroll = useMutation({
    mutationFn: () => apiPost<MfaEnrollment>('/auth/mfa/enroll'),
    onSuccess: (result) => { setEnrollment(result); setError(null); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Enrolment failed'),
  });
  const confirm = useMutation({
    mutationFn: () => apiPost<RecoveryCodesResult>('/auth/mfa/confirm', { code: confirmCode }),
    onSuccess: async (result) => {
      setCodes(result);
      setEnrollment(null);
      setConfirmCode('');
      setMessage('Authenticator enabled. Store your recovery codes offline.');
      await invalidateAll();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Confirmation failed'),
  });
  const regenerate = useMutation({
    mutationFn: () => apiPost<RecoveryCodesResult>('/auth/mfa/recovery-codes', { code: recoveryCode }),
    onSuccess: (result) => { setCodes(result); setRecoveryCode(''); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Regeneration failed'),
  });
  const changePassword = useMutation({
    mutationFn: () => apiPost('/auth/password/change', passwordInput),
    onSuccess: async () => {
      setMessage('Password changed. All sessions were revoked; please sign in again.');
      await logout();
      navigate('/login', { replace: true });
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Password change failed'),
  });
  const revokeSession = useMutation({
    mutationFn: (id: string) => apiPost(`/auth/sessions/${id}/revoke`),
    onSuccess: invalidateAll,
  });
  const requestPhone = useMutation({
    mutationFn: () => apiPost('/auth/phone/request'),
    onSuccess: () => setMessage('Phone verification code issued.'),
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Could not issue phone code'),
  });
  const verifyPhone = useMutation({
    mutationFn: () => apiPost('/auth/phone/verify', { code: phoneCode }),
    onSuccess: async () => { setMessage('Phone verified.'); await invalidateAll(); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Phone verification failed'),
  });
  const performStepUp = useMutation({
    mutationFn: () => stepUp(stepUpInput),
    onSuccess: (result) => { setStepUpAt(Date.parse(result.stepUpVerifiedAt)); setError(null); setMessage('Step-up proof accepted for 10 minutes.'); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Step-up failed'),
  });
  const rotatePin = useMutation({
    mutationFn: () => apiPost('/admin/super-admins/' + user?.id + '/rotate-pin', { newPin }),
    onSuccess: async () => { setNewPin(''); setMessage('Super Admin PIN rotated.'); await invalidateAll(); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'PIN rotation failed'),
  });

  const stepUpValid = stepUpAt !== null && Date.now() - stepUpAt < STEP_UP_WINDOW_MS;
  const profile = me.data ?? user;

  if (me.isError || sessions.isError) return <ErrorBanner error={me.error ?? sessions.error} onRetry={() => { void me.refetch(); void sessions.refetch(); }} />;

  return (
    <div className="space-y-5">
      <PageHeader title="Profile and security" subtitle="Account, sessions, MFA and privileged security controls." />
      {message && <p className="rounded-lg border border-success/30 bg-success/10 p-3 text-xs text-success">{message}</p>}
      {error && <p className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">{error}</p>}

      {me.isLoading || !profile ? <LoadingRows count={4} /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Account">
            <dl className="space-y-2 text-sm">
              <div><dt className="text-xs text-muted">Email</dt><dd>{profile.email ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted">Global role</dt><dd>{profile.globalRole ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted">Tenant roles</dt><dd>{profile.tenantRoles.join(', ') || '—'}</dd></div>
              <div><dt className="text-xs text-muted">Permissions</dt><dd className="font-mono text-xs">{profile.permissions.slice(0, 12).join(', ')}{profile.permissions.length > 12 ? '…' : ''}</dd></div>
              <div><dt className="text-xs text-muted">MFA</dt><dd><Badge tone={profile.mfaEnabled ? 'success' : 'warning'}>{profile.mfaEnabled ? 'Enrolled' : 'Not enrolled'}</Badge></dd></div>
            </dl>
          </Card>

          <Card title="Password" subtitle="Changing the password revokes every active session.">
            <div className="space-y-2">
              <input className="input" type="password" placeholder="Current password" value={passwordInput.currentPassword} onChange={(event) => setPasswordInput({ ...passwordInput, currentPassword: event.target.value })} />
              <input className="input" type="password" placeholder="New password (12+ characters)" value={passwordInput.newPassword} onChange={(event) => setPasswordInput({ ...passwordInput, newPassword: event.target.value })} />
              <Button disabled={changePassword.isPending || !passwordInput.currentPassword || passwordInput.newPassword.length < 12} onClick={() => changePassword.mutate()}>Change password</Button>
            </div>
          </Card>
        </div>
      )}

      <Card title="Multi-factor authentication" subtitle="TOTP enrolment and one-time recovery codes.">
        {!profile?.mfaEnabled && (
          <div className="space-y-3">
            <Button onClick={() => enroll.mutate()} disabled={enroll.isPending}>
              <ShieldCheck size={15} /> {enroll.isPending ? 'Preparing…' : 'Start authenticator enrolment'}
            </Button>
            {enrollment && (
              <div className="rounded-lg border border-line bg-surface-2 p-3 text-xs">
                <p className="font-medium">Add this secret to your authenticator app</p>
                <code className="mt-1 block break-all">{enrollment.secret}</code>
                <p className="mt-2 break-all">URI: {enrollment.otpauthUri}</p>
                <div className="mt-3 flex gap-2">
                  <input className="input max-w-[180px]" inputMode="numeric" maxLength={6} value={confirmCode} onChange={(event) => setConfirmCode(event.target.value.replace(/\D/g, ''))} placeholder="6-digit code" />
                  <Button disabled={confirm.isPending || confirmCode.length !== 6} onClick={() => confirm.mutate()}>Confirm</Button>
                </div>
              </div>
            )}
          </div>
        )}
        {profile?.mfaEnabled && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input className="input max-w-[180px]" inputMode="numeric" maxLength={6} value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, ''))} placeholder="Current TOTP code" />
              <Button disabled={regenerate.isPending || recoveryCode.length !== 6} onClick={() => regenerate.mutate()}>Regenerate recovery codes</Button>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={requestPhone.isPending} onClick={() => requestPhone.mutate()}><Smartphone size={15} /> Send phone code</Button>
              <input className="input max-w-[180px]" inputMode="numeric" maxLength={6} value={phoneCode} onChange={(event) => setPhoneCode(event.target.value.replace(/\D/g, ''))} placeholder="Phone code" />
              <Button variant="secondary" disabled={verifyPhone.isPending || phoneCode.length !== 6} onClick={() => verifyPhone.mutate()}>Verify phone</Button>
            </div>
          </div>
        )}
        {codes && (
          <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs">
            <p className="font-medium">Store these recovery codes offline. They are shown only once.</p>
            <div className="mt-2 grid gap-1 font-mono sm:grid-cols-2">{codes.codes.map((code) => <span key={code}>{code}</span>)}</div>
          </div>
        )}
      </Card>

      <Card title="Active sessions" subtitle="Live session list from the authenticated user record.">
        {sessions.isLoading || !sessions.data ? <LoadingRows count={3} /> : sessions.data.length === 0 ? (
          <p className="py-4 text-sm text-muted">No active sessions.</p>
        ) : (
          <div className="space-y-2">
            {sessions.data.map((session) => (
              <div key={session.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3 text-sm">
                <div>
                  <p className="font-medium">{session.deviceLabel ?? session.authMethod}{session.current ? ' · current' : ''}</p>
                  <p className="text-xs text-muted">{session.ip ?? 'unknown IP'} · created {new Date(session.createdAt).toLocaleString()}</p>
                </div>
                {!session.current && <Button variant="secondary" disabled={revokeSession.isPending} onClick={() => revokeSession.mutate(session.id)}>Revoke</Button>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Privileged security" subtitle="Step-up proof is required before PIN rotation.">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium"><KeyRound size={15} /> Step-up verification</p>
            <input className="input" type="password" placeholder="Password (or PIN)" value={stepUpInput.password} onChange={(event) => setStepUpInput({ ...stepUpInput, password: event.target.value, pin: '' })} />
            <input className="input" type="password" placeholder="Super Admin PIN" value={stepUpInput.pin} onChange={(event) => setStepUpInput({ ...stepUpInput, pin: event.target.value, password: '' })} />
            <input className="input" inputMode="numeric" maxLength={6} placeholder="TOTP code" value={stepUpInput.code} onChange={(event) => setStepUpInput({ ...stepUpInput, code: event.target.value.replace(/\D/g, '') })} />
            <Button disabled={performStepUp.isPending || (!stepUpInput.password && !stepUpInput.pin && !stepUpInput.code)} onClick={() => performStepUp.mutate()}>
              {performStepUp.isPending ? 'Verifying…' : 'Verify step-up'}
            </Button>
            <p className="text-xs text-muted">{stepUpValid ? 'Step-up proof is active.' : 'No active step-up proof.'}</p>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Rotate Super Admin PIN</p>
            <input className="input" type="password" placeholder="New PIN (12+ characters)" value={newPin} onChange={(event) => setNewPin(event.target.value)} />
            <Button disabled={!profile || profile.globalRole !== 'SUPER_ADMIN' || !stepUpValid || newPin.length < 12 || rotatePin.isPending} onClick={() => rotatePin.mutate()}>
              {rotatePin.isPending ? 'Rotating…' : 'Rotate PIN'}
            </Button>
            {profile?.globalRole !== 'SUPER_ADMIN' && <p className="text-xs text-muted">Only Super Admin accounts have a PIN.</p>}
          </div>
        </div>
      </Card>
    </div>
  );
}

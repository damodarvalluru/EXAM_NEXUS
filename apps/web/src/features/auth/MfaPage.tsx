import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useAuth } from './AuthProvider';

export function MfaPage() {
  const { challengeToken, verifyMfa } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (code.length === 6) setRecoveryCode('');
  }, [code]);

  if (!challengeToken) return <Navigate to="/login" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await verifyMfa(code || undefined, recoveryCode || undefined);
      navigate(result.user.globalRole ? '/admin/overview' : '/org/dashboard', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'MFA verification failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-10">
      <Card title="Multi-factor verification" subtitle="Enter the 6-digit code from your authenticator app.">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="code" className="mb-1 block text-xs font-medium">Authenticator code</label>
            <input
              id="code"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-center text-lg tracking-widest"
            />
          </div>
          <div>
            <label htmlFor="recovery" className="mb-1 block text-xs font-medium">Or use a recovery code</label>
            <input
              id="recovery"
              value={recoveryCode}
              onChange={(event) => { setRecoveryCode(event.target.value); setCode(''); }}
              className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm"
              placeholder="XXXX-XXXX-XXXX-XXXX"
            />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || (!code && !recoveryCode)}>
            {busy ? 'Verifying…' : 'Verify and continue'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

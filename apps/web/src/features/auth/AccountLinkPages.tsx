import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { publicPost } from '../../lib/api-client';

function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>, success: string) => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const result = await action();
      const detail = result && typeof result === 'object' && 'message' in result ? String((result as { message: unknown }).message) : null;
      setMessage(detail ?? success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };
  return { error, message, busy, run };
}

function Feedback({ error, message }: { error: string | null; message: string | null }) {
  return (
    <>
      {error && <p className="text-xs text-danger">{error}</p>}
      {message && <p className="text-xs text-success">{message}</p>}
    </>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const [token, setToken] = useState(params.get('token') ?? '');
  const { error, message, busy, run } = useAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(() => publicPost('/auth/verify-email', { token }), 'Email verified. You can sign in now.');
  };
  return (
    <div className="mx-auto max-w-md py-10">
      <Card title="Verify email" subtitle="Use the token issued by the registration or verification API.">
        <form onSubmit={submit} className="space-y-3">
          <input className="input" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Verification token" />
          <Feedback error={error} message={message} />
          <Button type="submit" disabled={busy || !token} className="w-full">{busy ? 'Verifying…' : 'Verify email'}</Button>
        </form>
      </Card>
    </div>
  );
}

export function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const [token, setToken] = useState(params.get('token') ?? '');
  const [password, setPassword] = useState('');
  const { error, message, busy, run } = useAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(
      () => publicPost('/organisations/invitations/accept', { token, password }),
      'Invitation accepted. You can sign in with your new password.',
    );
  };
  return (
    <div className="mx-auto max-w-md py-10">
      <Card title="Accept invitation" subtitle="Set a password of at least 12 characters to activate your account.">
        <form onSubmit={submit} className="space-y-3">
          <input className="input" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Invitation token" />
          <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" />
          <Feedback error={error} message={message} />
          <Button type="submit" disabled={busy || !token || password.length < 12} className="w-full">{busy ? 'Activating…' : 'Accept invitation'}</Button>
        </form>
      </Card>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const { error, message, busy, run } = useAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(() => publicPost('/auth/password/forgot', { email }), 'If the account exists, a reset token was issued.');
  };
  return (
    <div className="mx-auto max-w-md py-10">
      <Card title="Reset password" subtitle="A single-use token is issued for valid accounts.">
        <form onSubmit={submit} className="space-y-3">
          <input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email address" />
          <Feedback error={error} message={message} />
          <Button type="submit" disabled={busy || !email} className="w-full">{busy ? 'Submitting…' : 'Request reset token'}</Button>
          <p className="text-center text-xs text-muted"><Link to="/login" className="text-brand no-underline">Back to sign in</Link></p>
        </form>
      </Card>
    </div>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const [token, setToken] = useState(params.get('token') ?? '');
  const [password, setPassword] = useState('');
  const { error, message, busy, run } = useAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(() => publicPost('/auth/password/reset', { token, newPassword: password }), 'Password reset. You can sign in now.');
  };
  return (
    <div className="mx-auto max-w-md py-10">
      <Card title="Choose a new password" subtitle="Use at least 12 characters.">
        <form onSubmit={submit} className="space-y-3">
          <input className="input" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Reset token" />
          <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" />
          <Feedback error={error} message={message} />
          <Button type="submit" disabled={busy || !token || password.length < 12} className="w-full">{busy ? 'Resetting…' : 'Reset password'}</Button>
        </form>
      </Card>
    </div>
  );
}

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useAuth } from './AuthProvider';

const schema = z.object({
  identifier: z.string().min(3, 'Enter your registered identifier'),
  secret: z.string().min(12, 'Secret must be at least 12 characters'),
});

type LoginValues = z.infer<typeof schema>;

type Mode = 'password' | 'pin';

function destination(globalRole: string | null): string {
  return globalRole ? '/admin/overview' : '/org/dashboard';
}

export function LoginPage() {
  const [mode, setMode] = useState<Mode>('password');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { login, pinLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(schema),
    defaultValues: { identifier: '', secret: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const result = mode === 'password'
        ? await login(values.identifier, values.secret)
        : await pinLogin(values.identifier, values.secret);
      if (result.status === 'MFA_REQUIRED') {
        navigate('/mfa');
        return;
      }
      navigate(from ?? destination(result.user.globalRole), { replace: true });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Sign-in failed');
    }
  });

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-10">
      <Card title="Sign in" subtitle="Super Admin, organisation and candidate portals">
        <div className="mb-5 flex gap-2 rounded-lg border border-line bg-surface-2 p-1 text-xs">
          <button
            type="button"
            onClick={() => { setMode('password'); setSubmitError(null); }}
            className={`flex-1 rounded-md px-3 py-2 ${mode === 'password' ? 'bg-surface font-medium text-ink' : 'text-muted'}`}
          >
            Password
          </button>
          <button
            type="button"
            onClick={() => { setMode('pin'); setSubmitError(null); }}
            className={`flex-1 rounded-md px-3 py-2 ${mode === 'pin' ? 'bg-surface font-medium text-ink' : 'text-muted'}`}
          >
            Super Admin PIN
          </button>
        </div>

        {mode === 'pin' && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-brand/30 bg-brand/10 p-3 text-xs text-brand">
            <ShieldCheck size={16} className="shrink-0" />
            <p>PIN login is available only to Super Admins with an enrolled authenticator. MFA is mandatory.</p>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="identifier" className="mb-1 block text-xs font-medium">
              Email or username
            </label>
            <input
              id="identifier"
              autoComplete="username"
              className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm"
              {...register('identifier')}
            />
            {errors.identifier && <p className="mt-1 text-xs text-danger">{errors.identifier.message}</p>}
          </div>
          <div>
            <label htmlFor="secret" className="mb-1 block text-xs font-medium">
              {mode === 'password' ? 'Password' : 'PIN'}
            </label>
            <input
              id="secret"
              type="password"
              autoComplete={mode === 'password' ? 'current-password' : 'off'}
              className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm"
              {...register('secret')}
            />
            {errors.secret && <p className="mt-1 text-xs text-danger">{errors.secret.message}</p>}
          </div>
          {submitError && <p className="text-xs text-danger">{submitError}</p>}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Verifying…' : 'Sign in'}
          </Button>
        </form>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <a href="/register" className="text-brand no-underline">Register an organisation</a>
          <a href="/password/forgot" className="text-brand no-underline">Forgot password?</a>
        </div>
      </Card>
    </div>
  );
}

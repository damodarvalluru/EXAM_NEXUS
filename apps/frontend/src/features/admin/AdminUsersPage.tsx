import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '../../lib/api-client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, ErrorBanner, LoadingRows, PageHeader, Pagination, statusTone } from '../../components/ui/DataState';

interface PlatformUser {
  id: string;
  email: string | null;
  username: string | null;
  globalRole: string | null;
  status: string;
  tenantId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  mfaEnabled: boolean;
}

interface UserList {
  items: PlatformUser[];
  total: number;
  page: number;
  pageSize: number;
}

const ROLES = ['SUPER_ADMIN', 'PLATFORM_STAFF', 'AUDITOR'];
const STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'LOCKED'];

export function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '', username: '', globalRole: 'PLATFORM_STAFF' });

  const query = useQuery({
    queryKey: ['admin', 'users', page, search, status],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      return apiGet<UserList>(`/admin/users?${params.toString()}`, { signal });
    },
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] }),
    ]);
  };

  const setRole = useMutation({
    mutationFn: ({ id, globalRole }: { id: string; globalRole: string }) =>
      apiPatch(`/admin/users/${id}/role`, { globalRole }),
    onSuccess: invalidate,
  });
  const updateStatus = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => apiPatch(`/admin/users/${id}/status`, { status: value }),
    onSuccess: invalidate,
  });
  const create = useMutation({
    mutationFn: () => apiPost('/admin/users', {
      email: newUser.email,
      password: newUser.password,
      username: newUser.username || undefined,
      globalRole: newUser.globalRole,
    }),
    onSuccess: async () => {
      setFormError(null);
      setCreateOpen(false);
      setNewUser({ email: '', password: '', username: '', globalRole: 'PLATFORM_STAFF' });
      await invalidate();
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : 'Create failed'),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="User management"
        subtitle="Platform and organisation users from the live database."
        action={<Button onClick={() => setCreateOpen((value) => !value)}><UserPlus size={15} /> Create platform user</Button>}
      />

      {createOpen && (
        <Card title="Create platform user" subtitle="The new user must enrol in MFA at next sign-in.">
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input" placeholder="Email" value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} />
            <input className="input" placeholder="Username (optional)" value={newUser.username} onChange={(event) => setNewUser({ ...newUser, username: event.target.value })} />
            <input className="input" type="password" placeholder="Password (12+ characters)" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} />
            <select className="input" value={newUser.globalRole} onChange={(event) => setNewUser({ ...newUser, globalRole: event.target.value })}>
              {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </div>
          {formError && <p className="mt-2 text-xs text-danger">{formError}</p>}
          <Button className="mt-3" disabled={create.isPending || !newUser.email || newUser.password.length < 12} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create user'}
          </Button>
        </Card>
      )}

      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <input className="input max-w-xs" placeholder="Search email or username" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          <select className="input max-w-xs" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        {query.isError ? (
          <ErrorBanner error={query.error} onRetry={() => void query.refetch()} />
        ) : query.isLoading || !query.data ? (
          <LoadingRows />
        ) : query.data.items.length === 0 ? (
          <EmptyState message="No users match these filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="py-2">User</th>
                  <th className="py-2">Scope</th>
                  <th className="py-2">Global role</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">MFA</th>
                  <th className="py-2">Last login</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((user) => (
                  <tr key={user.id} className="border-b border-line/60 last:border-0">
                    <td className="py-3">
                      <p className="font-medium">{user.email ?? user.username ?? user.id}</p>
                      <p className="text-xs text-muted">{user.username ?? '—'}</p>
                    </td>
                    <td className="py-3 text-xs text-muted">{user.tenantId ? 'Organisation' : 'Platform'}</td>
                    <td className="py-3">
                      {user.globalRole ? (
                        <select
                          className="input max-w-[180px] py-1 text-xs"
                          value={user.globalRole}
                          onChange={(event) => setRole.mutate({ id: user.id, globalRole: event.target.value })}
                        >
                          {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                        </select>
                      ) : <span className="text-xs text-muted">Tenant role</span>}
                    </td>
                    <td className="py-3">
                      <select
                        className="input max-w-[160px] py-1 text-xs"
                        value={user.status}
                        onChange={(event) => updateStatus.mutate({ id: user.id, value: event.target.value })}
                      >
                        {STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
                      </select>
                    </td>
                    <td className="py-3"><Badge tone={user.mfaEnabled ? 'success' : 'warning'}>{user.mfaEnabled ? 'Enrolled' : 'Not enrolled'}</Badge></td>
                    <td className="py-3 text-xs text-muted">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(setRole.isError || updateStatus.isError) && (
              <p className="mt-2 text-xs text-danger">Could not update user. Check permissions and try again.</p>
            )}
            <div className="mt-4">
              <Pagination page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onChange={setPage} />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

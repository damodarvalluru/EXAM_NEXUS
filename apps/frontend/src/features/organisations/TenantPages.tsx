import { useEffect, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CandidateView, MemberView, OrganisationDashboard, OrganisationView, RoleView } from '@examnexus/shared';
import { FileUp, Plus, Trash2 } from 'lucide-react';
import { apiGet, apiPatch, apiPost, apiDelete } from '../../lib/api-client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, ErrorBanner, LoadingRows, PageHeader, Pagination, statusTone } from '../../components/ui/DataState';

interface PermissionRow {
  id: string;
  key: string;
  description: string | null;
  category: string | null;
}

function CandidateStatusCell({ value, onSave }: { value: string; onSave: (status: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="flex items-center gap-1">
      <input
        className="input max-w-[120px] py-1 text-xs"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <Button variant="secondary" disabled={draft === value} onClick={() => onSave(draft)}>Save</Button>
    </div>
  );
}

function fileToBase64(file: File): Promise<{ fileName: string; mimeType: string; contentBase64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result);
      resolve({ fileName: file.name, mimeType: file.type || 'application/octet-stream', contentBase64: value.slice(value.indexOf(',') + 1) });
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export function TenantDashboardPage() {
  const query = useQuery({
    queryKey: ['tenant', 'dashboard'],
    queryFn: ({ signal }) => apiGet<OrganisationDashboard>('/organisations/me/dashboard', { signal }),
  });
  if (query.isError) return <ErrorBanner error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isLoading || !query.data) return <LoadingRows count={8} />;
  const { organisation, counts, roleDistribution, recentExaminations } = query.data;
  const metrics = [
    ['Active users', counts.activeUsers],
    ['Candidates', counts.candidates],
    ['Examinations', counts.examinations],
    ['Live examinations', counts.liveExaminations],
    ['Integrations', counts.integrations],
    ['Connected integrations', counts.connectedIntegrations],
    ['Attempts', counts.attempts],
  ] as const;
  return (
    <div className="space-y-5">
      <PageHeader title={organisation.name} subtitle={`${organisation.slug} · ${organisation.status}`} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value]) => (
          <Card key={label}>
            <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Role distribution">
          {roleDistribution.length === 0 ? <EmptyState message="No role assignments yet." /> : (
            <div className="space-y-2">
              {roleDistribution.map((row) => (
                <div key={row.role} className="flex justify-between text-sm"><span>{row.role}</span><strong>{row.count}</strong></div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Recent examinations">
          {recentExaminations.length === 0 ? <EmptyState message="No examinations recorded." /> : (
            <div className="space-y-2">
              {recentExaminations.map((exam) => (
                <div key={exam.id} className="flex items-center justify-between text-sm">
                  <span>{exam.title}</span>
                  <Badge tone={statusTone(exam.status)}>{exam.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export function TenantProfilePage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['tenant', 'profile'],
    queryFn: ({ signal }) => apiGet<OrganisationView>('/organisations/me/profile', { signal }),
  });
  const [form, setForm] = useState({ name: '', contactPhone: '', website: '', primaryColour: '' });
  const [documentType, setDocumentType] = useState('ADDITIONAL');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => apiPatch('/organisations/me', {
      name: form.name || undefined,
      contactPhone: form.contactPhone || undefined,
      website: form.website || undefined,
      primaryColour: form.primaryColour || undefined,
    }),
    onSuccess: async () => { setMessage('Organisation profile updated.'); await queryClient.invalidateQueries({ queryKey: ['tenant'] }); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Update failed'),
  });
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a document first');
      const payload = await fileToBase64(file);
      return apiPost('/organisations/me/documents', { documentType, ...payload });
    },
    onSuccess: async () => { setMessage('Verification document stored.'); setFile(null); await queryClient.invalidateQueries({ queryKey: ['tenant'] }); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Upload failed'),
  });

  if (query.isError) return <ErrorBanner error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isLoading || !query.data) return <LoadingRows count={4} />;
  const organisation = query.data;
  return (
    <div className="space-y-5">
      <PageHeader title="Organisation profile" subtitle="Branding and contact details are used across tenant screens." />
      {message && <p className="text-xs text-success">{message}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
      <Card title="Details">
        <div className="grid gap-3 sm:grid-cols-2">
          <input className="input" placeholder={organisation.name} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <input className="input" placeholder={organisation.officialEmail} disabled />
          <input className="input" placeholder="Contact phone" value={form.contactPhone} onChange={(event) => setForm({ ...form, contactPhone: event.target.value })} />
          <input className="input" placeholder="Website" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} />
          <input className="input" placeholder="Primary colour (#RRGGBB)" value={form.primaryColour} onChange={(event) => setForm({ ...form, primaryColour: event.target.value })} />
        </div>
        <Button className="mt-3" disabled={save.isPending} onClick={() => save.mutate()}>Save profile</Button>
      </Card>
      <Card title="Verification documents">
        <div className="flex flex-wrap items-center gap-2">
          <select className="input max-w-[240px]" value={documentType} onChange={(event) => setDocumentType(event.target.value)}>
            {['ADDITIONAL', 'REGISTRATION', 'ID_PROOF', 'ADDRESS_PROOF'].map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <input type="file" onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] ?? null)} className="text-xs" />
          <Button disabled={upload.isPending || !file} onClick={() => upload.mutate()}><FileUp size={15} /> Upload</Button>
        </div>
      </Card>
    </div>
  );
}

export function TenantUsersPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [invite, setInvite] = useState({ email: '', firstName: '', lastName: '', roleNames: [] as string[] });
  const [error, setError] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ['tenant', 'users', page, search],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (search) params.set('search', search);
      return apiGet<{ items: MemberView[]; total: number }>(`/organisations/me/users?${params.toString()}`, { signal });
    },
  });
  const roles = useQuery({
    queryKey: ['tenant', 'roles'],
    queryFn: ({ signal }) => apiGet<RoleView[]>('/organisations/me/roles', { signal }),
  });

  const invalidate = async () => queryClient.invalidateQueries({ queryKey: ['tenant', 'users'] });
  const inviteMutation = useMutation({
    mutationFn: () => apiPost('/organisations/me/users', invite),
    onSuccess: async () => { setError(null); setInvite({ email: '', firstName: '', lastName: '', roleNames: [] }); await invalidate(); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Invite failed'),
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiPost(`/organisations/me/users/${id}/status`, { status }),
    onSuccess: invalidate,
  });
  const rolesMutation = useMutation({
    mutationFn: ({ id, roleNames }: { id: string; roleNames: string[] }) => apiPost(`/organisations/me/users/${id}/roles`, { roleNames }),
    onSuccess: invalidate,
  });

  if (users.isError || roles.isError) return <ErrorBanner error={users.error ?? roles.error} onRetry={() => { void users.refetch(); void roles.refetch(); }} />;
  return (
    <div className="space-y-5">
      <PageHeader title="Organisation users" subtitle="Members, invitations and role assignments in this tenant." />
      <Card title="Invite a user">
        <div className="grid gap-3 sm:grid-cols-2">
          <input className="input" placeholder="Email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} />
          <input className="input" placeholder="First name" value={invite.firstName} onChange={(event) => setInvite({ ...invite, firstName: event.target.value })} />
          <input className="input" placeholder="Last name" value={invite.lastName} onChange={(event) => setInvite({ ...invite, lastName: event.target.value })} />
          <select
            className="input"
            multiple
            value={invite.roleNames}
            onChange={(event) => setInvite({ ...invite, roleNames: Array.from(event.target.selectedOptions).map((option) => option.value) })}
          >
            {(roles.data ?? []).map((role) => <option key={role.id} value={role.name}>{role.name}</option>)}
          </select>
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        <Button className="mt-3" disabled={inviteMutation.isPending || !invite.email || invite.roleNames.length === 0} onClick={() => inviteMutation.mutate()}>
          <Plus size={15} /> Send invitation
        </Button>
      </Card>
      <Card>
        <input className="input mb-4 max-w-xs" placeholder="Search members" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        {users.isLoading || !users.data ? <LoadingRows /> : users.data.items.length === 0 ? <EmptyState message="No members found." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted"><th className="py-2">User</th><th className="py-2">Roles</th><th className="py-2">Status</th><th className="py-2">Joined</th></tr></thead>
              <tbody>
                {users.data.items.map((member) => (
                  <tr key={member.id} className="border-b border-line/60 last:border-0">
                    <td className="py-3"><p className="font-medium">{member.email ?? member.userId}</p><p className="text-xs text-muted">{member.firstName} {member.lastName}</p></td>
                    <td className="py-3">
                      <select
                        className="input max-w-[220px] py-1 text-xs"
                        multiple
                        value={member.roles}
                        onChange={(event) => rolesMutation.mutate({ id: member.userId, roleNames: Array.from(event.target.selectedOptions).map((option) => option.value) })}
                      >
                        {(roles.data ?? []).map((role) => <option key={role.id} value={role.name}>{role.name}</option>)}
                      </select>
                    </td>
                    <td className="py-3">
                      <select className="input max-w-[140px] py-1 text-xs" value={member.status} onChange={(event) => statusMutation.mutate({ id: member.userId, status: event.target.value })}>
                        {['ACTIVE', 'INACTIVE', 'SUSPENDED'].map((value) => <option key={value} value={value}>{value}</option>)}
                      </select>
                    </td>
                    <td className="py-3 text-xs text-muted">{member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4"><Pagination page={page} pageSize={20} total={users.data.total} onChange={setPage} /></div>
          </div>
        )}
      </Card>
    </div>
  );
}

export function TenantRolesPage() {
  const queryClient = useQueryClient();
  const [newRole, setNewRole] = useState({ name: '', description: '', permissions: [] as string[] });
  const [error, setError] = useState<string | null>(null);
  const roles = useQuery({ queryKey: ['tenant', 'roles'], queryFn: ({ signal }) => apiGet<RoleView[]>('/organisations/me/roles', { signal }) });
  const permissions = useQuery({ queryKey: ['tenant', 'permissions'], queryFn: ({ signal }) => apiGet<PermissionRow[]>('/organisations/me/permissions', { signal }) });
  const invalidate = async () => queryClient.invalidateQueries({ queryKey: ['tenant', 'roles'] });
  const create = useMutation({
    mutationFn: () => apiPost('/organisations/me/roles', newRole),
    onSuccess: async () => { setError(null); setNewRole({ name: '', description: '', permissions: [] }); await invalidate(); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Role creation failed'),
  });
  const remove = useMutation({ mutationFn: (id: string) => apiDelete(`/organisations/me/roles/${id}`), onSuccess: invalidate });

  if (roles.isError || permissions.isError) return <ErrorBanner error={roles.error ?? permissions.error} onRetry={() => { void roles.refetch(); void permissions.refetch(); }} />;
  return (
    <div className="space-y-5">
      <PageHeader title="Organisation roles" subtitle="Real tenant roles and the permissions assigned to them." />
      <Card title="Create role">
        <div className="grid gap-3 sm:grid-cols-2">
          <input className="input" placeholder="Role name" value={newRole.name} onChange={(event) => setNewRole({ ...newRole, name: event.target.value })} />
          <input className="input" placeholder="Description" value={newRole.description} onChange={(event) => setNewRole({ ...newRole, description: event.target.value })} />
        </div>
        <div className="mt-3 max-h-52 overflow-y-auto rounded-lg border border-line p-3">
          {(permissions.data ?? []).map((permission) => (
            <label key={permission.id} className="flex items-start gap-2 py-1 text-xs">
              <input
                type="checkbox"
                checked={newRole.permissions.includes(permission.key)}
                onChange={(event) => setNewRole({
                  ...newRole,
                  permissions: event.target.checked ? [...newRole.permissions, permission.key] : newRole.permissions.filter((key) => key !== permission.key),
                })}
              />
              <span><strong className="font-mono">{permission.key}</strong> — {permission.description}</span>
            </label>
          ))}
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        <Button className="mt-3" disabled={create.isPending || !newRole.name} onClick={() => create.mutate()}>Create role</Button>
      </Card>
      <Card>
        {roles.isLoading || !roles.data ? <LoadingRows /> : roles.data.length === 0 ? <EmptyState message="No roles seeded." /> : (
          <div className="space-y-2">
            {roles.data.map((role) => (
              <div key={role.id} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
                <div>
                  <p className="text-sm font-medium">{role.name} <Badge tone={role.isSystem ? 'success' : 'neutral'}>{role.isSystem ? 'System' : 'Custom'}</Badge></p>
                  <p className="text-xs text-muted">{role.description ?? 'No description'} · {role.memberCount} members · {role.permissions.length} permissions</p>
                </div>
                {!role.isSystem && <Button variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(role.id)}><Trash2 size={15} /></Button>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export function TenantCandidatesPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [candidate, setCandidate] = useState({ candidateCode: '', firstName: '', lastName: '', email: '', phone: '' });
  const [error, setError] = useState<string | null>(null);
  const candidates = useQuery({
    queryKey: ['tenant', 'candidates', page, search],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (search) params.set('search', search);
      return apiGet<{ items: CandidateView[]; total: number }>(`/organisations/me/candidates?${params.toString()}`, { signal });
    },
  });
  const create = useMutation({
    mutationFn: () => apiPost('/organisations/me/candidates', candidate),
    onSuccess: async () => { setError(null); setCandidate({ candidateCode: '', firstName: '', lastName: '', email: '', phone: '' }); await queryClient.invalidateQueries({ queryKey: ['tenant', 'candidates'] }); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Candidate creation failed'),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiPost(`/organisations/me/candidates/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenant', 'candidates'] }),
  });

  if (candidates.isError) return <ErrorBanner error={candidates.error} onRetry={() => void candidates.refetch()} />;
  return (
    <div className="space-y-5">
      <PageHeader title="Candidates" subtitle="Candidate records belonging to this organisation." />
      <Card title="Register candidate">
        <div className="grid gap-3 sm:grid-cols-2">
          <input className="input" placeholder="Candidate code" value={candidate.candidateCode} onChange={(event) => setCandidate({ ...candidate, candidateCode: event.target.value })} />
          <input className="input" placeholder="First name" value={candidate.firstName} onChange={(event) => setCandidate({ ...candidate, firstName: event.target.value })} />
          <input className="input" placeholder="Last name" value={candidate.lastName} onChange={(event) => setCandidate({ ...candidate, lastName: event.target.value })} />
          <input className="input" type="email" placeholder="Email" value={candidate.email} onChange={(event) => setCandidate({ ...candidate, email: event.target.value })} />
          <input className="input" placeholder="Phone" value={candidate.phone} onChange={(event) => setCandidate({ ...candidate, phone: event.target.value })} />
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        <Button className="mt-3" disabled={create.isPending || !candidate.candidateCode || !candidate.email} onClick={() => create.mutate()}>Register candidate</Button>
      </Card>
      <Card>
        <input className="input mb-4 max-w-xs" placeholder="Search candidates" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        {candidates.isLoading || !candidates.data ? <LoadingRows /> : candidates.data.items.length === 0 ? <EmptyState message="No candidates found." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted"><th className="py-2">Code</th><th className="py-2">Name</th><th className="py-2">Email</th><th className="py-2">Status</th></tr></thead>
              <tbody>
                {candidates.data.items.map((item) => (
                  <tr key={item.id} className="border-b border-line/60 last:border-0">
                    <td className="py-2 font-mono text-xs">{item.candidateCode}</td>
                    <td className="py-2">{item.firstName} {item.lastName}</td>
                    <td className="py-2 text-xs text-muted">{item.email}</td>
                    <td className="py-2">
                      <CandidateStatusCell
                        value={item.status}
                        onSave={(status) => setStatus.mutate({ id: item.id, status })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4"><Pagination page={page} pageSize={20} total={candidates.data.total} onChange={setPage} /></div>
          </div>
        )}
      </Card>
    </div>
  );
}

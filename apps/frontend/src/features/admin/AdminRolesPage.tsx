import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../lib/api-client';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { ErrorBanner, LoadingRows, PageHeader } from '../../components/ui/DataState';

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  organisation: string;
  organisationSlug: string;
  memberCount: number;
  permissionCount: number;
  createdAt: string;
}

interface PermissionRow {
  id: string;
  key: string;
  description: string | null;
  category: string | null;
}

export function AdminRolesPage() {
  const roles = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: ({ signal }) => apiGet<{ items: RoleRow[]; total: number }>('/admin/roles?pageSize=100', { signal }),
  });
  const permissions = useQuery({
    queryKey: ['admin', 'permissions'],
    queryFn: ({ signal }) => apiGet<PermissionRow[]>('/admin/permissions', { signal }),
  });

  const error = roles.error ?? permissions.error;
  if (error) return <ErrorBanner error={error} onRetry={() => { void roles.refetch(); void permissions.refetch(); }} />;

  return (
    <div className="space-y-5">
      <PageHeader title="Roles and permissions" subtitle="Global permission catalogue and seeded organisation roles." />
      {roles.isLoading || permissions.isLoading || !roles.data || !permissions.data ? (
        <LoadingRows count={8} />
      ) : (
        <>
          <Card title="Permission catalogue" subtitle={`${permissions.data.length} permissions enforced by the API.`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                    <th className="py-2">Key</th>
                    <th className="py-2">Category</th>
                    <th className="py-2">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {permissions.data.map((permission) => (
                    <tr key={permission.id} className="border-b border-line/60 last:border-0">
                      <td className="py-2 font-mono text-xs">{permission.key}</td>
                      <td className="py-2"><Badge tone="neutral">{permission.category ?? 'uncategorised'}</Badge></td>
                      <td className="py-2 text-xs text-muted">{permission.description ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Organisation roles" subtitle={`${roles.data.total} roles currently seeded across tenants.`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                    <th className="py-2">Role</th>
                    <th className="py-2">Organisation</th>
                    <th className="py-2">Members</th>
                    <th className="py-2">Permissions</th>
                    <th className="py-2">System</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.data.items.map((role) => (
                    <tr key={role.id} className="border-b border-line/60 last:border-0">
                      <td className="py-2 font-medium">{role.name}</td>
                      <td className="py-2 text-xs text-muted">{role.organisation}</td>
                      <td className="py-2">{role.memberCount}</td>
                      <td className="py-2">{role.permissionCount}</td>
                      <td className="py-2"><Badge tone={role.isSystem ? 'success' : 'neutral'}>{role.isSystem ? 'System' : 'Custom'}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

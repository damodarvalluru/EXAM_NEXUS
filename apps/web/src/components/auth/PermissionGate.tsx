import type { ReactNode } from 'react';
import { ShieldX } from 'lucide-react';
import { useAuth } from '../../features/auth/AuthProvider';

export function hasPermission(permissions: string[], required: string | string[]): boolean {
  if (permissions.includes('*')) return true;
  const needed = Array.isArray(required) ? required : [required];
  return needed.some((permission) => permissions.includes(permission));
}

export function PermissionGate({
  permission,
  children,
}: {
  permission: string | string[];
  children: ReactNode;
}) {
  const { user } = useAuth();
  if (!user || !hasPermission(user.permissions, permission)) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger/10 p-5 text-sm text-danger">
        <div className="flex items-center gap-2 font-medium">
          <ShieldX size={16} /> You do not have permission to view this section.
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

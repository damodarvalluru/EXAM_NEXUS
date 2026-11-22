import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  CreditCard,
  Database,
  FileText,
  GraduationCap,
  HeartPulse,
  HelpCircle,
  Key,
  LayoutDashboard,
  LogOut,
  Plug,
  Radio,
  Settings,
  Shield,
  Siren,
  User,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  slug: string;
  label: string;
  phase: number;
  icon: LucideIcon;
  path?: string;
  platform?: boolean;
  tenant?: boolean;
}

/** Mirrors the Super Admin navigation required by the specification. */
export const NAV_ITEMS: NavItem[] = [
  { slug: 'overview', label: 'Overview Dashboard', phase: 2, icon: LayoutDashboard, path: '/admin/overview', platform: true },
  { slug: 'organisations', label: 'Organisation Management', phase: 3, icon: Building2, path: '/admin/organisations', platform: true },
  { slug: 'verification', label: 'Organisation Verification', phase: 3, icon: CheckCircle2, path: '/admin/verification', platform: true },
  { slug: 'users', label: 'User Management', phase: 2, icon: Users, path: '/admin/users', platform: true },
  { slug: 'roles', label: 'Role and Permission Management', phase: 2, icon: Shield, path: '/admin/roles', platform: true },
  { slug: 'examinations', label: 'Examination Management', phase: 4, icon: GraduationCap },
  { slug: 'live-monitoring', label: 'Live Examination Monitoring', phase: 4, icon: Radio },
  { slug: 'integrations', label: 'Application Integrations', phase: 5, icon: Plug },
  { slug: 'api-management', label: 'API Management', phase: 5, icon: Key },
  { slug: 'integration-monitoring', label: 'Integration Monitoring', phase: 5, icon: Activity },
  { slug: 'candidates', label: 'Candidate Management', phase: 3, icon: UserCheck, path: '/org/candidates', tenant: true },
  { slug: 'question-bank', label: 'Question Bank Management', phase: 4, icon: BookOpen },
  { slug: 'evaluation', label: 'Evaluation Management', phase: 4, icon: ClipboardCheck },
  { slug: 'reports', label: 'Reports and Analytics', phase: 6, icon: BarChart3 },
  { slug: 'security-centre', label: 'Security Centre', phase: 6, icon: AlertTriangle },
  { slug: 'auth-logs', label: 'Authentication Logs', phase: 2, icon: FileText, path: '/admin/auth-logs', platform: true },
  { slug: 'audit-logs', label: 'Audit Logs', phase: 2, icon: Clock, path: '/admin/audit-logs', platform: true },
  { slug: 'system-health', label: 'System Health', phase: 6, icon: HeartPulse },
  { slug: 'notifications', label: 'Notifications', phase: 6, icon: Bell },
  { slug: 'billing', label: 'Subscription and Billing', phase: 3, icon: CreditCard },
  { slug: 'support', label: 'Support and Complaints', phase: 6, icon: HelpCircle },
  { slug: 'configuration', label: 'Platform Configuration', phase: 6, icon: Settings },
  { slug: 'backup', label: 'Backup and Recovery', phase: 8, icon: Database },
  { slug: 'incidents', label: 'Incident Management', phase: 6, icon: Siren },
  { slug: 'profile', label: 'Admin Profile and Security', phase: 2, icon: User, path: '/profile' },
  { slug: 'logout', label: 'Logout', phase: 2, icon: LogOut, path: '/logout' },
];

export const TENANT_NAV_ITEMS: NavItem[] = [
  { slug: 'tenant-dashboard', label: 'Organisation Dashboard', phase: 3, icon: LayoutDashboard, path: '/org/dashboard', tenant: true },
  { slug: 'tenant-profile', label: 'Organisation Profile', phase: 3, icon: Building2, path: '/org/profile', tenant: true },
  { slug: 'tenant-users', label: 'Organisation Users', phase: 3, icon: Users, path: '/org/users', tenant: true },
  { slug: 'tenant-roles', label: 'Organisation Roles', phase: 3, icon: Shield, path: '/org/roles', tenant: true },
  { slug: 'tenant-candidates', label: 'Candidates', phase: 3, icon: UserCheck, path: '/org/candidates', tenant: true },
];

export function findNavItem(slug: string | undefined): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.slug === slug) ?? TENANT_NAV_ITEMS.find((item) => item.slug === slug);
}

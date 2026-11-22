import { useEffect, useState } from 'react';
import { LogOut, Menu, Moon, Sun, X } from 'lucide-react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { NAV_ITEMS, TENANT_NAV_ITEMS, type NavItem } from '../config/navigation';
import { useAuth } from '../features/auth/AuthProvider';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';

function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem('examnexus-theme') === 'dark');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('examnexus-theme', dark ? 'dark' : 'light');
  }, [dark]);
  return { dark, toggle: () => setDark((value) => !value) };
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  const { dark, toggle } = useTheme();
  const { user, status, logout } = useAuth();
  const navigate = useNavigate();

  const isPlatform = Boolean(user?.globalRole);
  const isTenant = Boolean(user?.tenantId);
  const visible = [...NAV_ITEMS, ...TENANT_NAV_ITEMS].filter((item) => {
    if (item.slug === 'logout') return status === 'authenticated';
    if (item.slug === 'profile') return status === 'authenticated';
    if (item.platform) return isPlatform;
    if (item.tenant) return isTenant;
    return false;
  });
  const workspace = visible.filter((item) => item.path);
  const planned = visible.filter((item) => !item.path);

  const renderLink = (item: NavItem) => {
    const Icon = item.icon;
    if (item.slug === 'logout') {
      return (
        <li key={item.slug}>
          <button
            type="button"
            onClick={() => void logout().then(() => navigate('/login'))}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-muted transition hover:bg-surface-2 hover:text-ink"
          >
            <Icon size={16} className="shrink-0" />
            <span className="flex-1 text-left">{item.label}</span>
          </button>
        </li>
      );
    }
    return (
      <li key={`${item.slug}-${item.path}`}>
        <NavLink
          to={item.path!}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] no-underline transition ${
              isActive ? 'bg-brand/10 font-medium text-brand' : 'text-muted hover:bg-surface-2 hover:text-ink'
            }`
          }
        >
          <Icon size={16} className="shrink-0" />
          <span className="flex-1">{item.label}</span>
          <span className="text-[10px] text-muted">P{item.phase}</span>
        </NavLink>
      </li>
    );
  };

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-surface px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-lg p-2 text-muted hover:bg-surface-2 lg:hidden"
            onClick={() => setOpen((value) => !value)}
            aria-label="Toggle navigation"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
          <Link to="/" className="flex items-center gap-2 no-underline">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-sm font-bold text-brand-strong">
              EX
            </span>
            <span className="text-base font-semibold tracking-tight">ExamNexus</span>
          </Link>
          <span className="ml-2 hidden rounded-md border border-line px-2 py-0.5 text-[11px] text-muted sm:inline">
            Phases 2–3 delivered
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg p-2 text-muted hover:bg-surface-2"
            onClick={toggle}
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          {status === 'authenticated' && user ? (
            <div className="flex items-center gap-2">
              <div className="hidden text-right sm:block">
                <p className="text-xs font-medium">{user.email}</p>
                <p className="text-[10px] text-muted">{user.globalRole ?? 'Organisation user'}</p>
              </div>
              <Badge tone="success">Signed in</Badge>
              <Button
                variant="ghost"
                onClick={() => void logout().then(() => navigate('/login'))}
                aria-label="Sign out"
              >
                <LogOut size={16} />
              </Button>
            </div>
          ) : (
            <Link
              to="/login"
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink no-underline hover:bg-surface-2"
            >
              Sign in
            </Link>
          )}
        </div>
      </header>

      <div className="flex">
        <aside
          className={`${open ? 'block' : 'hidden'} lg:sticky lg:top-16 lg:block lg:h-[calc(100vh-4rem)] lg:w-72 lg:shrink-0`}
        >
          <nav className="h-full overflow-y-auto border-b border-line bg-surface p-3 lg:border-b-0 lg:border-r">
            {workspace.length > 0 && (
              <>
                <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Workspace
                </p>
                <ul className="space-y-0.5">{workspace.map(renderLink)}</ul>
              </>
            )}
            {planned.length > 0 && (
              <>
                <p className="mt-4 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Planned
                </p>
                <ul className="space-y-0.5">
                  {planned.slice(0, 12).map((item) => (
                    <li key={item.slug}>
                      <NavLink
                        to={`/module/${item.slug}`}
                        onClick={() => setOpen(false)}
                        className={({ isActive }) =>
                          `flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] no-underline transition ${
                            isActive ? 'bg-brand/10 font-medium text-brand' : 'text-muted hover:bg-surface-2 hover:text-ink'
                          }`
                        }
                      >
                        <item.icon size={16} className="shrink-0" />
                        <span className="flex-1">{item.label}</span>
                        <span className="text-[10px] text-muted">P{item.phase}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

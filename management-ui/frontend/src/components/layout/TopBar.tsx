import { NavLink, useLocation } from 'react-router';
import { cn } from '@/lib/utils';
import { Sun, Moon, Server, Package, Wrench, ShieldCheck, Bot, Menu } from 'lucide-react';
import { getTheme, toggleTheme } from '@/lib/theme';
import { useState, useEffect } from 'react';
import { Sheet } from '@/components/ui/sheet';
import { SidebarContent } from './SectionSidebar';

const sections = [
  { label: 'Инфра', icon: Server, paths: ['/', '/monitoring', '/dns', '/ru-proxy'] },
  { label: 'Проекты', icon: Package, paths: ['/publish', '/publish/runs', '/projects', '/content'] },
  { label: 'Инструменты', icon: Wrench, paths: ['/tunnels', '/analytics', '/tasks', '/files', '/git'] },
  { label: 'Админ', icon: ShieldCheck, paths: ['/users', '/tokens'] },
  { label: 'Агент', icon: Bot, paths: ['/agent'] },
];

function isActiveSection(paths: string[], currentPath: string) {
  if (paths.includes('/') && currentPath === '/') return true;
  return paths.some((p) => p !== '/' && currentPath.startsWith(p));
}

export function TopBar() {
  const [theme, setTheme] = useState(getTheme);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { pathname } = useLocation();

  // Auto-close sheet on navigation
  useEffect(() => {
    setSheetOpen(false);
  }, [pathname]);

  const handleToggle = () => {
    toggleTheme();
    setTheme(getTheme());
  };

  return (
    <>
      <header className="sticky top-0 z-40 flex h-14 items-center border-b border-border bg-card px-4 gap-6">
        {/* Hamburger — mobile only */}
        <button
          onClick={() => setSheetOpen(true)}
          className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Открыть меню"
        >
          <Menu className="h-5 w-5" />
        </button>

        <NavLink to="/" className="flex items-center gap-2 font-semibold text-foreground shrink-0">
          <Server className="h-5 w-5 text-accent" />
          <span className="hidden sm:inline">Admin</span>
        </NavLink>

        <nav className="flex items-center gap-1">
          {sections.map((s) => (
            <NavLink
              key={s.label}
              to={s.paths[0]}
              className={({ isActive }) => {
                const active = isActive || isActiveSection(s.paths, window.location.pathname);
                return cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-accent/10 text-accent'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                );
              }}
            >
              <s.icon className="h-4 w-4" />
              <span className="hidden md:inline">{s.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto">
          <button
            onClick={handleToggle}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Переключить тему"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Mobile sidebar sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <div className="flex flex-col p-3 gap-1 h-full">
          <div className="mb-3 px-3 py-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Навигация
          </div>
          <SidebarContent onNavigate={() => setSheetOpen(false)} />
        </div>
      </Sheet>
    </>
  );
}

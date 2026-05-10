import { useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { cn } from '@/lib/utils';
import { PanelLeftClose, PanelLeft } from 'lucide-react';
import {
  Server, Globe, Shield, Activity, ShieldCheck,
  Package, FileText, Rocket, History, Package2,
  Cable, BarChart3, CheckSquare, FolderOpen, GitBranch, ScrollText,
  Users, Key, Bot,
} from 'lucide-react';

interface SidebarItem {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}

const sidebarMap: Record<string, SidebarItem[]> = {
  infra: [
    { label: 'Сервисы', path: '/', icon: Server },
    { label: 'Серверы', path: '/servers', icon: Server },
    { label: 'Мониторинг', path: '/monitoring', icon: Activity },
    { label: 'DNS', path: '/dns', icon: Globe },
    { label: 'RU Proxy', path: '/ru-proxy', icon: Shield },
  ],
  projects: [
    { label: 'Публикация', path: '/publish', icon: Rocket },
    { label: 'История', path: '/publish/runs', icon: History },
    { label: 'Релизы', path: '/releases', icon: Package2 },
    { label: 'Реестр', path: '/projects', icon: Package },
    { label: 'Контент', path: '/content', icon: FileText },
  ],
  tools: [
    { label: 'Логи', path: '/logs', icon: ScrollText },
    { label: 'Туннели', path: '/tunnels', icon: Cable },
    { label: 'Аналитика', path: '/analytics', icon: BarChart3 },
    { label: 'Задачи', path: '/tasks', icon: CheckSquare },
    { label: 'Файлы', path: '/files', icon: FolderOpen },
    { label: 'Git', path: '/git', icon: GitBranch },
  ],
  admin: [
    { label: 'Пользователи', path: '/users', icon: Users },
    { label: 'Токены', path: '/tokens', icon: Key },
    { label: 'Casdoor', path: '/casdoor', icon: ShieldCheck },
  ],
  agent: [
    { label: 'Чат', path: '/agent', icon: Bot },
  ],
};

const pathToSection: Record<string, string> = {};
for (const [section, items] of Object.entries(sidebarMap)) {
  for (const item of items) {
    pathToSection[item.path] = section;
  }
}

export function getCurrentSection(pathname: string): string {
  if (pathToSection[pathname]) return pathToSection[pathname];
  for (const [path, section] of Object.entries(pathToSection)) {
    if (path !== '/' && pathname.startsWith(path)) return section;
  }
  return 'infra';
}

interface SidebarContentProps {
  onNavigate?: () => void;
  collapsed?: boolean;
}

export function SidebarContent({ onNavigate, collapsed }: SidebarContentProps) {
  const { pathname } = useLocation();
  const section = getCurrentSection(pathname);
  const items = sidebarMap[section] ?? sidebarMap.infra;

  return (
    <>
      {items.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === '/'}
          onClick={onNavigate}
          title={collapsed ? item.label : undefined}
          className={({ isActive }) =>
            cn(
              'flex items-center rounded-md text-sm font-medium transition-colors',
              collapsed
                ? 'justify-center h-9 w-9 mx-auto'
                : 'gap-2 px-3 py-2',
              isActive
                ? 'bg-accent/10 text-accent'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )
          }
        >
          <item.icon className="h-4 w-4 shrink-0" />
          {!collapsed && item.label}
        </NavLink>
      ))}
    </>
  );
}

export function SectionSidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col border-r border-border bg-card p-3 gap-1 transition-[width] duration-200',
        collapsed ? 'w-[56px]' : 'w-[200px]',
      )}
    >
      <SidebarContent collapsed={collapsed} />
      <div className="mt-auto pt-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Развернуть' : 'Свернуть'}
          className={cn(
            'flex items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
            collapsed
              ? 'justify-center h-9 w-9 mx-auto'
              : 'gap-2 px-3 py-2 w-full text-sm',
          )}
        >
          {collapsed
            ? <PanelLeft className="h-4 w-4" />
            : <><PanelLeftClose className="h-4 w-4" /><span>Свернуть</span></>
          }
        </button>
      </div>
    </aside>
  );
}

import { Outlet } from 'react-router';
import { TopBar } from './TopBar';
import { SectionSidebar } from './SectionSidebar';

export function AppLayout() {
  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <SectionSidebar />
        <main className="flex-1 overflow-y-auto p-6 max-w-7xl">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

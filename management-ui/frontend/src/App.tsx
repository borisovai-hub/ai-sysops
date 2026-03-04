import { Routes, Route, Navigate } from 'react-router';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { ServicesPage } from './pages/ServicesPage';
import { DnsPage } from './pages/DnsPage';
import { TokensPage } from './pages/TokensPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { UsersPage } from './pages/UsersPage';
import { ContentPage } from './pages/ContentPage';
import { TunnelsPage } from './pages/TunnelsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { RuProxyPage } from './pages/RuProxyPage';
import { FilesPage } from './pages/FilesPage';
import { GitPage } from './pages/GitPage';
import { AgentPage } from './pages/AgentPage';
import { MonitoringPage } from './pages/MonitoringPage';

export function App() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<ServicesPage />} />
        <Route path="monitoring" element={<MonitoringPage />} />
        <Route path="dns" element={<DnsPage />} />
        <Route path="ru-proxy" element={<RuProxyPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="content" element={<ContentPage />} />
        <Route path="tunnels" element={<TunnelsPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="files" element={<FilesPage />} />
        <Route path="git" element={<GitPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="tokens" element={<TokensPage />} />
        <Route path="agent" element={<AgentPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

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
import { TasksPage } from './pages/TasksPage';
import { CasdoorPage } from './pages/CasdoorPage';
import { PublishPage } from './pages/PublishPage';
import { PublishRunsPage } from './pages/PublishRunsPage';
import { ReleasesPage } from './pages/ReleasesPage';
import { LogsPage } from './pages/LogsPage';
import { ServersPage } from './pages/ServersPage';

export function App() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<ServicesPage />} />
        <Route path="monitoring" element={<MonitoringPage />} />
        <Route path="servers" element={<ServersPage />} />
        <Route path="dns" element={<DnsPage />} />
        <Route path="ru-proxy" element={<RuProxyPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="content" element={<ContentPage />} />
        <Route path="publish" element={<PublishPage />} />
        <Route path="publish/runs" element={<PublishRunsPage />} />
        <Route path="releases" element={<ReleasesPage />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="tunnels" element={<TunnelsPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="casdoor" element={<CasdoorPage />} />
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

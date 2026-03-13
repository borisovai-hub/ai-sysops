# AI SysOps

AI-powered infrastructure management platform for automated deployment and orchestration of self-hosted services.

## What is this?

AI SysOps is a complete DevOps toolkit that deploys and manages a full stack of self-hosted services on a single machine (or cluster). It includes a web-based Management UI, GitOps CI/CD pipelines, and AI agent integration for automated infrastructure operations.

### Managed Services

| Service | Description |
|---------|-------------|
| **Management UI** | Web dashboard for managing all services (Fastify v5 + React 19) |
| **Traefik** | Reverse proxy with automatic SSL (Let's Encrypt) |
| **GitLab CE** | Self-hosted Git server with CI/CD |
| **Authelia** | Single Sign-On (SSO) with 2FA via ForwardAuth |
| **Umami** | Privacy-friendly web analytics |
| **n8n** | Workflow automation |
| **Mailu** | Full-featured mail server |
| **frp** | Self-hosted tunneling (ngrok alternative) |
| **RU Proxy** | Regional reverse proxy (Caddy) for .ru domains |
| **DNS API** | Local DNS management via dnsmasq |

## Architecture

```
                         Internet
                            |
                   +--------+--------+
                   |                 |
              .ru domains       .tech domains
                   |                 |
            RU Proxy (Caddy)         |
                   |                 |
                   +--------+--------+
                            |
                      Traefik (443)
                            |
           +-------+-------+-------+-------+
           |       |       |       |       |
         GitLab  Umami   n8n    Mailu   Management UI
                                        (Fastify + React)
                                            |
                                      AI Agent (Claude)
```

### Multi-Domain Support

All services are accessible via two base domains (e.g. `borisovai.ru` + `borisovai.tech`). Traefik routes both, DNS records are created for each, and the RU Proxy handles `.ru` traffic through a regional VPS.

## Tech Stack

### Management UI (monorepo)

- **Backend**: Fastify v5, Drizzle ORM + SQLite, TypeScript
- **Frontend**: React 19, Vite, Tailwind CSS v4, TanStack Query, React Router v7
- **Shared**: Common types and utilities package
- **AI Agent**: Anthropic API + Claude CLI, 17 tools, tiered approvals, SSE streaming

### Infrastructure

- **CI/CD**: GitLab CI with shell runners, GitOps auto-deploy on push to main
- **Reverse Proxy**: Traefik v3 (main) + Caddy (RU regional proxy)
- **SSO**: Authelia with OIDC + ForwardAuth middleware
- **DNS**: dnsmasq + custom DNS API (port 5353)
- **Config Management**: Separate GitOps config repo (`tools/server-configs`)

## Project Structure

```
ai-sysops/
├── .gitlab-ci.yml              # CI/CD pipeline (validate -> deploy -> verify)
├── management-ui/
│   ├── backend/                # Fastify v5 API (14 route modules, 12 services)
│   ├── frontend/               # React 19 + Vite (11 pages)
│   ├── shared/                 # Common types & utilities
│   └── templates/              # CI pipeline templates for target projects
├── scripts/
│   ├── single-machine/         # Server install scripts (idempotent)
│   ├── ci/                     # CI/CD deploy scripts
│   └── dns-api/                # DNS API server (dnsmasq)
├── ru-proxy/                   # RU regional proxy (Caddy + Node.js API)
├── config/
│   ├── single-machine/         # Config templates (GitOps)
│   └── frpc-template/          # frp client config template
├── docs/
│   ├── setup/                  # Installation guides
│   ├── agents/                 # AI agent instructions
│   ├── plans/                  # Architecture plans & research
│   ├── dns/                    # DNS setup guides
│   └── DevOps_Research/        # AI-driven DevOps research docs
└── windows-install/            # Windows SSH/tooling helpers
```

## Quick Start

### System Requirements

- **OS**: Debian 11/12 or Ubuntu 20.04/22.04
- **RAM**: 8 GB minimum (16 GB+ recommended)
- **CPU**: 4 cores minimum (8+ recommended)
- **Disk**: 100 GB minimum (200 GB+ recommended)
- **Network**: Public IP, ports 80 and 443 open

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/borisovai-hub/ai-sysops.git
cd ai-sysops

# 2. Run the install script on the target server
sudo bash scripts/single-machine/install-management-ui.sh

# 3. Access the Management UI
# https://admin.<your-domain>
```

For detailed installation instructions, see [docs/setup/QUICK_START_GUIDE.md](docs/setup/QUICK_START_GUIDE.md).

## Key Features

### One-Click Publish

Register and deploy projects with automatic DNS, Traefik routing, CI/CD pipelines, and Strapi CMS integration. Supports 4 scenarios: deploy, docs, infra, product.

### GitOps CI/CD

Push to `main` triggers automatic deployment: validate -> build -> deploy -> health check. Server-specific configs are managed in a separate GitOps repository.

### AI Agent Integration

Built-in AI agent with 17 tools for infrastructure management: service control, DNS management, file operations, Git operations, and more. Tiered approval system for safe automation.

### Authelia SSO

Single Sign-On across all services with two-factor authentication. OIDC integration for Management UI, ForwardAuth middleware for Traefik-proxied services.

### Self-Hosted Tunneling (frp)

Expose local development services through the server — a self-hosted ngrok alternative with wildcard subdomain support.

## Documentation

- [Quick Start Guide](docs/setup/QUICK_START_GUIDE.md) — Get running in ~25 minutes
- [Full Installation](docs/setup/INSTALLATION.md) — Detailed setup guide
- [Single Machine Setup](README_SINGLE_MACHINE.md) — Complete single-server deployment

### For AI Agents

- [Orchestrator Guide](docs/agents/AGENT_ORCHESTRATOR.md) — Project registration API
- [GitOps Guide](docs/agents/AGENT_GITOPS.md) — CI/CD deployment
- [Services Guide](docs/agents/AGENT_SERVICES.md) — Service and DNS management
- [Strapi API Guide](docs/agents/AGENT_API_GUIDE.md) — Content publishing

### Research & Architecture

- [SSO Research](docs/plans/RESEARCH_SSO.md) — SSO comparison (Authelia vs Authentik vs Keycloak)
- [Tunneling Research](docs/plans/RESEARCH_TUNNELING.md) — Tunneling solutions comparison
- [Analytics Research](docs/plans/RESEARCH_ANALYTICS.md) — Analytics platforms comparison
- [DevOps AI System](docs/DevOps_Research/) — AI-driven DevOps architecture research

## License

This project is licensed under the [GNU Lesser General Public License v3.0](LICENSE).

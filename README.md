# Homelab Dashboard

Simple Homelab Dashboard for management with auto-discovery of services.

A lightweight Docker-deployable homelab dashboard with:

- Service launch groups from a mounted JSON config
- Local network TCP discovery with HTTP title/banner hints
- One-click addition of discovered HTTP services
- Proxmox API monitoring for nodes, CPU, memory, root disk, VMs, and LXC containers
- No frontend build step and no runtime npm dependencies

## Quick Start

```bash
docker compose up -d --build
```

Open:

```text
http://your-docker-host:8080
```

## Publish To GitHub And GHCR

This repo includes a GitHub Actions workflow that publishes the Docker image to GitHub Container Registry:

```text
ghcr.io/beefydaddy2510/homelab-dashboard:latest
```

After the first successful workflow run, open the package on GitHub and make sure its visibility is public if you want Portainer to pull it without registry credentials:

```text
GitHub repo -> Packages -> homelab-dashboard -> Package settings -> Change visibility -> Public
```

If Portainer shows `denied denied`, check both of these:

- The image name is fully lowercase: `ghcr.io/beefydaddy2510/homelab-dashboard:latest`
- The GHCR package is public, or Portainer has a GitHub registry credential with `read:packages`

After creating a GitHub repository, push this project:

```bash
git remote add origin https://github.com/BeefyDaddy2510/homelab-dashboard.git
git branch -M main
git push -u origin main
```

The included `compose.ghcr.yml` is already pointed at `ghcr.io/beefydaddy2510/homelab-dashboard:latest`.

## Portainer Compose

In Portainer, create a stack with this compose file:

```yaml
services:
  homelab-dashboard:
    image: ghcr.io/beefydaddy2510/homelab-dashboard:latest
    container_name: homelab-dashboard
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - /opt/homelab-dashboard/config:/config
    environment:
      DEFAULT_CIDR: "192.168.1.0/24"
      PROXMOX_URL: "https://proxmox.local:8006"
      PROXMOX_TOKEN_ID: "root@pam!dashboard"
      PROXMOX_TOKEN_SECRET: "replace-me"
      PROXMOX_VERIFY_SSL: "false"
```

Future updates are:

```bash
git add .
git commit -m "Update dashboard"
git push
```

Then on the server:

```bash
curl -fsSL https://raw.githubusercontent.com/BeefyDaddy2510/homelab-dashboard/main/scripts/refresh-server.sh | sh
```

The refresh script expects your server app directory to be:

```text
/opt/homelab-dashboard/
```

It expects a compose file at:

```text
/opt/homelab-dashboard/compose.yml
```

If you use a different path:

```bash
curl -fsSL https://raw.githubusercontent.com/BeefyDaddy2510/homelab-dashboard/main/scripts/refresh-server.sh | APP_DIR=/different/path sh
```

## Configure Services

Edit `config/services.json`:

```json
{
  "groups": [
    {
      "name": "Infrastructure",
      "services": [
        {
          "name": "Proxmox",
          "url": "https://proxmox.local:8006",
          "description": "Virtualization cluster",
          "icon": "server"
        }
      ]
    }
  ]
}
```

The container mounts this directory as `/config`, so edits survive rebuilds.

## Proxmox API

Create a Proxmox API token and set these environment variables in `compose.yml`:

```yaml
environment:
  PROXMOX_URL: "https://proxmox.local:8006"
  PROXMOX_TOKEN_ID: "root@pam!dashboard"
  PROXMOX_TOKEN_SECRET: "replace-me"
  PROXMOX_VERIFY_SSL: "false"
```

For a least-privilege token, grant read-only access needed for node and guest status, such as `PVEAuditor` at `/`.

## Network Discovery

The Discovery tab scans a CIDR and TCP port list. Defaults:

```yaml
environment:
  DEFAULT_CIDR: "192.168.1.0/24"
```

Optional scan tuning:

```yaml
environment:
  MAX_SCAN_HOSTS: "512"
  SCAN_WORKERS: "96"
  SCAN_TIMEOUT: "0.6"
```

Discovery uses TCP connect checks from inside the container. If your Docker server is isolated from parts of your LAN, run the container on a network that can reach those subnets.

## Build Without Compose

```bash
docker build -t homelab-dashboard .
docker run -d \
  --name homelab-dashboard \
  --restart unless-stopped \
  -p 8080:8080 \
  -v "$PWD/config:/config" \
  homelab-dashboard
```

## API Endpoints

- `GET /api/health`
- `GET /api/config`
- `POST /api/services`
- `GET /api/discovery?cidr=192.168.1.0/24&ports=22,80,443,8080`
- `GET /api/proxmox`

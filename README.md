# Lab Homie

A lightweight self-hosted dashboard for homelab environments.

Monitor your services, discover devices on your network, and view Proxmox infrastructure from a single interface.

## Features

* Dashboard with grouped services and custom icons
* Automatic network discovery
* One-click service import from discovery results
* Proxmox monitoring (nodes, VMs, LXCs, CPU, memory, storage)
* Docker deployment
* No external database required

## Quick Start

```yaml
services:
  homelab-dashboard:
    image: ghcr.io/beefydaddy2510/homelab-dashboard:latest
    container_name: homelab-dashboard
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ./config:/config
```

## Proxmox Integration

Proxmox servers can be configured directly from the dashboard:

```text
Settings → Proxmox Servers → Add Server
```

Alternatively, configure a server through Docker Compose:

```yaml
environment:
  PROXMOX_URL: "https://proxmox.local:8006"
  PROXMOX_TOKEN_ID: "root@pam!dashboard"
  PROXMOX_TOKEN_SECRET: "your-token"
  PROXMOX_VERIFY_SSL: "false"
```

For multiple Proxmox clusters:

```yaml
environment:
  PROXMOX_1_URL: "https://cluster1.local:8006"
  PROXMOX_1_TOKEN_ID: "root@pam!dashboard"
  PROXMOX_1_TOKEN_SECRET: "token1"

  PROXMOX_2_URL: "https://cluster2.local:8006"
  PROXMOX_2_TOKEN_ID: "root@pam!dashboard"
  PROXMOX_2_TOKEN_SECRET: "token2"
```

A read-only API token with the `PVEAuditor` role is recommended.

## Configuration

Service definitions are stored in:

```text
/config/services.json
```

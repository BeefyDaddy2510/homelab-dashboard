import concurrent.futures
import ipaddress
import json
import os
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
CONFIG_DIR = Path(os.environ.get("CONFIG_DIR", "/config"))
SERVICES_FILE = CONFIG_DIR / "services.json"
SETTINGS_FILE = CONFIG_DIR / "settings.json"
PROXMOX_FILE = CONFIG_DIR / "proxmox.json"

DEFAULT_PORTS = [22, 80, 443, 445, 5000, 8000, 8080, 8123, 9000, 9443]
MAX_SCAN_HOSTS = int(os.environ.get("MAX_SCAN_HOSTS", "512"))
SCAN_WORKERS = int(os.environ.get("SCAN_WORKERS", "96"))
SCAN_TIMEOUT = float(os.environ.get("SCAN_TIMEOUT", "0.6"))


def json_response(handler, payload, status=200):
    body = json.dumps(payload, indent=2).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def error_response(handler, message, status=400):
    json_response(handler, {"error": message}, status)


def read_json_file(path, fallback):
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return fallback
    except json.JSONDecodeError as exc:
        return {"error": f"Invalid JSON in {path}: {exc}"}


def load_services():
    fallback = {
        "groups": [
            {
                "name": "Core",
                "services": [
                    {
                        "name": "Router",
                        "url": "http://192.168.1.1",
                        "description": "Network gateway",
                        "icon": "route",
                    }
                ],
            }
        ]
    }
    return read_json_file(SERVICES_FILE, fallback)


def load_settings():
    fallback = {
        "theme": "cosmic",
        "background": "/assets/space-bg.png",
        "accent": "#5ee0b5",
        "panel_opacity": 82,
    }
    settings = read_json_file(SETTINGS_FILE, fallback)
    if not isinstance(settings, dict) or "error" in settings:
        return fallback
    return {**fallback, **settings}


def save_settings(payload):
    settings = load_settings()
    allowed_themes = {"cosmic", "dark", "midnight"}
    theme = payload.get("theme", settings["theme"])
    if theme not in allowed_themes:
        raise ValueError("Invalid theme.")

    accent = str(payload.get("accent", settings["accent"])).strip() or settings["accent"]
    background = str(payload.get("background", settings["background"])).strip()
    panel_opacity = int(payload.get("panel_opacity", settings["panel_opacity"]))
    panel_opacity = max(35, min(95, panel_opacity))

    settings = {
        "theme": theme,
        "background": background,
        "accent": accent,
        "panel_opacity": panel_opacity,
    }
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with SETTINGS_FILE.open("w", encoding="utf-8") as handle:
        json.dump(settings, handle, indent=2)
        handle.write("\n")
    return settings


def save_service(service):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    config = load_services()
    if not isinstance(config, dict) or "error" in config:
        config = {"groups": []}

    groups = config.setdefault("groups", [])
    discovered = next((group for group in groups if group.get("name") == "Discovered"), None)
    if not discovered:
        discovered = {"name": "Discovered", "services": []}
        groups.append(discovered)

    services = discovered.setdefault("services", [])
    url = service.get("url", "").strip()
    if not url:
        raise ValueError("Service URL is required.")
    if any(item.get("url") == url for group in groups for item in group.get("services", [])):
        return config

    parsed = urllib.parse.urlparse(url)
    services.append(
        {
            "name": service.get("name") or parsed.hostname or "Discovered service",
            "url": url,
            "description": service.get("description") or "Discovered on local network",
            "icon": "scan",
        }
    )
    with SERVICES_FILE.open("w", encoding="utf-8") as handle:
        json.dump(config, handle, indent=2)
        handle.write("\n")
    return config


def normalize_service(service):
    url = service.get("url", "").strip()
    name = service.get("name", "").strip()
    if not url:
        raise ValueError("Service URL is required.")
    if not name:
        raise ValueError("Service name is required.")

    parsed = urllib.parse.urlparse(url)
    if not parsed.scheme:
        url = f"http://{url}"

    return {
        "name": name,
        "url": url,
        "description": service.get("description", "").strip(),
        "icon": service.get("icon", "").strip() or name[:2].upper(),
        "icon_url": service.get("icon_url", "").strip(),
    }


def find_or_create_group(config, group_name):
    groups = config.setdefault("groups", [])
    clean_name = (group_name or "Manual").strip() or "Manual"
    group = next((item for item in groups if item.get("name") == clean_name), None)
    if not group:
        group = {"name": clean_name, "services": []}
        groups.append(group)
    return group


def write_config(config):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with SERVICES_FILE.open("w", encoding="utf-8") as handle:
        json.dump(config, handle, indent=2)
        handle.write("\n")


def add_manual_service(payload):
    config = load_services()
    if not isinstance(config, dict) or "error" in config:
        config = {"groups": []}

    service = normalize_service(payload)
    group = find_or_create_group(config, payload.get("group"))
    group.setdefault("services", []).append(service)
    write_config(config)
    return config


def update_service(payload):
    config = load_services()
    groups = config.get("groups", [])
    group_index = int(payload.get("groupIndex"))
    service_index = int(payload.get("serviceIndex"))

    try:
        current_group = groups[group_index]
        current_group.setdefault("services", [])[service_index]
    except (IndexError, TypeError):
        raise ValueError("Service was not found.")

    updated = normalize_service(payload)
    target_group_name = payload.get("group") or current_group.get("name") or "Manual"
    target_group = find_or_create_group(config, target_group_name)

    del current_group["services"][service_index]
    target_group.setdefault("services", []).append(updated)
    config["groups"] = [
        group
        for group in groups
        if group.get("services") or group is target_group or group.get("name") not in ("Manual", "Discovered")
    ]
    write_config(config)
    return config


def delete_service(payload):
    config = load_services()
    groups = config.get("groups", [])
    group_index = int(payload.get("groupIndex"))
    service_index = int(payload.get("serviceIndex"))

    try:
        del groups[group_index].setdefault("services", [])[service_index]
    except (IndexError, TypeError):
        raise ValueError("Service was not found.")

    config["groups"] = [
        group
        for group in groups
        if group.get("services") or group.get("name") not in ("Manual", "Discovered")
    ]
    write_config(config)
    return config


def load_proxmox_config():
    config = read_json_file(PROXMOX_FILE, {"servers": []})
    if not isinstance(config, dict) or "error" in config:
        return {"servers": []}
    servers = config.get("servers", [])
    return {"servers": servers if isinstance(servers, list) else []}


def normalize_proxmox_server(payload):
    name = str(payload.get("name", "")).strip()
    url = str(payload.get("url", "")).strip().rstrip("/")
    token_id = str(payload.get("token_id", "")).strip()
    token_secret = str(payload.get("token_secret", "")).strip()
    verify_ssl = payload.get("verify_ssl", True)

    if not url:
        raise ValueError("Proxmox URL is required.")
    if urllib.parse.urlparse(url).scheme not in ("http", "https"):
        url = f"https://{url}"
    if not name:
        name = urllib.parse.urlparse(url).hostname or "Proxmox"
    if not token_id:
        raise ValueError("Proxmox token ID is required.")
    if not token_secret:
        raise ValueError("Proxmox token secret is required.")

    return {
        "name": name,
        "url": url,
        "token_id": token_id,
        "token_secret": token_secret,
        "verify_ssl": str(verify_ssl).lower() == "true" if isinstance(verify_ssl, str) else bool(verify_ssl),
    }


def write_proxmox_config(config):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with PROXMOX_FILE.open("w", encoding="utf-8") as handle:
        json.dump(config, handle, indent=2)
        handle.write("\n")


def proxmox_public_config():
    config = load_proxmox_config()
    return {
        "servers": [
            {
                "name": server.get("name", ""),
                "url": server.get("url", ""),
                "token_id": server.get("token_id", ""),
                "verify_ssl": server.get("verify_ssl", True),
                "has_token_secret": bool(server.get("token_secret")),
            }
            for server in config.get("servers", [])
        ]
    }


def add_proxmox_server(payload):
    config = load_proxmox_config()
    config.setdefault("servers", []).append(normalize_proxmox_server(payload))
    write_proxmox_config(config)
    return proxmox_public_config()


def update_proxmox_server(payload):
    config = load_proxmox_config()
    index = int(payload.get("index"))
    try:
        existing = config.setdefault("servers", [])[index]
    except (IndexError, TypeError):
        raise ValueError("Proxmox server was not found.")

    merged = dict(existing)
    merged.update(payload)
    if not str(payload.get("token_secret", "")).strip() and existing.get("token_secret"):
        merged["token_secret"] = existing["token_secret"]
    config["servers"][index] = normalize_proxmox_server(merged)
    write_proxmox_config(config)
    return proxmox_public_config()


def delete_proxmox_server(payload):
    config = load_proxmox_config()
    index = int(payload.get("index"))
    try:
        del config.setdefault("servers", [])[index]
    except (IndexError, TypeError):
        raise ValueError("Proxmox server was not found.")
    write_proxmox_config(config)
    return proxmox_public_config()


def parse_ports(raw):
    if not raw:
        return DEFAULT_PORTS
    ports = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        port = int(item)
        if port < 1 or port > 65535:
            raise ValueError(f"Port out of range: {port}")
        ports.append(port)
    return sorted(set(ports))


def grab_http(ip, port, timeout):
    scheme = "https" if port in (443, 8443, 9443) else "http"
    url = f"{scheme}://{ip}:{port}/"
    context = ssl._create_unverified_context()
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "HomelabDashboard/0.1"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=context) as resp:
            content_type = resp.headers.get("content-type", "")
            server = resp.headers.get("server", "")
            title = ""
            if "text/html" in content_type:
                chunk = resp.read(65536).decode("utf-8", errors="ignore")
                lower = chunk.lower()
                start = lower.find("<title")
                if start >= 0:
                    start = lower.find(">", start)
                    end = lower.find("</title>", start)
                    if start >= 0 and end >= 0:
                        title = " ".join(chunk[start + 1 : end].split())[:120]
            return {"url": url, "server": server, "title": title}
    except Exception:
        return {"url": url, "server": "", "title": ""}


def scan_port(ip, port, timeout):
    started = time.perf_counter()
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        result = sock.connect_ex((ip, port))
    latency_ms = round((time.perf_counter() - started) * 1000)
    if result != 0:
        return None

    service = {
        "port": port,
        "latency_ms": latency_ms,
        "protocol": "tcp",
        "hint": socket.getservbyport(port, "tcp") if port < 1024 else "",
    }
    if port in (80, 443, 5000, 8000, 8080, 8123, 8443, 9000, 9443):
        service.update(grab_http(ip, port, timeout))
    return service


def scan_host(ip, ports, timeout):
    open_ports = []
    for port in ports:
        result = scan_port(str(ip), port, timeout)
        if result:
            open_ports.append(result)
    if not open_ports:
        return None

    try:
        hostname = socket.gethostbyaddr(str(ip))[0]
    except (socket.herror, socket.gaierror):
        hostname = ""

    return {"ip": str(ip), "hostname": hostname, "ports": open_ports}


def run_discovery(cidr, ports, timeout):
    network = ipaddress.ip_network(cidr, strict=False)
    hosts = list(network.hosts())
    if len(hosts) > MAX_SCAN_HOSTS:
        raise ValueError(f"CIDR is too large. Limit is {MAX_SCAN_HOSTS} hosts.")

    started = time.perf_counter()
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=SCAN_WORKERS) as pool:
        futures = [pool.submit(scan_host, ip, ports, timeout) for ip in hosts]
        for future in concurrent.futures.as_completed(futures):
            found = future.result()
            if found:
                results.append(found)

    results.sort(key=lambda item: tuple(int(part) for part in item["ip"].split(".")))
    return {
        "cidr": str(network),
        "ports": ports,
        "duration_ms": round((time.perf_counter() - started) * 1000),
        "hosts": results,
    }


def proxmox_servers():
    configured = load_proxmox_config().get("servers", [])
    if configured:
        return configured

    raw = os.environ.get("PROXMOX_SERVERS", "").strip()
    if raw:
        servers = json.loads(raw)
        if not isinstance(servers, list):
            raise RuntimeError("PROXMOX_SERVERS must be a JSON array.")
        return [
            {
                "name": item.get("name") or urllib.parse.urlparse(item.get("url", "")).hostname or "Proxmox",
                "url": item.get("url", "").rstrip("/"),
                "token_id": item.get("token_id", ""),
                "token_secret": item.get("token_secret", ""),
                "verify_ssl": str(item.get("verify_ssl", "true")).lower() == "true",
            }
            for item in servers
        ]

    indexed = []
    for index in range(1, 11):
        prefix = f"PROXMOX_{index}_"
        url = os.environ.get(f"{prefix}URL", "").rstrip("/")
        if not url:
            continue
        indexed.append(
            {
                "name": os.environ.get(f"{prefix}NAME")
                or urllib.parse.urlparse(url).hostname
                or f"Proxmox {index}",
                "url": url,
                "token_id": os.environ.get(f"{prefix}TOKEN_ID", ""),
                "token_secret": os.environ.get(f"{prefix}TOKEN_SECRET", ""),
                "verify_ssl": os.environ.get(f"{prefix}VERIFY_SSL", "true").lower() == "true",
            }
        )
    if indexed:
        return indexed

    return [
        {
            "name": os.environ.get("PROXMOX_NAME", "Proxmox"),
            "url": os.environ.get("PROXMOX_URL", "").rstrip("/"),
            "token_id": os.environ.get("PROXMOX_TOKEN_ID", ""),
            "token_secret": os.environ.get("PROXMOX_TOKEN_SECRET", ""),
            "verify_ssl": os.environ.get("PROXMOX_VERIFY_SSL", "true").lower() == "true",
        }
    ]


def proxmox_request(server, path):
    base_url = server.get("url", "").rstrip("/")
    token_id = server.get("token_id", "")
    token_secret = server.get("token_secret", "")
    verify_ssl = server.get("verify_ssl", True)

    if not base_url or not token_id or not token_secret:
        raise RuntimeError("Set Proxmox URL, token ID, and token secret.")

    headers = {"Authorization": f"PVEAPIToken={token_id}={token_secret}"}
    req = urllib.request.Request(f"{base_url}/api2/json{path}", headers=headers)
    context = None if verify_ssl else ssl._create_unverified_context()
    with urllib.request.urlopen(req, timeout=8, context=context) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return payload.get("data", payload)


def proxmox_summary():
    clusters = []
    all_nodes = []
    errors = []

    for server in proxmox_servers():
        cluster = {"name": server["name"], "url": server["url"], "nodes": []}
        try:
            nodes = proxmox_request(server, "/nodes")
        except Exception as exc:
            cluster["error"] = str(exc)
            errors.append({"server": server["name"], "error": str(exc)})
            clusters.append(cluster)
            continue

        try:
            resources = proxmox_request(server, "/cluster/resources")
        except Exception:
            resources = []

        enriched = []
        for node in nodes:
            name = node.get("node")
            item = dict(node)
            item["server"] = server["name"]
            item["server_url"] = server["url"]
            item["vms"] = [
                resource
                for resource in resources
                if resource.get("type") == "qemu" and resource.get("node") == name
            ]
            item["containers"] = [
                resource
                for resource in resources
                if resource.get("type") == "lxc" and resource.get("node") == name
            ]
            try:
                item["status_detail"] = proxmox_request(
                    server, f"/nodes/{urllib.parse.quote(name)}/status"
                )
            except Exception as exc:
                item["detail_error"] = str(exc)

            try:
                item["vms"] = proxmox_request(server, f"/nodes/{urllib.parse.quote(name)}/qemu")
            except Exception as exc:
                item["vm_error"] = str(exc)

            try:
                item["containers"] = proxmox_request(
                    server, f"/nodes/{urllib.parse.quote(name)}/lxc"
                )
            except Exception as exc:
                item["container_error"] = str(exc)
            enriched.append(item)
            all_nodes.append(item)

        cluster["nodes"] = enriched
        clusters.append(cluster)

    return {"clusters": clusters, "nodes": all_nodes, "errors": errors}


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def log_message(self, format, *args):
        if os.environ.get("QUIET_LOGS", "false").lower() != "true":
            super().log_message(format, *args)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/config":
            json_response(self, load_services())
            return

        if parsed.path == "/api/settings":
            json_response(self, load_settings())
            return

        if parsed.path == "/api/proxmox/config":
            json_response(self, proxmox_public_config())
            return

        if parsed.path == "/api/health":
            json_response(self, {"ok": True, "version": "0.1.0"})
            return

        if parsed.path == "/api/discovery":
            params = urllib.parse.parse_qs(parsed.query)
            cidr = params.get("cidr", [os.environ.get("DEFAULT_CIDR", "192.168.1.0/24")])[0]
            try:
                ports = parse_ports(params.get("ports", [""])[0])
                timeout = float(params.get("timeout", [SCAN_TIMEOUT])[0])
                json_response(self, run_discovery(cidr, ports, timeout))
            except Exception as exc:
                error_response(self, str(exc), 400)
            return

        if parsed.path == "/api/proxmox":
            try:
                json_response(self, proxmox_summary())
            except urllib.error.HTTPError as exc:
                error_response(self, f"Proxmox API error: {exc.code} {exc.reason}", exc.code)
            except Exception as exc:
                error_response(self, str(exc), 503)
            return

        if parsed.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def read_body_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8")
        return json.loads(body or "{}")

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        try:
            payload = self.read_body_json()
            if parsed.path == "/api/services":
                json_response(self, add_manual_service(payload), 201)
                return
            if parsed.path == "/api/services/discovered":
                json_response(self, save_service(payload), 201)
                return
            if parsed.path == "/api/services/update":
                json_response(self, update_service(payload), 200)
                return
            if parsed.path == "/api/services/delete":
                json_response(self, delete_service(payload), 200)
                return
            if parsed.path == "/api/settings":
                json_response(self, save_settings(payload), 200)
                return
            if parsed.path == "/api/proxmox/config":
                json_response(self, add_proxmox_server(payload), 201)
                return
            if parsed.path == "/api/proxmox/config/update":
                json_response(self, update_proxmox_server(payload), 200)
                return
            if parsed.path == "/api/proxmox/config/delete":
                json_response(self, delete_proxmox_server(payload), 200)
                return
            error_response(self, "Not found", 404)
        except Exception as exc:
            error_response(self, str(exc), 400)


def main():
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), DashboardHandler)
    print(f"Homelab Dashboard listening on :{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

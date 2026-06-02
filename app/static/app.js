const state = {
  services: [],
  discovery: [],
  proxmox: null,
};

const $ = (selector) => document.querySelector(selector);

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function percent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function firstNumber(...values) {
  return values.find((value) => Number.isFinite(value));
}

function serviceInitial(name) {
  return (name || "?").slice(0, 2).toUpperCase();
}

async function requestJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || response.statusText);
  return payload;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderServices(config) {
  const container = $("#services-grid");
  const groups = Array.isArray(config.groups) ? config.groups : [];
  let count = 0;

  container.innerHTML = groups
    .map((group) => {
      const services = Array.isArray(group.services) ? group.services : [];
      count += services.length;
      return `
        <div>
          <h3 class="group-title">${group.name || "Services"}</h3>
          <div class="service-list">
            ${services
              .map(
                (service) => `
                  <a class="service-card" href="${service.url}" target="_blank" rel="noreferrer">
                    <div class="service-icon">${serviceInitial(service.name)}</div>
                    <strong>${escapeHtml(service.name)}</strong>
                    <span>${escapeHtml(service.description || service.url || "")}</span>
                  </a>
                `,
              )
              .join("")}
          </div>
        </div>
      `;
    })
    .join("");

  if (!groups.length) {
    container.innerHTML = `<div class="empty">No services configured yet.</div>`;
  }
  setText("#service-count", count);
  setText("#config-note", count ? `${count} configured` : "Edit /config/services.json");
}

function renderProxmox(payload) {
  const container = $("#proxmox-grid");
  const nodes = payload?.nodes || [];
  setText("#node-count", nodes.length || "-");
  setText("#proxmox-state", nodes.length ? "Connected" : "No nodes");

  if (!nodes.length) {
    container.innerHTML = `<div class="empty">No Proxmox nodes returned.</div>`;
    return;
  }

  container.innerHTML = nodes
    .map((node) => {
      const detail = node.status_detail || {};
      const memoryUsed = firstNumber(detail.memory?.used, node.mem);
      const memoryTotal = firstNumber(detail.memory?.total, node.maxmem);
      const rootUsed = firstNumber(detail.rootfs?.used, node.disk);
      const rootTotal = firstNumber(detail.rootfs?.total, node.maxdisk);
      const cpu = percent(firstNumber(detail.cpu, node.cpu));
      const memory = percent(memoryUsed / memoryTotal);
      const root = percent(rootUsed / rootTotal);
      const vms = Array.isArray(node.vms) ? node.vms.length : 0;
      const containers = Array.isArray(node.containers) ? node.containers.length : 0;
      const detailWarning = node.detail_error
        ? `<div class="node-warning">Detail API unavailable: ${escapeHtml(node.detail_error)}</div>`
        : "";
      return `
        <article class="node-card">
          <div class="node-top">
            <div>
            <strong>${escapeHtml(node.node || "Node")}</strong>
              <div class="host-meta">${vms} VMs / ${containers} CTs</div>
            </div>
            <span class="badge ${node.status === "online" ? "" : "warn"}">${node.status || "unknown"}</span>
          </div>
          <div class="resource">
            <div class="resource-row">
              <span>CPU ${cpu}%</span>
              <div class="bar"><i style="--value:${cpu}%"></i></div>
            </div>
            <div class="resource-row">
              <span>Memory ${memory}% of ${formatBytes(memoryTotal)}</span>
              <div class="bar"><i style="--value:${memory}%"></i></div>
            </div>
            <div class="resource-row">
              <span>Root FS ${root}% of ${formatBytes(rootTotal)}</span>
              <div class="bar"><i style="--value:${root}%"></i></div>
            </div>
          </div>
          ${detailWarning}
        </article>
      `;
    })
    .join("");
}

function renderScan(payload) {
  const container = $("#scan-results");
  const hosts = payload.hosts || [];
  state.discovery = hosts;
  setText("#host-count", hosts.length);
  setText("#last-scan", `${Math.round(payload.duration_ms / 1000)}s`);

  if (!hosts.length) {
    container.innerHTML = `<div class="empty">No open ports found for this scan.</div>`;
    return;
  }

  container.innerHTML = hosts
    .map((host) => {
      const title = host.hostname || host.ip;
      return `
        <article class="host-card">
          <div class="host-top">
            <div>
              <strong>${escapeHtml(title)}</strong>
              <div class="host-meta">${escapeHtml(host.ip)}</div>
            </div>
            <span class="badge">${host.ports.length} open</span>
          </div>
          <div class="port-list">
            ${host.ports
              .map((port) => {
                const label = port.title || port.server || port.hint || port.protocol;
                const link = port.url
                  ? `<span class="port port-action"><a href="${port.url}" target="_blank" rel="noreferrer">${port.port} ${escapeHtml(label)}</a><button data-add-service="${encodeURIComponent(
                      JSON.stringify({
                        name: port.title || `${host.ip}:${port.port}`,
                        url: port.url,
                        description: label || "Discovered on local network",
                      }),
                    )}" title="Add service">+</button></span>`
                  : `<span class="port">${port.port} ${escapeHtml(label)}</span>`;
                return link;
              })
              .join("")}
          </div>
        </article>
      `;
    })
    .join("");
}

async function addService(encoded) {
  const service = JSON.parse(decodeURIComponent(encoded));
  const response = await fetch("/api/services", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(service),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || response.statusText);
  renderServices(payload);
}

async function loadConfig() {
  try {
    const config = await requestJson("/api/config");
    renderServices(config);
    setText("#api-status", "Online");
  } catch (error) {
    $("#services-grid").innerHTML = `<div class="error">${error.message}</div>`;
    setText("#api-status", "Config error");
  }
}

async function loadProxmox() {
  setText("#proxmox-state", "Loading");
  $("#proxmox-grid").innerHTML = `<div class="empty">Contacting Proxmox API...</div>`;
  try {
    const payload = await requestJson("/api/proxmox");
    state.proxmox = payload;
    renderProxmox(payload);
  } catch (error) {
    setText("#proxmox-state", "Needs configuration");
    $("#proxmox-grid").innerHTML = `<div class="error">${error.message}</div>`;
  }
}

async function runScan(event) {
  event.preventDefault();
  const cidr = encodeURIComponent($("#cidr").value.trim());
  const ports = encodeURIComponent($("#ports").value.trim());
  $("#scan-results").innerHTML = `<div class="empty">Scanning local network...</div>`;
  try {
    const payload = await requestJson(`/api/discovery?cidr=${cidr}&ports=${ports}`);
    renderScan(payload);
  } catch (error) {
    $("#scan-results").innerHTML = `<div class="error">${error.message}</div>`;
  }
}

document.addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-add-service]");
  if (addButton) {
    addButton.disabled = true;
    addService(addButton.dataset.addService)
      .then(() => {
        addButton.textContent = "OK";
      })
      .catch((error) => {
        addButton.textContent = "!";
        addButton.title = error.message;
      });
    return;
  }

  const link = event.target.closest(".nav a");
  if (!link) return;
  document.querySelectorAll(".nav a").forEach((item) => item.classList.remove("active"));
  link.classList.add("active");
});

$("#scan-form").addEventListener("submit", runScan);
$("#refresh-config").addEventListener("click", loadConfig);
$("#refresh-proxmox").addEventListener("click", loadProxmox);

loadConfig();
loadProxmox();

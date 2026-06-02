const state = {
  config: { groups: [] },
  settings: {},
  proxmoxConfig: { servers: [] },
  discoveryHosts: 0,
  proxmoxNodes: 0,
  proxmoxVms: 0,
  proxmoxContainers: 0,
};

const $ = (selector) => document.querySelector(selector);

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

function formatUptime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const days = Math.floor(seconds / 86400);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) return `${hours}h`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m`;
}

function percent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function firstNumber(...values) {
  return values.find((value) => Number.isFinite(value));
}

function updateHostCount() {
  setText("#host-count", state.discoveryHosts + state.proxmoxNodes);
}

function updateQuickStats() {
  setText("#quick-vms", state.proxmoxVms);
  setText("#quick-containers", state.proxmoxContainers);
}

function iconText(service) {
  const icon = String(service.icon || "").trim();
  if (icon) return icon.slice(0, 8).toUpperCase();
  return String(service.name || "?").slice(0, 2).toUpperCase();
}

function iconMarkup(service) {
  const iconUrl = String(service.icon_url || "").trim();
  if (iconUrl) {
    return `<img src="${escapeHtml(iconUrl)}" alt="" loading="lazy" />`;
  }
  return `<span>${escapeHtml(iconText(service))}</span>`;
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || response.statusText);
  return payload;
}

function applySettings(settings) {
  state.settings = settings || {};
  document.body.classList.remove("theme-cosmic", "theme-dark", "theme-midnight");
  document.body.classList.add(`theme-${state.settings.theme || "cosmic"}`);
  document.documentElement.style.setProperty("--accent", state.settings.accent || "#5ee0b5");
  document.documentElement.style.setProperty(
    "--panel-opacity",
    String((Number(state.settings.panel_opacity) || 82) / 100),
  );

  const background = state.settings.background || "/assets/space-bg.png";
  if (background) {
    document.documentElement.style.setProperty("--background-image", `url("${background.replaceAll('"', "%22")}")`);
  }

  $("#setting-theme").value = state.settings.theme || "cosmic";
  $("#setting-accent").value = state.settings.accent || "#5ee0b5";
  $("#setting-panel-opacity").value = state.settings.panel_opacity || 82;
  $("#setting-background").value = background;
  $("#setting-weather-location").value = state.settings.weather_location || "";
}

async function loadSettings() {
  applySettings(await requestJson("/api/settings"));
}

async function saveSettings() {
  const settings = await requestJson("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      theme: $("#setting-theme").value,
      accent: $("#setting-accent").value,
      panel_opacity: $("#setting-panel-opacity").value,
      background: $("#setting-background").value.trim(),
      weather_location: $("#setting-weather-location").value.trim(),
    }),
  });
  applySettings(settings);
  loadWeather();
}

function renderProxmoxConfig(config) {
  state.proxmoxConfig = config || { servers: [] };
  const container = $("#proxmox-config-list");
  const servers = state.proxmoxConfig.servers || [];

  if (!servers.length) {
    container.innerHTML = `
      <div class="empty">
        No UI-managed Proxmox servers yet. Environment variables still work as fallback.
      </div>
    `;
    return;
  }

  container.innerHTML = servers
    .map((server, index) => `
      <article class="config-row">
        <div>
          <strong>${escapeHtml(server.name || "Proxmox")}</strong>
          <span>${escapeHtml(server.url || "")}</span>
          <small>${escapeHtml(server.token_id || "")}${server.has_token_secret ? " / secret saved" : ""}</small>
        </div>
        <button data-edit-proxmox="${index}" class="small-button">Edit</button>
      </article>
    `)
    .join("");
}

async function loadProxmoxConfig() {
  renderProxmoxConfig(await requestJson("/api/proxmox/config"));
}

function openProxmoxDialog(entry) {
  const isEdit = Boolean(entry);
  $("#proxmox-dialog-title").textContent = isEdit ? "Edit Proxmox Server" : "Add Proxmox Server";
  $("#delete-proxmox").style.visibility = isEdit ? "visible" : "hidden";
  $("#proxmox-index").value = isEdit ? entry.index : "";
  $("#proxmox-name").value = isEdit ? entry.server.name || "" : "";
  $("#proxmox-url").value = isEdit ? entry.server.url || "" : "";
  $("#proxmox-token-id").value = isEdit ? entry.server.token_id || "" : "";
  $("#proxmox-token-secret").value = "";
  $("#proxmox-token-secret").required = !isEdit;
  $("#proxmox-verify-ssl").checked = isEdit ? Boolean(entry.server.verify_ssl) : false;
  $("#proxmox-dialog").showModal();
}

function proxmoxFormPayload() {
  return {
    name: $("#proxmox-name").value.trim(),
    url: $("#proxmox-url").value.trim(),
    token_id: $("#proxmox-token-id").value.trim(),
    token_secret: $("#proxmox-token-secret").value.trim(),
    verify_ssl: $("#proxmox-verify-ssl").checked,
  };
}

async function saveProxmoxServer(event) {
  event.preventDefault();
  const index = $("#proxmox-index").value;
  const isEdit = index !== "";
  const endpoint = isEdit ? "/api/proxmox/config/update" : "/api/proxmox/config";
  const payload = isEdit ? { ...proxmoxFormPayload(), index } : proxmoxFormPayload();
  renderProxmoxConfig(
    await requestJson(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  $("#proxmox-dialog").close();
  loadProxmox();
}

async function deleteCurrentProxmoxServer() {
  const index = $("#proxmox-index").value;
  if (index === "") return;
  renderProxmoxConfig(
    await requestJson("/api/proxmox/config/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index }),
    }),
  );
  $("#proxmox-dialog").close();
  loadProxmox();
}

function switchView(view) {
  document.querySelectorAll(".view").forEach((element) => element.classList.remove("active"));
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.remove("active"));
  $(`#view-${view}`)?.classList.add("active");
  document.querySelectorAll(`[data-view-link="${view}"]`).forEach((button) => {
    if (button.classList.contains("nav-button")) button.classList.add("active");
  });
}

function renderServices(config) {
  state.config = config;
  const container = $("#services-grid");
  const query = $("#service-search").value.trim().toLowerCase();
  const groups = Array.isArray(config.groups) ? config.groups : [];
  let count = 0;

  container.innerHTML = groups
    .map((group, groupIndex) => {
      const groupServices = group.services || [];
      count += groupServices.length;
      const services = groupServices
        .map((service, serviceIndex) => ({ service, serviceIndex }))
        .filter(({ service }) => {
          const haystack = `${service.name} ${service.description} ${service.url}`.toLowerCase();
          return !query || haystack.includes(query);
        });

      if (!services.length) return "";

      return `
        <div class="service-group">
          <h3 class="group-title">${escapeHtml(group.name || "Services")}</h3>
          <div class="service-list">
            ${services
              .map(({ service, serviceIndex }) => `
                <article class="service-card">
                  <a class="service-link" href="${escapeHtml(service.url)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeHtml(
                    service.name,
                  )}"></a>
                  <div class="service-icon">${iconMarkup(service)}</div>
                  <div class="service-copy">
                    <strong>${escapeHtml(service.name)}</strong>
                    <span>${escapeHtml(service.description || service.url || "")}</span>
                  </div>
                  <button class="service-menu" data-edit="${groupIndex}:${serviceIndex}" title="Edit service">...</button>
                </article>
              `)
              .join("")}
          </div>
        </div>
      `;
    })
    .join("");

  if (!groups.length || !container.innerHTML.trim()) {
    container.innerHTML = `<div class="empty">No services match this view.</div>`;
  }
  setText("#service-count", count);
  setText("#quick-services", count);
  setText("#config-note", `${count} configured`);
}

function renderProxmox(payload) {
  const container = $("#proxmox-grid");
  const nodes = payload?.nodes || [];
  const clusters = payload?.clusters || [{ name: "Proxmox", nodes }];
  state.proxmoxNodes = nodes.length;
  state.proxmoxVms = nodes.reduce((total, node) => total + (Array.isArray(node.vms) ? node.vms.length : 0), 0);
  state.proxmoxContainers = nodes.reduce(
    (total, node) => total + (Array.isArray(node.containers) ? node.containers.length : 0),
    0,
  );
  setText("#node-count", nodes.length || "-");
  updateHostCount();
  updateQuickStats();

  if (!nodes.length && !clusters.some((cluster) => cluster.error)) {
    container.innerHTML = `<div class="empty">No Proxmox nodes returned.</div>`;
    return;
  }

  container.innerHTML = clusters
    .map((cluster) => {
      if (cluster.error) {
        return `<div class="error">${escapeHtml(cluster.name)}: ${escapeHtml(cluster.error)}</div>`;
      }
      return (cluster.nodes || []).map((node) => renderProxmoxNode(node, cluster)).join("");
    })
    .join("");
}

function renderProxmoxNode(node, cluster) {
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
        <article class="node-row">
          <div class="node-main">
            <div class="node-icon" aria-hidden="true">
              <span></span><span></span>
            </div>
            <div>
              <div class="node-server">${escapeHtml(cluster?.name || node.server || "Proxmox")}</div>
              <strong>${escapeHtml(node.node || "Node")}</strong>
              <div class="host-meta">${vms} VMs / ${containers} CTs</div>
            </div>
          </div>
          <div class="node-resources">
            <div class="resource-row">
              <span>CPU ${cpu}%</span>
              <div class="bar"><i style="--value:${cpu}%"></i></div>
            </div>
            <div class="resource-row">
              <span>RAM ${memory}% / ${formatBytes(memoryTotal)}</span>
              <div class="bar"><i style="--value:${memory}%"></i></div>
            </div>
            <div class="resource-row">
              <span>Disk ${root}% / ${formatBytes(rootTotal)}</span>
              <div class="bar"><i style="--value:${root}%"></i></div>
            </div>
          </div>
          <div class="node-actions">
            <span class="badge ${node.status === "online" ? "" : "warn"}">${escapeHtml(node.status || "unknown")}</span>
            <span class="uptime">${formatUptime(node.uptime || detail.uptime)}</span>
          </div>
          ${detailWarning ? `<div class="node-detail">${detailWarning}</div>` : ""}
        </article>
      `;
}

function renderScan(payload) {
  const container = $("#scan-results");
  const hosts = payload.hosts || [];
  state.discoveryHosts = hosts.length;
  updateHostCount();
  setText("#last-scan", `${hosts.length} hosts in ${Math.round(payload.duration_ms / 1000)}s`);
  setText("#quick-last-scan", `${hosts.length} hosts`);

  if (!hosts.length) {
    container.innerHTML = `<div class="empty">No open ports found for this scan.</div>`;
    return;
  }

  container.innerHTML = hosts
    .map((host) => `
      <article class="host-card">
        <div class="host-top">
          <div>
            <strong>${escapeHtml(host.hostname || host.ip)}</strong>
            <div class="host-meta">${escapeHtml(host.ip)}</div>
          </div>
          <span class="badge">${host.ports.length} open</span>
        </div>
        <div class="port-list">
          ${host.ports
            .map((port) => {
              const label = port.title || port.server || port.hint || port.protocol;
              if (!port.url) return `<span class="port">${port.port} ${escapeHtml(label)}</span>`;
              const payload = encodeURIComponent(
                JSON.stringify({
                  name: port.title || `${host.ip}:${port.port}`,
                  url: port.url,
                  description: label || "Discovered on local network",
                }),
              );
              return `<span class="port"><a href="${escapeHtml(port.url)}" target="_blank" rel="noreferrer">${port.port} ${escapeHtml(
                label,
              )}</a><button data-add-service="${payload}" title="Add service">+</button></span>`;
            })
            .join("")}
        </div>
      </article>
    `)
    .join("");
}

function updateClock() {
  const now = new Date();
  setText("#clock-time", now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  setText(
    "#clock-date",
    now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }),
  );
}

async function loadWeather() {
  try {
    const weather = await requestJson("/api/weather");
    if (!weather.configured) {
      setText("#weather-temp", "--");
      setText("#weather-condition", "Weather");
      setText("#weather-location", weather.message || "Set location in Settings");
      return;
    }
    setText("#weather-temp", `${Math.round(weather.temperature)}${weather.temperature_unit || "°C"}`);
    setText("#weather-condition", weather.condition || "Weather");
    const details = [
      [weather.location, weather.country].filter(Boolean).join(", "),
      Number.isFinite(weather.humidity) ? `${weather.humidity}% humidity` : "",
      Number.isFinite(weather.wind_speed) ? `${Math.round(weather.wind_speed)} ${weather.wind_speed_unit || ""} wind` : "",
    ].filter(Boolean);
    setText("#weather-location", details.join(" / "));
  } catch (error) {
    setText("#weather-temp", "--");
    setText("#weather-condition", "Weather unavailable");
    setText("#weather-location", error.message);
  }
}

function serviceFormPayload() {
  return {
    name: $("#service-name").value.trim(),
    url: $("#service-url").value.trim(),
    icon: $("#service-icon").value.trim(),
    icon_url: $("#service-icon-url").value.trim(),
    group: $("#service-group").value.trim() || "Manual",
    description: $("#service-description").value.trim(),
  };
}

function openServiceDialog(entry) {
  const isEdit = Boolean(entry);
  $("#dialog-title").textContent = isEdit ? "Edit Service" : "Add Service";
  $("#delete-service").style.visibility = isEdit ? "visible" : "hidden";
  $("#service-group-index").value = isEdit ? entry.groupIndex : "";
  $("#service-index").value = isEdit ? entry.serviceIndex : "";
  $("#service-name").value = isEdit ? entry.service.name || "" : "";
  $("#service-url").value = isEdit ? entry.service.url || "" : "";
  $("#service-icon").value = isEdit ? entry.service.icon || "" : "";
  $("#service-icon-url").value = isEdit ? entry.service.icon_url || "" : "";
  $("#service-icon-file").value = "";
  $("#service-group").value = isEdit ? entry.group.name || "" : "Manual";
  $("#service-description").value = isEdit ? entry.service.description || "" : "";
  $("#service-dialog").showModal();
}

async function saveService(event) {
  event.preventDefault();
  const groupIndex = $("#service-group-index").value;
  const serviceIndex = $("#service-index").value;
  const isEdit = groupIndex !== "" && serviceIndex !== "";
  const payload = serviceFormPayload();
  const endpoint = isEdit ? "/api/services/update" : "/api/services";
  const body = isEdit ? { ...payload, groupIndex, serviceIndex } : payload;

  const config = await requestJson(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  $("#service-dialog").close();
  renderServices(config);
}

async function deleteCurrentService() {
  const groupIndex = $("#service-group-index").value;
  const serviceIndex = $("#service-index").value;
  if (groupIndex === "" || serviceIndex === "") return;
  const config = await requestJson("/api/services/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupIndex, serviceIndex }),
  });
  $("#service-dialog").close();
  renderServices(config);
}

async function addDiscoveredService(encoded) {
  const service = JSON.parse(decodeURIComponent(encoded));
  const config = await requestJson("/api/services/discovered", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(service),
  });
  renderServices(config);
}

async function loadConfig() {
  try {
    const config = await requestJson("/api/config");
    renderServices(config);
    setText("#api-status", "Online");
  } catch (error) {
    $("#services-grid").innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
    setText("#api-status", "Config error");
  }
}

async function loadProxmox() {
  $("#proxmox-grid").innerHTML = `<div class="empty">Contacting Proxmox API...</div>`;
  try {
    renderProxmox(await requestJson("/api/proxmox"));
  } catch (error) {
    $("#proxmox-grid").innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

async function runScan(event) {
  event.preventDefault();
  const cidr = encodeURIComponent($("#cidr").value.trim());
  const ports = encodeURIComponent($("#ports").value.trim());
  $("#scan-results").innerHTML = `<div class="empty">Scanning local network...</div>`;
  try {
    renderScan(await requestJson(`/api/discovery?cidr=${cidr}&ports=${ports}`));
  } catch (error) {
    $("#scan-results").innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

function readIconFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    event.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    $("#service-icon-url").value = String(reader.result || "");
  });
  reader.readAsDataURL(file);
}

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view-link]");
  if (viewButton) {
    event.preventDefault();
    switchView(viewButton.dataset.viewLink);
    return;
  }

  const addButton = event.target.closest("[data-add-service]");
  if (addButton) {
    addButton.disabled = true;
    addDiscoveredService(addButton.dataset.addService)
      .then(() => {
        addButton.textContent = "OK";
      })
      .catch((error) => {
        addButton.textContent = "!";
        addButton.title = error.message;
      });
    return;
  }

  const editButton = event.target.closest("[data-edit]");
  if (editButton) {
    event.preventDefault();
    event.stopPropagation();
    const [groupIndex, serviceIndex] = editButton.dataset.edit.split(":").map(Number);
    const group = state.config.groups[groupIndex];
    const service = group?.services?.[serviceIndex];
    if (group && service) openServiceDialog({ group, groupIndex, service, serviceIndex });
    return;
  }

  const proxmoxEditButton = event.target.closest("[data-edit-proxmox]");
  if (proxmoxEditButton) {
    const index = Number(proxmoxEditButton.dataset.editProxmox);
    const server = state.proxmoxConfig.servers?.[index];
    if (server) openProxmoxDialog({ server, index });
  }
});

$("#add-service").addEventListener("click", () => openServiceDialog());
$("#add-proxmox").addEventListener("click", () => openProxmoxDialog());
$("#cancel-dialog").addEventListener("click", () => $("#service-dialog").close());
$("#cancel-proxmox-dialog").addEventListener("click", () => $("#proxmox-dialog").close());
$("#delete-service").addEventListener("click", deleteCurrentService);
$("#delete-proxmox").addEventListener("click", deleteCurrentProxmoxServer);
$("#service-form").addEventListener("submit", saveService);
$("#proxmox-form").addEventListener("submit", saveProxmoxServer);
$("#service-icon-file").addEventListener("change", readIconFile);
$("#service-search").addEventListener("input", () => renderServices(state.config));
$("#scan-form").addEventListener("submit", runScan);
$("#refresh-config").addEventListener("click", loadConfig);
$("#refresh-proxmox").addEventListener("click", loadProxmox);
$("#save-settings").addEventListener("click", saveSettings);

["#setting-theme", "#setting-accent", "#setting-panel-opacity", "#setting-background", "#setting-weather-location"].forEach((selector) => {
  $(selector).addEventListener("input", () => {
    applySettings({
      theme: $("#setting-theme").value,
      accent: $("#setting-accent").value,
      panel_opacity: $("#setting-panel-opacity").value,
      background: $("#setting-background").value.trim(),
      weather_location: $("#setting-weather-location").value.trim(),
    });
  });
});

updateClock();
setInterval(updateClock, 1000);
loadSettings();
loadProxmoxConfig();
loadConfig();
loadProxmox();
loadWeather();

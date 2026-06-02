const state = {
  config: { groups: [] },
  settings: {},
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

function percent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function firstNumber(...values) {
  return values.find((value) => Number.isFinite(value));
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
    }),
  });
  applySettings(settings);
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
  setText("#config-note", `${count} configured`);
}

function renderProxmox(payload) {
  const container = $("#proxmox-grid");
  const nodes = payload?.nodes || [];
  setText("#node-count", nodes.length || "-");

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
            <span class="badge ${node.status === "online" ? "" : "warn"}">${escapeHtml(node.status || "unknown")}</span>
          </div>
          <div class="resource">
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
          ${detailWarning}
        </article>
      `;
    })
    .join("");
}

function renderScan(payload) {
  const container = $("#scan-results");
  const hosts = payload.hosts || [];
  setText("#host-count", hosts.length);
  setText("#last-scan", `${hosts.length} hosts in ${Math.round(payload.duration_ms / 1000)}s`);

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
  }
});

$("#add-service").addEventListener("click", () => openServiceDialog());
$("#cancel-dialog").addEventListener("click", () => $("#service-dialog").close());
$("#delete-service").addEventListener("click", deleteCurrentService);
$("#service-form").addEventListener("submit", saveService);
$("#service-icon-file").addEventListener("change", readIconFile);
$("#service-search").addEventListener("input", () => renderServices(state.config));
$("#scan-form").addEventListener("submit", runScan);
$("#refresh-config").addEventListener("click", loadConfig);
$("#refresh-proxmox").addEventListener("click", loadProxmox);
$("#save-settings").addEventListener("click", saveSettings);

["#setting-theme", "#setting-accent", "#setting-panel-opacity", "#setting-background"].forEach((selector) => {
  $(selector).addEventListener("input", () => {
    applySettings({
      theme: $("#setting-theme").value,
      accent: $("#setting-accent").value,
      panel_opacity: $("#setting-panel-opacity").value,
      background: $("#setting-background").value.trim(),
    });
  });
});

updateClock();
setInterval(updateClock, 1000);
loadSettings();
loadConfig();
loadProxmox();

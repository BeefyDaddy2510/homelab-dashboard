const state = {
  config: { groups: [] },
  discovery: [],
  editMode: false,
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
  if (icon) return icon.slice(0, 6).toUpperCase();
  return String(service.name || "?").slice(0, 2).toUpperCase();
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || response.statusText);
  return payload;
}

function allServices(config = state.config) {
  return (config.groups || []).flatMap((group, groupIndex) =>
    (group.services || []).map((service, serviceIndex) => ({
      group,
      groupIndex,
      service,
      serviceIndex,
    })),
  );
}

function renderServices(config) {
  state.config = config;
  const container = $("#services-grid");
  const query = $("#service-search").value.trim().toLowerCase();
  const groups = Array.isArray(config.groups) ? config.groups : [];
  let count = 0;

  container.classList.toggle("editing", state.editMode);
  container.innerHTML = groups
    .map((group, groupIndex) => {
      const services = (group.services || []).filter((service) => {
        const haystack = `${service.name} ${service.description} ${service.url}`.toLowerCase();
        return !query || haystack.includes(query);
      });
      count += group.services?.length || 0;
      if (!services.length) return "";
      return `
        <div class="tile-group">
          <h3 class="group-title">${escapeHtml(group.name || "Services")}</h3>
          <div class="tile-list">
            ${services
              .map((service) => {
                const serviceIndex = (group.services || []).indexOf(service);
                return `
                  <div class="service-tile-wrap">
                    <a class="service-tile" href="${escapeHtml(service.url)}" target="_blank" rel="noreferrer" title="${escapeHtml(
                      `${service.name}\n${service.description || service.url}`,
                    )}">
                      <span class="tile-icon">${escapeHtml(iconText(service))}</span>
                      <span class="service-name">${escapeHtml(service.name)}</span>
                    </a>
                    <button class="edit-service-button" data-edit="${groupIndex}:${serviceIndex}" title="Edit service">E</button>
                  </div>
                `;
              })
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
  setText("#config-note", `${count} services`);
  setText("#edit-toggle", state.editMode ? "Done" : "Edit");
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
  state.discovery = hosts;
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
    group: $("#service-group").value.trim() || "Manual",
    description: $("#service-description").value.trim(),
  };
}

function openServiceDialog(entry) {
  const dialog = $("#service-dialog");
  const isEdit = Boolean(entry);
  $("#dialog-title").textContent = isEdit ? "Edit Service" : "Add Service";
  $("#delete-service").style.visibility = isEdit ? "visible" : "hidden";
  $("#service-group-index").value = isEdit ? entry.groupIndex : "";
  $("#service-index").value = isEdit ? entry.serviceIndex : "";
  $("#service-name").value = isEdit ? entry.service.name || "" : "";
  $("#service-url").value = isEdit ? entry.service.url || "" : "";
  $("#service-icon").value = isEdit ? entry.service.icon || "" : "";
  $("#service-group").value = isEdit ? entry.group.name || "" : "Manual";
  $("#service-description").value = isEdit ? entry.service.description || "" : "";
  dialog.showModal();
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
  const response = await fetch("/api/services/discovered", {
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

document.addEventListener("click", (event) => {
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
$("#service-search").addEventListener("input", () => renderServices(state.config));
$("#edit-toggle").addEventListener("click", () => {
  state.editMode = !state.editMode;
  renderServices(state.config);
});
$("#scan-form").addEventListener("submit", runScan);
$("#refresh-config").addEventListener("click", loadConfig);
$("#refresh-proxmox").addEventListener("click", loadProxmox);

updateClock();
setInterval(updateClock, 1000);
loadConfig();
loadProxmox();

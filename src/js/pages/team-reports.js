function fillSelect(selectId, rows, placeholder) {
  const el = document.getElementById(selectId);
  if (!el) return;

  el.innerHTML = "";
  const first = document.createElement("option");
  first.value = "";
  first.textContent = placeholder;
  el.appendChild(first);

  (rows || []).forEach(row => {
    const option = document.createElement("option");
    option.value = row.Code;
    option.textContent = row.Name;
    el.appendChild(option);
  });
}

function renderRows(rows) {
  const tbody = document.getElementById("reportsTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!rows || rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9">No reports found.</td>
      </tr>
    `;
    return;
  }

  rows.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.IncidentNumber || ""}</td>
      <td>${row.IncidentType || ""}</td>
      <td>${row.BusinessAreaName || ""}</td>
      <td>${row.Title || ""}</td>
      <td>${row.ReportedByName || ""}</td>
      <td>${row.SeverityName || ""}</td>
      <td>${row.StatusName || ""}</td>
      <td>${row.CreatedOn || ""}</td>
      <td><button class="mini-btn success" data-id="${row.IncidentID}">Open</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("button[data-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      window.location.href = `/incident-detail.html?id=${encodeURIComponent(id)}`;
    });
  });
}

async function loadLookups() {
  const res = await fetch("/api/getLookups", {
    credentials: "include",
    cache: "no-store"
  });

  const json = await res.json();

  if (!json.success || !json.data) {
    throw new Error(json.message || "Failed to load lookups.");
  }

  fillSelect("filterType", json.data.incidentTypes || [], "All");
  fillSelect("filterStatus", json.data.statuses || [], "All");
  fillSelect("filterArea", json.data.businessAreas || [], "All");
}

async function loadReports() {
  try {
    showPageLoader?.("Loading team reports...");

    const type = document.getElementById("filterType")?.value || "";
    const status = document.getElementById("filterStatus")?.value || "";
    const area = document.getElementById("filterArea")?.value || "";

    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (status) params.set("status", status);
    if (area) params.set("area", area);

    const url = `/api/getTeamReports${params.toString() ? `?${params.toString()}` : ""}`;

    const res = await fetch(url, {
      credentials: "include",
      cache: "no-store"
    });

    const json = await res.json();

    hidePageLoader?.();

    if (!json.success) {
      alert(json.message || "Failed to load team reports.");
      return;
    }

    renderRows(json.data || []);
  } catch (error) {
    hidePageLoader?.();
    alert(`Failed to load team reports: ${error.message}`);
  }
}

document.getElementById("applyFiltersBtn")?.addEventListener("click", loadReports);

document.getElementById("clearFiltersBtn")?.addEventListener("click", () => {
  ["filterType", "filterStatus", "filterArea"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  loadReports();
});

document.getElementById("backToDashboardBtn")?.addEventListener("click", () => {
  window.location.href = "/dashboard.html";
});

(async function init() {
  try {
    showPageLoader?.("Loading team reports...");
    await loadLookups();
    await loadReports();
  } catch (error) {
    hidePageLoader?.();
    alert(`Initialization failed: ${error.message}`);
  }
})();
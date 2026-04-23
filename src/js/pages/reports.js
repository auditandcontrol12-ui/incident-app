let currentRows = [];
let currentUser = null;
let currentAreas = [];

function fillSelect(selectId, rows, placeholder, valueKey = "Code", textKey = "Name", skipDraft = false) {
  const el = document.getElementById(selectId);
  if (!el) return;

  el.innerHTML = "";

  const first = document.createElement("option");
  first.value = "";
  first.textContent = placeholder;
  el.appendChild(first);

  (rows || []).forEach(row => {
    if (skipDraft && row[valueKey] === "DRAFT") return;

    const option = document.createElement("option");
    option.value = row[valueKey];
    option.textContent = row[textKey];
    el.appendChild(option);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getFilterValue(id) {
  return document.getElementById(id)?.value?.trim() || "";
}

function buildSummaryText() {
  const parts = [];

  const dateFrom = getFilterValue("filterDateFrom");
  const dateTo = getFilterValue("filterDateTo");
  const businessArea = document.getElementById("filterBusinessArea")?.selectedOptions?.[0]?.textContent || "";
  const type = document.getElementById("filterType")?.selectedOptions?.[0]?.textContent || "";
  const status = document.getElementById("filterStatus")?.selectedOptions?.[0]?.textContent || "";
  const level = document.getElementById("filterLevel")?.selectedOptions?.[0]?.textContent || "";
  const nature = document.getElementById("filterNature")?.selectedOptions?.[0]?.textContent || "";

  if (dateFrom) parts.push(`Date From: ${dateFrom}`);
  if (dateTo) parts.push(`Date To: ${dateTo}`);
  if (getFilterValue("filterBusinessArea")) parts.push(`Business Area: ${businessArea}`);
  if (getFilterValue("filterType")) parts.push(`Type: ${type}`);
  if (getFilterValue("filterStatus")) parts.push(`Status: ${status}`);
  if (getFilterValue("filterLevel")) parts.push(`Level: ${level}`);
  if (getFilterValue("filterNature")) parts.push(`Nature: ${nature}`);

  return parts.length ? parts.join(" | ") : "No filters applied.";
}

function renderSummary() {
  const banner = document.getElementById("reportSummaryBanner");
  if (!banner) return;
  banner.textContent = `${buildSummaryText()} | Rows: ${currentRows.length}`;
}

function renderRows(rows) {
  const tbody = document.getElementById("reportsTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!rows || rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10">No reports found.</td>
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
      <td>${row.LevelOfIncidentName || ""}</td>
      <td>${row.NatureOfIncidentName || ""}</td>
      <td>${row.StatusName || ""}</td>
      <td>${row.IncidentDateTime || ""}</td>
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

function getDefaultFromDate() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

async function loadAccessAndLookups() {
  const [accessRes, lookupRes] = await Promise.all([
    fetch("/api/getAccess", {
      credentials: "include",
      cache: "no-store"
    }),
    fetch("/api/getIncidentCreateLookups", {
      credentials: "include",
      cache: "no-store"
    })
  ]);

  const accessJson = await accessRes.json();
  const lookupJson = await lookupRes.json();

  if (!accessJson.success || !accessJson.data) {
    throw new Error(accessJson.message || "Failed to load access.");
  }

  if (!lookupJson.success || !lookupJson.data) {
    throw new Error(lookupJson.message || "Failed to load lookups.");
  }

  currentUser = accessJson.data;
  currentAreas = Array.isArray(accessJson.data.AllowedAreas) ? accessJson.data.AllowedAreas : [];

  fillSelect("filterBusinessArea", currentAreas, "All", "AreaCode", "AreaName");
  fillSelect("filterType", lookupJson.data.incidentTypes || [], "All");
  fillSelect("filterStatus", (lookupJson.data.statuses || []), "All", "Code", "Name", true);
  fillSelect("filterLevel", lookupJson.data.levelsOfIncident || [], "All");
  fillSelect("filterNature", lookupJson.data.naturesOfIncident || [], "All");
}

async function loadReports() {
  try {
    showPageLoader?.("Loading reports...");

    const params = new URLSearchParams();

    const dateFrom = getFilterValue("filterDateFrom");
    const dateTo = getFilterValue("filterDateTo");
    const businessArea = getFilterValue("filterBusinessArea");
    const type = getFilterValue("filterType");
    const status = getFilterValue("filterStatus");
    const level = getFilterValue("filterLevel");
    const nature = getFilterValue("filterNature");

    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (businessArea) params.set("businessArea", businessArea);
    if (type) params.set("type", type);
    if (status) params.set("status", status);
    if (level) params.set("level", level);
    if (nature) params.set("nature", nature);

    const url = `/api/getIncidentReport${params.toString() ? `?${params.toString()}` : ""}`;

    const res = await fetch(url, {
      credentials: "include",
      cache: "no-store"
    });

    const json = await res.json();

    hidePageLoader?.();

    if (!res.ok || !json.success) {
      alert(json.message || "Failed to load report.");
      return;
    }

    currentRows = json.data || [];
    renderRows(currentRows);
    renderSummary();
  } catch (error) {
    hidePageLoader?.();
    alert(`Failed to load report: ${error.message}`);
  }
}

function exportPdf() {
  if (!currentRows.length) {
    alert("No rows available to export.");
    return;
  }

  const summary = buildSummaryText();

  const tableRowsHtml = currentRows.map(row => `
    <tr>
      <td>${escapeHtml(row.IncidentNumber)}</td>
      <td>${escapeHtml(row.IncidentType)}</td>
      <td>${escapeHtml(row.BusinessAreaName)}</td>
      <td>${escapeHtml(row.Title)}</td>
      <td>${escapeHtml(row.LevelOfIncidentName)}</td>
      <td>${escapeHtml(row.NatureOfIncidentName)}</td>
      <td>${escapeHtml(row.StatusName)}</td>
      <td>${escapeHtml(row.IncidentDateTime)}</td>
      <td>${escapeHtml(row.CreatedOn)}</td>
    </tr>
  `).join("");

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Incident Report Export</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
        h1 { margin: 0 0 8px; font-size: 22px; }
        .sub { margin-bottom: 16px; color: #4b5563; font-size: 12px; }
        .summary { margin-bottom: 16px; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { border: 1px solid #d1d5db; padding: 6px; text-align: left; vertical-align: top; }
        th { background: #f3f4f6; }
      </style>
    </head>
    <body>
      <h1>Incident Report</h1>
      <div class="sub">Generated from Reports and Analysis</div>
      <div class="summary"><strong>Filters:</strong> ${escapeHtml(summary)}</div>
      <div class="summary"><strong>Total Rows:</strong> ${currentRows.length}</div>
      <table>
        <thead>
          <tr>
            <th>Incident No</th>
            <th>Type</th>
            <th>Business Area</th>
            <th>Title</th>
            <th>Level</th>
            <th>Nature</th>
            <th>Status</th>
            <th>Incident Date Time</th>
            <th>Created On</th>
          </tr>
        </thead>
        <tbody>
          ${tableRowsHtml}
        </tbody>
      </table>
    </body>
    </html>
  `;

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Pop-up blocked. Please allow pop-ups and try again.");
    return;
  }

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();

  setTimeout(() => {
    printWindow.print();
  }, 400);
}

document.getElementById("applyFiltersBtn")?.addEventListener("click", () => {
  loadReports();
});

document.getElementById("clearFiltersBtn")?.addEventListener("click", () => {
  document.getElementById("filterDateFrom").value = getDefaultFromDate();
  document.getElementById("filterDateTo").value = getTodayDate();
  document.getElementById("filterBusinessArea").value = "";
  document.getElementById("filterType").value = "";
  document.getElementById("filterStatus").value = "";
  document.getElementById("filterLevel").value = "";
  document.getElementById("filterNature").value = "";
  loadReports();
});

document.getElementById("exportPdfBtn")?.addEventListener("click", exportPdf);

document.getElementById("backToDashboardBtn")?.addEventListener("click", () => {
  window.location.href = "/dashboard.html";
});

(async function init() {
  try {
    showPageLoader?.("Loading reports...");
    await loadAccessAndLookups();

    document.getElementById("filterDateFrom").value = getDefaultFromDate();
    document.getElementById("filterDateTo").value = getTodayDate();

    await loadReports();
  } catch (error) {
    hidePageLoader?.();
    alert(`Initialization failed: ${error.message}`);
  }
})();
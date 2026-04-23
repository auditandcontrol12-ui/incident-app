let editingMaster = null;
let currentRows = [];

function setMessage(text, isError = false) {
  const el = document.getElementById("formMessage");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = isError ? "#b91c1c" : "";
}

function getMasterType() {
  return document.getElementById("masterType")?.value || "IncidentType";
}

function clearForm() {
  editingMaster = null;
  document.getElementById("masterCode").value = "";
  document.getElementById("masterName").value = "";
  document.getElementById("masterDescription").value = "";
  document.getElementById("sortOrder").value = "0";
  document.getElementById("isActive").checked = true;
  setMessage("");
}

function populateForm(row) {
  editingMaster = row;
  document.getElementById("masterCode").value = row.Code || "";
  document.getElementById("masterName").value = row.Name || "";
  document.getElementById("masterDescription").value = row.Description || "";
  document.getElementById("sortOrder").value = row.SortOrder ?? 0;
  document.getElementById("isActive").checked = !!row.IsActive;
  setMessage(`Editing ${row.Code}`);
}

function renderRows(rows) {
  const tbody = document.getElementById("masterTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!rows || !rows.length) {
    tbody.innerHTML = `<tr><td colspan="6">No records found.</td></tr>`;
    return;
  }

  rows.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.Code || ""}</td>
      <td>${row.Name || ""}</td>
      <td>${row.Description || ""}</td>
      <td>${row.SortOrder ?? ""}</td>
      <td>${row.IsActive ? "Yes" : "No"}</td>
      <td><button type="button" class="mini-btn success edit-btn" data-code="${row.Code}">Edit</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const code = btn.getAttribute("data-code");
      const row = currentRows.find(x => x.Code === code);
      if (row) populateForm(row);
    });
  });
}

async function loadRows() {
  try {
    showPageLoader?.("Loading incident masters...");

    const type = getMasterType();
    const res = await fetch(`/api/getIncidentMasters?masterType=${encodeURIComponent(type)}`, {
      credentials: "include",
      cache: "no-store"
    });

    const json = await res.json();
    hidePageLoader?.();

    if (!res.ok || !json.success) {
      setMessage(json.message || "Failed to load incident masters.", true);
      return;
    }

    currentRows = json.data || [];
    renderRows(currentRows);
  } catch (error) {
    hidePageLoader?.();
    setMessage(`Failed to load incident masters: ${error.message}`, true);
  }
}

async function saveMaster() {
  try {
    const payload = {
      masterType: getMasterType(),
      originalCode: editingMaster?.Code || null,
      code: document.getElementById("masterCode").value.trim(),
      name: document.getElementById("masterName").value.trim(),
      description: document.getElementById("masterDescription").value.trim(),
      sortOrder: Number(document.getElementById("sortOrder").value || 0),
      isActive: document.getElementById("isActive").checked
    };

    if (!payload.code) {
      setMessage("Code is required.", true);
      return;
    }

    if (!payload.name) {
      setMessage("Name is required.", true);
      return;
    }

    showPageLoader?.("Saving master...");

    const res = await fetch("/api/saveIncidentMaster", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    hidePageLoader?.();

    if (!res.ok || !json.success) {
      setMessage(json.message || "Failed to save master.", true);
      return;
    }

    setMessage(json.message || "Saved successfully.");
    clearForm();
    await loadRows();
  } catch (error) {
    hidePageLoader?.();
    setMessage(`Failed to save master: ${error.message}`, true);
  }
}

document.getElementById("masterType")?.addEventListener("change", () => {
  clearForm();
  loadRows();
});

document.getElementById("saveMasterBtn")?.addEventListener("click", saveMaster);
document.getElementById("clearFormBtn")?.addEventListener("click", clearForm);
document.getElementById("backToDashboardBtn")?.addEventListener("click", () => {
  window.location.href = "/dashboard.html";
});

clearForm();
loadRows();
let currentDepartments = [];
let currentUsers = [];
let currentMappings = [];
let editingMappingId = null;

function setMessage(text, isError = false) {
  const el = document.getElementById("formMessage");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = isError ? "#b91c1c" : "";
}

function fillSelect(selectId, rows, placeholder, valueKey, textKey) {
  const el = document.getElementById(selectId);
  if (!el) return;

  el.innerHTML = "";

  const first = document.createElement("option");
  first.value = "";
  first.textContent = placeholder;
  el.appendChild(first);

  (rows || []).forEach(row => {
    const option = document.createElement("option");
    option.value = row[valueKey];
    option.textContent = row[textKey];
    el.appendChild(option);
  });
}

function clearForm() {
  editingMappingId = null;
  document.getElementById("departmentCode").value = "";
  document.getElementById("userId").value = "";
  document.getElementById("isResponder").checked = true;
  document.getElementById("isDepartmentHead").checked = false;
  document.getElementById("isActive").checked = true;
  setMessage("");
}

function populateForm(row) {
  editingMappingId = row.IncidentDepartmentUserID;
  document.getElementById("departmentCode").value = row.DepartmentCode || "";
  document.getElementById("userId").value = row.UserID || "";
  document.getElementById("isResponder").checked = !!row.IsResponder;
  document.getElementById("isDepartmentHead").checked = !!row.IsDepartmentHead;
  document.getElementById("isActive").checked = !!row.IsActive;
  setMessage(`Editing mapping for ${row.UserName}`);
}

function renderRows(rows) {
  const tbody = document.getElementById("mappingTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!rows || !rows.length) {
    tbody.innerHTML = `<tr><td colspan="7">No mappings found.</td></tr>`;
    return;
  }

  rows.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.DepartmentName || ""}</td>
      <td>${row.UserName || ""}</td>
      <td>${row.UserEmail || ""}</td>
      <td>${row.IsResponder ? "Yes" : "No"}</td>
      <td>${row.IsDepartmentHead ? "Yes" : "No"}</td>
      <td>${row.IsActive ? "Yes" : "No"}</td>
      <td><button type="button" class="mini-btn success edit-btn" data-id="${row.IncidentDepartmentUserID}">Edit</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-id"));
      const row = currentMappings.find(x => x.IncidentDepartmentUserID === id);
      if (row) populateForm(row);
    });
  });
}

async function loadData() {
  try {
    showPageLoader?.("Loading department user mapping...");

    const res = await fetch("/api/getDepartmentUserMappingData", {
      credentials: "include",
      cache: "no-store"
    });

    const json = await res.json();
    hidePageLoader?.();

    if (!res.ok || !json.success) {
      setMessage(json.message || "Failed to load mapping data.", true);
      return;
    }

    currentDepartments = json.data.departments || [];
    currentUsers = json.data.users || [];
    currentMappings = json.data.mappings || [];

    fillSelect("departmentCode", currentDepartments, "Select Department", "DepartmentCode", "DepartmentName");
    fillSelect("userId", currentUsers, "Select User", "UserID", "UserName");

    renderRows(currentMappings);
  } catch (error) {
    hidePageLoader?.();
    setMessage(`Failed to load mapping data: ${error.message}`, true);
  }
}

async function saveMapping() {
  try {
    const payload = {
      incidentDepartmentUserId: editingMappingId,
      departmentCode: document.getElementById("departmentCode").value,
      userId: Number(document.getElementById("userId").value || 0),
      isResponder: document.getElementById("isResponder").checked,
      isDepartmentHead: document.getElementById("isDepartmentHead").checked,
      isActive: document.getElementById("isActive").checked
    };

    if (!payload.departmentCode) {
      setMessage("Department is required.", true);
      return;
    }

    if (!payload.userId) {
      setMessage("User is required.", true);
      return;
    }

    showPageLoader?.("Saving mapping...");

    const res = await fetch("/api/saveDepartmentUserMapping", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    hidePageLoader?.();

    if (!res.ok || !json.success) {
      setMessage(json.message || "Failed to save mapping.", true);
      return;
    }

    setMessage(json.message || "Mapping saved successfully.");
    clearForm();
    await loadData();
  } catch (error) {
    hidePageLoader?.();
    setMessage(`Failed to save mapping: ${error.message}`, true);
  }
}

document.getElementById("saveMappingBtn")?.addEventListener("click", saveMapping);
document.getElementById("clearFormBtn")?.addEventListener("click", clearForm);
document.getElementById("backToDashboardBtn")?.addEventListener("click", () => {
  window.location.href = "/dashboard.html";
});

clearForm();
loadData();
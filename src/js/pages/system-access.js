let currentUsers = [];
let currentAreas = [];
let editingUserId = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setMessage(text, isError = false) {
  const el = document.getElementById("formMessage");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = isError ? "#b91c1c" : "";
}

function renderBusinessAreaChecklist(selectedAreaIds = []) {
  const container = document.getElementById("businessAreaChecklist");
  if (!container) return;

  container.innerHTML = "";

  if (!currentAreas.length) {
    container.innerHTML = `<div class="info-banner empty">No business areas found.</div>`;
    return;
  }

  currentAreas.forEach(area => {
    const label = document.createElement("label");
    label.className = "checkbox-item";

    const checked = selectedAreaIds.includes(area.AppAreaID);

    label.innerHTML = `
      <input type="checkbox" class="area-checkbox" value="${area.AppAreaID}" ${checked ? "checked" : ""} />
      <span>${escapeHtml(area.AreaName)}</span>
    `;

    container.appendChild(label);
  });
}

function getSelectedAreaIds() {
  return Array.from(document.querySelectorAll(".area-checkbox:checked"))
    .map(x => Number(x.value))
    .filter(x => !Number.isNaN(x));
}

function clearForm() {
  editingUserId = null;

  document.getElementById("userEmail").value = "";
  document.getElementById("userName").value = "";
  document.getElementById("holdingName").value = "";
  document.getElementById("appRole").value = "Standard User";
  document.getElementById("isActive").checked = true;
  document.getElementById("isManager").checked = false;
  document.getElementById("isSuperUser").checked = false;

  renderBusinessAreaChecklist([]);
  setMessage("");
}

function populateForm(user) {
  editingUserId = user.UserID;

  document.getElementById("userEmail").value = user.UserEmail || "";
  document.getElementById("userName").value = user.UserName || "";
  document.getElementById("holdingName").value = user.HoldingName || "";
  document.getElementById("appRole").value = user.AppRole || "Standard User";
  document.getElementById("isActive").checked = !!user.IsActive;
  document.getElementById("isManager").checked = !!user.IsManager;
  document.getElementById("isSuperUser").checked = !!user.IsSuperUser;

  renderBusinessAreaChecklist(user.AreaIds || []);
  setMessage(`Editing user: ${user.UserEmail}`);
}

function renderUsers(rows) {
  const tbody = document.getElementById("usersTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!rows || !rows.length) {
    tbody.innerHTML = `<tr><td colspan="10">No users found.</td></tr>`;
    return;
  }

  rows.forEach(user => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${user.UserID || ""}</td>
      <td>${escapeHtml(user.UserEmail || "")}</td>
      <td>${escapeHtml(user.UserName || "")}</td>
      <td>${escapeHtml(user.HoldingName || "")}</td>
      <td>${escapeHtml(user.AppRole || "")}</td>
      <td>${user.IsActive ? "Yes" : "No"}</td>
      <td>${user.IsManager ? "Yes" : "No"}</td>
      <td>${user.IsSuperUser ? "Yes" : "No"}</td>
      <td>${escapeHtml((user.AreaNames || []).join(", "))}</td>
      <td>
        <button type="button" class="mini-btn success edit-user-btn" data-user-id="${user.UserID}">Edit</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".edit-user-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const userId = Number(btn.getAttribute("data-user-id"));
      const user = currentUsers.find(x => x.UserID === userId);
      if (user) populateForm(user);
    });
  });
}

async function loadSystemAccessData() {
  try {
    showPageLoader?.("Loading system access...");

    const res = await fetch("/api/getSystemAccessData", {
      credentials: "include",
      cache: "no-store"
    });

    const json = await res.json();
    hidePageLoader?.();

    if (!res.ok || !json.success) {
      alert(json.message || "Failed to load system access data.");
      return;
    }

    currentUsers = json.data.users || [];
    currentAreas = json.data.appAreas || [];

    renderUsers(currentUsers);
    renderBusinessAreaChecklist([]);
  } catch (error) {
    hidePageLoader?.();
    alert(`Failed to load system access data: ${error.message}`);
  }
}

async function saveUser() {
  try {
    const payload = {
      userId: editingUserId,
      userEmail: document.getElementById("userEmail").value.trim(),
      userName: document.getElementById("userName").value.trim(),
      holdingName: document.getElementById("holdingName").value.trim(),
      appRole: document.getElementById("appRole").value.trim() || "Standard User",
      isActive: document.getElementById("isActive").checked,
      isManager: document.getElementById("isManager").checked,
      isSuperUser: document.getElementById("isSuperUser").checked,
      areaIds: getSelectedAreaIds()
    };

    if (!payload.userEmail) {
      setMessage("User Email is required.", true);
      return;
    }

    if (!payload.userName) {
      setMessage("User Name is required.", true);
      return;
    }

    showPageLoader?.("Saving user...");

    const res = await fetch("/api/saveSystemAccessUser", {
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
      setMessage(json.message || "Failed to save user.", true);
      return;
    }

    setMessage(json.message || "User saved successfully.");
    clearForm();
    await loadSystemAccessData();
  } catch (error) {
    hidePageLoader?.();
    setMessage(`Failed to save user: ${error.message}`, true);
  }
}

document.getElementById("saveUserBtn")?.addEventListener("click", saveUser);
document.getElementById("clearFormBtn")?.addEventListener("click", clearForm);
document.getElementById("backToDashboardBtn")?.addEventListener("click", () => {
  window.location.href = "/dashboard.html";
});

clearForm();
loadSystemAccessData();
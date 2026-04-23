function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "";
}

let currentUser = null;
let allowedAreas = [];
let selectedAreaCode = localStorage.getItem("selectedAreaCode") || "";
let selectedAreaName = localStorage.getItem("selectedAreaName") || "";

function refreshSelectedArea() {
  setText("selectedArea", selectedAreaName || "None");
}

function saveSelectedArea(area) {
  selectedAreaCode = area.AreaCode;
  selectedAreaName = area.AreaName;

  localStorage.setItem("selectedAreaCode", selectedAreaCode);
  localStorage.setItem("selectedAreaName", selectedAreaName);

  refreshSelectedArea();
  renderBusinessAreaButtons();
}

function clearSelectedArea() {
  selectedAreaCode = "";
  selectedAreaName = "";

  localStorage.removeItem("selectedAreaCode");
  localStorage.removeItem("selectedAreaName");

  refreshSelectedArea();
  renderBusinessAreaButtons();
}

function saveCurrentUser() {
  if (currentUser) {
    localStorage.setItem("appCurrentUser", JSON.stringify(currentUser));
  } else {
    localStorage.removeItem("appCurrentUser");
  }
}

function makeAreaButton(area) {
  const btn = document.createElement("button");
  btn.textContent = area.AreaName;
  btn.classList.add("secondary");

  if (selectedAreaCode === area.AreaCode) {
    btn.classList.remove("secondary");
    btn.classList.add("success");
  }

  btn.addEventListener("click", () => {
    saveSelectedArea(area);
  });

  return btn;
}

function renderBusinessAreaButtons() {
  const container = document.getElementById("businessAreaButtons");
  if (!container) return;

  container.innerHTML = "";

  if (!allowedAreas.length) {
    const empty = document.createElement("div");
    empty.className = "info-banner empty";
    empty.textContent = "No business areas are assigned to this user for this application.";
    container.appendChild(empty);
    return;
  }

  allowedAreas.forEach(area => {
    container.appendChild(makeAreaButton(area));
  });
}

function renderAccessButtons() {
  const teamReportsBtn = document.getElementById("teamReportsBtn");
  const systemAccessBtn = document.getElementById("systemAccessBtn");
  const incidentMastersBtn = document.getElementById("incidentMastersBtn");
  const departmentUserMappingBtn = document.getElementById("departmentUserMappingBtn");
  const pendingActionsBtn = document.getElementById("pendingActionsBtn");

  const isAdmin = !!(currentUser?.IsSuperUser || currentUser?.IsManager);

  if (teamReportsBtn) {
    teamReportsBtn.style.display = currentUser?.IsManager ? "inline-block" : "none";
  }

  if (systemAccessBtn) {
    systemAccessBtn.style.display = isAdmin ? "inline-block" : "none";
  }

  if (incidentMastersBtn) {
    incidentMastersBtn.style.display = isAdmin ? "inline-block" : "none";
  }

  if (departmentUserMappingBtn) {
    departmentUserMappingBtn.style.display = isAdmin ? "inline-block" : "none";
  }

  if (pendingActionsBtn) {
    pendingActionsBtn.style.display = "inline-block";
  }
}

function ensureSelectedAreaIsValid() {
  if (!allowedAreas.length) {
    clearSelectedArea();
    return;
  }

  const exists = allowedAreas.some(x => x.AreaCode === selectedAreaCode);
  if (!exists) {
    clearSelectedArea();
  }
}

function canUseSelectedArea() {
  if (!currentUser) {
    alert("User is not loaded.");
    return false;
  }

  if (!selectedAreaCode) {
    alert("Select Business Area first.");
    return false;
  }

  const found = allowedAreas.find(x => x.AreaCode === selectedAreaCode);
  if (!found) {
    alert("Selected area is not allowed for this user.");
    return false;
  }

  return true;
}

async function loadUserAccess() {
  try {
    showPageLoader?.("Loading dashboard...");

    const res = await fetch("/api/getAccess", {
      credentials: "include",
      cache: "no-store"
    });

    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      hidePageLoader?.();
      alert("API returned a non-JSON response.");
      return;
    }

    if (!data.success || !data.data) {
      hidePageLoader?.();
      localStorage.removeItem("appCurrentUser");
      localStorage.removeItem("selectedAreaCode");
      localStorage.removeItem("selectedAreaName");
      window.location.href = "/no-access.html";
      return;
    }

    currentUser = data.data;
    allowedAreas = Array.isArray(data.data.AllowedAreas) ? data.data.AllowedAreas : [];

    saveCurrentUser();

    setText("userName", currentUser.UserName);
    setText("userEmail", currentUser.UserEmail);
    setText("userRole", currentUser.AppRole || "");
    setText("holdingName", currentUser.HoldingName || "");

    ensureSelectedAreaIsValid();
    renderBusinessAreaButtons();
    renderAccessButtons();
    refreshSelectedArea();
    hidePageLoader?.();
  } catch (err) {
    hidePageLoader?.();
    alert(`Failed to load dashboard: ${err.message}`);
  }
}

document.getElementById("createIncidentBtn")?.addEventListener("click", () => {
  if (!canUseSelectedArea()) return;
  window.location.href = "/create-incident.html";
});

document.getElementById("createObservationBtn")?.addEventListener("click", () => {
  if (!canUseSelectedArea()) return;
  window.location.href = "/create-observation.html";
});

document.getElementById("myReportsBtn")?.addEventListener("click", () => {
  window.location.href = "/my-reports.html";
});

document.getElementById("pendingActionsBtn")?.addEventListener("click", () => {
  window.location.href = "/pending-actions.html";
});

document.getElementById("teamReportsBtn")?.addEventListener("click", () => {
  window.location.href = "/team-reports.html";
});

document.getElementById("reportsBtn")?.addEventListener("click", () => {
  window.location.href = "/reports.html";
});

document.getElementById("systemAccessBtn")?.addEventListener("click", () => {
  window.location.href = "/system-access.html";
});

document.getElementById("incidentMastersBtn")?.addEventListener("click", () => {
  window.location.href = "/incident-masters.html";
});

document.getElementById("departmentUserMappingBtn")?.addEventListener("click", () => {
  window.location.href = "/department-user-mapping.html";
});

document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  try {
    await fetch("/api/logout", {
      method: "POST",
      credentials: "include",
      cache: "no-store"
    });
  } catch {}

  localStorage.removeItem("appCurrentUser");
  localStorage.removeItem("selectedAreaCode");
  localStorage.removeItem("selectedAreaName");
  sessionStorage.removeItem("login_email");

  window.location.replace("/?logged_out=1");
});

refreshSelectedArea();
loadUserAccess();
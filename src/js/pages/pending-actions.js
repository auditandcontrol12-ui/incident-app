let currentStatusFilter = "OPEN,IN_PROGRESS";

function getStatusBadgeClass(statusCode) {
  switch ((statusCode || "").toUpperCase()) {
    case "OPEN":
      return "status-pill status-open";
    case "IN_PROGRESS":
      return "status-pill status-progress";
    case "COMPLETED":
      return "status-pill status-completed";
    case "CANCELLED":
      return "status-pill status-cancelled";
    default:
      return "status-pill";
  }
}

function setFilterButtons() {
  document.querySelectorAll(".status-filter-btn").forEach(btn => {
    const isActive = btn.dataset.status === currentStatusFilter;
    btn.classList.toggle("active", isActive);
  });
}

async function loadPendingActions() {
  try {
    showPageLoader?.("Loading pending actions...");

    const query = currentStatusFilter && currentStatusFilter !== "ALL"
      ? `?status=${encodeURIComponent(currentStatusFilter)}`
      : "";

    const res = await fetch(`/api/getPendingActions${query}`, {
      credentials: "include",
      cache: "no-store"
    });

    const json = await res.json();

    hidePageLoader?.();

    if (!res.ok || !json.success) {
      alert(json.message || "Failed to load pending actions.");
      return;
    }

    renderRows(json.data || []);
  } catch (error) {
    hidePageLoader?.();
    alert(`Failed to load pending actions: ${error.message}`);
  }
}

function renderRows(rows) {
  const tbody = document.getElementById("pendingActionsTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!rows || rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10">No pending actions found.</td>
      </tr>
    `;
    return;
  }

  rows.forEach(row => {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";

    tr.innerHTML = `
      <td>${row.IncidentPendingActionID || ""}</td>
      <td>${row.IncidentNumber || ""}</td>
      <td>${row.BusinessAreaName || ""}</td>
      <td>${row.IncidentTitle || ""}</td>
      <td>${row.ActionTypeName || ""}</td>
      <td>${row.AssignedDepartmentName || ""}</td>
      <td>${row.AssignedUserName || ""}</td>
      <td><span class="${getStatusBadgeClass(row.PendingActionStatusCode)}">${row.PendingActionStatusName || ""}</span></td>
      <td>${row.CreatedOn || ""}</td>
      <td>
        <div class="table-action-row">
          ${row.PendingActionStatusCode === "OPEN" ? `<button type="button" class="secondary table-action-btn start-btn">Start Action</button>` : ""}
          ${row.PendingActionStatusCode === "IN_PROGRESS" ? `<button type="button" class="secondary table-action-btn complete-btn">Mark Completed</button>` : ""}
        </div>
      </td>
    `;

    tr.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      window.location.href = `/incident-detail.html?id=${row.IncidentID}`;
    });

    const startBtn = tr.querySelector(".start-btn");
    if (startBtn) {
      startBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await updatePendingActionStatus(row.IncidentPendingActionID, "IN_PROGRESS");
      });
    }

    const completeBtn = tr.querySelector(".complete-btn");
    if (completeBtn) {
      completeBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await updatePendingActionStatus(row.IncidentPendingActionID, "COMPLETED");
      });
    }

    tbody.appendChild(tr);
  });
}

async function updatePendingActionStatus(actionId, newStatusCode) {
  try {
    showPageLoader?.("Updating action status...");

    const res = await fetch("/api/updatePendingActionStatus", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        incidentPendingActionId: actionId,
        newStatusCode
      })
    });

    const json = await res.json();

    hidePageLoader?.();

    if (!res.ok || !json.success) {
      alert(json.message || "Failed to update action status.");
      return;
    }

    await loadPendingActions();
  } catch (error) {
    hidePageLoader?.();
    alert(`Failed to update action status: ${error.message}`);
  }
}

document.querySelectorAll(".status-filter-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    currentStatusFilter = btn.dataset.status || "OPEN,IN_PROGRESS";
    setFilterButtons();
    await loadPendingActions();
  });
});

document.getElementById("backToDashboardBtn")?.addEventListener("click", () => {
  window.location.href = "/dashboard.html";
});

setFilterButtons();
loadPendingActions();
function renderRows(rows) {
  const tbody = document.getElementById("draftsTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!rows || rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8">No drafts found.</td>
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
      <td>${row.CreatedOn || ""}</td>
      <td>
        <div class="table-action-row">
          <button type="button" class="mini-btn success edit-btn" data-id="${row.IncidentID}">Edit</button>
          <button type="button" class="mini-btn secondary delete-btn" data-id="${row.IncidentID}" data-number="${row.IncidentNumber || ""}">Delete</button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      window.location.href = `/create-incident.html?id=${encodeURIComponent(id)}`;
    });
  });

  tbody.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const number = btn.getAttribute("data-number") || "";

      const confirmed = window.confirm(
        `Delete this draft?\n\n${number ? `Draft No: ${number}\n\n` : ""}This action will remove the draft and delete related blob files.`
      );

      if (!confirmed) return;

      await deleteDraft(id);
    });
  });
}

async function deleteDraft(incidentId) {
  try {
    showPageLoader?.("Deleting draft...");

    const res = await fetch("/api/deleteIncidentDraft", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ incidentId })
    });

    const json = await res.json();

    hidePageLoader?.();

    if (!res.ok || !json.success) {
      alert(json.message || "Failed to delete draft.");
      return;
    }

    await loadDrafts();
  } catch (error) {
    hidePageLoader?.();
    alert(`Failed to delete draft: ${error.message}`);
  }
}

async function loadDrafts() {
  try {
    showPageLoader?.("Loading drafts...");

    const res = await fetch("/api/getMyDrafts", {
      credentials: "include",
      cache: "no-store"
    });

    const json = await res.json();

    hidePageLoader?.();

    if (!json.success) {
      alert(json.message || "Failed to load drafts.");
      return;
    }

    renderRows(json.data || []);
  } catch (error) {
    hidePageLoader?.();
    alert(`Failed to load drafts: ${error.message}`);
  }
}

document.getElementById("backToDashboardBtn")?.addEventListener("click", () => {
  window.location.href = "/dashboard.html";
});

loadDrafts();
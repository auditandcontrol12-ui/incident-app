function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "-";
}

function formatDateTime(value) {
  if (!value) return "-";

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return String(value);
  }

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function yesNoText(value) {
  return value ? "Yes" : "No";
}

function renderComments(rows) {
  const container = document.getElementById("commentsContainer");
  if (!container) return;

  container.innerHTML = "";

  if (!rows || rows.length === 0) {
    container.innerHTML = `<div class="info-banner empty">No comments found.</div>`;
    return;
  }

  rows.forEach(row => {
    const div = document.createElement("div");
    div.className = "field-block";
    div.innerHTML = `
      <label>${row.CommentType || ""} · ${row.CommentByName || ""} · ${row.CreatedOn || ""}</label>
      <div class="workspace-text">${row.CommentText || "-"}</div>
    `;
    container.appendChild(div);
  });
}

function renderStatusLog(rows) {
  const tbody = document.getElementById("statusLogBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!rows || rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">No status history found.</td></tr>`;
    return;
  }

  rows.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.ActionOn || ""}</td>
      <td>${row.ActionType || ""}</td>
      <td>${row.OldStatusName || ""}</td>
      <td>${row.NewStatusName || ""}</td>
      <td>${row.ActionByName || ""}</td>
      <td>${row.ActionRemarks || ""}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderAttachments(rows) {
  const container = document.getElementById("attachmentsContainer");
  if (!container) return;

  container.innerHTML = "";

  if (!rows || rows.length === 0) {
    container.innerHTML = `<div class="info-banner empty">No attachments found.</div>`;
    return;
  }

  rows.forEach((row, index) => {
    const item = document.createElement("div");
    item.className = "evidence-item";

    const main = document.createElement("div");
    main.className = "evidence-main";

    const name = document.createElement("div");
    name.className = "evidence-name";
    name.textContent = `${index + 1}. ${row.FileOriginalName || row.FileName || "-"}`;

    const meta = document.createElement("div");
    meta.className = "evidence-meta";
    meta.textContent =
      `${row.ContentType || row.AttachmentType || ""}` +
      `${row.FileSizeKB ? ` | ${row.FileSizeKB} KB` : ""}` +
      `${row.UploadedOn ? ` | Uploaded: ${row.UploadedOn}` : ""}`;

    main.appendChild(name);
    main.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "evidence-actions";

    if (row.BlobUrl) {
      const openBtn = document.createElement("a");
      openBtn.href = row.BlobUrl;
      openBtn.target = "_blank";
      openBtn.rel = "noopener noreferrer";
      openBtn.className = "evidence-remove-btn";
      openBtn.textContent = "Open";
      actions.appendChild(openBtn);
    }

    item.appendChild(main);
    item.appendChild(actions);
    container.appendChild(item);
  });
}

async function loadDetail() {
  try {
    showPageLoader?.("Loading detail...");

    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");

    if (!id) {
      alert("Incident ID is missing.");
      window.location.href = "/dashboard.html";
      return;
    }

    const res = await fetch(`/api/getIncident?id=${encodeURIComponent(id)}`, {
      credentials: "include",
      cache: "no-store"
    });

    const json = await res.json();

    hidePageLoader?.();

    if (!res.ok || !json.success || !json.data) {
      alert(json.message || "Failed to load incident.");
      return;
    }

    const header = json.data.header || {};
    const attachments = json.data.attachments || [];
    const comments = json.data.comments || [];
    const statusLog = json.data.statusLog || [];

    setText("incidentNumber", header.IncidentNumber);
    setText("incidentType", header.IncidentType);
    setText("businessArea", header.BusinessAreaName);
    setText("statusName", header.StatusName);
    setText("levelOfIncidentName", header.LevelOfIncidentName || header.SeverityName);
    setText("natureOfIncidentName", header.NatureOfIncidentName || header.CategoryName);
    setText("reportedBy", header.ReportedByName);
    setText("incidentDateTime", formatDateTime(header.IncidentDateTime));
    setText("reportingDateTime", formatDateTime(header.ReportingDateTime));
    setText("incidentLocationName", header.IncidentLocationName || header.LocationText);

    setText("observedByName", header.ObservedByName);
    setText("reportedByEntryName", header.ReportedByEntryName);
    setText("reportedToName", header.ReportedToName);
    setText("responsibleDepartmentHeadName", header.ResponsibleDepartmentHeadName);

    setText("titleText", header.Title);
    setText("descriptionText", header.IncidentDescription || header.Description);
    setText("natureVolumeOfLossText", header.NatureVolumeOfLoss);
    setText("contributingFactorsText", header.ContributingFactors);
    setText("rootCauseText", header.RootCause);
    setText("immediateActionTakenText", header.ImmediateActionTaken);
    setText("auditorConclusionText", header.AuditorConclusion);
    setText("sceneClearanceWorkResumeText", header.SceneClearanceWorkResume);

    setText("requiresImmediateActionText", yesNoText(header.RequiresImmediateAction));
    setText("furtherEscalationRequiredText", yesNoText(header.FurtherEscalationRequired));
    setText("immediateActionDepartmentName", header.ImmediateActionDepartmentName);
    setText("responsibleUserName", header.ResponsibleUserName);

    renderAttachments(attachments);
    renderComments(comments);
    renderStatusLog(statusLog);
  } catch (error) {
    hidePageLoader?.();
    alert(`Failed to load detail: ${error.message}`);
  }
}

document.getElementById("backBtn")?.addEventListener("click", () => {
  history.back();
});

loadDetail();
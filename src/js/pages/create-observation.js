function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "";
}

function fillSelect(selectId, rows, placeholder) {
  const el = document.getElementById(selectId);
  if (!el) return;

  el.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = placeholder;
  el.appendChild(defaultOption);

  (rows || []).forEach(row => {
    const option = document.createElement("option");
    option.value = row.Code;
    option.textContent = row.Name;
    el.appendChild(option);
  });
}

function getNameByCode(rows, code) {
  const found = (rows || []).find(x => x.Code === code);
  return found ? found.Name : "";
}

let accessData = null;
let lookups = null;

async function loadPage() {
  try {
    showPageLoader?.("Loading observation form...");

    const accessRes = await fetch("/api/getAccess", {
      credentials: "include",
      cache: "no-store"
    });
    const access = await accessRes.json();

    if (!access.success || !access.data) {
      window.location.href = "/no-access.html";
      return;
    }

    accessData = access.data;

    const selectedAreaCode = localStorage.getItem("selectedAreaCode") || "";
    const selectedAreaName = localStorage.getItem("selectedAreaName") || "";

    if (!selectedAreaCode || !selectedAreaName) {
      alert("Select Business Area first from dashboard.");
      window.location.href = "/dashboard.html";
      return;
    }

    setText("currentUserName", accessData.UserName);
    setText("currentUserEmail", accessData.UserEmail);
    setText("currentUserRole", accessData.AppRole || "");
    setText("currentAreaName", `${selectedAreaName} (${selectedAreaCode})`);

    const lookupRes = await fetch("/api/getLookups", {
      credentials: "include",
      cache: "no-store"
    });
    const lookupJson = await lookupRes.json();

    if (!lookupJson.success || !lookupJson.data) {
      throw new Error(lookupJson.message || "Failed to load lookups.");
    }

    lookups = lookupJson.data;

    const observationTypes = (lookups.incidentTypes || []).filter(
      x => x.Code === "OBSERVATION" || x.Code === "NEAR_MISS" || x.Code === "OTHER"
    );

    fillSelect("incidentType", observationTypes, "Select report type");
    fillSelect("severity", lookups.severities, "Select severity");
    fillSelect("category", lookups.categories, "Select category");
    fillSelect("priority", lookups.priorities, "Select priority");

    if (observationTypes.some(x => x.Code === "OBSERVATION")) {
      document.getElementById("incidentType").value = "OBSERVATION";
    }

    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    document.getElementById("incidentDateTime").value = local;

    hidePageLoader?.();
  } catch (error) {
    hidePageLoader?.();
    alert(`Failed to load page: ${error.message}`);
  }
}

function buildPayload() {
  const selectedAreaCode = localStorage.getItem("selectedAreaCode") || "";
  const selectedAreaName = localStorage.getItem("selectedAreaName") || "";
  const incidentDateTime = document.getElementById("incidentDateTime").value || null;

  return {
    incidentType: document.getElementById("incidentType").value,
    severityCode: document.getElementById("severity").value,
    severityName: getNameByCode(lookups?.severities, document.getElementById("severity").value),
    categoryCode: document.getElementById("category").value,
    categoryName: getNameByCode(lookups?.categories, document.getElementById("category").value),
    priorityCode: document.getElementById("priority").value,
    priorityName: getNameByCode(lookups?.priorities, document.getElementById("priority").value),
    businessAreaCode: selectedAreaCode,
    businessAreaName: selectedAreaName,
    title: document.getElementById("title").value.trim(),
    description: document.getElementById("description").value.trim(),
    incidentDate: incidentDateTime ? incidentDateTime.slice(0, 10) : null,
    incidentDateTime,
    locationText: document.getElementById("locationText").value.trim(),
    isAnonymous: document.getElementById("isAnonymous").checked,
    isConfidential: document.getElementById("isConfidential").checked,
    requiresImmediateAction: document.getElementById("requiresImmediateAction").checked
  };
}

document.getElementById("observationForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const msg = document.getElementById("formMessage");
  msg.textContent = "";

  const payload = buildPayload();

  if (
    !payload.incidentType ||
    !payload.severityCode ||
    !payload.categoryCode ||
    !payload.priorityCode ||
    !payload.businessAreaCode ||
    !payload.title ||
    !payload.description ||
    !payload.incidentDateTime
  ) {
    msg.textContent = "Please complete all required fields.";
    return;
  }

  try {
    showPageLoader?.("Submitting observation...");
    msg.textContent = "Submitting observation...";

    const res = await fetch("/api/submitIncident", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const json = await res.json();

    hidePageLoader?.();

    if (!res.ok || !json.success) {
      msg.textContent = json.message || "Failed to submit observation.";
      return;
    }

    msg.textContent = `Observation submitted successfully. Incident Number: ${json.data.IncidentNumber}`;
    alert(`Observation submitted successfully.\n\nReference Number: ${json.data.IncidentNumber}`);
    window.location.href = "/dashboard.html";
  } catch (error) {
    hidePageLoader?.();
    msg.textContent = `Submit failed: ${error.message}`;
  }
});

document.getElementById("saveDraftBtn")?.addEventListener("click", async () => {
  const msg = document.getElementById("formMessage");
  msg.textContent = "";

  const payload = buildPayload();
  payload.incidentType = payload.incidentType || "OBSERVATION";
  payload.severityCode = payload.severityCode || "LOW";
  payload.severityName = payload.severityName || "Low";
  payload.categoryCode = payload.categoryCode || "OTHER";
  payload.categoryName = payload.categoryName || "Other";
  payload.priorityCode = payload.priorityCode || "LOW";
  payload.priorityName = payload.priorityName || "Low";
  payload.title = payload.title || "Draft Observation";
  payload.incidentDate = payload.incidentDate || new Date().toISOString().slice(0, 10);

  try {
    showPageLoader?.("Saving draft...");
    msg.textContent = "Saving draft...";

    const res = await fetch("/api/saveIncidentDraft", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const json = await res.json();

    hidePageLoader?.();

    if (!res.ok || !json.success) {
      msg.textContent = json.message || "Failed to save draft.";
      return;
    }

    msg.textContent = `Draft saved successfully. Draft Number: ${json.data.IncidentNumber}`;
    alert(`Draft saved successfully.\n\nDraft Number: ${json.data.IncidentNumber}`);
    window.location.href = "/my-drafts.html";
  } catch (error) {
    hidePageLoader?.();
    msg.textContent = `Save draft failed: ${error.message}`;
  }
});

document.getElementById("backToDashboardBtn")?.addEventListener("click", () => {
  window.location.href = "/dashboard.html";
});

loadPage();
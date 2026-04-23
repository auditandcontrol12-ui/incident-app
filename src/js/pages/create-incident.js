function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "";
}

function fillSelect(selectId, rows, placeholder, valueKey = "Code", textKey = "Name", includeOther = false) {
  const el = document.getElementById(selectId);
  if (!el) return;

  el.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = placeholder;
  el.appendChild(defaultOption);

  (rows || []).forEach(row => {
    const option = document.createElement("option");
    option.value = row[valueKey];
    option.textContent = row[textKey];
    el.appendChild(option);
  });

  if (includeOther) {
    const otherOption = document.createElement("option");
    otherOption.value = "OTHER";
    otherOption.textContent = "Other";
    el.appendChild(otherOption);
  }
}

function getNameByCode(rows, code, valueKey = "Code", textKey = "Name") {
  const found = (rows || []).find(x => x[valueKey] === code);
  return found ? found[textKey] : "";
}

function getDepartmentResponders(departmentCode) {
  if (!departmentCode || departmentCode === "OTHER") return [];
  return (lookups?.departmentResponders || []).filter(x => x.DepartmentCode === departmentCode);
}

function getDepartmentHeads(departmentCode) {
  if (!departmentCode || departmentCode === "OTHER") return [];
  return (lookups?.departmentHeadsByDepartment || []).filter(x => x.DepartmentCode === departmentCode);
}

function refreshDepartmentDrivenPeople() {
  const departmentCode = document.getElementById("immediateActionDepartment")?.value || "";

  const responderRows = getDepartmentResponders(departmentCode);
  const headRows = getDepartmentHeads(departmentCode);

  fillSelect(
    "responsibleUser",
    responderRows,
    "Select Responsible User",
    "Code",
    "Name",
    true
  );

  fillSelect(
    "responsibleDepartmentHead",
    headRows,
    "Select Responsible Department Head",
    "Code",
    "Name",
    true
  );

  handleOtherField("responsibleUser", "responsibleUserOther");
  handleOtherField("responsibleDepartmentHead", "responsibleDepartmentHeadOther");
}

function toLocalDateTimeValue(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function fromServerDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return String(value).slice(0, 16);
  }
  return toLocalDateTimeValue(d);
}

function trimValue(id) {
  return (document.getElementById(id)?.value || "").trim();
}

function isChecked(id) {
  return !!document.getElementById(id)?.checked;
}

function setRequired(id, required) {
  const el = document.getElementById(id);
  if (el) el.required = !!required;
}

function showElement(id, show) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? "" : "none";
}

function handleOtherField(selectId, otherInputId) {
  const select = document.getElementById(selectId);
  const otherInput = document.getElementById(otherInputId);
  if (!select || !otherInput) return;

  const isOther = select.value === "OTHER";
  otherInput.style.display = isOther ? "" : "none";
  otherInput.required = isOther;

  if (!isOther) otherInput.value = "";
}

function handleImmediateActionSection() {
  const isRequired = isChecked("requiresImmediateAction");

  showElement("immediateActionSection", isRequired);

  setRequired("immediateActionDepartment", isRequired);
  setRequired("responsibleUser", isRequired);

  if (!isRequired) {
    const fieldsToReset = [
      "immediateActionDepartment",
      "immediateActionDepartmentOther",
      "responsibleUser",
      "responsibleUserOther"
    ];

    fieldsToReset.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = "";
    });

    showElement("immediateActionDepartmentOther", false);
    showElement("responsibleUserOther", false);
    setRequired("immediateActionDepartmentOther", false);
    setRequired("responsibleUserOther", false);
  }

  refreshDepartmentDrivenPeople();
}

function getSelectFinalValue(selectId, otherInputId) {
  const code = document.getElementById(selectId)?.value || "";
  const otherText = trimValue(otherInputId);

  if (code === "OTHER") {
    return {
      code: "OTHER",
      name: otherText
    };
  }

  return {
    code,
    name: ""
  };
}

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function rebuildFileInputFromSelectedFiles() {
  const input = document.getElementById("objectiveEvidence");
  if (!input) return;

  const dt = new DataTransfer();
  selectedFiles.forEach(file => dt.items.add(file));
  input.files = dt.files;
}

function validateFiles(files, requireFiles = true) {
  const allowedTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "application/pdf"
  ];

  const maxFiles = 5;
  const maxSingleFileBytes = 5 * 1024 * 1024;
  const maxTotalBytes = 20 * 1024 * 1024;

  const activeExistingCount = existingAttachments.filter(x => !deletedExistingAttachmentIds.includes(x.IncidentAttachmentID)).length;
  const totalCount = activeExistingCount + files.length;

  if (requireFiles && totalCount === 0) {
    return { valid: false, message: "Objective Evidence is required." };
  }

  if (totalCount > maxFiles) {
    return { valid: false, message: "Maximum 5 files allowed in total." };
  }

  let totalBytes = 0;

  for (const file of files) {
    totalBytes += file.size;

    if (!allowedTypes.includes(file.type)) {
      return { valid: false, message: `Invalid file type: ${file.name}` };
    }

    if (file.size > maxSingleFileBytes) {
      return { valid: false, message: `File exceeds 5 MB: ${file.name}` };
    }
  }

  if (totalBytes > maxTotalBytes) {
    return { valid: false, message: "Total upload size of new files cannot exceed 20 MB." };
  }

  return { valid: true, message: "" };
}

function removeSelectedFile(index) {
  selectedFiles.splice(index, 1);
  rebuildFileInputFromSelectedFiles();
  renderSelectedFiles();
}

function markExistingAttachmentDeleted(attachmentId) {
  if (!deletedExistingAttachmentIds.includes(attachmentId)) {
    deletedExistingAttachmentIds.push(attachmentId);
  }
  renderExistingAttachments();
  updateEvidenceInfo();
}

function undoExistingAttachmentDeleted(attachmentId) {
  deletedExistingAttachmentIds = deletedExistingAttachmentIds.filter(x => x !== attachmentId);
  renderExistingAttachments();
  updateEvidenceInfo();
}

function renderSelectedFiles() {
  const info = document.getElementById("objectiveEvidenceInfo");
  const list = document.getElementById("objectiveEvidenceList");

  if (!info || !list) return;

  list.innerHTML = "";

  const activeExistingCount = existingAttachments.filter(x => !deletedExistingAttachmentIds.includes(x.IncidentAttachmentID)).length;

  if (!selectedFiles.length) {
    info.textContent = activeExistingCount ? "No new files selected." : "No files selected.";
    return;
  }

  const totalBytes = selectedFiles.reduce((sum, f) => sum + f.size, 0);
  info.textContent = `${selectedFiles.length} new file(s) selected | Total size: ${formatFileSize(totalBytes)}`;

  selectedFiles.forEach((file, index) => {
    const row = document.createElement("div");
    row.className = "evidence-item";

    const main = document.createElement("div");
    main.className = "evidence-main";

    const name = document.createElement("div");
    name.className = "evidence-name";
    name.textContent = `${index + 1}. ${file.name}`;

    const meta = document.createElement("div");
    meta.className = "evidence-meta";
    meta.textContent = `${file.type || "Unknown"} | ${formatFileSize(file.size)}`;

    main.appendChild(name);
    main.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "evidence-actions";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "evidence-remove-btn";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => removeSelectedFile(index));

    actions.appendChild(removeBtn);
    row.appendChild(main);
    row.appendChild(actions);

    list.appendChild(row);
  });
}

function updateEvidenceInfo() {
  renderSelectedFiles();
}

function renderExistingAttachments() {
  const wrap = document.getElementById("existingEvidenceWrap");
  const list = document.getElementById("existingEvidenceList");

  if (!wrap || !list) return;

  list.innerHTML = "";

  if (!existingAttachments.length) {
    wrap.style.display = "none";
    return;
  }

  wrap.style.display = "";

  existingAttachments.forEach((file, index) => {
    const isDeleted = deletedExistingAttachmentIds.includes(file.IncidentAttachmentID);

    const row = document.createElement("div");
    row.className = "evidence-item";
    if (isDeleted) row.style.opacity = "0.5";

    const main = document.createElement("div");
    main.className = "evidence-main";

    const name = document.createElement("div");
    name.className = "evidence-name";
    name.textContent = `${index + 1}. ${file.FileOriginalName || file.FileName || ""}`;

    const meta = document.createElement("div");
    meta.className = "evidence-meta";
    meta.textContent =
      `${file.ContentType || file.AttachmentType || ""}` +
      `${file.FileSizeKB ? ` | ${file.FileSizeKB} KB` : ""}` +
      `${isDeleted ? " | Marked for delete" : ""}`;

    main.appendChild(name);
    main.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "evidence-actions";

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "evidence-remove-btn";
    toggleBtn.textContent = isDeleted ? "Undo" : "Remove";
    toggleBtn.addEventListener("click", () => {
      if (isDeleted) undoExistingAttachmentDeleted(file.IncidentAttachmentID);
      else markExistingAttachmentDeleted(file.IncidentAttachmentID);
    });

    actions.appendChild(toggleBtn);
    row.appendChild(main);
    row.appendChild(actions);

    list.appendChild(row);
  });
}

function applySelectOrOther(selectId, otherInputId, code, name) {
  const select = document.getElementById(selectId);
  const otherInput = document.getElementById(otherInputId);
  if (!select || !otherInput) return;

  const hasOption = Array.from(select.options).some(opt => opt.value === (code || ""));

  if (code && hasOption && code !== "OTHER") {
    select.value = code;
    otherInput.value = "";
    otherInput.style.display = "none";
    otherInput.required = false;
    return;
  }

  if (code || name) {
    select.value = "OTHER";
    otherInput.value = name || "";
    otherInput.style.display = "";
    otherInput.required = true;
    return;
  }

  select.value = "";
  otherInput.value = "";
  otherInput.style.display = "none";
  otherInput.required = false;
}

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function setFormModeUI() {
  const pageTitle = document.getElementById("pageTitle");
  const pageSubtitle = document.getElementById("pageSubtitle");
  const submitBtn = document.getElementById("submitIncidentBtn");
  const saveBtn = document.getElementById("saveDraftBtn");

  if (isEditMode) {
    if (pageTitle) pageTitle.textContent = "Edit Draft Incident";
    if (pageSubtitle) pageSubtitle.textContent = "Update your saved draft incident and continue later or submit it.";
    if (submitBtn) submitBtn.textContent = "Submit Incident";
    if (saveBtn) saveBtn.textContent = "Update Draft";
  } else {
    if (pageTitle) pageTitle.textContent = "Create Incident";
    if (pageSubtitle) pageSubtitle.textContent = "Record a new incident in the required company format with reporting, action, and evidence details.";
    if (submitBtn) submitBtn.textContent = "Submit Incident";
    if (saveBtn) saveBtn.textContent = "Save Draft";
  }
}

function buildPayload() {
  const selectedAreaCode = localStorage.getItem("selectedAreaCode") || "";
  const selectedAreaName = localStorage.getItem("selectedAreaName") || "";

  const incidentLocation = getSelectFinalValue("incidentLocation", "incidentLocationOther");
  const observedBy = getSelectFinalValue("observedBy", "observedByOther");
  const reportedBy = getSelectFinalValue("reportedBy", "reportedByOther");
  const reportedTo = getSelectFinalValue("reportedTo", "reportedToOther");
  const natureOfIncident = getSelectFinalValue("natureOfIncident", "natureOfIncidentOther");
  const levelOfIncident = getSelectFinalValue("levelOfIncident", "levelOfIncidentOther");
  const responsibleDepartmentHead = getSelectFinalValue("responsibleDepartmentHead", "responsibleDepartmentHeadOther");
  const immediateActionDepartment = getSelectFinalValue("immediateActionDepartment", "immediateActionDepartmentOther");
  const responsibleUser = getSelectFinalValue("responsibleUser", "responsibleUserOther");

  return {
    incidentId: currentIncidentId,
    incidentSerialNo: trimValue("incidentSerialNo"),
    incidentTypeCode: document.getElementById("incidentType").value,
    incidentTypeName: getNameByCode(lookups?.incidentTypes, document.getElementById("incidentType").value),

    levelOfIncidentCode: levelOfIncident.code,
    levelOfIncidentName:
      levelOfIncident.code === "OTHER"
        ? levelOfIncident.name
        : getNameByCode(lookups?.levelsOfIncident, levelOfIncident.code),

    natureOfIncidentCode: natureOfIncident.code,
    natureOfIncidentName:
      natureOfIncident.code === "OTHER"
        ? natureOfIncident.name
        : getNameByCode(lookups?.naturesOfIncident, natureOfIncident.code),

    businessAreaCode: selectedAreaCode,
    businessAreaName: selectedAreaName,

    incidentDateTime: document.getElementById("incidentDateTime").value || null,
    reportingDateTime: document.getElementById("reportingDateTime").value || null,

    incidentLocationCode: incidentLocation.code,
    incidentLocationName:
      incidentLocation.code === "OTHER"
        ? incidentLocation.name
        : getNameByCode(lookups?.incidentLocations, incidentLocation.code),

    observedByCode: observedBy.code,
    observedByName:
      observedBy.code === "OTHER"
        ? observedBy.name
        : getNameByCode(lookups?.people, observedBy.code),

    reportedByEntryCode: reportedBy.code,
    reportedByEntryName:
      reportedBy.code === "OTHER"
        ? reportedBy.name
        : getNameByCode(lookups?.people, reportedBy.code),

    reportedToCode: reportedTo.code,
    reportedToName:
      reportedTo.code === "OTHER"
        ? reportedTo.name
        : getNameByCode(lookups?.people, reportedTo.code),

    responsibleDepartmentHeadCode: responsibleDepartmentHead.code,
    responsibleDepartmentHeadName:
      responsibleDepartmentHead.code === "OTHER"
        ? responsibleDepartmentHead.name
        : getNameByCode(
            getDepartmentHeads(document.getElementById("immediateActionDepartment")?.value || ""),
            responsibleDepartmentHead.code
          ),

    incidentTitle: trimValue("incidentTitle"),
    incidentDescription: trimValue("incidentDescription"),
    natureVolumeOfLoss: trimValue("natureVolumeOfLoss"),
    contributingFactors: trimValue("contributingFactors"),
    rootCause: trimValue("rootCause"),
    immediateActionTaken: trimValue("immediateActionTaken"),
    auditorConclusion: trimValue("auditorConclusion"),
    sceneClearanceWorkResume: trimValue("sceneClearanceWorkResume"),

    requiresImmediateAction: isChecked("requiresImmediateAction"),
    furtherEscalationRequired: isChecked("furtherEscalationRequired"),

    immediateActionDepartmentCode: isChecked("requiresImmediateAction") ? immediateActionDepartment.code : null,
    immediateActionDepartmentName: isChecked("requiresImmediateAction")
      ? (
          immediateActionDepartment.code === "OTHER"
            ? immediateActionDepartment.name
            : getNameByCode(lookups?.departments, immediateActionDepartment.code)
        )
      : null,

    responsibleUserCode: isChecked("requiresImmediateAction") ? responsibleUser.code : null,
    responsibleUserName: isChecked("requiresImmediateAction")
      ? (
          responsibleUser.code === "OTHER"
            ? responsibleUser.name
            : getNameByCode(
                getDepartmentResponders(document.getElementById("immediateActionDepartment")?.value || ""),
                responsibleUser.code
              )
        )
      : null,

    deletedExistingAttachmentIds
  };
}

function validatePayload(payload, isDraft = false) {
  if (isDraft) return { valid: true, message: "" };

  const requiredFields = [
    payload.incidentTypeCode,
    payload.levelOfIncidentCode,
    payload.natureOfIncidentCode,
    payload.incidentDateTime,
    payload.reportingDateTime,
    payload.incidentLocationCode,
    payload.observedByCode,
    payload.reportedByEntryCode,
    payload.reportedToCode,
    payload.responsibleDepartmentHeadCode,
    payload.incidentTitle,
    payload.incidentDescription,
    payload.natureVolumeOfLoss,
    payload.contributingFactors,
    payload.rootCause,
    payload.immediateActionTaken,
    payload.auditorConclusion,
    payload.sceneClearanceWorkResume
  ];

  if (requiredFields.some(x => !x)) {
    return { valid: false, message: "Please complete all required fields." };
  }

  const otherPairs = [
    [payload.levelOfIncidentCode, payload.levelOfIncidentName, "Level of Incident"],
    [payload.natureOfIncidentCode, payload.natureOfIncidentName, "Nature of Incident"],
    [payload.incidentLocationCode, payload.incidentLocationName, "Incident Location"],
    [payload.observedByCode, payload.observedByName, "Observed By"],
    [payload.reportedByEntryCode, payload.reportedByEntryName, "Reported By"],
    [payload.reportedToCode, payload.reportedToName, "Reported To"],
    [payload.responsibleDepartmentHeadCode, payload.responsibleDepartmentHeadName, "Responsible Department Head"]
  ];

  for (const [code, name, label] of otherPairs) {
    if (code === "OTHER" && !name) {
      return { valid: false, message: `${label} requires Other text.` };
    }
  }

  if (payload.requiresImmediateAction) {
    if (!payload.immediateActionDepartmentCode || !payload.responsibleUserCode) {
      return { valid: false, message: "Immediate Action Department and Responsible User are required." };
    }

    if (payload.immediateActionDepartmentCode === "OTHER" && !payload.immediateActionDepartmentName) {
      return { valid: false, message: "Immediate Action Department requires Other text." };
    }

    if (payload.responsibleUserCode === "OTHER" && !payload.responsibleUserName) {
      return { valid: false, message: "Responsible User requires Other text." };
    }
  }

  return { valid: true, message: "" };
}

async function sendForm(url, payload, successRedirect, successLabel, requireFiles = true) {
  const msg = document.getElementById("formMessage");
  const files = [...selectedFiles];

  const fileCheck = validateFiles(files, requireFiles);
  if (!fileCheck.valid) {
    msg.textContent = fileCheck.message;
    return;
  }

  const formData = new FormData();
  formData.append("payload", JSON.stringify(payload));

  files.forEach(file => {
    formData.append("files", file);
  });

  showPageLoader?.(successLabel);
  msg.textContent = successLabel;

  try {
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      body: formData
    });

    const json = await res.json();
    hidePageLoader?.();

    if (!res.ok || !json.success) {
      msg.textContent = json.message || "Request failed.";
      return;
    }

    msg.textContent = `${json.message || "Success"} ${json.data?.IncidentNumber ? `Incident Number: ${json.data.IncidentNumber}` : ""}`;
    alert(`${json.message || "Success"}${json.data?.IncidentNumber ? `\n\nIncident Number: ${json.data.IncidentNumber}` : ""}`);
    window.location.href = successRedirect;
  } catch (error) {
    hidePageLoader?.();
    msg.textContent = `Request failed: ${error.message}`;
  }
}

function populateFormFromIncident(header, attachments) {
  if (!header) return;

  currentIncidentId = header.IncidentID;
  existingAttachments = attachments || [];
  deletedExistingAttachmentIds = [];

  document.getElementById("incidentSerialNo").value = header.IncidentNumber || "";
  document.getElementById("incidentDateTime").value = fromServerDateTime(header.IncidentDateTime);
  document.getElementById("reportingDateTime").value = fromServerDateTime(header.ReportingDateTime);

  document.getElementById("incidentType").value = header.IncidentType || "";

  applySelectOrOther("levelOfIncident", "levelOfIncidentOther", header.LevelOfIncidentCode, header.LevelOfIncidentName);
  applySelectOrOther("natureOfIncident", "natureOfIncidentOther", header.NatureOfIncidentCode, header.NatureOfIncidentName);
  applySelectOrOther("incidentLocation", "incidentLocationOther", header.IncidentLocationCode, header.IncidentLocationName);
  applySelectOrOther("observedBy", "observedByOther", header.ObservedByCode, header.ObservedByName);
  applySelectOrOther("reportedBy", "reportedByOther", header.ReportedByEntryCode, header.ReportedByEntryName);
  applySelectOrOther("reportedTo", "reportedToOther", header.ReportedToCode, header.ReportedToName);

  document.getElementById("incidentTitle").value = header.Title || "";
  document.getElementById("incidentDescription").value = header.IncidentDescription || header.Description || "";
  document.getElementById("natureVolumeOfLoss").value = header.NatureVolumeOfLoss || "";
  document.getElementById("contributingFactors").value = header.ContributingFactors || "";
  document.getElementById("rootCause").value = header.RootCause || "";
  document.getElementById("immediateActionTaken").value = header.ImmediateActionTaken || "";
  document.getElementById("auditorConclusion").value = header.AuditorConclusion || "";
  document.getElementById("sceneClearanceWorkResume").value = header.SceneClearanceWorkResume || "";

  document.getElementById("requiresImmediateAction").checked = !!header.RequiresImmediateAction;
  document.getElementById("furtherEscalationRequired").checked = !!header.FurtherEscalationRequired;

  handleImmediateActionSection();

  if (header.RequiresImmediateAction) {
    applySelectOrOther(
      "immediateActionDepartment",
      "immediateActionDepartmentOther",
      header.ImmediateActionDepartmentCode,
      header.ImmediateActionDepartmentName
    );

    refreshDepartmentDrivenPeople();

    applySelectOrOther(
      "responsibleDepartmentHead",
      "responsibleDepartmentHeadOther",
      header.ResponsibleDepartmentHeadCode,
      header.ResponsibleDepartmentHeadName
    );

    applySelectOrOther(
      "responsibleUser",
      "responsibleUserOther",
      header.ResponsibleUserCode,
      header.ResponsibleUserName
    );
  } else {
    refreshDepartmentDrivenPeople();
  }

  renderExistingAttachments();
  renderSelectedFiles();
}

function mergeNewFilesFromInput() {
  const input = document.getElementById("objectiveEvidence");
  if (!input) return;

  const incomingFiles = Array.from(input.files || []);
  if (!incomingFiles.length) {
    renderSelectedFiles();
    return;
  }

  const existingKeySet = new Set(
    selectedFiles.map(file => `${file.name}|${file.size}|${file.type}|${file.lastModified}`)
  );

  incomingFiles.forEach(file => {
    const key = `${file.name}|${file.size}|${file.type}|${file.lastModified}`;
    if (!existingKeySet.has(key)) {
      selectedFiles.push(file);
      existingKeySet.add(key);
    }
  });

  rebuildFileInputFromSelectedFiles();
  renderSelectedFiles();
}

function setFormModeUI() {
  const pageTitle = document.getElementById("pageTitle");
  const pageSubtitle = document.getElementById("pageSubtitle");
  const submitBtn = document.getElementById("submitIncidentBtn");
  const saveBtn = document.getElementById("saveDraftBtn");

  if (isEditMode) {
    if (pageTitle) pageTitle.textContent = "Edit Draft Incident";
    if (pageSubtitle) pageSubtitle.textContent = "Update your saved draft incident and continue later or submit it.";
    if (submitBtn) submitBtn.textContent = "Submit Incident";
    if (saveBtn) saveBtn.textContent = "Update Draft";
  } else {
    if (pageTitle) pageTitle.textContent = "Create Incident";
    if (pageSubtitle) pageSubtitle.textContent = "Record a new incident in the required company format with reporting, action, and evidence details.";
    if (submitBtn) submitBtn.textContent = "Submit Incident";
    if (saveBtn) saveBtn.textContent = "Save Draft";
  }
}

let accessData = null;
let lookups = null;
let currentIncidentId = null;
let isEditMode = false;
let existingAttachments = [];
let deletedExistingAttachmentIds = [];
let selectedFiles = [];

async function loadLookups() {
  const lookupRes = await fetch("/api/getIncidentCreateLookups", {
    credentials: "include",
    cache: "no-store"
  });
  const lookupJson = await lookupRes.json();

  if (!lookupJson.success || !lookupJson.data) {
    throw new Error(lookupJson.message || "Failed to load incident lookups.");
  }

  lookups = lookupJson.data;

  fillSelect("incidentType", lookups.incidentTypes, "Select Incident Type", "Code", "Name", false);
  fillSelect("levelOfIncident", lookups.levelsOfIncident, "Select Level of Incident", "Code", "Name", true);
  fillSelect("natureOfIncident", lookups.naturesOfIncident, "Select Nature of Incident", "Code", "Name", true);
  fillSelect("incidentLocation", lookups.incidentLocations, "Select Incident Location", "Code", "Name", true);
  fillSelect("observedBy", lookups.people, "Select Observed By", "Code", "Name", true);
  fillSelect("reportedBy", lookups.people, "Select Reported By", "Code", "Name", true);
  fillSelect("reportedTo", lookups.people, "Select Reported To", "Code", "Name", true);
  fillSelect("responsibleDepartmentHead", [], "Select Responsible Department Head", "Code", "Name", true);
  fillSelect("immediateActionDepartment", lookups.departments, "Select Immediate Action Department", "Code", "Name", true);
  fillSelect("responsibleUser", [], "Select Responsible User", "Code", "Name", true);

  refreshDepartmentDrivenPeople();
}

function bindUiEvents() {
  [
    ["levelOfIncident", "levelOfIncidentOther"],
    ["natureOfIncident", "natureOfIncidentOther"],
    ["incidentLocation", "incidentLocationOther"],
    ["observedBy", "observedByOther"],
    ["reportedBy", "reportedByOther"],
    ["reportedTo", "reportedToOther"],
    ["responsibleDepartmentHead", "responsibleDepartmentHeadOther"],
    ["immediateActionDepartment", "immediateActionDepartmentOther"],
    ["responsibleUser", "responsibleUserOther"]
  ].forEach(([selectId, otherInputId]) => {
    const select = document.getElementById(selectId);
    if (select) {
      select.addEventListener("change", () => handleOtherField(selectId, otherInputId));
      handleOtherField(selectId, otherInputId);
    }
  });

  document.getElementById("requiresImmediateAction")?.addEventListener("change", handleImmediateActionSection);
  document.getElementById("objectiveEvidence")?.addEventListener("change", mergeNewFilesFromInput);

  document.getElementById("immediateActionDepartment")?.addEventListener("change", () => {
    handleOtherField("immediateActionDepartment", "immediateActionDepartmentOther");
    refreshDepartmentDrivenPeople();
  });

  handleImmediateActionSection();
  renderSelectedFiles();
}

async function loadPage() {
  try {
    showPageLoader?.("Loading incident form...");

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

    await loadLookups();
    bindUiEvents();

    const editId = getQueryParam("id");
    isEditMode = !!editId;
    setFormModeUI();

    if (isEditMode) {
      const res = await fetch(`/api/getIncident?id=${encodeURIComponent(editId)}`, {
        credentials: "include",
        cache: "no-store"
      });
      const json = await res.json();

      if (!res.ok || !json.success || !json.data?.header) {
        throw new Error(json.message || "Failed to load draft incident.");
      }

      if (json.data.header.StatusCode !== "DRAFT") {
        throw new Error("Only draft incidents can be edited here.");
      }

      populateFormFromIncident(json.data.header, json.data.attachments || []);
    } else {
      document.getElementById("incidentDateTime").value = toLocalDateTimeValue();
      document.getElementById("reportingDateTime").value = toLocalDateTimeValue();
      document.getElementById("incidentSerialNo").value = "Auto-generated on save/submit";
    }

    hidePageLoader?.();
  } catch (error) {
    hidePageLoader?.();
    alert(`Failed to load page: ${error.message}`);
  }
}

document.getElementById("incidentForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const msg = document.getElementById("formMessage");
  msg.textContent = "";

  const payload = buildPayload();
  const validation = validatePayload(payload, false);

  if (!validation.valid) {
    msg.textContent = validation.message;
    return;
  }

  await sendForm(
    "/api/submitIncident",
    payload,
    "/dashboard.html",
    isEditMode ? "Submitting draft incident..." : "Submitting incident...",
    true
  );
});

document.getElementById("saveDraftBtn")?.addEventListener("click", async () => {
  const msg = document.getElementById("formMessage");
  msg.textContent = "";

  const payload = buildPayload();

  if (!payload.incidentTypeCode) {
    payload.incidentTypeCode = "INCIDENT";
    payload.incidentTypeName = "Incident";
  }

  if (!payload.incidentDateTime) payload.incidentDateTime = toLocalDateTimeValue();
  if (!payload.reportingDateTime) payload.reportingDateTime = toLocalDateTimeValue();
  if (!payload.incidentTitle) payload.incidentTitle = "Draft Incident";

  if (isEditMode && currentIncidentId) {
    await sendForm(
      "/api/updateIncidentDraft",
      payload,
      "/my-drafts.html",
      "Updating draft...",
      false
    );
    return;
  }

  await sendForm(
    "/api/saveIncidentDraft",
    payload,
    "/my-drafts.html",
    "Saving draft...",
    false
  );
});

document.getElementById("backToDashboardBtn")?.addEventListener("click", () => {
  window.location.href = "/dashboard.html";
});

loadPage();
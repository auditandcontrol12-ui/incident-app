const { app } = require("@azure/functions");
const Busboy = require("busboy");
const path = require("path");
const { getPool, sql } = require("../shared/db");
const { readCookie } = require("../shared/session");
const { AUTH_SCHEMA, APP_SCHEMA, APP_CODE } = require("../shared/config");
const { buildBlobPath, uploadBufferToBlob, deleteBlobIfExists } = require("../shared/blob");

function buildIncidentNumber(now = new Date()) {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mi = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  return `INC-${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

async function parseMultipartForm(request) {
  const contentType = request.headers.get("content-type") || "";

  return new Promise(async (resolve, reject) => {
    try {
      const busboy = Busboy({
        headers: {
          "content-type": contentType
        }
      });

      const fields = {};
      const files = [];

      busboy.on("field", (name, value) => {
        fields[name] = value;
      });

      busboy.on("file", (name, file, info) => {
        const chunks = [];
        const { filename, encoding, mimeType } = info || {};

        file.on("data", chunk => chunks.push(chunk));
        file.on("end", () => {
          files.push({
            fieldName: name,
            filename,
            encoding,
            mimeType,
            buffer: Buffer.concat(chunks),
            size: chunks.reduce((s, c) => s + c.length, 0)
          });
        });
      });

      busboy.on("finish", () => resolve({ fields, files }));
      busboy.on("error", reject);

      const arrayBuffer = await request.arrayBuffer();
      busboy.end(Buffer.from(arrayBuffer));
    } catch (err) {
      reject(err);
    }
  });
}

function normalizePayload(payloadRaw) {
  if (!payloadRaw) return {};
  if (typeof payloadRaw === "string") return JSON.parse(payloadRaw);
  return payloadRaw;
}

function validateFiles(files, hasExistingAttachments = false) {
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

  if ((!files || files.length === 0) && !hasExistingAttachments) {
    return "Objective Evidence is required.";
  }

  if (!files || files.length === 0) {
    return null;
  }

  if (files.length > maxFiles) {
    return "Maximum 5 files allowed.";
  }

  let totalBytes = 0;

  for (const file of files) {
    totalBytes += file.size;

    if (!allowedTypes.includes(file.mimeType)) {
      return `Invalid file type: ${file.filename}`;
    }

    if (file.size > maxSingleFileBytes) {
      return `File exceeds 5 MB: ${file.filename}`;
    }
  }

  if (totalBytes > maxTotalBytes) {
    return "Total upload size cannot exceed 20 MB.";
  }

  return null;
}

function getAttachmentType(mimeType = "") {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) return "IMAGE";
  return "OTHER";
}

async function insertPendingAction(tx, inserted, body, user) {
  await new sql.Request(tx)
    .input("IncidentID", sql.BigInt, inserted.IncidentID)
    .input("IncidentNumber", sql.NVarChar(50), inserted.IncidentNumber)
    .input("ActionTypeCode", sql.NVarChar(50), "IMMEDIATE_ACTION")
    .input("ActionTypeName", sql.NVarChar(100), "Immediate Action")
    .input("AssignedDepartmentCode", sql.NVarChar(100), body.immediateActionDepartmentCode)
    .input("AssignedDepartmentName", sql.NVarChar(300), body.immediateActionDepartmentName)
    .input("AssignedUserCode", sql.NVarChar(100), body.responsibleUserCode)
    .input("AssignedUserName", sql.NVarChar(300), body.responsibleUserName)
    .input("PendingActionStatusCode", sql.NVarChar(50), "OPEN")
    .input("PendingActionStatusName", sql.NVarChar(100), "Open")
    .input("ActionRemarks", sql.NVarChar(2000), "Immediate action created automatically from incident submission.")
    .input("CreatedByUserID", sql.Int, user.UserID)
    .input("CreatedByEmail", sql.NVarChar(1020), user.UserEmail)
    .input("CreatedByName", sql.NVarChar(300), user.UserName)
    .query(`
      INSERT INTO ${APP_SCHEMA}.IncidentPendingAction
      (
          IncidentID,
          IncidentNumber,
          ActionTypeCode,
          ActionTypeName,
          AssignedDepartmentCode,
          AssignedDepartmentName,
          AssignedUserCode,
          AssignedUserName,
          PendingActionStatusCode,
          PendingActionStatusName,
          ActionRemarks,
          CreatedByUserID,
          CreatedByEmail,
          CreatedByName
      )
      VALUES
      (
          @IncidentID,
          @IncidentNumber,
          @ActionTypeCode,
          @ActionTypeName,
          @AssignedDepartmentCode,
          @AssignedDepartmentName,
          @AssignedUserCode,
          @AssignedUserName,
          @PendingActionStatusCode,
          @PendingActionStatusName,
          @ActionRemarks,
          @CreatedByUserID,
          @CreatedByEmail,
          @CreatedByName
      );
    `);
}

async function upsertPendingActionForSubmittedDraft(tx, incidentId, incidentNumber, body, user) {
  const existingPending = await new sql.Request(tx)
    .input("IncidentID", sql.BigInt, incidentId)
    .query(`
      SELECT TOP 1
          IncidentPendingActionID,
          PendingActionStatusCode
      FROM ${APP_SCHEMA}.IncidentPendingAction
      WHERE IncidentID = @IncidentID
        AND IsDeleted = 0;
    `);

  if (body.requiresImmediateAction) {
    if (existingPending.recordset.length === 0) {
      await insertPendingAction(
        tx,
        { IncidentID: incidentId, IncidentNumber: incidentNumber },
        body,
        user
      );
      return;
    }

    await new sql.Request(tx)
      .input("IncidentID", sql.BigInt, incidentId)
      .input("AssignedDepartmentCode", sql.NVarChar(100), body.immediateActionDepartmentCode)
      .input("AssignedDepartmentName", sql.NVarChar(300), body.immediateActionDepartmentName)
      .input("AssignedUserCode", sql.NVarChar(100), body.responsibleUserCode)
      .input("AssignedUserName", sql.NVarChar(300), body.responsibleUserName)
      .input("UpdatedByUserID", sql.Int, user.UserID)
      .query(`
        UPDATE ${APP_SCHEMA}.IncidentPendingAction
        SET
            AssignedDepartmentCode = @AssignedDepartmentCode,
            AssignedDepartmentName = @AssignedDepartmentName,
            AssignedUserCode = @AssignedUserCode,
            AssignedUserName = @AssignedUserName,
            PendingActionStatusCode = 'OPEN',
            PendingActionStatusName = 'Open',
            UpdatedOn = SYSUTCDATETIME(),
            UpdatedByUserID = @UpdatedByUserID
        WHERE IncidentID = @IncidentID
          AND IsDeleted = 0;
      `);

    return;
  }

  if (existingPending.recordset.length > 0) {
    await new sql.Request(tx)
      .input("IncidentID", sql.BigInt, incidentId)
      .input("UpdatedByUserID", sql.Int, user.UserID)
      .query(`
        UPDATE ${APP_SCHEMA}.IncidentPendingAction
        SET
            PendingActionStatusCode = 'CANCELLED',
            PendingActionStatusName = 'Cancelled',
            CancelledOn = SYSUTCDATETIME(),
            UpdatedOn = SYSUTCDATETIME(),
            UpdatedByUserID = @UpdatedByUserID
        WHERE IncidentID = @IncidentID
          AND IsDeleted = 0
          AND PendingActionStatusCode IN ('OPEN', 'IN_PROGRESS');
      `);
  }
}

async function insertAttachments(tx, incidentId, incidentNumber, files, user) {
  for (const file of files) {
    const blobPath = buildBlobPath({
      incidentNumber,
      fileName: file.filename
    });

    const uploadResult = await uploadBufferToBlob({
      buffer: file.buffer,
      blobPath,
      contentType: file.mimeType
    });

    const ext = path.extname(file.filename || "").replace(".", "").toUpperCase();

    await new sql.Request(tx)
      .input("IncidentID", sql.BigInt, incidentId)
      .input("FileName", sql.NVarChar(500), path.basename(uploadResult.blobPath))
      .input("FileOriginalName", sql.NVarChar(500), file.filename || path.basename(uploadResult.blobPath))
      .input("FileExtension", sql.NVarChar(50), ext || null)
      .input("ContentType", sql.NVarChar(200), file.mimeType || null)
      .input("FileSizeKB", sql.Decimal(18, 2), Number((file.size / 1024).toFixed(2)))
      .input("BlobPath", sql.NVarChar(1000), uploadResult.blobPath)
      .input("BlobUrl", sql.NVarChar(2000), uploadResult.blobUrl)
      .input("AttachmentType", sql.NVarChar(100), getAttachmentType(file.mimeType))
      .input("UploadedByUserID", sql.Int, user.UserID)
      .input("UploadedByEmail", sql.NVarChar(1020), user.UserEmail)
      .input("UploadedByName", sql.NVarChar(300), user.UserName)
      .query(`
        INSERT INTO ${APP_SCHEMA}.IncidentAttachment
        (
            IncidentID,
            FileName,
            FileOriginalName,
            FileExtension,
            ContentType,
            FileSizeKB,
            BlobPath,
            BlobUrl,
            AttachmentType,
            UploadedByUserID,
            UploadedByEmail,
            UploadedByName
        )
        VALUES
        (
            @IncidentID,
            @FileName,
            @FileOriginalName,
            @FileExtension,
            @ContentType,
            @FileSizeKB,
            @BlobPath,
            @BlobUrl,
            @AttachmentType,
            @UploadedByUserID,
            @UploadedByEmail,
            @UploadedByName
        );
      `);
  }
}

app.http("submitIncident", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    try {
      const cookieName = process.env.SESSION_COOKIE_NAME || "app_session";
      const sessionId = readCookie(request, cookieName);

      if (!sessionId) {
        return {
          status: 401,
          jsonBody: {
            success: false,
            message: "User is not authenticated."
          }
        };
      }

      const { fields, files } = await parseMultipartForm(request);
      const body = normalizePayload(fields.payload);
      const deletedIds = Array.isArray(body.deletedExistingAttachmentIds)
        ? body.deletedExistingAttachmentIds.map(x => Number(x)).filter(x => !Number.isNaN(x))
        : [];

      const required = [
        "incidentTypeCode",
        "incidentTypeName",
        "businessAreaCode",
        "businessAreaName",
        "incidentTitle",
        "incidentDescription",
        "incidentDateTime",
        "reportingDateTime",
        "levelOfIncidentCode",
        "levelOfIncidentName",
        "natureOfIncidentCode",
        "natureOfIncidentName",
        "incidentLocationCode",
        "incidentLocationName",
        "observedByCode",
        "observedByName",
        "reportedByEntryCode",
        "reportedByEntryName",
        "reportedToCode",
        "reportedToName",
        "responsibleDepartmentHeadCode",
        "responsibleDepartmentHeadName",
        "natureVolumeOfLoss",
        "contributingFactors",
        "rootCause",
        "immediateActionTaken",
        "auditorConclusion",
        "sceneClearanceWorkResume"
      ];

      for (const field of required) {
        if (!body?.[field]) {
          return {
            status: 400,
            jsonBody: {
              success: false,
              message: `${field} is required.`
            }
          };
        }
      }

      if (
        body.requiresImmediateAction &&
        (
          !body.immediateActionDepartmentCode ||
          !body.immediateActionDepartmentName ||
          !body.responsibleUserCode ||
          !body.responsibleUserName
        )
      ) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            message: "Immediate Action Department and Responsible User are required."
          }
        };
      }

      const allowedTypes = ["INCIDENT", "OBSERVATION", "NEAR_MISS", "FEEDBACK", "OTHER"];
      if (!allowedTypes.includes(body.incidentTypeCode)) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            message: "Invalid incident type."
          }
        };
      }

      const pool = await getPool();

      const authResult = await pool.request()
        .input("SessionID", sql.UniqueIdentifier, sessionId)
        .input("AppCode", sql.NVarChar(100), APP_CODE)
        .query(`
          SELECT TOP 1
              s.SessionID,
              s.ExpiresOn,
              s.IsRevoked,
              u.UserID,
              u.UserEmail,
              u.UserName,
              u.HoldingName,
              u.IsActive,
              u.IsDeleted,
              a.AppID,
              ua.AppRole,
              ua.IsManager,
              ua.IsSuperUser,
              ua.IsActive AS IsUserAppAccessActive
          FROM ${AUTH_SCHEMA}.UserSession s
          INNER JOIN ${AUTH_SCHEMA}.Users u
              ON s.UserID = u.UserID
          INNER JOIN ${AUTH_SCHEMA}.Applications a
              ON a.AppCode = @AppCode
             AND a.IsActive = 1
          INNER JOIN ${AUTH_SCHEMA}.UserAppAccess ua
              ON ua.UserID = u.UserID
             AND ua.AppID = a.AppID
          WHERE s.SessionID = @SessionID;
        `);

      if (authResult.recordset.length === 0) {
        return {
          status: 403,
          jsonBody: {
            success: false,
            message: "No app access found."
          }
        };
      }

      const user = authResult.recordset[0];

      if (
        user.IsRevoked ||
        !user.IsActive ||
        user.IsDeleted ||
        !user.IsUserAppAccessActive ||
        new Date(user.ExpiresOn) < new Date()
      ) {
        return {
          status: 401,
          jsonBody: {
            success: false,
            message: "Session expired, revoked, or access inactive."
          }
        };
      }

      const areaResult = await pool.request()
        .input("UserID", sql.Int, user.UserID)
        .input("AppID", sql.Int, user.AppID)
        .input("AreaCode", sql.NVarChar(100), body.businessAreaCode)
        .query(`
          SELECT TOP 1
              aa.AppAreaID,
              aa.AreaCode,
              aa.AreaName
          FROM ${AUTH_SCHEMA}.UserAppAreaAccess uaa
          INNER JOIN ${AUTH_SCHEMA}.AppAreas aa
              ON uaa.AppAreaID = aa.AppAreaID
          WHERE uaa.UserID = @UserID
            AND uaa.AppID = @AppID
            AND uaa.IsActive = 1
            AND aa.IsActive = 1
            AND aa.AreaCode = @AreaCode;
        `);

      if (areaResult.recordset.length === 0) {
        return {
          status: 403,
          jsonBody: {
            success: false,
            message: "User does not have access to the selected business area."
          }
        };
      }

      const isDraftPromotion = !!body.incidentId;
      let existingAttachmentCount = 0;
      let attachmentsToDeleteResult = { recordset: [] };

      if (isDraftPromotion) {
        const attachmentCountResult = await pool.request()
          .input("IncidentID", sql.BigInt, body.incidentId)
          .query(`
            SELECT COUNT(1) AS Cnt
            FROM ${APP_SCHEMA}.IncidentAttachment
            WHERE IncidentID = @IncidentID
              AND IsDeleted = 0;
          `);

        existingAttachmentCount = attachmentCountResult.recordset[0]?.Cnt || 0;

        if (deletedIds.length) {
          attachmentsToDeleteResult = await pool.request()
            .input("IncidentID", sql.BigInt, body.incidentId)
            .query(`
              SELECT
                  IncidentAttachmentID,
                  BlobPath
              FROM ${APP_SCHEMA}.IncidentAttachment
              WHERE IncidentID = ${Number(body.incidentId)}
                AND IsDeleted = 0
                AND IncidentAttachmentID IN (${deletedIds.join(",")});
            `);

          existingAttachmentCount = Math.max(
            0,
            existingAttachmentCount - attachmentsToDeleteResult.recordset.length
          );
        }
      }

      const fileValidation = validateFiles(files, existingAttachmentCount > 0);
      if (fileValidation) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            message: fileValidation
          }
        };
      }

      const tx = new sql.Transaction(pool);
      await tx.begin();

      try {
        let finalIncidentId = null;
        let finalIncidentNumber = null;

        if (isDraftPromotion) {
          const existingDraftResult = await new sql.Request(tx)
            .input("IncidentID", sql.BigInt, body.incidentId)
            .input("UserID", sql.Int, user.UserID)
            .query(`
              SELECT TOP 1
                  IncidentID,
                  IncidentNumber,
                  StatusCode
              FROM ${APP_SCHEMA}.IncidentHeader
              WHERE IncidentID = @IncidentID
                AND ReportedByUserID = @UserID
                AND IsDeleted = 0;
            `);

          if (existingDraftResult.recordset.length === 0) {
            throw new Error("Draft incident not found.");
          }

          const existingDraft = existingDraftResult.recordset[0];

          if (existingDraft.StatusCode !== "DRAFT") {
            throw new Error("Only draft incidents can be submitted from edit mode.");
          }

          await new sql.Request(tx)
            .input("IncidentID", sql.BigInt, body.incidentId)
            .input("IncidentType", sql.NVarChar(50), body.incidentTypeCode)
            .input("BusinessAreaCode", sql.NVarChar(100), body.businessAreaCode)
            .input("BusinessAreaName", sql.NVarChar(200), body.businessAreaName)
            .input("Title", sql.NVarChar(500), body.incidentTitle)
            .input("Description", sql.NVarChar(sql.MAX), body.incidentDescription)
            .input("IncidentDate", sql.Date, body.incidentDateTime.slice(0, 10))
            .input("IncidentDateTime", sql.DateTime2, body.incidentDateTime)
            .input("ReportingDateTime", sql.DateTime2, body.reportingDateTime)
            .input("LocationText", sql.NVarChar(500), body.incidentLocationName)
            .input("IncidentLocationCode", sql.NVarChar(100), body.incidentLocationCode)
            .input("IncidentLocationName", sql.NVarChar(200), body.incidentLocationName)
            .input("SeverityCode", sql.NVarChar(50), body.levelOfIncidentCode)
            .input("SeverityName", sql.NVarChar(100), body.levelOfIncidentName)
            .input("CategoryCode", sql.NVarChar(100), body.natureOfIncidentCode)
            .input("CategoryName", sql.NVarChar(200), body.natureOfIncidentName)
            .input("LevelOfIncidentCode", sql.NVarChar(100), body.levelOfIncidentCode)
            .input("LevelOfIncidentName", sql.NVarChar(200), body.levelOfIncidentName)
            .input("NatureOfIncidentCode", sql.NVarChar(100), body.natureOfIncidentCode)
            .input("NatureOfIncidentName", sql.NVarChar(200), body.natureOfIncidentName)
            .input("StatusCode", sql.NVarChar(50), "SUBMITTED")
            .input("StatusName", sql.NVarChar(100), "Submitted")
            .input("ReportedByEntryCode", sql.NVarChar(100), body.reportedByEntryCode)
            .input("ReportedByEntryName", sql.NVarChar(300), body.reportedByEntryName)
            .input("ObservedByCode", sql.NVarChar(100), body.observedByCode)
            .input("ObservedByName", sql.NVarChar(300), body.observedByName)
            .input("ReportedToCode", sql.NVarChar(100), body.reportedToCode)
            .input("ReportedToName", sql.NVarChar(300), body.reportedToName)
            .input("ResponsibleDepartmentHeadCode", sql.NVarChar(100), body.responsibleDepartmentHeadCode)
            .input("ResponsibleDepartmentHeadName", sql.NVarChar(300), body.responsibleDepartmentHeadName)
            .input("NatureVolumeOfLoss", sql.NVarChar(sql.MAX), body.natureVolumeOfLoss)
            .input("IncidentDescription", sql.NVarChar(sql.MAX), body.incidentDescription)
            .input("ContributingFactors", sql.NVarChar(sql.MAX), body.contributingFactors)
            .input("RootCause", sql.NVarChar(sql.MAX), body.rootCause)
            .input("ImmediateActionTaken", sql.NVarChar(sql.MAX), body.immediateActionTaken)
            .input("AuditorConclusion", sql.NVarChar(sql.MAX), body.auditorConclusion)
            .input("SceneClearanceWorkResume", sql.NVarChar(sql.MAX), body.sceneClearanceWorkResume)
            .input("RequiresImmediateAction", sql.Bit, body.requiresImmediateAction ? 1 : 0)
            .input("FurtherEscalationRequired", sql.Bit, body.furtherEscalationRequired ? 1 : 0)
            .input("ImmediateActionDepartmentCode", sql.NVarChar(100), body.immediateActionDepartmentCode || null)
            .input("ImmediateActionDepartmentName", sql.NVarChar(300), body.immediateActionDepartmentName || null)
            .input("ResponsibleUserCode", sql.NVarChar(100), body.responsibleUserCode || null)
            .input("ResponsibleUserName", sql.NVarChar(300), body.responsibleUserName || null)
            .input("SourceChannel", sql.NVarChar(50), "WEB")
            .input("UpdatedByUserID", sql.Int, user.UserID)
            .query(`
              UPDATE ${APP_SCHEMA}.IncidentHeader
              SET
                  IncidentType = @IncidentType,
                  BusinessAreaCode = @BusinessAreaCode,
                  BusinessAreaName = @BusinessAreaName,
                  Title = @Title,
                  Description = @Description,
                  IncidentDate = @IncidentDate,
                  IncidentDateTime = @IncidentDateTime,
                  ReportingDateTime = @ReportingDateTime,
                  LocationText = @LocationText,
                  IncidentLocationCode = @IncidentLocationCode,
                  IncidentLocationName = @IncidentLocationName,
                  SeverityCode = @SeverityCode,
                  SeverityName = @SeverityName,
                  CategoryCode = @CategoryCode,
                  CategoryName = @CategoryName,
                  LevelOfIncidentCode = @LevelOfIncidentCode,
                  LevelOfIncidentName = @LevelOfIncidentName,
                  NatureOfIncidentCode = @NatureOfIncidentCode,
                  NatureOfIncidentName = @NatureOfIncidentName,
                  StatusCode = @StatusCode,
                  StatusName = @StatusName,
                  ReportedByEntryCode = @ReportedByEntryCode,
                  ReportedByEntryName = @ReportedByEntryName,
                  ObservedByCode = @ObservedByCode,
                  ObservedByName = @ObservedByName,
                  ReportedToCode = @ReportedToCode,
                  ReportedToName = @ReportedToName,
                  ResponsibleDepartmentHeadCode = @ResponsibleDepartmentHeadCode,
                  ResponsibleDepartmentHeadName = @ResponsibleDepartmentHeadName,
                  NatureVolumeOfLoss = @NatureVolumeOfLoss,
                  IncidentDescription = @IncidentDescription,
                  ContributingFactors = @ContributingFactors,
                  RootCause = @RootCause,
                  ImmediateActionTaken = @ImmediateActionTaken,
                  AuditorConclusion = @AuditorConclusion,
                  SceneClearanceWorkResume = @SceneClearanceWorkResume,
                  RequiresImmediateAction = @RequiresImmediateAction,
                  FurtherEscalationRequired = @FurtherEscalationRequired,
                  ImmediateActionDepartmentCode = @ImmediateActionDepartmentCode,
                  ImmediateActionDepartmentName = @ImmediateActionDepartmentName,
                  ResponsibleUserCode = @ResponsibleUserCode,
                  ResponsibleUserName = @ResponsibleUserName,
                  SourceChannel = @SourceChannel,
                  UpdatedOn = SYSUTCDATETIME(),
                  UpdatedByUserID = @UpdatedByUserID
              WHERE IncidentID = @IncidentID;
            `);

          await new sql.Request(tx)
            .input("IncidentID", sql.BigInt, body.incidentId)
            .input("OldStatusCode", sql.NVarChar(50), "DRAFT")
            .input("OldStatusName", sql.NVarChar(100), "Draft")
            .input("NewStatusCode", sql.NVarChar(50), "SUBMITTED")
            .input("NewStatusName", sql.NVarChar(100), "Submitted")
            .input("ActionType", sql.NVarChar(50), "SUBMIT")
            .input("ActionRemarks", sql.NVarChar(2000), "Draft updated and submitted.")
            .input("ActionByUserID", sql.Int, user.UserID)
            .input("ActionByEmail", sql.NVarChar(1020), user.UserEmail)
            .input("ActionByName", sql.NVarChar(300), user.UserName)
            .query(`
              INSERT INTO ${APP_SCHEMA}.IncidentStatusLog
              (
                  IncidentID,
                  OldStatusCode,
                  OldStatusName,
                  NewStatusCode,
                  NewStatusName,
                  ActionType,
                  ActionRemarks,
                  ActionByUserID,
                  ActionByEmail,
                  ActionByName
              )
              VALUES
              (
                  @IncidentID,
                  @OldStatusCode,
                  @OldStatusName,
                  @NewStatusCode,
                  @NewStatusName,
                  @ActionType,
                  @ActionRemarks,
                  @ActionByUserID,
                  @ActionByEmail,
                  @ActionByName
              );
            `);

          if (deletedIds.length) {
            await new sql.Request(tx)
              .query(`
                UPDATE ${APP_SCHEMA}.IncidentAttachment
                SET
                    IsDeleted = 1
                WHERE IncidentID = ${Number(body.incidentId)}
                  AND IsDeleted = 0
                  AND IncidentAttachmentID IN (${deletedIds.join(",")});
              `);
          }

          await upsertPendingActionForSubmittedDraft(
            tx,
            body.incidentId,
            existingDraft.IncidentNumber,
            body,
            user
          );

          finalIncidentId = body.incidentId;
          finalIncidentNumber = existingDraft.IncidentNumber;
        } else {
          const incidentNumber = buildIncidentNumber();

          const insertResult = await new sql.Request(tx)
            .input("IncidentNumber", sql.NVarChar(50), incidentNumber)
            .input("IncidentType", sql.NVarChar(50), body.incidentTypeCode)
            .input("BusinessAreaCode", sql.NVarChar(100), body.businessAreaCode)
            .input("BusinessAreaName", sql.NVarChar(200), body.businessAreaName)
            .input("Title", sql.NVarChar(500), body.incidentTitle)
            .input("Description", sql.NVarChar(sql.MAX), body.incidentDescription)
            .input("IncidentDate", sql.Date, body.incidentDateTime.slice(0, 10))
            .input("IncidentDateTime", sql.DateTime2, body.incidentDateTime)
            .input("ReportingDateTime", sql.DateTime2, body.reportingDateTime)
            .input("LocationText", sql.NVarChar(500), body.incidentLocationName)
            .input("IncidentLocationCode", sql.NVarChar(100), body.incidentLocationCode)
            .input("IncidentLocationName", sql.NVarChar(200), body.incidentLocationName)
            .input("SeverityCode", sql.NVarChar(50), body.levelOfIncidentCode)
            .input("SeverityName", sql.NVarChar(100), body.levelOfIncidentName)
            .input("CategoryCode", sql.NVarChar(100), body.natureOfIncidentCode)
            .input("CategoryName", sql.NVarChar(200), body.natureOfIncidentName)
            .input("LevelOfIncidentCode", sql.NVarChar(100), body.levelOfIncidentCode)
            .input("LevelOfIncidentName", sql.NVarChar(200), body.levelOfIncidentName)
            .input("NatureOfIncidentCode", sql.NVarChar(100), body.natureOfIncidentCode)
            .input("NatureOfIncidentName", sql.NVarChar(200), body.natureOfIncidentName)
            .input("StatusCode", sql.NVarChar(50), "SUBMITTED")
            .input("StatusName", sql.NVarChar(100), "Submitted")
            .input("ReportedByUserID", sql.Int, user.UserID)
            .input("ReportedByEmail", sql.NVarChar(1020), user.UserEmail)
            .input("ReportedByName", sql.NVarChar(300), user.UserName)
            .input("ReportedByEntryCode", sql.NVarChar(100), body.reportedByEntryCode)
            .input("ReportedByEntryName", sql.NVarChar(300), body.reportedByEntryName)
            .input("ObservedByCode", sql.NVarChar(100), body.observedByCode)
            .input("ObservedByName", sql.NVarChar(300), body.observedByName)
            .input("ReportedToCode", sql.NVarChar(100), body.reportedToCode)
            .input("ReportedToName", sql.NVarChar(300), body.reportedToName)
            .input("ResponsibleDepartmentHeadCode", sql.NVarChar(100), body.responsibleDepartmentHeadCode)
            .input("ResponsibleDepartmentHeadName", sql.NVarChar(300), body.responsibleDepartmentHeadName)
            .input("NatureVolumeOfLoss", sql.NVarChar(sql.MAX), body.natureVolumeOfLoss)
            .input("IncidentDescription", sql.NVarChar(sql.MAX), body.incidentDescription)
            .input("ContributingFactors", sql.NVarChar(sql.MAX), body.contributingFactors)
            .input("RootCause", sql.NVarChar(sql.MAX), body.rootCause)
            .input("ImmediateActionTaken", sql.NVarChar(sql.MAX), body.immediateActionTaken)
            .input("AuditorConclusion", sql.NVarChar(sql.MAX), body.auditorConclusion)
            .input("SceneClearanceWorkResume", sql.NVarChar(sql.MAX), body.sceneClearanceWorkResume)
            .input("RequiresImmediateAction", sql.Bit, body.requiresImmediateAction ? 1 : 0)
            .input("FurtherEscalationRequired", sql.Bit, body.furtherEscalationRequired ? 1 : 0)
            .input("ImmediateActionDepartmentCode", sql.NVarChar(100), body.immediateActionDepartmentCode || null)
            .input("ImmediateActionDepartmentName", sql.NVarChar(300), body.immediateActionDepartmentName || null)
            .input("ResponsibleUserCode", sql.NVarChar(100), body.responsibleUserCode || null)
            .input("ResponsibleUserName", sql.NVarChar(300), body.responsibleUserName || null)
            .input("SourceChannel", sql.NVarChar(50), "WEB")
            .input("CreatedByUserID", sql.Int, user.UserID)
            .query(`
              INSERT INTO ${APP_SCHEMA}.IncidentHeader
              (
                  IncidentNumber,
                  IncidentType,
                  BusinessAreaCode,
                  BusinessAreaName,
                  Title,
                  Description,
                  IncidentDate,
                  IncidentDateTime,
                  ReportingDateTime,
                  LocationText,
                  IncidentLocationCode,
                  IncidentLocationName,
                  SeverityCode,
                  SeverityName,
                  CategoryCode,
                  CategoryName,
                  LevelOfIncidentCode,
                  LevelOfIncidentName,
                  NatureOfIncidentCode,
                  NatureOfIncidentName,
                  StatusCode,
                  StatusName,
                  ReportedByUserID,
                  ReportedByEmail,
                  ReportedByName,
                  ReportedByEntryCode,
                  ReportedByEntryName,
                  ObservedByCode,
                  ObservedByName,
                  ReportedToCode,
                  ReportedToName,
                  ResponsibleDepartmentHeadCode,
                  ResponsibleDepartmentHeadName,
                  NatureVolumeOfLoss,
                  IncidentDescription,
                  ContributingFactors,
                  RootCause,
                  ImmediateActionTaken,
                  AuditorConclusion,
                  SceneClearanceWorkResume,
                  RequiresImmediateAction,
                  FurtherEscalationRequired,
                  ImmediateActionDepartmentCode,
                  ImmediateActionDepartmentName,
                  ResponsibleUserCode,
                  ResponsibleUserName,
                  SourceChannel,
                  CreatedByUserID
              )
              OUTPUT INSERTED.IncidentID, INSERTED.IncidentNumber
              VALUES
              (
                  @IncidentNumber,
                  @IncidentType,
                  @BusinessAreaCode,
                  @BusinessAreaName,
                  @Title,
                  @Description,
                  @IncidentDate,
                  @IncidentDateTime,
                  @ReportingDateTime,
                  @LocationText,
                  @IncidentLocationCode,
                  @IncidentLocationName,
                  @SeverityCode,
                  @SeverityName,
                  @CategoryCode,
                  @CategoryName,
                  @LevelOfIncidentCode,
                  @LevelOfIncidentName,
                  @NatureOfIncidentCode,
                  @NatureOfIncidentName,
                  @StatusCode,
                  @StatusName,
                  @ReportedByUserID,
                  @ReportedByEmail,
                  @ReportedByName,
                  @ReportedByEntryCode,
                  @ReportedByEntryName,
                  @ObservedByCode,
                  @ObservedByName,
                  @ReportedToCode,
                  @ReportedToName,
                  @ResponsibleDepartmentHeadCode,
                  @ResponsibleDepartmentHeadName,
                  @NatureVolumeOfLoss,
                  @IncidentDescription,
                  @ContributingFactors,
                  @RootCause,
                  @ImmediateActionTaken,
                  @AuditorConclusion,
                  @SceneClearanceWorkResume,
                  @RequiresImmediateAction,
                  @FurtherEscalationRequired,
                  @ImmediateActionDepartmentCode,
                  @ImmediateActionDepartmentName,
                  @ResponsibleUserCode,
                  @ResponsibleUserName,
                  @SourceChannel,
                  @CreatedByUserID
              );
            `);

          const inserted = insertResult.recordset[0];

          await new sql.Request(tx)
            .input("IncidentID", sql.BigInt, inserted.IncidentID)
            .input("OldStatusCode", sql.NVarChar(50), null)
            .input("OldStatusName", sql.NVarChar(100), null)
            .input("NewStatusCode", sql.NVarChar(50), "SUBMITTED")
            .input("NewStatusName", sql.NVarChar(100), "Submitted")
            .input("ActionType", sql.NVarChar(50), "CREATE")
            .input("ActionRemarks", sql.NVarChar(2000), "Incident created and submitted.")
            .input("ActionByUserID", sql.Int, user.UserID)
            .input("ActionByEmail", sql.NVarChar(1020), user.UserEmail)
            .input("ActionByName", sql.NVarChar(300), user.UserName)
            .query(`
              INSERT INTO ${APP_SCHEMA}.IncidentStatusLog
              (
                  IncidentID,
                  OldStatusCode,
                  OldStatusName,
                  NewStatusCode,
                  NewStatusName,
                  ActionType,
                  ActionRemarks,
                  ActionByUserID,
                  ActionByEmail,
                  ActionByName
              )
              VALUES
              (
                  @IncidentID,
                  @OldStatusCode,
                  @OldStatusName,
                  @NewStatusCode,
                  @NewStatusName,
                  @ActionType,
                  @ActionRemarks,
                  @ActionByUserID,
                  @ActionByEmail,
                  @ActionByName
              );
            `);

          if (body.requiresImmediateAction) {
            await insertPendingAction(tx, inserted, body, user);
          }

          finalIncidentId = inserted.IncidentID;
          finalIncidentNumber = inserted.IncidentNumber;
        }

        await insertAttachments(tx, finalIncidentId, finalIncidentNumber, files, user);

        await tx.commit();

        for (const row of attachmentsToDeleteResult.recordset || []) {
          try {
            await deleteBlobIfExists(row.BlobPath);
          } catch (blobDeleteError) {
            context.log("delete blob warning", blobDeleteError);
          }
        }

        await pool.request()
          .input("SessionID", sql.UniqueIdentifier, sessionId)
          .query(`
            UPDATE ${AUTH_SCHEMA}.UserSession
            SET LastAccessOn = SYSUTCDATETIME()
            WHERE SessionID = @SessionID;
          `);

        return {
          status: 200,
          jsonBody: {
            success: true,
            message: "Incident submitted successfully.",
            data: {
              IncidentID: finalIncidentId,
              IncidentNumber: finalIncidentNumber
            }
          }
        };
      } catch (innerError) {
        await tx.rollback();
        throw innerError;
      }
    } catch (error) {
      context.log("submitIncident error", error);

      return {
        status: 500,
        jsonBody: {
          success: false,
          message: error.message || "Internal server error."
        }
      };
    }
  }
});
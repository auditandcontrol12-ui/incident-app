const { app } = require("@azure/functions");
const Busboy = require("busboy");
const path = require("path");
const { getPool, sql } = require("../shared/db");
const { readCookie } = require("../shared/session");
const { AUTH_SCHEMA, APP_SCHEMA, APP_CODE } = require("../shared/config");
const { buildBlobPath, uploadBufferToBlob, deleteBlobIfExists } = require("../shared/blob");

async function parseMultipartForm(request) {
  const contentType = request.headers.get("content-type") || "";

  return new Promise(async (resolve, reject) => {
    try {
      const busboy = Busboy({
        headers: { "content-type": contentType }
      });

      const fields = {};
      const files = [];

      busboy.on("field", (name, value) => {
        fields[name] = value;
      });

      busboy.on("file", (name, file, info) => {
        const chunks = [];
        const { filename, mimeType } = info || {};

        file.on("data", chunk => chunks.push(chunk));
        file.on("end", () => {
          files.push({
            fieldName: name,
            filename,
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

function getAttachmentType(mimeType = "") {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) return "IMAGE";
  return "OTHER";
}

function validateFiles(files) {
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

  if (!files || files.length === 0) return null;
  if (files.length > maxFiles) return "Maximum 5 files allowed.";

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

app.http("updateIncidentDraft", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    try {
      const cookieName = process.env.SESSION_COOKIE_NAME || "app_session";
      const sessionId = readCookie(request, cookieName);

      if (!sessionId) {
        return {
          status: 401,
          jsonBody: { success: false, message: "User is not authenticated." }
        };
      }

      const { fields, files } = await parseMultipartForm(request);
      const body = normalizePayload(fields.payload);
      const deletedIds = Array.isArray(body.deletedExistingAttachmentIds)
        ? body.deletedExistingAttachmentIds.map(x => Number(x)).filter(x => !Number.isNaN(x))
        : [];

      if (!body.incidentId) {
        return {
          status: 400,
          jsonBody: { success: false, message: "incidentId is required." }
        };
      }

      const fileValidation = validateFiles(files);
      if (fileValidation) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            message: fileValidation
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
              u.IsActive,
              u.IsDeleted,
              a.AppID,
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
          jsonBody: { success: false, message: "No app access found." }
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
          jsonBody: { success: false, message: "Session expired, revoked, or access inactive." }
        };
      }

      const existingResult = await pool.request()
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

      if (existingResult.recordset.length === 0) {
        return {
          status: 404,
          jsonBody: { success: false, message: "Draft not found." }
        };
      }

      const existing = existingResult.recordset[0];

      if (existing.StatusCode !== "DRAFT") {
        return {
          status: 400,
          jsonBody: { success: false, message: "Only draft incidents can be updated." }
        };
      }

      const attachmentsToDeleteResult = deletedIds.length
        ? await pool.request()
            .input("IncidentID", sql.BigInt, body.incidentId)
            .query(`
              SELECT
                  IncidentAttachmentID,
                  BlobPath
              FROM ${APP_SCHEMA}.IncidentAttachment
              WHERE IncidentID = ${Number(body.incidentId)}
                AND IsDeleted = 0
                AND IncidentAttachmentID IN (${deletedIds.join(",")});
            `)
        : { recordset: [] };

      const tx = new sql.Transaction(pool);
      await tx.begin();

      try {
        await new sql.Request(tx)
          .input("IncidentID", sql.BigInt, body.incidentId)
          .input("IncidentType", sql.NVarChar(50), body.incidentTypeCode || "INCIDENT")
          .input("BusinessAreaCode", sql.NVarChar(100), body.businessAreaCode || "")
          .input("BusinessAreaName", sql.NVarChar(200), body.businessAreaName || "")
          .input("Title", sql.NVarChar(500), body.incidentTitle || "Draft Incident")
          .input("Description", sql.NVarChar(sql.MAX), body.incidentDescription || "")
          .input("IncidentDate", sql.Date, (body.incidentDateTime || new Date().toISOString()).slice(0, 10))
          .input("IncidentDateTime", sql.DateTime2, body.incidentDateTime || null)
          .input("ReportingDateTime", sql.DateTime2, body.reportingDateTime || null)
          .input("LocationText", sql.NVarChar(500), body.incidentLocationName || null)
          .input("IncidentLocationCode", sql.NVarChar(100), body.incidentLocationCode || null)
          .input("IncidentLocationName", sql.NVarChar(200), body.incidentLocationName || null)
          .input("SeverityCode", sql.NVarChar(50), body.levelOfIncidentCode || "LOW")
          .input("SeverityName", sql.NVarChar(100), body.levelOfIncidentName || "Low")
          .input("CategoryCode", sql.NVarChar(100), body.natureOfIncidentCode || "OTHER")
          .input("CategoryName", sql.NVarChar(200), body.natureOfIncidentName || "Other")
          .input("LevelOfIncidentCode", sql.NVarChar(100), body.levelOfIncidentCode || null)
          .input("LevelOfIncidentName", sql.NVarChar(200), body.levelOfIncidentName || null)
          .input("NatureOfIncidentCode", sql.NVarChar(100), body.natureOfIncidentCode || null)
          .input("NatureOfIncidentName", sql.NVarChar(200), body.natureOfIncidentName || null)
          .input("ReportedByEntryCode", sql.NVarChar(100), body.reportedByEntryCode || null)
          .input("ReportedByEntryName", sql.NVarChar(300), body.reportedByEntryName || null)
          .input("ObservedByCode", sql.NVarChar(100), body.observedByCode || null)
          .input("ObservedByName", sql.NVarChar(300), body.observedByName || null)
          .input("ReportedToCode", sql.NVarChar(100), body.reportedToCode || null)
          .input("ReportedToName", sql.NVarChar(300), body.reportedToName || null)
          .input("ResponsibleDepartmentHeadCode", sql.NVarChar(100), body.responsibleDepartmentHeadCode || null)
          .input("ResponsibleDepartmentHeadName", sql.NVarChar(300), body.responsibleDepartmentHeadName || null)
          .input("NatureVolumeOfLoss", sql.NVarChar(sql.MAX), body.natureVolumeOfLoss || null)
          .input("IncidentDescription", sql.NVarChar(sql.MAX), body.incidentDescription || null)
          .input("ContributingFactors", sql.NVarChar(sql.MAX), body.contributingFactors || null)
          .input("RootCause", sql.NVarChar(sql.MAX), body.rootCause || null)
          .input("ImmediateActionTaken", sql.NVarChar(sql.MAX), body.immediateActionTaken || null)
          .input("AuditorConclusion", sql.NVarChar(sql.MAX), body.auditorConclusion || null)
          .input("SceneClearanceWorkResume", sql.NVarChar(sql.MAX), body.sceneClearanceWorkResume || null)
          .input("RequiresImmediateAction", sql.Bit, body.requiresImmediateAction ? 1 : 0)
          .input("FurtherEscalationRequired", sql.Bit, body.furtherEscalationRequired ? 1 : 0)
          .input("ImmediateActionDepartmentCode", sql.NVarChar(100), body.immediateActionDepartmentCode || null)
          .input("ImmediateActionDepartmentName", sql.NVarChar(300), body.immediateActionDepartmentName || null)
          .input("ResponsibleUserCode", sql.NVarChar(100), body.responsibleUserCode || null)
          .input("ResponsibleUserName", sql.NVarChar(300), body.responsibleUserName || null)
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
                UpdatedOn = SYSUTCDATETIME(),
                UpdatedByUserID = @UpdatedByUserID
            WHERE IncidentID = @IncidentID;
          `);

        await new sql.Request(tx)
          .input("IncidentID", sql.BigInt, body.incidentId)
          .input("OldStatusCode", sql.NVarChar(50), "DRAFT")
          .input("OldStatusName", sql.NVarChar(100), "Draft")
          .input("NewStatusCode", sql.NVarChar(50), "DRAFT")
          .input("NewStatusName", sql.NVarChar(100), "Draft")
          .input("ActionType", sql.NVarChar(50), "UPDATE")
          .input("ActionRemarks", sql.NVarChar(2000), "Draft updated.")
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
            .input("IncidentID", sql.BigInt, body.incidentId)
            .input("UpdatedByUserID", sql.Int, user.UserID)
            .query(`
              UPDATE ${APP_SCHEMA}.IncidentAttachment
              SET
                  IsDeleted = 1
              WHERE IncidentID = ${Number(body.incidentId)}
                AND IsDeleted = 0
                AND IncidentAttachmentID IN (${deletedIds.join(",")});
            `);
        }

        for (const file of files) {
          const blobPath = buildBlobPath({
            incidentNumber: existing.IncidentNumber,
            fileName: file.filename
          });

          const uploadResult = await uploadBufferToBlob({
            buffer: file.buffer,
            blobPath,
            contentType: file.mimeType
          });

          const ext = path.extname(file.filename || "").replace(".", "").toUpperCase();

          await new sql.Request(tx)
            .input("IncidentID", sql.BigInt, body.incidentId)
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

        await tx.commit();

        for (const row of attachmentsToDeleteResult.recordset || []) {
          try {
            await deleteBlobIfExists(row.BlobPath);
          } catch (blobDeleteError) {
            context.log("delete blob warning", blobDeleteError);
          }
        }

        return {
          status: 200,
          jsonBody: {
            success: true,
            message: "Draft updated successfully.",
            data: {
              IncidentID: existing.IncidentID,
              IncidentNumber: existing.IncidentNumber
            }
          }
        };
      } catch (innerError) {
        await tx.rollback();
        throw innerError;
      }
    } catch (error) {
      context.log("updateIncidentDraft error", error);
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
const { app } = require("@azure/functions");
const { getPool, sql } = require("../shared/db");
const { readCookie } = require("../shared/session");
const { AUTH_SCHEMA, APP_SCHEMA, APP_CODE } = require("../shared/config");

app.http("getIncident", {
  methods: ["GET"],
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

      const incidentId = parseInt(request.query.get("id"), 10);

      if (!incidentId || Number.isNaN(incidentId)) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            message: "Valid incident id is required."
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
              u.IsActive,
              u.IsDeleted,
              a.AppID,
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

      const headerResult = await pool.request()
        .input("IncidentID", sql.BigInt, incidentId)
        .input("UserID", sql.Int, user.UserID)
        .input("CanViewAll", sql.Bit, user.IsManager || user.IsSuperUser ? 1 : 0)
        .query(`
          SELECT TOP 1
              IncidentID,
              IncidentNumber,
              IncidentType,
              BusinessAreaCode,
              BusinessAreaName,
              Title,
              Description,
              IncidentDateTime,
              ReportingDateTime,
              IncidentLocationCode,
              IncidentLocationName,
              ObservedByCode,
              ObservedByName,
              ReportedByEntryCode,
              ReportedByEntryName,
              ReportedToCode,
              ReportedToName,
              LevelOfIncidentCode,
              LevelOfIncidentName,
              NatureOfIncidentCode,
              NatureOfIncidentName,
              NatureVolumeOfLoss,
              IncidentDescription,
              ContributingFactors,
              RootCause,
              ImmediateActionTaken,
              AuditorConclusion,
              SceneClearanceWorkResume,
              RequiresImmediateAction,
              FurtherEscalationRequired,
              ResponsibleDepartmentHeadCode,
              ResponsibleDepartmentHeadName,
              ImmediateActionDepartmentCode,
              ImmediateActionDepartmentName,
              ResponsibleUserCode,
              ResponsibleUserName,
              StatusCode,
              StatusName,
              ReportedByUserID,
              ReportedByEmail,
              ReportedByName,
              CreatedOn,
              UpdatedOn
          FROM ${APP_SCHEMA}.IncidentHeader
          WHERE IncidentID = @IncidentID
            AND IsDeleted = 0
            AND (
                @CanViewAll = 1
                OR ReportedByUserID = @UserID
            );
        `);

      if (headerResult.recordset.length === 0) {
        return {
          status: 404,
          jsonBody: {
            success: false,
            message: "Incident not found or not accessible."
          }
        };
      }

      const attachmentResult = await pool.request()
        .input("IncidentID", sql.BigInt, incidentId)
        .query(`
          SELECT
              IncidentAttachmentID,
              FileName,
              FileOriginalName,
              FileExtension,
              ContentType,
              FileSizeKB,
              BlobPath,
              BlobUrl,
              AttachmentType,
              CONVERT(VARCHAR(19), UploadedOn, 120) AS UploadedOn
          FROM ${APP_SCHEMA}.IncidentAttachment
          WHERE IncidentID = @IncidentID
            AND IsDeleted = 0
          ORDER BY UploadedOn ASC;
        `);

      const commentsResult = await pool.request()
        .input("IncidentID", sql.BigInt, incidentId)
        .query(`
          SELECT
              CommentType,
              CommentText,
              CommentByName,
              CONVERT(VARCHAR(19), CreatedOn, 120) AS CreatedOn
          FROM ${APP_SCHEMA}.IncidentComment
          WHERE IncidentID = @IncidentID
            AND IsDeleted = 0
          ORDER BY CreatedOn DESC;
        `);

      const statusLogResult = await pool.request()
        .input("IncidentID", sql.BigInt, incidentId)
        .query(`
          SELECT
              CONVERT(VARCHAR(19), ActionOn, 120) AS ActionOn,
              ActionType,
              OldStatusName,
              NewStatusName,
              ActionByName,
              ActionRemarks
          FROM ${APP_SCHEMA}.IncidentStatusLog
          WHERE IncidentID = @IncidentID
          ORDER BY ActionOn DESC;
        `);

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
          data: {
            header: headerResult.recordset[0],
            attachments: attachmentResult.recordset || [],
            comments: commentsResult.recordset || [],
            statusLog: statusLogResult.recordset || []
          }
        }
      };
    } catch (error) {
      context.log("getIncident error", error);

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
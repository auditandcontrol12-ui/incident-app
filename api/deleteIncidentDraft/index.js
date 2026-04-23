const { app } = require("@azure/functions");
const { getPool, sql } = require("../shared/db");
const { readCookie } = require("../shared/session");
const { AUTH_SCHEMA, APP_SCHEMA, APP_CODE } = require("../shared/config");
const { deleteBlobIfExists } = require("../shared/blob");

app.http("deleteIncidentDraft", {
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

      const body = await request.json();
      const incidentId = Number(body?.incidentId);

      if (!incidentId || Number.isNaN(incidentId)) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            message: "Valid incidentId is required."
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

      const incidentResult = await pool.request()
        .input("IncidentID", sql.BigInt, incidentId)
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

      if (incidentResult.recordset.length === 0) {
        return {
          status: 404,
          jsonBody: {
            success: false,
            message: "Draft not found."
          }
        };
      }

      const incident = incidentResult.recordset[0];

      if (incident.StatusCode !== "DRAFT") {
        return {
          status: 400,
          jsonBody: {
            success: false,
            message: "Only drafts can be deleted."
          }
        };
      }

      const attachmentsResult = await pool.request()
        .input("IncidentID", sql.BigInt, incidentId)
        .query(`
          SELECT
              IncidentAttachmentID,
              BlobPath
          FROM ${APP_SCHEMA}.IncidentAttachment
          WHERE IncidentID = @IncidentID
            AND IsDeleted = 0;
        `);

      const tx = new sql.Transaction(pool);
      await tx.begin();

      try {
        await new sql.Request(tx)
          .input("IncidentID", sql.BigInt, incidentId)
          .input("UpdatedByUserID", sql.Int, user.UserID)
          .query(`
            UPDATE ${APP_SCHEMA}.IncidentHeader
            SET
                IsDeleted = 1,
                UpdatedOn = SYSUTCDATETIME(),
                UpdatedByUserID = @UpdatedByUserID
            WHERE IncidentID = @IncidentID;
          `);

        await new sql.Request(tx)
          .input("IncidentID", sql.BigInt, incidentId)
          .query(`
            UPDATE ${APP_SCHEMA}.IncidentAttachment
            SET
                IsDeleted = 1
            WHERE IncidentID = @IncidentID
              AND IsDeleted = 0;
          `);

        await new sql.Request(tx)
          .input("IncidentID", sql.BigInt, incidentId)
          .input("OldStatusCode", sql.NVarChar(50), "DRAFT")
          .input("OldStatusName", sql.NVarChar(100), "Draft")
          .input("NewStatusCode", sql.NVarChar(50), "DELETED")
          .input("NewStatusName", sql.NVarChar(100), "Deleted")
          .input("ActionType", sql.NVarChar(50), "DELETE")
          .input("ActionRemarks", sql.NVarChar(2000), "Draft deleted by owner.")
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

        await tx.commit();

        for (const row of attachmentsResult.recordset || []) {
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
            message: "Draft deleted successfully."
          }
        };
      } catch (innerError) {
        await tx.rollback();
        throw innerError;
      }
    } catch (error) {
      context.log("deleteIncidentDraft error", error);

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
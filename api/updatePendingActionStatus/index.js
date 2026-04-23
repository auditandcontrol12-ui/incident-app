const { app } = require("@azure/functions");
const { getPool, sql } = require("../shared/db");
const { readCookie } = require("../shared/session");
const { AUTH_SCHEMA, APP_SCHEMA, APP_CODE } = require("../shared/config");

function getStatusName(statusCode) {
  switch ((statusCode || "").toUpperCase()) {
    case "OPEN": return "Open";
    case "IN_PROGRESS": return "In Progress";
    case "COMPLETED": return "Completed";
    case "CANCELLED": return "Cancelled";
    default: return statusCode || "";
  }
}

app.http("updatePendingActionStatus", {
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

      const body = await request.json();
      const incidentPendingActionId = Number(body?.incidentPendingActionId);
      const newStatusCode = String(body?.newStatusCode || "").toUpperCase();

      if (!incidentPendingActionId || Number.isNaN(incidentPendingActionId)) {
        return {
          status: 400,
          jsonBody: { success: false, message: "Valid incidentPendingActionId is required." }
        };
      }

      if (!["IN_PROGRESS", "COMPLETED"].includes(newStatusCode)) {
        return {
          status: 400,
          jsonBody: { success: false, message: "Invalid new status." }
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

      const actionResult = await pool.request()
        .input("IncidentPendingActionID", sql.BigInt, incidentPendingActionId)
        .input("AssignedUserCode", sql.NVarChar(100), String(user.UserID))
        .query(`
          SELECT TOP 1
              pa.IncidentPendingActionID,
              pa.IncidentID,
              pa.PendingActionStatusCode,
              pa.PendingActionStatusName
          FROM ${APP_SCHEMA}.IncidentPendingAction pa
          WHERE pa.IncidentPendingActionID = @IncidentPendingActionID
            AND pa.IsDeleted = 0
            AND pa.AssignedUserCode = @AssignedUserCode;
        `);

      if (actionResult.recordset.length === 0) {
        return {
          status: 404,
          jsonBody: { success: false, message: "Pending action not found." }
        };
      }

      const existing = actionResult.recordset[0];
      const oldStatusCode = existing.PendingActionStatusCode;
      const oldStatusName = existing.PendingActionStatusName;
      const newStatusName = getStatusName(newStatusCode);

      const tx = new sql.Transaction(pool);
      await tx.begin();

      try {
        await new sql.Request(tx)
          .input("IncidentPendingActionID", sql.BigInt, incidentPendingActionId)
          .input("PendingActionStatusCode", sql.NVarChar(50), newStatusCode)
          .input("PendingActionStatusName", sql.NVarChar(100), newStatusName)
          .input("UpdatedByUserID", sql.Int, user.UserID)
          .query(`
            UPDATE ${APP_SCHEMA}.IncidentPendingAction
            SET
                PendingActionStatusCode = @PendingActionStatusCode,
                PendingActionStatusName = @PendingActionStatusName,
                AcceptedOn = CASE WHEN @PendingActionStatusCode = 'IN_PROGRESS' AND AcceptedOn IS NULL THEN SYSUTCDATETIME() ELSE AcceptedOn END,
                CompletedOn = CASE WHEN @PendingActionStatusCode = 'COMPLETED' THEN SYSUTCDATETIME() ELSE CompletedOn END,
                UpdatedOn = SYSUTCDATETIME(),
                UpdatedByUserID = @UpdatedByUserID
            WHERE IncidentPendingActionID = @IncidentPendingActionID;
          `);

        await new sql.Request(tx)
          .input("IncidentID", sql.BigInt, existing.IncidentID)
          .input("OldStatusCode", sql.NVarChar(50), oldStatusCode)
          .input("OldStatusName", sql.NVarChar(100), oldStatusName)
          .input("NewStatusCode", sql.NVarChar(50), newStatusCode)
          .input("NewStatusName", sql.NVarChar(100), newStatusName)
          .input("ActionType", sql.NVarChar(50), "ACTION")
          .input("ActionRemarks", sql.NVarChar(2000), `Pending action status updated to ${newStatusName}.`)
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
            message: "Pending action status updated successfully."
          }
        };
      } catch (innerError) {
        await tx.rollback();
        throw innerError;
      }
    } catch (error) {
      context.log("updatePendingActionStatus error", error);
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
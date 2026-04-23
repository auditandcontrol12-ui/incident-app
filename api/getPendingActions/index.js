const { app } = require("@azure/functions");
const { getPool, sql } = require("../shared/db");
const { readCookie } = require("../shared/session");
const { AUTH_SCHEMA, APP_SCHEMA, APP_CODE } = require("../shared/config");

app.http("getPendingActions", {
  methods: ["GET"],
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

      const statusParam = (request.query.get("status") || "").trim();
      const statuses = statusParam && statusParam !== "ALL"
        ? statusParam.split(",").map(x => x.trim()).filter(Boolean)
        : [];

      const allowedStatuses = ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
      const filteredStatuses = statuses.filter(x => allowedStatuses.includes(x));

      const statusFilterSql = filteredStatuses.length
        ? `AND pa.PendingActionStatusCode IN (${filteredStatuses.map(s => `'${s}'`).join(",")})`
        : "";

      const result = await pool.request()
        .input("AssignedUserCode", sql.NVarChar(100), String(user.UserID))
        .query(`
          SELECT
              pa.IncidentPendingActionID,
              pa.IncidentID,
              pa.IncidentNumber,
              ih.BusinessAreaName,
              ih.Title AS IncidentTitle,
              pa.ActionTypeCode,
              pa.ActionTypeName,
              pa.AssignedDepartmentCode,
              pa.AssignedDepartmentName,
              pa.AssignedUserCode,
              pa.AssignedUserName,
              pa.PendingActionStatusCode,
              pa.PendingActionStatusName,
              CONVERT(VARCHAR(19), pa.CreatedOn, 120) AS CreatedOn
          FROM ${APP_SCHEMA}.IncidentPendingAction pa
          INNER JOIN ${APP_SCHEMA}.IncidentHeader ih
              ON pa.IncidentID = ih.IncidentID
          WHERE pa.IsDeleted = 0
            AND ih.IsDeleted = 0
            AND pa.AssignedUserCode = @AssignedUserCode
            ${statusFilterSql}
          ORDER BY pa.CreatedOn DESC;
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
          data: result.recordset || []
        }
      };
    } catch (error) {
      context.log("getPendingActions error", error);
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
const { app } = require("@azure/functions");
const { getPool, sql } = require("../shared/db");
const { readCookie } = require("../shared/session");
const { AUTH_SCHEMA, APP_SCHEMA, APP_CODE } = require("../shared/config");

app.http("getTeamReports", {
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

      const type = (request.query.get("type") || "").trim();
      const status = (request.query.get("status") || "").trim();
      const area = (request.query.get("area") || "").trim();

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

      if (!user.IsManager && !user.IsSuperUser) {
        return {
          status: 403,
          jsonBody: {
            success: false,
            message: "You are not allowed to view team reports."
          }
        };
      }

      const result = await pool.request()
        .input("IncidentType", sql.NVarChar(50), type || null)
        .input("StatusCode", sql.NVarChar(50), status || null)
        .input("AreaCode", sql.NVarChar(100), area || null)
        .query(`
          SELECT
              IncidentID,
              IncidentNumber,
              IncidentType,
              BusinessAreaCode,
              BusinessAreaName,
              Title,
              ReportedByName,
              SeverityName,
              StatusName,
              CONVERT(VARCHAR(19), CreatedOn, 120) AS CreatedOn
          FROM ${APP_SCHEMA}.IncidentHeader
          WHERE IsDeleted = 0
            AND (@IncidentType IS NULL OR IncidentType = @IncidentType)
            AND (@StatusCode IS NULL OR StatusCode = @StatusCode)
            AND (@AreaCode IS NULL OR BusinessAreaCode = @AreaCode)
          ORDER BY CreatedOn DESC;
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
      context.log("getTeamReports error", error);

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
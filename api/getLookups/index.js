const { app } = require("@azure/functions");
const { getPool, sql } = require("../shared/db");
const { readCookie } = require("../shared/session");
const { AUTH_SCHEMA, APP_SCHEMA, APP_CODE } = require("../shared/config");

app.http("getLookups", {
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

      const pool = await getPool();

      const sessionResult = await pool.request()
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
              a.AppCode,
              a.AppName,
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

      if (sessionResult.recordset.length === 0) {
        return {
          status: 403,
          jsonBody: {
            success: false,
            message: "No app access found."
          }
        };
      }

      const authRow = sessionResult.recordset[0];

      if (
        authRow.IsRevoked ||
        !authRow.IsActive ||
        authRow.IsDeleted ||
        !authRow.IsUserAppAccessActive ||
        new Date(authRow.ExpiresOn) < new Date()
      ) {
        return {
          status: 401,
          jsonBody: {
            success: false,
            message: "Session expired, revoked, or access inactive."
          }
        };
      }

      await pool.request()
        .input("SessionID", sql.UniqueIdentifier, sessionId)
        .query(`
          UPDATE ${AUTH_SCHEMA}.UserSession
          SET LastAccessOn = SYSUTCDATETIME()
          WHERE SessionID = @SessionID;
        `);

      const lookupsResult = await pool.request()
        .input("UserID", sql.Int, authRow.UserID)
        .input("AppID", sql.Int, authRow.AppID)
        .query(`
          SELECT
              TypeCode AS Code,
              TypeName AS Name,
              SortOrder
          FROM ${APP_SCHEMA}.IncidentType
          WHERE IsActive = 1
          ORDER BY SortOrder, TypeName;

          SELECT
              SeverityCode AS Code,
              SeverityName AS Name,
              SortOrder
          FROM ${APP_SCHEMA}.IncidentSeverity
          WHERE IsActive = 1
          ORDER BY SortOrder, SeverityName;

          SELECT
              CategoryCode AS Code,
              CategoryName AS Name,
              SortOrder
          FROM ${APP_SCHEMA}.IncidentCategory
          WHERE IsActive = 1
          ORDER BY SortOrder, CategoryName;

          SELECT
              PriorityCode AS Code,
              PriorityName AS Name,
              SortOrder
          FROM ${APP_SCHEMA}.IncidentPriority
          WHERE IsActive = 1
          ORDER BY SortOrder, PriorityName;

          SELECT
              StatusCode AS Code,
              StatusName AS Name,
              SortOrder,
              IsClosedStatus
          FROM ${APP_SCHEMA}.IncidentStatus
          WHERE IsActive = 1
          ORDER BY SortOrder, StatusName;

          SELECT
              aa.AreaCode AS Code,
              aa.AreaName AS Name,
              aa.SortOrder
          FROM ${AUTH_SCHEMA}.UserAppAreaAccess uaa
          INNER JOIN ${AUTH_SCHEMA}.AppAreas aa
              ON uaa.AppAreaID = aa.AppAreaID
          WHERE uaa.UserID = @UserID
            AND uaa.AppID = @AppID
            AND uaa.IsActive = 1
            AND aa.IsActive = 1
          ORDER BY aa.SortOrder, aa.AreaName;
        `);

      const sets = lookupsResult.recordsets || [];

      return {
        status: 200,
        jsonBody: {
          success: true,
          data: {
            app: {
              AppID: authRow.AppID,
              AppCode: authRow.AppCode,
              AppName: authRow.AppName,
              AppRole: authRow.AppRole,
              IsManager: authRow.IsManager,
              IsSuperUser: authRow.IsSuperUser
            },
            incidentTypes: sets[0] || [],
            severities: sets[1] || [],
            categories: sets[2] || [],
            priorities: sets[3] || [],
            statuses: sets[4] || [],
            businessAreas: sets[5] || []
          }
        }
      };
    } catch (error) {
      context.log("getLookups error", error);

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
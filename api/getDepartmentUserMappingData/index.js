const { app } = require("@azure/functions");
const { getPool, sql } = require("../shared/db");
const { readCookie } = require("../shared/session");
const { AUTH_SCHEMA, APP_SCHEMA, APP_CODE } = require("../shared/config");

app.http("getDepartmentUserMappingData", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request) => {
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
              s.ExpiresOn,
              s.IsRevoked,
              u.IsActive,
              u.IsDeleted,
              ua.IsManager,
              ua.IsSuperUser,
              ua.IsActive AS IsUserAppAccessActive
          FROM ${AUTH_SCHEMA}.UserSession s
          INNER JOIN ${AUTH_SCHEMA}.Users u ON s.UserID = u.UserID
          INNER JOIN ${AUTH_SCHEMA}.Applications a ON a.AppCode = @AppCode AND a.IsActive = 1
          INNER JOIN ${AUTH_SCHEMA}.UserAppAccess ua ON ua.UserID = u.UserID AND ua.AppID = a.AppID
          WHERE s.SessionID = @SessionID;
        `);

      const currentUser = authResult.recordset[0];

      if (!currentUser) {
        return {
          status: 403,
          jsonBody: { success: false, message: "No app access found." }
        };
      }

      if (
        currentUser.IsRevoked ||
        !currentUser.IsActive ||
        currentUser.IsDeleted ||
        !currentUser.IsUserAppAccessActive ||
        new Date(currentUser.ExpiresOn) < new Date()
      ) {
        return {
          status: 401,
          jsonBody: { success: false, message: "Session expired, revoked, or access inactive." }
        };
      }

      if (!currentUser.IsManager && !currentUser.IsSuperUser) {
        return {
          status: 403,
          jsonBody: { success: false, message: "Access denied." }
        };
      }

      const result = await pool.request().query(`
        SELECT
            DepartmentCode,
            DepartmentName
        FROM ${APP_SCHEMA}.IncidentDepartment
        WHERE IsActive = 1
        ORDER BY SortOrder, DepartmentName;

        SELECT
            UserID,
            UserName,
            UserEmail
        FROM ${AUTH_SCHEMA}.Users
        WHERE IsActive = 1
          AND ISNULL(IsDeleted, 0) = 0
        ORDER BY UserName, UserEmail;

        SELECT
            m.IncidentDepartmentUserID,
            m.DepartmentCode,
            d.DepartmentName,
            m.UserID,
            u.UserName,
            u.UserEmail,
            m.IsResponder,
            m.IsDepartmentHead,
            m.IsActive
        FROM ${APP_SCHEMA}.IncidentDepartmentUser m
        INNER JOIN ${APP_SCHEMA}.IncidentDepartment d
            ON m.DepartmentCode = d.DepartmentCode
        INNER JOIN ${AUTH_SCHEMA}.Users u
            ON m.UserID = u.UserID
        ORDER BY d.DepartmentName, u.UserName;
      `);

      return {
        status: 200,
        jsonBody: {
          success: true,
          data: {
            departments: result.recordsets[0] || [],
            users: result.recordsets[1] || [],
            mappings: result.recordsets[2] || []
          }
        }
      };
    } catch (error) {
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
const { app } = require("@azure/functions");
const { getPool, sql } = require("../shared/db");
const { readCookie } = require("../shared/session");
const { AUTH_SCHEMA, APP_SCHEMA, APP_CODE } = require("../shared/config");

function getMasterQuery(masterType) {
  switch (masterType) {
    case "IncidentType":
      return `
        SELECT
            TypeCode AS Code,
            TypeName AS Name,
            TypeDescription AS Description,
            SortOrder,
            IsActive
        FROM ${APP_SCHEMA}.IncidentType
        ORDER BY SortOrder, TypeName;
      `;
    case "LevelOfIncident":
      return `
        SELECT
            SeverityCode AS Code,
            SeverityName AS Name,
            SeverityDescription AS Description,
            SortOrder,
            IsActive
        FROM ${APP_SCHEMA}.IncidentSeverity
        ORDER BY SortOrder, SeverityName;
      `;
    case "NatureOfIncident":
      return `
        SELECT
            CategoryCode AS Code,
            CategoryName AS Name,
            CategoryDescription AS Description,
            SortOrder,
            IsActive
        FROM ${APP_SCHEMA}.IncidentCategory
        ORDER BY SortOrder, CategoryName;
      `;
    case "IncidentLocation":
      return `
        SELECT
            LocationCode AS Code,
            LocationName AS Name,
            LocationDescription AS Description,
            SortOrder,
            IsActive
        FROM ${APP_SCHEMA}.IncidentLocation
        ORDER BY SortOrder, LocationName;
      `;
    case "IncidentDepartment":
      return `
        SELECT
            DepartmentCode AS Code,
            DepartmentName AS Name,
            DepartmentDescription AS Description,
            SortOrder,
            IsActive
        FROM ${APP_SCHEMA}.IncidentDepartment
        ORDER BY SortOrder, DepartmentName;
      `;
    default:
      throw new Error("Invalid masterType.");
  }
}

app.http("getIncidentMasters", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request) => {
    try {
      const cookieName = process.env.SESSION_COOKIE_NAME || "app_session";
      const sessionId = readCookie(request, cookieName);
      if (!sessionId) {
        return { status: 401, jsonBody: { success: false, message: "User is not authenticated." } };
      }

      const masterType = String(request.query.get("masterType") || "").trim();

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
        return { status: 403, jsonBody: { success: false, message: "No app access found." } };
      }

      if (
        currentUser.IsRevoked ||
        !currentUser.IsActive ||
        currentUser.IsDeleted ||
        !currentUser.IsUserAppAccessActive ||
        new Date(currentUser.ExpiresOn) < new Date()
      ) {
        return { status: 401, jsonBody: { success: false, message: "Session expired, revoked, or access inactive." } };
      }

      if (!currentUser.IsManager && !currentUser.IsSuperUser) {
        return { status: 403, jsonBody: { success: false, message: "Access denied." } };
      }

      const result = await pool.request().query(getMasterQuery(masterType));

      return {
        status: 200,
        jsonBody: {
          success: true,
          data: result.recordset || []
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
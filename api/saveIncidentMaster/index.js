const { app } = require("@azure/functions");
const { getPool, sql } = require("../shared/db");
const { readCookie } = require("../shared/session");
const { AUTH_SCHEMA, APP_SCHEMA, APP_CODE } = require("../shared/config");

function getStatements(masterType) {
  switch (masterType) {
    case "IncidentType":
      return {
        table: `${APP_SCHEMA}.IncidentType`,
        codeCol: "TypeCode",
        nameCol: "TypeName",
        descCol: "TypeDescription"
      };
    case "LevelOfIncident":
      return {
        table: `${APP_SCHEMA}.IncidentSeverity`,
        codeCol: "SeverityCode",
        nameCol: "SeverityName",
        descCol: "SeverityDescription"
      };
    case "NatureOfIncident":
      return {
        table: `${APP_SCHEMA}.IncidentCategory`,
        codeCol: "CategoryCode",
        nameCol: "CategoryName",
        descCol: "CategoryDescription"
      };
    case "IncidentLocation":
      return {
        table: `${APP_SCHEMA}.IncidentLocation`,
        codeCol: "LocationCode",
        nameCol: "LocationName",
        descCol: "LocationDescription"
      };
    case "IncidentDepartment":
      return {
        table: `${APP_SCHEMA}.IncidentDepartment`,
        codeCol: "DepartmentCode",
        nameCol: "DepartmentName",
        descCol: "DepartmentDescription"
      };
    default:
      throw new Error("Invalid masterType.");
  }
}

app.http("saveIncidentMaster", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request) => {
    try {
      const cookieName = process.env.SESSION_COOKIE_NAME || "app_session";
      const sessionId = readCookie(request, cookieName);
      if (!sessionId) {
        return { status: 401, jsonBody: { success: false, message: "User is not authenticated." } };
      }

      const body = await request.json();
      const masterType = String(body?.masterType || "").trim();
      const originalCode = body?.originalCode ? String(body.originalCode).trim() : null;
      const code = String(body?.code || "").trim();
      const name = String(body?.name || "").trim();
      const description = String(body?.description || "").trim();
      const sortOrder = Number(body?.sortOrder || 0);
      const isActive = !!body?.isActive;

      if (!code) return { status: 400, jsonBody: { success: false, message: "Code is required." } };
      if (!name) return { status: 400, jsonBody: { success: false, message: "Name is required." } };

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

      const m = getStatements(masterType);

      if (originalCode) {
        await pool.request()
          .input("OriginalCode", sql.NVarChar(100), originalCode)
          .input("Code", sql.NVarChar(100), code)
          .input("Name", sql.NVarChar(200), name)
          .input("Description", sql.NVarChar(1000), description || null)
          .input("SortOrder", sql.Int, sortOrder)
          .input("IsActive", sql.Bit, isActive ? 1 : 0)
          .query(`
            UPDATE ${m.table}
            SET
                ${m.codeCol} = @Code,
                ${m.nameCol} = @Name,
                ${m.descCol} = @Description,
                SortOrder = @SortOrder,
                IsActive = @IsActive,
                UpdatedOn = SYSUTCDATETIME()
            WHERE ${m.codeCol} = @OriginalCode;
          `);

        return {
          status: 200,
          jsonBody: {
            success: true,
            message: "Master updated successfully."
          }
        };
      }

      await pool.request()
        .input("Code", sql.NVarChar(100), code)
        .input("Name", sql.NVarChar(200), name)
        .input("Description", sql.NVarChar(1000), description || null)
        .input("SortOrder", sql.Int, sortOrder)
        .input("IsActive", sql.Bit, isActive ? 1 : 0)
        .query(`
          INSERT INTO ${m.table}
          (
              ${m.codeCol},
              ${m.nameCol},
              ${m.descCol},
              SortOrder,
              IsActive
          )
          VALUES
          (
              @Code,
              @Name,
              @Description,
              @SortOrder,
              @IsActive
          );
        `);

      return {
        status: 200,
        jsonBody: {
          success: true,
          message: "Master created successfully."
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
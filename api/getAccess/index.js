const { app } = require("@azure/functions");
const { getPool, sql } = require("../shared/db");
const { readCookie } = require("../shared/session");
const { AUTH_SCHEMA, APP_CODE } = require("../shared/config");

app.http("getAccess", {
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

      const result = await pool.request()
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

      if (result.recordset.length === 0) {
        return {
          status: 401,
          jsonBody: {
            success: false,
            message: "Invalid session or no app access."
          }
        };
      }

      const row = result.recordset[0];

      if (
        row.IsRevoked ||
        !row.IsActive ||
        row.IsDeleted ||
        !row.IsUserAppAccessActive ||
        new Date(row.ExpiresOn) < new Date()
      ) {
        return {
          status: 401,
          jsonBody: {
            success: false,
            message: "Session expired or revoked."
          }
        };
      }

      const areaResult = await pool.request()
        .input("UserID", sql.Int, row.UserID)
        .input("AppID", sql.Int, row.AppID)
        .query(`
          SELECT
              aa.AreaCode,
              aa.AreaName
          FROM ${AUTH_SCHEMA}.UserAppAreaAccess uaa
          INNER JOIN ${AUTH_SCHEMA}.AppAreas aa
              ON uaa.AppAreaID = aa.AppAreaID
          WHERE uaa.UserID = @UserID
            AND uaa.AppID = @AppID
            AND uaa.IsActive = 1
            AND aa.IsActive = 1
          ORDER BY aa.SortOrder, aa.AreaName;
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
            UserID: row.UserID,
            UserEmail: row.UserEmail,
            UserName: row.UserName,
            HoldingName: row.HoldingName,
            AppID: row.AppID,
            AppCode: row.AppCode,
            AppName: row.AppName,
            AppRole: row.AppRole,
            IsManager: row.IsManager,
            IsSuperUser: row.IsSuperUser,
            AllowedAreas: areaResult.recordset || []
          }
        }
      };
    } catch (error) {
      context.log("getAccess error", error);

      return {
        status: 500,
        jsonBody: {
          success: false,
          message: error.message
        }
      };
    }
  }
});
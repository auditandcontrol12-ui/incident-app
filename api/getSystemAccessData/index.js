const { app } = require("@azure/functions");
const { getPool, sql } = require("../shared/db");
const { readCookie } = require("../shared/session");
const { AUTH_SCHEMA, APP_SCHEMA, APP_CODE } = require("../shared/config");

app.http("getSystemAccessData", {
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

      if (!authResult.recordset.length) {
        return {
          status: 403,
          jsonBody: { success: false, message: "No app access found." }
        };
      }

      const currentUser = authResult.recordset[0];

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
          jsonBody: { success: false, message: "System access is restricted." }
        };
      }

      const appIdResult = await pool.request()
        .input("AppCode", sql.NVarChar(100), APP_CODE)
        .query(`
          SELECT TOP 1 AppID
          FROM ${AUTH_SCHEMA}.Applications
          WHERE AppCode = @AppCode
            AND IsActive = 1;
        `);

      const appId = appIdResult.recordset[0]?.AppID;

      const result = await pool.request()
        .input("AppID", sql.Int, appId)
        .query(`
          SELECT
              aa.AppAreaID,
              aa.AreaCode,
              aa.AreaName,
              aa.SortOrder
          FROM ${AUTH_SCHEMA}.AppAreas aa
          WHERE aa.AppID = @AppID
            AND aa.IsActive = 1
          ORDER BY aa.SortOrder, aa.AreaName;

          SELECT
              u.UserID,
              u.UserEmail,
              u.UserName,
              u.HoldingName,
              u.IsActive,
              ISNULL(ua.AppRole, '') AS AppRole,
              ISNULL(ua.IsManager, 0) AS IsManager,
              ISNULL(ua.IsSuperUser, 0) AS IsSuperUser,
              ISNULL(ua.IsActive, 0) AS IsAppAccessActive
          FROM ${AUTH_SCHEMA}.Users u
          LEFT JOIN ${AUTH_SCHEMA}.UserAppAccess ua
              ON ua.UserID = u.UserID
             AND ua.AppID = @AppID
          WHERE ISNULL(u.IsDeleted, 0) = 0
          ORDER BY u.UserName, u.UserEmail;

          SELECT
              uaa.UserID,
              aa.AppAreaID,
              aa.AreaName
          FROM ${AUTH_SCHEMA}.UserAppAreaAccess uaa
          INNER JOIN ${AUTH_SCHEMA}.AppAreas aa
              ON uaa.AppAreaID = aa.AppAreaID
          WHERE uaa.AppID = @AppID
            AND uaa.IsActive = 1
            AND aa.IsActive = 1;
        `);

      const appAreas = result.recordsets[0] || [];
      const users = result.recordsets[1] || [];
      const areaMapRows = result.recordsets[2] || [];

      const areaMap = new Map();
      areaMapRows.forEach(row => {
        if (!areaMap.has(row.UserID)) {
          areaMap.set(row.UserID, { ids: [], names: [] });
        }
        areaMap.get(row.UserID).ids.push(row.AppAreaID);
        areaMap.get(row.UserID).names.push(row.AreaName);
      });

      const mergedUsers = users.map(user => {
        const areas = areaMap.get(user.UserID) || { ids: [], names: [] };
        return {
          ...user,
          AreaIds: areas.ids,
          AreaNames: areas.names
        };
      });

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
            appAreas,
            users: mergedUsers
          }
        }
      };
    } catch (error) {
      context.log("getSystemAccessData error", error);
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
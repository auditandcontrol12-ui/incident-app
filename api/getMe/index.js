const { app } = require("@azure/functions");
const { getPool, sql } = require("../shared/db");
const { readCookie } = require("../shared/session");
const { AUTH_SCHEMA } = require("../shared/config");

app.http("getMe", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    try {
      const cookieName = process.env.SESSION_COOKIE_NAME || "app_session";
      const sessionId = readCookie(request, cookieName);

      if (!sessionId) {
        return {
          status: 401,
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
          },
          jsonBody: {
            authenticated: false
          }
        };
      }

      const pool = await getPool();

      const result = await pool.request()
        .input("SessionID", sql.UniqueIdentifier, sessionId)
        .query(`
          SELECT TOP 1
              s.SessionID,
              s.ExpiresOn,
              s.IsRevoked,
              s.LastAccessOn,
              u.UserID,
              u.UserEmail,
              u.UserName,
              u.HoldingName,
              u.IsActive,
              u.IsDeleted
          FROM ${AUTH_SCHEMA}.UserSession s
          INNER JOIN ${AUTH_SCHEMA}.Users u
              ON s.UserID = u.UserID
          WHERE s.SessionID = @SessionID;
        `);

      if (result.recordset.length === 0) {
        return {
          status: 401,
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
          },
          jsonBody: {
            authenticated: false
          }
        };
      }

      const row = result.recordset[0];

      if (
        row.IsRevoked ||
        !row.IsActive ||
        row.IsDeleted ||
        new Date(row.ExpiresOn) < new Date()
      ) {
        return {
          status: 401,
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
          },
          jsonBody: {
            authenticated: false
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

      return {
        status: 200,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          "Pragma": "no-cache",
          "Expires": "0"
        },
        jsonBody: {
          authenticated: true,
          userId: row.UserID,
          userDetails: row.UserName || "",
          email: row.UserEmail || "",
          userRoles: [],
          user: {
            UserID: row.UserID,
            UserEmail: row.UserEmail,
            UserName: row.UserName,
            HoldingName: row.HoldingName,
            IsActive: row.IsActive
          }
        }
      };
    } catch (error) {
      context.log("getMe error", error);

      return {
        status: 500,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          "Pragma": "no-cache",
          "Expires": "0"
        },
        jsonBody: {
          authenticated: false,
          message: "Internal server error."
        }
      };
    }
  }
});
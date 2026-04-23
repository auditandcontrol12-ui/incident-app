const { app } = require("@azure/functions");
const { getPool, sql } = require("../shared/db");
const { readCookie, buildLogoutCookie } = require("../shared/session");
const { AUTH_SCHEMA } = require("../shared/config");

app.http("logout", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    try {
      const cookieName = process.env.SESSION_COOKIE_NAME || "app_session";
      const sessionId = readCookie(request, cookieName);

      if (sessionId) {
        const pool = await getPool();

        await pool.request()
          .input("SessionID", sql.UniqueIdentifier, sessionId)
          .query(`
            UPDATE ${AUTH_SCHEMA}.UserSession
            SET
                IsRevoked = 1,
                LastAccessOn = SYSUTCDATETIME()
            WHERE SessionID = @SessionID;
          `);
      }

      return {
        status: 200,
        headers: {
          "Set-Cookie": buildLogoutCookie(),
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          "Pragma": "no-cache",
          "Expires": "0"
        },
        jsonBody: {
          success: true,
          message: "Logged out successfully."
        }
      };
    } catch (error) {
      context.log("logout error", error);

      return {
        status: 500,
        headers: {
          "Set-Cookie": buildLogoutCookie()
        },
        jsonBody: {
          success: false,
          message: error.message || "Logout failed."
        }
      };
    }
  }
});
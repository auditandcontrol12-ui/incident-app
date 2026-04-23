const { app } = require("@azure/functions");
const { getPool, sql } = require("../shared/db");
const {
  generateSessionId,
  getSessionExpiry,
  buildSessionCookie
} = require("../shared/session");
const { AUTH_SCHEMA } = require("../shared/config");

app.http("verifyOtp", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    try {
      const body = await request.json();
      const email = (body?.email || "").trim().toLowerCase();
      const otp = (body?.otp || "").trim();

      if (!email || !otp) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            message: "Email and OTP are required."
          }
        };
      }

      const pool = await getPool();

      const otpResult = await pool.request()
        .input("UserEmail", sql.NVarChar(1020), email)
        .input("OTPCode", sql.NVarChar(40), otp)
        .query(`
          SELECT TOP 1
              OTPID
          FROM ${AUTH_SCHEMA}.UserOTP
          WHERE LOWER(UserEmail) = @UserEmail
            AND OTPCode = @OTPCode
            AND IsUsed = 0
            AND ExpiresOn >= SYSUTCDATETIME()
          ORDER BY OTPID DESC
        `);

      if (otpResult.recordset.length === 0) {
        return {
          status: 401,
          jsonBody: {
            success: false,
            message: "Invalid or expired OTP."
          }
        };
      }

      const userResult = await pool.request()
        .input("UserEmail", sql.NVarChar(1020), email)
        .query(`
          SELECT TOP 1
              UserID,
              UserEmail,
              UserName,
              HoldingName,
              IsActive,
              IsDeleted
          FROM ${AUTH_SCHEMA}.Users
          WHERE LOWER(UserEmail) = @UserEmail
            AND IsActive = 1
            AND IsDeleted = 0
        `);

      if (userResult.recordset.length === 0) {
        return {
          status: 404,
          jsonBody: {
            success: false,
            message: "Active user not found."
          }
        };
      }

      const appUser = userResult.recordset[0];
      const sessionId = generateSessionId();
      const expiresOn = getSessionExpiry();

      await pool.request()
        .input("OTPID", sql.BigInt, otpResult.recordset[0].OTPID)
        .query(`
          UPDATE ${AUTH_SCHEMA}.UserOTP
          SET IsUsed = 1
          WHERE OTPID = @OTPID
        `);

      await pool.request()
        .input("SessionID", sql.UniqueIdentifier, sessionId)
        .input("UserID", sql.Int, appUser.UserID)
        .input("ExpiresOn", sql.DateTime2, expiresOn)
        .query(`
          INSERT INTO ${AUTH_SCHEMA}.UserSession
          (
              SessionID,
              UserID,
              ExpiresOn,
              IsRevoked,
              CreatedOn,
              LastAccessOn
          )
          VALUES
          (
              @SessionID,
              @UserID,
              @ExpiresOn,
              0,
              SYSUTCDATETIME(),
              SYSUTCDATETIME()
          )
        `);

      return {
        status: 200,
        headers: {
          "Set-Cookie": buildSessionCookie(sessionId)
        },
        jsonBody: {
          success: true,
          user: {
            userId: appUser.UserID,
            email: appUser.UserEmail,
            name: appUser.UserName,
            holding: appUser.HoldingName
          }
        }
      };
    } catch (error) {
      context.log("verifyOtp error", error);

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
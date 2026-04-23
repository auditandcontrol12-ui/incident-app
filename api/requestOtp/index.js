const { app } = require("@azure/functions");
const { getPool, sql } = require("../shared/db");
const { generateOtp, getOtpExpiry } = require("../shared/otp");
const { sendOtpEmail } = require("../shared/mail");
const { AUTH_SCHEMA } = require("../shared/config");

app.http("requestOtp", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    try {
      const body = await request.json();
      const email = (body?.email || "").trim().toLowerCase();

      if (!email) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            message: "Email is required."
          }
        };
      }

      const pool = await getPool();

      const userResult = await pool.request()
        .input("UserEmail", sql.NVarChar(1020), email)
        .query(`
          SELECT TOP 1
              UserID,
              UserEmail,
              UserName,
              IsActive,
              IsDeleted
          FROM ${AUTH_SCHEMA}.Users
          WHERE LOWER(UserEmail) = @UserEmail
        `);

      if (
        userResult.recordset.length === 0 ||
        !userResult.recordset[0].IsActive ||
        userResult.recordset[0].IsDeleted
      ) {
        return {
          status: 404,
          jsonBody: {
            success: false,
            message: "User not found or inactive."
          }
        };
      }

      const user = userResult.recordset[0];
      const otp = generateOtp();
      const expiresOn = getOtpExpiry();

      await pool.request()
        .input("UserEmail", sql.NVarChar(1020), email)
        .query(`
          UPDATE ${AUTH_SCHEMA}.UserOTP
          SET IsUsed = 1
          WHERE LOWER(UserEmail) = @UserEmail
            AND IsUsed = 0
        `);

      await pool.request()
        .input("UserEmail", sql.NVarChar(1020), email)
        .input("OTPCode", sql.NVarChar(40), otp)
        .input("ExpiresOn", sql.DateTime2, expiresOn)
        .query(`
          INSERT INTO ${AUTH_SCHEMA}.UserOTP
          (
              UserEmail,
              OTPCode,
              ExpiresOn,
              IsUsed,
              CreatedOn
          )
          VALUES
          (
              @UserEmail,
              @OTPCode,
              @ExpiresOn,
              0,
              SYSUTCDATETIME()
          )
        `);

      await sendOtpEmail(email, otp, user.UserName);

      return {
        status: 200,
        jsonBody: {
          success: true,
          message: "OTP sent successfully."
        }
      };
    } catch (error) {
      context.log("requestOtp error", error);

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
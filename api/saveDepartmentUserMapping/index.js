const { app } = require("@azure/functions");
const { getPool, sql } = require("../shared/db");
const { readCookie } = require("../shared/session");
const { AUTH_SCHEMA, APP_SCHEMA, APP_CODE } = require("../shared/config");

app.http("saveDepartmentUserMapping", {
  methods: ["POST"],
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

      const body = await request.json();

      const incidentDepartmentUserId = body?.incidentDepartmentUserId ? Number(body.incidentDepartmentUserId) : null;
      const departmentCode = String(body?.departmentCode || "").trim();
      const userId = Number(body?.userId || 0);
      const isResponder = !!body?.isResponder;
      const isDepartmentHead = !!body?.isDepartmentHead;
      const isActive = !!body?.isActive;

      if (!departmentCode) {
        return {
          status: 400,
          jsonBody: { success: false, message: "Department is required." }
        };
      }

      if (!userId) {
        return {
          status: 400,
          jsonBody: { success: false, message: "User is required." }
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

      const tx = new sql.Transaction(pool);
      await tx.begin();

      try {
        if (isDepartmentHead && isActive) {
          await new sql.Request(tx)
            .input("DepartmentCode", sql.NVarChar(100), departmentCode)
            .input("CurrentID", sql.BigInt, incidentDepartmentUserId || 0)
            .query(`
              UPDATE ${APP_SCHEMA}.IncidentDepartmentUser
              SET
                  IsDepartmentHead = 0,
                  UpdatedOn = SYSUTCDATETIME()
              WHERE DepartmentCode = @DepartmentCode
                AND IsActive = 1
                AND IncidentDepartmentUserID <> @CurrentID;
            `);
        }

        if (incidentDepartmentUserId) {
          await new sql.Request(tx)
            .input("IncidentDepartmentUserID", sql.BigInt, incidentDepartmentUserId)
            .input("DepartmentCode", sql.NVarChar(100), departmentCode)
            .input("UserID", sql.Int, userId)
            .input("IsResponder", sql.Bit, isResponder ? 1 : 0)
            .input("IsDepartmentHead", sql.Bit, isDepartmentHead ? 1 : 0)
            .input("IsActive", sql.Bit, isActive ? 1 : 0)
            .query(`
              UPDATE ${APP_SCHEMA}.IncidentDepartmentUser
              SET
                  DepartmentCode = @DepartmentCode,
                  UserID = @UserID,
                  IsResponder = @IsResponder,
                  IsDepartmentHead = @IsDepartmentHead,
                  IsActive = @IsActive,
                  UpdatedOn = SYSUTCDATETIME()
              WHERE IncidentDepartmentUserID = @IncidentDepartmentUserID;
            `);

          await tx.commit();

          return {
            status: 200,
            jsonBody: {
              success: true,
              message: "Mapping updated successfully."
            }
          };
        }

        await new sql.Request(tx)
          .input("DepartmentCode", sql.NVarChar(100), departmentCode)
          .input("UserID", sql.Int, userId)
          .input("IsResponder", sql.Bit, isResponder ? 1 : 0)
          .input("IsDepartmentHead", sql.Bit, isDepartmentHead ? 1 : 0)
          .input("IsActive", sql.Bit, isActive ? 1 : 0)
          .query(`
            INSERT INTO ${APP_SCHEMA}.IncidentDepartmentUser
            (
                DepartmentCode,
                UserID,
                IsResponder,
                IsDepartmentHead,
                IsActive
            )
            VALUES
            (
                @DepartmentCode,
                @UserID,
                @IsResponder,
                @IsDepartmentHead,
                @IsActive
            );
          `);

        await tx.commit();

        return {
          status: 200,
          jsonBody: {
            success: true,
            message: "Mapping created successfully."
          }
        };
      } catch (innerError) {
        await tx.rollback();
        throw innerError;
      }
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
const { app } = require("@azure/functions");
const { getPool, sql } = require("../shared/db");
const { readCookie } = require("../shared/session");
const { AUTH_SCHEMA, APP_SCHEMA, APP_CODE } = require("../shared/config");

app.http("saveSystemAccessUser", {
  methods: ["POST"],
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

      const body = await request.json();

      const userId = body?.userId ? Number(body.userId) : null;
      const userEmail = String(body?.userEmail || "").trim().toLowerCase();
      const userName = String(body?.userName || "").trim();
      const holdingName = String(body?.holdingName || "").trim();
      const appRole = String(body?.appRole || "Standard User").trim();
      const isActive = !!body?.isActive;
      const isManager = !!body?.isManager;
      const isSuperUser = !!body?.isSuperUser;
      const areaIds = Array.isArray(body?.areaIds)
        ? body.areaIds.map(x => Number(x)).filter(x => !Number.isNaN(x))
        : [];

      if (!userEmail) {
        return {
          status: 400,
          jsonBody: { success: false, message: "User Email is required." }
        };
      }

      if (!userName) {
        return {
          status: 400,
          jsonBody: { success: false, message: "User Name is required." }
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

      const appId = currentUser.AppID;
      const tx = new sql.Transaction(pool);
      await tx.begin();

      try {
        let finalUserId = userId;

        if (finalUserId) {
          await new sql.Request(tx)
            .input("UserID", sql.Int, finalUserId)
            .input("UserEmail", sql.NVarChar(1020), userEmail)
            .input("UserName", sql.NVarChar(300), userName)
            .input("HoldingName", sql.NVarChar(300), holdingName || null)
            .input("IsActive", sql.Bit, isActive ? 1 : 0)
            .query(`
              UPDATE ${AUTH_SCHEMA}.Users
              SET
                  UserEmail = @UserEmail,
                  UserName = @UserName,
                  HoldingName = @HoldingName,
                  IsActive = @IsActive,
                  UpdatedOn = SYSUTCDATETIME()
              WHERE UserID = @UserID
                AND ISNULL(IsDeleted, 0) = 0;
            `);
        } else {
          const insertUserResult = await new sql.Request(tx)
            .input("UserEmail", sql.NVarChar(1020), userEmail)
            .input("UserName", sql.NVarChar(300), userName)
            .input("HoldingName", sql.NVarChar(300), holdingName || null)
            .input("IsActive", sql.Bit, isActive ? 1 : 0)
            .query(`
              INSERT INTO ${AUTH_SCHEMA}.Users
              (
                  UserEmail,
                  UserName,
                  HoldingName,
                  IsActive
              )
              OUTPUT INSERTED.UserID
              VALUES
              (
                  @UserEmail,
                  @UserName,
                  @HoldingName,
                  @IsActive
              );
            `);

          finalUserId = insertUserResult.recordset[0].UserID;
        }

        await new sql.Request(tx)
          .input("UserID", sql.Int, finalUserId)
          .input("AppID", sql.Int, appId)
          .input("AppRole", sql.NVarChar(200), appRole)
          .input("IsManager", sql.Bit, isManager ? 1 : 0)
          .input("IsSuperUser", sql.Bit, isSuperUser ? 1 : 0)
          .input("IsActive", sql.Bit, isActive ? 1 : 0)
          .query(`
            MERGE ${AUTH_SCHEMA}.UserAppAccess AS target
            USING (
              SELECT
                  @UserID AS UserID,
                  @AppID AS AppID
            ) AS source
            ON target.UserID = source.UserID
           AND target.AppID = source.AppID
            WHEN MATCHED THEN
              UPDATE SET
                  AppRole = @AppRole,
                  IsManager = @IsManager,
                  IsSuperUser = @IsSuperUser,
                  IsActive = @IsActive,
                  UpdatedOn = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN
              INSERT
              (
                  UserID,
                  AppID,
                  AppRole,
                  IsManager,
                  IsSuperUser,
                  IsActive
              )
              VALUES
              (
                  @UserID,
                  @AppID,
                  @AppRole,
                  @IsManager,
                  @IsSuperUser,
                  @IsActive
              );
          `);

        await new sql.Request(tx)
          .input("UserID", sql.Int, finalUserId)
          .input("AppID", sql.Int, appId)
          .query(`
            UPDATE ${AUTH_SCHEMA}.UserAppAreaAccess
            SET
                IsActive = 0,
                UpdatedOn = SYSUTCDATETIME()
            WHERE UserID = @UserID
              AND AppID = @AppID;
          `);

        for (const areaId of areaIds) {
          await new sql.Request(tx)
            .input("UserID", sql.Int, finalUserId)
            .input("AppID", sql.Int, appId)
            .input("AppAreaID", sql.BigInt, areaId)
            .query(`
              MERGE ${AUTH_SCHEMA}.UserAppAreaAccess AS target
              USING (
                SELECT
                    @UserID AS UserID,
                    @AppID AS AppID,
                    @AppAreaID AS AppAreaID
              ) AS source
              ON target.UserID = source.UserID
             AND target.AppID = source.AppID
             AND target.AppAreaID = source.AppAreaID
              WHEN MATCHED THEN
                UPDATE SET
                    IsActive = 1,
                    UpdatedOn = SYSUTCDATETIME()
              WHEN NOT MATCHED THEN
                INSERT
                (
                    UserID,
                    AppID,
                    AppAreaID,
                    IsActive
                )
                VALUES
                (
                    @UserID,
                    @AppID,
                    @AppAreaID,
                    1
                );
            `);
        }

        await tx.commit();

        return {
          status: 200,
          jsonBody: {
            success: true,
            message: finalUserId === userId
              ? "User updated successfully."
              : "User created successfully."
          }
        };
      } catch (innerError) {
        await tx.rollback();
        throw innerError;
      }
    } catch (error) {
      context.log("saveSystemAccessUser error", error);
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
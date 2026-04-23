const crypto = require("crypto");

function generateSessionId() {
  return crypto.randomUUID();
}

function getSessionExpiry() {
  const hours = parseInt(process.env.SESSION_EXPIRY_HOURS || "12", 10);
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + hours);
  return expiry;
}

function buildSessionCookie(sessionId) {
  const cookieName = process.env.SESSION_COOKIE_NAME || "app_session";
  return `${cookieName}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function buildLogoutCookie() {
  const cookieName = process.env.SESSION_COOKIE_NAME || "app_session";
  return `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function readCookie(request, cookieName) {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookies = cookieHeader.split(";").map(x => x.trim()).filter(Boolean);

  for (const cookie of cookies) {
    const [name, ...rest] = cookie.split("=");
    if (name === cookieName) {
      return rest.join("=");
    }
  }

  return null;
}

module.exports = {
  generateSessionId,
  getSessionExpiry,
  buildSessionCookie,
  buildLogoutCookie,
  readCookie
};
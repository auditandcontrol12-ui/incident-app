const AUTH_SCHEMA = (process.env.AUTH_SCHEMA || "appcore").trim();
const APP_SCHEMA = (process.env.APP_SCHEMA || "incidentapp").trim();
const APP_CODE = (process.env.APP_CODE || "INCIDENT").trim();

module.exports = {
  AUTH_SCHEMA,
  APP_SCHEMA,
  APP_CODE
};
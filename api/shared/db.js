const sql = require("mssql");

let pool;

async function getPool() {
  if (pool) return pool;

  pool = await sql.connect({
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
      encrypt: true,
      trustServerCertificate: false
    }
  });

  return pool;
}

module.exports = { sql, getPool };
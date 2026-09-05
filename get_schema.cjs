const db = require('./src/config/db');

async function getSchema() {
  try {
    const [rows] = await db.query('DESCRIBE client_master');
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

getSchema();

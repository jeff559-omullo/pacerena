const mysql = require('mysql2/promise');
const url = 'mysql://2XdgvaDWDfRAHz2.root:Og9w5Eq111CmYA8o@gateway01.ap-northeast-1.prod.aws.tidbcloud.com:4000/pacearena?ssl=%7B%22rejectUnauthorized%22%3Atrue%7D';
(async () => {
  const c = await mysql.createConnection(url);
  const [rows] = await c.query("SELECT * FROM __drizzle_migrations");
  console.log('MIGRATIONS:', JSON.stringify(rows, null, 2));
  await c.end();
})();

const mysql = require('mysql2/promise');
const url = process.env.DATABASE_URL || 'mysql://2XdgvaDWDfRAHz2.root:Og9w5Eq111CmYA8o@gateway01.ap-northeast-1.prod.aws.tidbcloud.com:4000/pacearena?ssl=%7B%22rejectUnauthorized%22%3Atrue%7D';
(async () => {
  const c = await mysql.createConnection(url);
  const [rows] = await c.query("SHOW CREATE TABLE match_state_events");
  console.log('CREATE:', JSON.stringify(rows));
  const [cols] = await c.query("SHOW COLUMNS FROM match_state_events");
  console.log('COLUMNS:', JSON.stringify(cols));
  await c.end();
})();

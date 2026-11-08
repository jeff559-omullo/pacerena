const mysql = require('mysql2/promise');
const url = 'mysql://2XdgvaDWDfRAHz2.root:Og9w5Eq111CmYA8o@gateway01.ap-northeast-1.prod.aws.tidbcloud.com:4000/pacearena?ssl=%7B%22rejectUnauthorized%22%3Atrue%7D';
(async () => {
  const c = await mysql.createConnection(url);
  // check constraints on challenges
  const [r1] = await c.query("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='challenges'");
  console.log('challenges constraints:', r1.map(x=>x.CONSTRAINT_NAME).join(', '));
  const [r2] = await c.query("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='match_participants'");
  console.log('match_participants constraints:', r2.map(x=>x.CONSTRAINT_NAME).join(', '));
  await c.end();
})();

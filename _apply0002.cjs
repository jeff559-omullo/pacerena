const mysql = require('mysql2/promise');
const fs = require('fs');
const url = 'mysql://2XdgvaDWDfRAHz2.root:Og9w5Eq111CmYA8o@gateway01.ap-northeast-1.prod.aws.tidbcloud.com:4000/pacearena?ssl=%7B%22rejectUnauthorized%22%3Atrue%7D';
(async () => {
  const c = await mysql.createConnection(url);
  const sql = fs.readFileSync('drizzle/0002_chemical_zodiak.sql','utf8');
  const statements = sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
  for (const st of statements) {
    try {
      await c.query(st);
      console.log('OK:', st.slice(0,60).replace(/\n/g,' '));
    } catch (e) {
      console.log('ERR:', e.code, '-', st.slice(0,60).replace(/\n/g,' '), '|', e.message.slice(0,120));
    }
  }
  await c.end();
})();

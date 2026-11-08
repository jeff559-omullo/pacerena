const mysql = require('mysql2/promise');
const url = 'mysql://2XdgvaDWDfRAHz2.root:Og9w5Eq111CmYA8o@gateway01.ap-northeast-1.prod.aws.tidbcloud.com:4000/pacearena?ssl=%7B%22rejectUnauthorized%22%3Atrue%7D';
(async () => {
  const c = await mysql.createConnection(url);
  for (const t of ['match_evidence','wallet_accounts','wallet_transactions','disputes']) {
    const [r] = await c.query("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [t]);
    console.log(t, ':', r.map(x=>x.CONSTRAINT_NAME).join(', '));
  }
  // indexes
  const [idx] = await c.query("SELECT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('match_state_events','dispute_attachments')");
  console.log('idx rows:', idx.length);
  await c.end();
})();

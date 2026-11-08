const mysql = require('mysql2/promise');
const url = "mysql://2XdgvaDWDfRAHz2.root:Og9w5Eq111CmYA8o@gateway01.ap-northeast-1.prod.aws.tidbcloud.com:4000/pacearena?ssl=%7B%5C%22rejectUnauthorized%5C%22:true%7D";
(async () => {
  const c = await mysql.createConnection(url);
  const [m] = await c.query('SELECT id FROM matches ORDER BY id DESC LIMIT 1');
  console.log('last match id:', m[0] && m[0].id);
  const matchId = m[0] && m[0].id;
  const [u] = await c.query('SELECT id FROM users WHERE id=3');
  console.log('user3 exists:', u.length>0);
  try {
    const [r] = await c.query('INSERT INTO match_state_events (matchId, fromState, toState, actorUserId, reason) VALUES (?,?,?,?,?)', [matchId, 'ACCEPTED','AWAITING_STAKES', 3, 'test']);
    console.log('insert OK, id:', r.insertId);
    await c.query('DELETE FROM match_state_events WHERE id=?', [r.insertId]);
    console.log('cleanup done');
  } catch(e) { console.log('insert ERR:', e.code, e.message); }
  await c.end();
})();

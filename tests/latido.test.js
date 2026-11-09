const Module = require('module'); const orig = Module._load;
let consultas = [];
const dbOk = { from: (t) => ({ select: (c, o) => { consultas.push({ t, c, o }); return Promise.resolve({ error: null, count: 53 }); } }) };
const dbMal = { from: () => ({ select: () => Promise.resolve({ error: { message: 'x' } }) }) };
Module._load = function (r, ...a) { return r === '@supabase/supabase-js' ? { createClient: () => dbOk } : orig.call(this, r, ...a); };
const latido = require('../api/latido.js');
const { latir } = latido;
let fallos = 0; const ok = (c, n, x) => { console.log(c ? 'OK  ' : 'FAIL', n, c ? '' : x || ''); if (!c) fallos = 1; };
function res() { const r = { code: 0, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; }
(async () => {
  let r = await latir({ db: dbOk });
  ok(r.ok === true && Object.keys(r).join() === 'ok', 'devuelve solo { ok } (sin datos de la base)', JSON.stringify(r));
  ok(consultas.length === 1 && consultas[0].o && consultas[0].o.head === true, 'hace una consulta mínima (head, sin leer filas)', JSON.stringify(consultas));
  r = await latir({ db: dbMal });
  ok(r.ok === false, 'si la base falla lo indica');
  // endpoint: sin secreto configurado o con secreto incorrecto, rechaza y NO toca la base
  delete process.env.CRON_SECRET; consultas = [];
  let p = res(); await latido({ headers: {} }, p);
  ok(p.code === 401 && consultas.length === 0, 'sin CRON_SECRET configurado: 401 y no consulta');
  process.env.CRON_SECRET = 'prueba-secreto';
  p = res(); await latido({ headers: { authorization: 'Bearer otro' } }, p);
  ok(p.code === 401 && consultas.length === 0, 'secreto incorrecto: 401 y no consulta');
  p = res(); await latido({ headers: { authorization: 'Bearer prueba-secreto' } }, p);
  ok(p.code === 200 && p.body.ok === true && consultas.length === 1, 'secreto correcto: 200 y consulta una vez', JSON.stringify(p));
  process.exit(fallos);
})();

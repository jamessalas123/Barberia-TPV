const DB = {
  asistente_numeros: [{ phone_number_id: 'PN1', user_id: 'U1' }],
  profiles: [{ id: 'U1', asistente: { nombre_negocio: 'Uñas y Uñas' } }],
  appointments: [
    { id: 'a', user_id: 'U1', client_name: 'Rosa Pérez', service: 'Manicura', start_time: '10:30:00', notes: 'wa:34677000111', appointment_date: '2026-10-25', status: 'scheduled' },
    { id: 'b', user_id: 'U1', client_name: 'Luis', service: 'Corte', start_time: '11:00:00', notes: null, appointment_date: '2026-10-25', status: 'scheduled' },
    { id: 'c', user_id: 'U1', client_name: 'Ana', service: 'Corte', start_time: '12:00:00', notes: 'wa:34600000000', appointment_date: '2026-10-25', status: 'cancelled' },
    { id: 'd', user_id: 'U1', client_name: 'Eva', service: 'Corte', start_time: '12:00:00', notes: 'wa:34611111111', appointment_date: '2026-10-26', status: 'scheduled' },
    { id: 'e', user_id: 'U1', client_name: 'Ya', service: 'Corte', start_time: '13:00:00', notes: 'wa:34622222222', appointment_date: '2026-10-25', status: 'scheduled', recordatorio_enviado_at: 'x' }
  ]
};
function q(t) { const f = []; let op = 's', pay, single = false; const o = {
  select() { return o; }, update(p) { op = 'u'; pay = p; return o; }, eq(k, v) { f.push(r => r[k] === v); return o; }, maybeSingle() { single = true; return o; },
  then(res, rej) { const m = DB[t].filter(r => f.every(x => x(r))); if (op === 'u') { m.forEach(r => Object.assign(r, pay)); return Promise.resolve({ error: null }).then(res, rej); }
    return Promise.resolve({ data: single ? (m[0] || null) : m, error: null }).then(res, rej); } }; return o; }
const db = { from: q };
const Module = require('module'); const orig = Module._load;
Module._load = function (r, ...a) { return r === '@supabase/supabase-js' ? { createClient: () => db } : orig.call(this, r, ...a); };
const { recordar } = require('../api/recordatorios.js');
let fallos = 0; const ok = (c, n, x) => { console.log(c ? 'OK  ' : 'FAIL', n, c ? '' : x || ''); if (!c) fallos = 1; };
(async () => {
  const env = []; const enviar = async (...a) => { env.push(a); return true; };
  const ahora = new Date('2026-10-24T16:00:00Z'); // 18:00 Madrid, mañana = 25
  let r = await recordar({ db, enviar, ahora, plantilla: '' });
  ok(r.enviadas === 0 && env.length === 0, 'sin plantilla no envía');
  r = await recordar({ db, enviar, ahora, plantilla: 'recordatorio_cita' });
  ok(r.enviadas === 1 && env.length === 1, 'envía solo 1 (bot, mañana, programada, sin recordar)', JSON.stringify(r));
  ok(env[0][0] === 'PN1' && env[0][1] === '34677000111' && env[0][2] === 'recordatorio_cita', 'destino y plantilla');
  ok(JSON.stringify(env[0][4]) === JSON.stringify(['Rosa', 'Manicura', '10:30', 'Uñas y Uñas']), 'parámetros', JSON.stringify(env[0][4]));
  ok(!!DB.appointments[0].recordatorio_enviado_at, 'marca enviado');
  r = await recordar({ db, enviar, ahora, plantilla: 'recordatorio_cita' });
  ok(r.enviadas === 0 && env.length === 1, 'no repite');
  DB.appointments[3].appointment_date = '2026-10-25'; DB.appointments[3].start_time = '09:00:00';
  r = await recordar({ db, enviar: async () => false, ahora, plantilla: 'p' });
  ok(r.fallidas === 1 && !DB.appointments[3].recordatorio_enviado_at, 'si falla el envío no marca (reintenta)');
  process.exit(fallos);
})();

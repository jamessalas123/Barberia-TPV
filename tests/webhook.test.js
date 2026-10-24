/* Prueba de integración con una base de datos simulada en memoria. */
const Module = require('module');
const DB = {
  asistente_numeros: [{ phone_number_id: 'PN1', user_id: 'U1' }],
  profiles: [{ id: 'U1', nombre: 'Estética Luisa', horario: null, asistente: { equipo: ['Luisa'] } }],
  servicios: [{ user_id: 'U1', nombre: 'Depilación', precio: 50, duracion_min: 45 }, { user_id: 'U1', nombre: 'Depilación', precio: 50, duracion_min: 45 }],
  appointments: []
};
let idn = 1;
function q(t) {
  const f = []; let op = 's', pay = null, single = false;
  const o = {
    select() { return o; }, insert(p) { op = 'i'; pay = p; return o; }, update(p) { op = 'u'; pay = p; return o; },
    eq(k, v) { f.push(r => r[k] === v); return o; }, neq(k, v) { f.push(r => r[k] !== v); return o; },
    gte(k, v) { f.push(r => r[k] >= v); return o; }, lte(k, v) { f.push(r => r[k] <= v); return o; },
    order() { return o; }, maybeSingle() { single = true; return o; },
    then(res, rej) {
      const m = DB[t].filter(r => f.every(x => x(r)));
      if (op === 'i') { DB[t].push({ id: 'id' + (idn++) + '-0000', ...pay }); return Promise.resolve({ error: null }).then(res, rej); }
      if (op === 'u') { m.forEach(r => Object.assign(r, pay)); return Promise.resolve({ error: null }).then(res, rej); }
      return Promise.resolve({ data: single ? (m[0] || null) : m, error: null }).then(res, rej);
    }
  };
  return o;
}
const orig = Module._load;
Module._load = function (req, ...a) { return req === '@supabase/supabase-js' ? { createClient: () => ({ from: q }) } : orig.call(this, req, ...a); };
const { atender } = require('../api/meta-webhook.js');
let fallos = 0; const ok = (c, n, x) => { console.log(c ? 'OK  ' : 'FAIL', n, c ? '' : x || ''); if (!c) fallos = 1; };
const msg = (t, from = '34600111222') => ({ from, id: 'm' + Math.random(), text: { body: t } });
(async () => {
  const mañana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  let r = await atender('PN1', msg('servicios'), 'Pepe');
  ok(/1\. Depilación/.test(r) && !/2\./.test(r), 'servicios sin duplicados', r);
  r = await atender('PN1', msg('reservar 1 mañana 11:00'), 'Pepe');
  ok(/Reservado/.test(r) && DB.appointments.length === 1 && DB.appointments[0].notes === 'wa:34600111222' && DB.appointments[0].status === 'scheduled', 'reserva crea la cita', r);
  r = await atender('PN1', msg('reservar 1 mañana 11:00', '34699999999'), 'Ana');
  ok(/no está libre|se acaba de ocupar/.test(r) && DB.appointments.length === 1, 'otro cliente no puede coger el mismo hueco', r);
  r = await atender('PN1', msg('mis citas'), 'Pepe');
  ok(/CANCELAR/.test(r), 'mis citas', r);
  r = await atender('PN1', msg('mis citas', '34699999999'), 'Ana');
  ok(/No tienes citas/.test(r), 'otro cliente no ve citas ajenas', r);
  const cod = DB.appointments[0].id.slice(0, 4);
  r = await atender('PN1', msg('cancelar ' + cod, '34699999999'), 'Ana');
  ok(DB.appointments[0].status === 'scheduled', 'otro cliente no puede cancelar mi cita', r);
  r = await atender('PN1', msg('cancelar ' + cod), 'Pepe');
  ok(/cancelado/.test(r) && DB.appointments[0].status === 'cancelled', 'cancelar', r);
  r = await atender('PN1', msg('reservar 1 mañana 11:00', '34699999999'), 'Ana');
  ok(/Reservado/.test(r) && DB.appointments.length === 2, 'el hueco cancelado vuelve a estar libre', r);
  r = await atender('OTRO', msg('hola'), 'X');
  ok(r === null, 'número desconocido: no responde');
  process.exit(fallos);
})();

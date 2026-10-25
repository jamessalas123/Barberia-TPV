/* Prueba de integración con una base de datos simulada en memoria. */
const Module = require('module');
const DB = {
  asistente_numeros: [{ phone_number_id: 'PN1', user_id: 'U1' }],
  profiles: [{ id: 'U1', nombre: 'Dueño', horario: null, asistente: { equipo: ['Luisa'], nombre_negocio: 'Uñas y Uñas' } }],
  servicios: [{ user_id: 'U1', nombre: 'Depilación', precio: 50, duracion_min: 45 }, { user_id: 'U1', nombre: 'Depilación', precio: 50, duracion_min: 45 }],
  appointments: [], asistente_conversaciones: [], agente_registro: [], avisos_dueno: [], bloqueos: []
};
let idn = 1;
function q(t) {
  const f = []; let op = 's', pay = null, single = false;
  const o = {
    select() { return o; }, upsert(p) { op = 'up'; pay = p; return o; }, insert(p) { op = 'i'; pay = p; return o; }, update(p) { op = 'u'; pay = p; return o; },
    eq(k, v) { f.push(r => r[k] === v); return o; }, neq(k, v) { f.push(r => r[k] !== v); return o; },
    gte(k, v) { f.push(r => r[k] >= v); return o; }, lte(k, v) { f.push(r => r[k] <= v); return o; },
    order() { return o; }, limit() { return o; }, maybeSingle() { single = true; return o; },
    then(res, rej) {
      const m = DB[t].filter(r => f.every(x => x(r)));
      if (op === 'i') { DB[t].push({ id: 'ab0' + (idn++) + '-0000', created_at: new Date().toISOString(), leido: false, ...pay }); return Promise.resolve({ error: null }).then(res, rej); }
      if (op === 'up') { const k = DB[t].findIndex(r => r.phone_number_id === pay.phone_number_id && r.cliente === pay.cliente); if (k >= 0) DB[t][k] = pay; else DB[t].push(pay); return Promise.resolve({ error: null }).then(res, rej); }
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
  r = await atender('PN1', msg('hola'), 'Pepe');
  ok(/asistente virtual de Uñas y Uñas/.test(r) && !/Dueño/.test(r), 'se presenta con el nombre del negocio', r);
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
  /* ── Conversación por reglas con memoria de estado ── */
  DB.appointments.length = 0; DB.asistente_conversaciones.length = 0;
  r = await atender('PN1', msg('quiero una cita el lunes por la tarde'), 'Pepe');
  ok(/Horas libres/.test(r) && /Luisa: 15:00/.test(r), 'reglas: un solo servicio, ofrece la tarde del lunes', r);
  r = await atender('PN1', msg('a las 5'), 'Pepe');
  ok(/¿Te reservo/.test(r) && DB.appointments.length === 0, 'reglas: pide confirmación sin reservar aún', r);
  r = await atender('PN1', msg('sí'), 'Pepe');
  ok(/Reservado/.test(r) && DB.appointments.length === 1 && DB.appointments[0].barbero === 'Luisa' && DB.appointments[0].start_time === '17:00:00', 'reglas: tras el sí reserva', r + JSON.stringify(DB.appointments));
  r = await atender('PN1', msg('sí'), 'Pepe');
  ok(DB.appointments.length === 1, 'un segundo sí no duplica la cita', r);
  DB.asistente_conversaciones.forEach(c => c.updated_at = new Date(Date.now() - 40 * 60 * 1000).toISOString());
  /* ── Aviso al dueño ── */
  r = await atender('PN1', msg('quiero hablar con una persona', '34677000111'), 'Rosa');
  ok(/aviso a/.test(r) && DB.avisos_dueno.length === 1 && DB.avisos_dueno[0].cliente === '34677000111' && DB.avisos_dueno[0].cliente_nombre === 'Rosa' && DB.avisos_dueno[0].user_id === 'U1' && DB.avisos_dueno[0].leido === false, 'aviso: se guarda para el dueño', r + JSON.stringify(DB.avisos_dueno));
  r = await atender('PN1', msg('persona', '34677000111'), 'Rosa');
  ok(/Ya he avisado/.test(r) && DB.avisos_dueno.length === 1, 'aviso: no se duplica en 2 h', r);
  /* ── Modo agente (IA simulada) ── */
  const { crearLLMSimulado } = require('../api/_llm.js');
  DB.appointments.length = 0;
  const T = (t) => ({ content: [{ type: 'text', text: t }] });
  const U = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }] });
  const mañana2 = '2026-10-26';
  let llm = crearLLMSimulado([T('Hola, ¿qué servicio quieres?')]);
  r = await atender('PN1', msg('buenas, quería una cita'), 'Pepe', { llm });
  ok(/qué servicio/.test(r) && DB.asistente_conversaciones.some(c => c.cliente === '34600111222'), 'IA: responde y guarda la conversación', r);
  const sistemaVisto = [];
  llm = crearLLMSimulado([U('a', 'reservar', { servicio: 'Depilación', fecha: mañana2, hora: '16:00', profesional: 'Luisa' }), (p) => { sistemaVisto.push(p.messages); return T('Reservado ✅'); }]);
  r = await atender('PN1', msg('sí, a las 16 con Luisa'), 'Pepe', { llm });
  ok(/Reservado/.test(r) && DB.appointments.length === 1 && DB.appointments[0].barbero === 'Luisa' && DB.appointments[0].notes === 'wa:34600111222', 'IA: reserva de verdad en la agenda', JSON.stringify(DB.appointments));
  ok(sistemaVisto[0][0].content === 'buenas, quería una cita', 'IA: recuerda la conversación anterior', JSON.stringify(sistemaVisto[0].slice(0, 2)));
  ok(DB.agente_registro.length === 1 && DB.agente_registro[0].herramienta === 'reservar' && DB.agente_registro[0].user_id === 'U1', 'IA: queda registrado lo que hizo', JSON.stringify(DB.agente_registro));
  llm = crearLLMSimulado([U('a', 'reservar', { servicio: 'Depilación', fecha: mañana2, hora: '16:00', profesional: 'Luisa' }), T('x')]);
  await atender('PN1', msg('reserva a las 16', '34699999999'), 'Ana', { llm });
  ok(DB.appointments.length === 1, 'IA: otro cliente no puede coger el mismo hueco');
  llm = crearLLMSimulado([U('a', 'mis_citas', {}), T('ok')]);
  const antes = DB.agente_registro.length;
  await atender('PN1', msg('mis citas', '34699999999'), 'Ana', { llm });
  ok(JSON.parse(JSON.stringify(DB.agente_registro[antes].resultado)).citas.length === 0, 'IA: otro cliente no ve citas ajenas', JSON.stringify(DB.agente_registro[antes]));
  const cod2 = DB.appointments[0].id.slice(0, 4);
  llm = crearLLMSimulado([U('a', 'cancelar', { codigo: cod2 }), T('x')]);
  await atender('PN1', msg('cancela', '34699999999'), 'Ana', { llm });
  ok(DB.appointments[0].status === 'scheduled', 'IA: otro cliente no puede cancelar mi cita');
  llm = crearLLMSimulado([U('a', 'cancelar', { codigo: cod2 }), T('Cancelada')]);
  await atender('PN1', msg('cancela mi cita', '34600111222'), 'Pepe', { llm });
  ok(DB.appointments[0].status === 'cancelled', 'IA: cancela la propia');
  {
    const { crearLLMSimulado: sim } = require('../api/_llm.js');
    const antesAv = DB.avisos_dueno.length;
    llm = sim([U('z', 'avisar_persona', { motivo: 'queja por la última visita' }), T('He avisado al negocio')]);
    r = await atender('PN1', msg('estoy muy descontento', '34688000222'), 'Luis', { llm });
    ok(DB.avisos_dueno.length === antesAv + 1 && /queja/.test(DB.avisos_dueno[antesAv].mensaje), 'IA: herramienta avisar_persona crea el aviso', JSON.stringify(DB.avisos_dueno));
  }
  /* si la IA falla, caemos a comandos */
  const llmRoto = async () => { throw new Error('sin saldo'); };
  r = await atender('PN1', msg('servicios'), 'Pepe', { llm: llmRoto });
  ok(/1\. Depilación/.test(r), 'si la IA falla, responde por comandos', r);
  /* conversación caducada (más de 24 h) se olvida */
  DB.asistente_conversaciones.forEach(c => c.updated_at = new Date(Date.now() - 25 * 3600 * 1000).toISOString());
  const vistos2 = [];
  llm = crearLLMSimulado([(p) => { vistos2.push(p.messages.length); return T('hola'); }]);
  await atender('PN1', msg('hola de nuevo'), 'Pepe', { llm });
  ok(vistos2[0] === 1, 'conversación caducada se olvida', String(vistos2[0]));
  /* ── Bloqueos de tiempo del dueño ── */
  DB.appointments.length = 0; DB.asistente_conversaciones.length = 0;
  const diaB = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const diaTxt = diaB.slice(8, 10) + '/' + diaB.slice(5, 7) + '/' + diaB.slice(0, 4);
  DB.bloqueos.push({ user_id: 'U1', fecha: diaB, fecha_fin: diaB, hora_desde: '11:00:00', hora_hasta: '12:30:00', profesional: null, motivo: 'Cita médica' });
  r = await atender('PN1', msg('reservar 1 ' + diaTxt + ' 11:30'), 'Pepe');
  ok(!/Reservado/.test(r) && DB.appointments.length === 0, 'no reserva dentro de un bloqueo', r);
  r = await atender('PN1', msg('reservar 1 ' + diaTxt + ' 13:00'), 'Pepe');
  ok(/Reservado/.test(r) && DB.appointments.length === 1, 'sí reserva fuera del bloqueo', r);
  DB.bloqueos.length = 0; DB.bloqueos.push({ user_id: 'U1', fecha: diaB, fecha_fin: diaB, hora_desde: null, hora_hasta: null, profesional: null, motivo: 'Vacaciones' });
  DB.appointments.length = 0;
  r = await atender('PN1', msg('reservar 1 ' + diaTxt + ' 17:00'), 'Pepe');
  ok(!/Reservado/.test(r) && DB.appointments.length === 0, 'día completo bloqueado: no reserva', r);
  r = await atender('PN1', msg('reservar 1 15/13 11:00'), 'Pepe');
  ok(typeof r === 'string' && r.length > 0, 'una fecha imposible (15/13) no rompe el bot', String(r));
  process.exit(fallos);
})();

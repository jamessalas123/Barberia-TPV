const { atenderDemo, permitir, limpiarHistorial, limpiarCitas, MAX_MSG_DIA } = require('../api/_demo.js');
const { crearLLMSimulado } = require('../api/_llm.js');
let fallos = 0; const ok = (c, n, x) => { console.log(c ? 'OK  ' : 'FAIL', n, c ? '' : x || ''); if (!c) fallos = 1; };
const uso = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }] });
const texto = (t) => ({ content: [{ type: 'text', text: t }] });
const demo = { codigo: 'lola', nombre: 'Peluquería Lola', activa: true, expira_at: new Date(Date.now() + 86400000).toISOString(), mensajes_dia: 0, dia: null,
  config: { servicios: [{ nombre: 'Corte', precio: 15, duracion_min: 30 }], equipo: ['Lola'], faq: [{ p: '¿Aceptáis tarjeta?', r: 'Sí, aceptamos tarjeta.' }], descripcion: 'Peluquería en Monzón.' } };
const ahora = { fecha: '2026-10-26', min: 9 * 60 };

(async () => {
  // 1. Reservar en la demo: la cita queda solo en la respuesta (no hay base de datos)
  let sistemaVisto = '';
  let llm = crearLLMSimulado([p => { sistemaVisto = p.system; return uso('t1', 'reservar', { servicio: 'Corte', fecha: '2026-10-27', hora: '11:00' }); }, texto('Reservado ✅')]);
  let r = await atenderDemo({ demo, mensaje: 'reserva corte mañana a las 11', historial: [], citas: [], llm, ahora });
  ok(r.respuesta === 'Reservado ✅' && r.citas.length === 1 && r.citas[0].start_time === '11:00:00', 'reserva de prueba en la respuesta', JSON.stringify(r));
  ok(/DEMOSTRACIÓN/.test(sistemaVisto) && /Aceptáis tarjeta/.test(sistemaVisto) && /Peluquería en Monzón/.test(sistemaVisto), 'instrucciones con info del negocio y aviso de demo');
  // 2. Ocupado: segunda reserva a la misma hora falla
  llm = crearLLMSimulado([uso('t1', 'reservar', { servicio: 'Corte', fecha: '2026-10-27', hora: '11:00' }), p => { const res = JSON.parse(p.messages[p.messages.length - 1].content[0].content); return texto(res.ok === false ? 'ocupado' : 'mal'); }]);
  r = await atenderDemo({ demo, mensaje: 'otra', historial: [], citas: r.citas, llm, ahora });
  ok(r.respuesta === 'ocupado' && r.citas.length === 1, 'no permite doble reserva en la demo', r.respuesta);
  // 3. Aviso a persona no escribe en ningún sitio y responde
  llm = crearLLMSimulado([uso('t1', 'avisar_persona', { motivo: 'quiere persona' }), texto('Avisado')]);
  r = await atenderDemo({ demo, mensaje: 'quiero una persona', historial: [], citas: [], llm, ahora });
  ok(r.respuesta === 'Avisado', 'avisar_persona funciona en demo');
  // 4. Mensaje vacío / larguísimo / historial manipulado
  r = await atenderDemo({ demo, mensaje: '   ', historial: [], citas: [], llm, ahora });
  ok(!!r.error, 'rechaza mensaje vacío');
  const h = limpiarHistorial([{ role: 'assistant', content: 'x' }, { role: 'system', content: 'malo' }, { role: 'user', content: 'a'.repeat(5000) }, { role: 'assistant', content: { raro: 1 } }]);
  ok(h.length === 1 && h[0].role === 'user' && h[0].content.length === 1500, 'historial saneado', JSON.stringify(h).slice(0, 80));
  ok(limpiarCitas([{ appointment_date: 'xx', start_time: '10:00' }, { appointment_date: '2026-10-27', start_time: '10:00:00' }]).length === 1, 'citas saneadas');
  // 5. Permisos: caducada, desactivada, tope diario
  const db = { from: () => ({ update: () => ({ eq: async () => ({}) }) }) };
  ok((await permitir(db, { ...demo, activa: false }, '2026-10-26')).status === 404, 'demo desactivada');
  ok((await permitir(db, { ...demo, expira_at: '2020-01-01T00:00:00Z' }, '2026-10-26')).status === 410, 'demo caducada');
  ok((await permitir(db, { ...demo, dia: '2026-10-26', mensajes_dia: MAX_MSG_DIA }, '2026-10-26')).status === 429, 'tope diario');
  ok((await permitir(db, { ...demo, dia: '2026-10-25', mensajes_dia: MAX_MSG_DIA }, '2026-10-26')).ok === true, 'el tope se reinicia otro día');
  process.exit(fallos);
})();

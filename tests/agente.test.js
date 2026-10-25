const { correrAgente, historialCompacto } = require('../api/_agente.js');
const { herramientas, instrucciones } = require('../api/_agente_citas.js');
const { crearLLMSimulado } = require('../api/_llm.js');
let fallos = 0; const ok = (c, n, x) => { console.log(c ? 'OK  ' : 'FAIL', n, c ? '' : x || ''); if (!c) fallos = 1; };

const ahora = { fecha: '2026-10-24', min: 9 * 60 };
const horario = { 1: { a: '09:00', c: '21:00' }, 2: { a: '09:00', c: '21:00' } };
const negocio = { nombre: 'Uñas y Uñas', horario, equipo: ['Luisa', 'Pedro'], servicios: [{ nombre: 'depilacion', precio: 50, duracion_min: 45 }, { nombre: 'masaje corporal', precio: 20, duracion_min: 60 }] };
function nuevoCtx(extra = {}) {
  const creadas = [], canceladas = [];
  const citas = { '2026-10-26': [{ start_time: '10:30:00', duration_minutes: 45, status: 'scheduled', barbero: 'Luisa' }] };
  const mias = [{ id: 'a1b2c3d4-0', appointment_date: '2026-10-26', start_time: '10:30:00', service: 'depilacion', barbero: 'Luisa', status: 'scheduled' }];
  return { creadas, canceladas, ahora, negocio, telefono: '34600111222', nombreCliente: 'Pepe',
    citasDia: f => citas[f] || [], citasCliente: () => mias,
    crearCita: async c => { creadas.push(c); return { ok: true }; }, cancelarCita: async id => { canceladas.push(id); return { ok: true }; }, ...extra };
}
const uso = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }] });
const texto = (t) => ({ content: [{ type: 'text', text: t }] });
const run = (ctx, llm, msg, hist = []) => correrAgente({ llm, sistema: instrucciones(ctx), herramientas, ctx, historial: hist, mensajeUsuario: msg });

(async () => {
  // 1. Flujo completo: ver huecos -> confirmar -> reservar
  let ctx = nuevoCtx();
  let vistoResultado = null;
  let llm = crearLLMSimulado([
    uso('t1', 'ver_huecos', { servicio: 'depilacion', fecha: '2026-10-26', desde: '15:00' }),
    (p) => { vistoResultado = JSON.parse(p.messages[p.messages.length - 1].content[0].content); return texto('El lunes por la tarde hay hueco con Luisa y Pedro. ¿Qué hora y con quién?'); }
  ]);
  let r = await run(ctx, llm, 'Quiero una depilación el lunes por la tarde');
  ok(/lunes por la tarde/.test(r.texto) && r.pasos === 2, 'agente consulta huecos y responde', JSON.stringify(r));
  ok(vistoResultado && vistoResultado.por_profesional.length === 2 && vistoResultado.por_profesional.every(p => p.horas.every(h => h >= '15:00')), 'filtra por la tarde', JSON.stringify(vistoResultado));
  ctx = nuevoCtx();
  llm = crearLLMSimulado([uso('t1', 'reservar', { servicio: 'depilacion', fecha: '2026-10-26', hora: '16:00', profesional: 'pedro' }), texto('¡Listo! Reservada.')]);
  r = await run(ctx, llm, 'Sí, a las 16:00 con Pedro');
  ok(ctx.creadas.length === 1 && ctx.creadas[0].barbero === 'Pedro' && ctx.creadas[0].start_time === '16:00:00' && ctx.creadas[0].notes === 'wa:34600111222', 'reserva se guarda bien', JSON.stringify(ctx.creadas));
  // 2. La IA intenta reservar una hora ocupada -> la herramienta lo impide
  ctx = nuevoCtx(); let rr = null;
  llm = crearLLMSimulado([uso('t1', 'reservar', { servicio: 'depilacion', fecha: '2026-10-26', hora: '10:30', profesional: 'Luisa' }), (p) => { rr = JSON.parse(p.messages[p.messages.length - 1].content[0].content); return texto('Esa hora no está libre'); }]);
  await run(ctx, llm, 'reserva a las 10:30 con Luisa');
  ok(ctx.creadas.length === 0 && rr.ok === false && rr.horas_libres, 'no deja reservar un hueco ocupado', JSON.stringify(rr));
  // 3. Sin profesional con varios -> error pidiendo profesional
  ctx = nuevoCtx(); rr = null;
  llm = crearLLMSimulado([uso('t1', 'reservar', { servicio: 'depilacion', fecha: '2026-10-26', hora: '16:00' }), (p) => { rr = JSON.parse(p.messages[p.messages.length - 1].content[0].content); return texto('¿Con quién?'); }]);
  await run(ctx, llm, 'a las 16');
  ok(ctx.creadas.length === 0 && /falta el profesional/.test(rr.error), 'exige profesional si hay varios', JSON.stringify(rr));
  // 4. Validaciones: fecha pasada, formato, lejana, servicio inexistente
  ctx = nuevoCtx();
  for (const [a, esperado] of [[{ servicio: 'depilacion', fecha: '2026-10-20', hora: '10:00', profesional: 'Pedro' }, /ya pasó/], [{ servicio: 'depilacion', fecha: 'mañana', hora: '10:00' }, /inválida/], [{ servicio: 'depilacion', fecha: '2027-05-01', hora: '10:00' }, /antelación/], [{ servicio: 'tinte', fecha: '2026-10-26', hora: '10:00' }, /no reconocido/], [{ servicio: 'depilacion', fecha: '2026-10-26', hora: '10', profesional: 'Pedro' }, /hora inválida/]]) {
    const res = await herramientas.reservar.ejecutar(a, ctx);
    ok(esperado.test(res.error || ''), 'validación ' + JSON.stringify(a), JSON.stringify(res));
  }
  ok(ctx.creadas.length === 0, 'ninguna validación fallida crea cita');
  // 5. Cancelar: solo citas del propio cliente
  ctx = nuevoCtx();
  let res = await herramientas.cancelar.ejecutar({ codigo: 'zzzz' }, ctx);
  ok(res.ok === false && ctx.canceladas.length === 0, 'cancelar código ajeno no hace nada');
  res = await herramientas.cancelar.ejecutar({ codigo: 'a' }, ctx);
  ok(res.ok === false && ctx.canceladas.length === 0, 'código demasiado corto no cancela');
  res = await herramientas.cancelar.ejecutar({ codigo: 'a1b2' }, ctx);
  ok(res.ok && ctx.canceladas[0] === 'a1b2c3d4-0', 'cancelar la propia');
  // 6. Herramienta desconocida y fallo interno
  ctx = nuevoCtx();
  llm = crearLLMSimulado([uso('t1', 'borrar_todo', {}), texto('No puedo')]);
  r = await run(ctx, llm, 'borra todo');
  ok(/No puedo/.test(r.texto), 'herramienta desconocida no rompe');
  // 7. Bucle infinito acotado
  ctx = nuevoCtx();
  llm = crearLLMSimulado(Array.from({ length: 10 }, (_, i) => uso('t' + i, 'ver_servicios', {})));
  r = await run(ctx, llm, 'hola');
  ok(r.excedido && llm.llamadas() === 6, 'máximo de pasos', String(llm.llamadas()));
  // 8. Registro de auditoría
  ctx = nuevoCtx(); const reg = [];
  llm = crearLLMSimulado([uso('t1', 'ver_servicios', {}), texto('ok')]);
  await correrAgente({ llm, sistema: '', herramientas, ctx, mensajeUsuario: 'hola', registrar: async x => reg.push(x) });
  ok(reg.length === 1 && reg[0].herramienta === 'ver_servicios', 'registra las herramientas usadas');
  // 9. Historial compacto
  const h = historialCompacto([{ role: 'user', content: 'hola' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'a', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: '{}' }] }, { role: 'assistant', content: [{ type: 'text', text: 'buenas' }] }]);
  ok(JSON.stringify(h) === JSON.stringify([{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'buenas' }]), 'historial solo guarda texto', JSON.stringify(h));
  // 10. Instrucciones incluyen nombre y fecha
  const ins = instrucciones(nuevoCtx());
  ok(/Uñas y Uñas/.test(ins) && /2026-10-24/.test(ins) && !/Escalia/.test(ins), 'instrucciones con negocio y fecha, sin Escalia');
  ok(/SOLO la herramienta avisar_persona/.test(ins) && /No menciones citas/.test(ins), 'instrucciones: al pedir persona solo avisar y despedirse');
  process.exit(fallos);
})();

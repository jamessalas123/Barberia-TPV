const { procesar, parseFecha } = require('../api/_asistente.js');
let fallos = 0;
const ok = (c, n, extra) => { console.log(c ? 'OK  ' : 'FAIL', n, c ? '' : extra || ''); if (!c) fallos = 1; };
const hoy = '2026-10-24'; // sábado
const ahora = { fecha: hoy, min: 8 * 60 };
const horario = { 0: null, 1: { a: '09:00', c: '21:00' }, 2: { a: '09:00', c: '21:00' }, 6: { a: '10:00', c: '12:00' } };
const negocio = { nombre: 'Estética Luisa', horario, equipo: ['Luisa', 'Marta'], servicios: [{ nombre: 'Depilación', precio: 50, duracion_min: 45 }, { nombre: 'Masaje corporal', precio: 20, duracion_min: 60 }] };
const citas = { [hoy]: [{ start_time: '10:00:00', duration_minutes: 45, status: 'scheduled', barbero: 'Luisa' }] };
const base = { telefono: '34600111222', nombre: 'Pepe', ahora, negocio, citasDia: f => citas[f] || [], citasCliente: [] };
const p = (t, x = {}) => procesar({ ...base, ...x, texto: t });

ok(parseFecha('mañana', hoy) === '2026-10-25', 'fecha mañana');
ok(parseFecha('25/10', hoy) === '2026-10-25', 'fecha 25/10');
ok(parseFecha('1/1', hoy) === '2027-01-01', 'fecha pasada → año siguiente');
ok(parseFecha('31/02', hoy) === null, 'fecha imposible');
ok(/Depilación/.test(p('servicios').respuesta), 'servicios');
ok(/Hola/.test(p('buenas').respuesta), 'ayuda por defecto');
let r = p('huecos 1 hoy');
ok(/Luisa: 11:00\n/.test(r.respuesta) && /Marta: 10:00, 10:30, 11:00/.test(r.respuesta), 'huecos por profesional', r.respuesta);
r = p('RESERVAR 1 hoy 10:00 marta');
ok(r.accion && r.accion.tipo === 'crear' && r.accion.cita.barbero === 'Marta' && r.accion.cita.start_time === '10:00:00' && r.accion.cita.notes === 'wa:34600111222', 'reservar con Marta', JSON.stringify(r));
r = p('reservar 1 hoy 10:00 luisa');
ok(!r.accion && /no está libre/.test(r.respuesta), 'no reserva hueco ocupado');
r = p('reservar 1 hoy 10:30');
ok(!r.accion && /¿Con quién\?/.test(r.respuesta), 'pide profesional si hay varios');
r = p('reservar 1 hoy');
ok(!r.accion && /hora/.test(r.respuesta), 'pide la hora');
r = p('reservar 1 ayer 10:00');
ok(!r.accion, 'fecha no reconocida no reserva', r.respuesta);
r = p('reservar 1 20/10/2026 10:00 luisa');
ok(!r.accion && /ya pas/.test(r.respuesta), 'fecha pasada');
r = p('reservar 1 01/05 10:00 luisa', {});
ok(!r.accion && /antelación/.test(r.respuesta), 'demasiado lejos', r.respuesta);
r = p('huecos 9 hoy');
ok(/No reconozco el servicio/.test(r.respuesta), 'servicio inexistente');
r = p('huecos 1 domingo');
ok(/No reconozco/.test(r.respuesta), 'palabra desconocida');
r = p('huecos masaje 26/10'); // domingo cerrado (2026-10-25 es domingo; 26 lunes)
ok(/Masaje corporal/.test(r.respuesta) && /09:00/.test(r.respuesta), 'busca servicio por nombre');
r = p('huecos 1 mañana'); // domingo cerrado
ok(/sin huecos/.test(r.respuesta), 'día cerrado sin huecos', r.respuesta);
const mias = [{ id: 'a1b2c3d4-0000', appointment_date: '2026-10-26', start_time: '10:00:00', service: 'Depilación', barbero: 'Luisa', status: 'scheduled' }];
ok(/CANCELAR a1b2/.test(p('mis citas', { citasCliente: mias }).respuesta), 'mis citas con código');
r = p('cancelar a1b2', { citasCliente: mias });
ok(r.accion && r.accion.tipo === 'cancelar' && r.accion.id === 'a1b2c3d4-0000', 'cancelar');
r = p('cancelar zzzz', { citasCliente: mias });
ok(!r.accion, 'cancelar código ajeno no hace nada');
ok(/persona/i.test(p('persona').respuesta), 'persona');
// negocio individual (sin equipo)
const ind = { ...negocio, equipo: [] };
r = p('reservar 2 hoy 11:00', { negocio: ind });
ok(r.accion && r.accion.cita.barbero === null, 'individual: sin profesional');
process.exit(fallos);

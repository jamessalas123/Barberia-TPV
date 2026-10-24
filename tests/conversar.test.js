const { procesar } = require('../api/_asistente.js');
const { extraerFecha, extraerHora, extraerFranja } = require('../api/_conversar.js');
let fallos = 0; const ok = (c, n, x) => { console.log(c ? 'OK  ' : 'FAIL', n, c ? '' : x || ''); if (!c) fallos = 1; };
const hoy = '2026-10-24'; // sábado
const ahora = { fecha: hoy, min: 8 * 60 };
const horario = { 0: null, 1: { a: '09:00', c: '21:00' }, 2: { a: '09:00', c: '21:00' }, 3: { a: '09:00', c: '21:00' }, 4: { a: '09:00', c: '21:00' }, 5: { a: '09:00', c: '21:00' }, 6: { a: '09:00', c: '21:00' } };
const negocio = { nombre: 'Uñas y Uñas', horario, equipo: ['Luisa', 'Pedro'], servicios: [{ nombre: 'Depilación', precio: 50, duracion_min: 45 }, { nombre: 'Masaje corporal', precio: 20, duracion_min: 60 }] };
const citasMap = { '2026-10-26': [{ start_time: '10:30:00', duration_minutes: 45, status: 'scheduled', barbero: 'Luisa' }] };
const mias = [{ id: 'a1b2c3d4-0', appointment_date: '2026-10-26', start_time: '10:30:00', service: 'Depilación', barbero: 'Luisa', status: 'scheduled' }];
function chat(neg = negocio, citasCliente = mias) {
  let estado = null;
  return (texto) => { const r = procesar({ texto, telefono: '34600111222', nombre: 'Pepe', ahora, negocio: neg, citasDia: f => citasMap[f] || [], citasCliente, estado }); estado = r.estado; return r; };
}
// extracción
ok(extraerFecha('pasado manana', hoy) === '2026-10-26', 'pasado mañana');
ok(extraerFecha('el dia 28', hoy) === '2026-10-28' && extraerFecha('el 3', hoy) === '2026-11-03', 'el día N (mes siguiente si ya pasó)');
ok(extraerFecha('el viernes', hoy) === '2026-10-30', 'el viernes');
ok(extraerHora('a las 5') === '17:00' && extraerHora('a las 10') === '10:00' && extraerHora('a las 5 de la manana') === '05:00', 'hora: a las 5 → 17:00');
ok(extraerHora('a las 4 y media') === '16:30' && extraerHora('17h') === '17:00' && extraerHora('10.30') === '10:30' && extraerHora('a las 6 menos cuarto') === '17:45', 'horas variadas');
ok(extraerFranja('despues de las 5').desde === '17:00' && extraerFranja('antes de las 12').hasta === '12:00' && extraerFranja('por la tarde').desde === '15:00', 'franjas');

// Conversación completa, paso a paso
let c = chat(), r;
r = c('Hola buenas');
ok(/asistente virtual de Uñas y Uñas/.test(r.respuesta) && !/RESERVAR/.test(r.respuesta), 'saludo natural sin comandos', r.respuesta);
r = c('quiero una cita mañana por la tarde');
ok(/¿Qué servicio quieres\?/.test(r.respuesta), 'pide el servicio (mañana = domingo cerrado se comprobará luego)', r.respuesta);
r = c('depilación');
ok(/cerrados/.test(r.respuesta), 'mañana es domingo: cerrado', r.respuesta);
r = c('mejor el lunes por la tarde');
ok(/Horas libres/.test(r.respuesta) && /Luisa:/.test(r.respuesta) && /Pedro:/.test(r.respuesta) && !/\b1[0-4]:\d\d\b/.test(r.respuesta.split('Horas libres:')[1]), 'lunes por la tarde: solo horas desde las 15', r.respuesta);
r = c('a las 5 con Pedro');
ok(/¿Te reservo Depilación/.test(r.respuesta) && /17:00/.test(r.respuesta) && /Pedro/.test(r.respuesta) && !r.accion, 'pide confirmación', r.respuesta);
r = c('sí');
ok(r.accion && r.accion.tipo === 'crear' && r.accion.cita.start_time === '17:00:00' && r.accion.cita.barbero === 'Pedro' && r.accion.cita.appointment_date === '2026-10-26' && r.accion.cita.notes === 'wa:34600111222' && /Reservado/.test(r.respuesta), 'confirma y reserva', JSON.stringify(r));

// Todo en una frase
c = chat();
r = c('Quiero una depilación el lunes a las 4 y media con Pedro');
ok(/¿Te reservo/.test(r.respuesta) && /16:30/.test(r.respuesta), 'frase completa → confirma', r.respuesta);
r = c('no');
ok(!r.accion && /no hago nada/.test(r.respuesta), 'no cancela la reserva', r.respuesta);
// cambia de idea antes de confirmar
c = chat();
c('quiero depilación el lunes a las 4 con Pedro');
r = c('mejor a las 6');
ok(/18:00/.test(r.respuesta) && /¿Te reservo/.test(r.respuesta), 'cambia la hora y reconfirma', r.respuesta);
// hueco ocupado
c = chat();
r = c('quiero depilación el lunes a las 10:30 con Luisa');
ok(/no está libre/.test(r.respuesta) && !r.accion, 'hora ocupada, ofrece alternativas', r.respuesta);
// solo preguntar horas
c = chat();
r = c('¿qué horas tenéis libres el martes para masaje?');
ok(/Masaje corporal \(60 min\)/.test(r.respuesta) && /Horas libres/.test(r.respuesta), 'consulta de horas', r.respuesta);
// sin profesional y hay hueco con uno solo
c = chat();
r = c('depilación el lunes a las 10:30');
ok(/¿Te reservo/.test(r.respuesta) && /con Pedro/.test(r.respuesta), 'si solo uno está libre lo asigna', r.respuesta);
// servicios y precios
r = chat()('¿cuánto cuesta?');
ok(/Depilación · 45 min · 50 €/.test(r.respuesta), 'precios', r.respuesta);
r = chat()('qué servicios tenéis');
ok(/Masaje corporal/.test(r.respuesta), 'servicios', r.respuesta);
// mis citas
r = chat()('¿cuándo tengo cita?');
ok(/lunes, 26 de octubre a las 10:30/.test(r.respuesta), 'mis citas', r.respuesta);
// cancelar con confirmación
c = chat();
r = c('quiero cancelar mi cita');
ok(/¿Cancelo tu cita/.test(r.respuesta) && !r.accion, 'cancelar pide confirmación', r.respuesta);
r = c('sí');
ok(r.accion && r.accion.tipo === 'cancelar' && r.accion.id === 'a1b2c3d4-0', 'cancelar tras confirmar', JSON.stringify(r));
r = chat(negocio, [])('cancela mi cita');
ok(/no tienes citas/i.test(r.respuesta) && !r.accion, 'sin citas no cancela');
// un solo servicio y sin profesionales
const solo = { ...negocio, equipo: [], servicios: [negocio.servicios[0]] };
c = chat(solo);
r = c('quiero cita el martes por la tarde');
ok(/Horas libres/.test(r.respuesta) && !/¿Qué servicio/.test(r.respuesta), 'un solo servicio: no lo pregunta', r.respuesta);
r = c('a las 17');
ok(/¿Te reservo Depilación/.test(r.respuesta) && !/ con /.test(r.respuesta), 'sin profesionales', r.respuesta);
// basura / persona
r = chat()('asdfgh');
ok(/No estoy seguro/.test(r.respuesta), 'no entiende → ayuda amable');
r = chat()('quiero hablar con una persona');
ok(/persona/.test(r.respuesta) && !r.accion, 'persona');
// comandos antiguos siguen funcionando
r = chat()('reservar 1 lunes 16:00 pedro');
ok(r.accion && r.accion.tipo === 'crear', 'comando antiguo directo sigue funcionando', r.respuesta);
// ── Casos reales de la prueba de James (24-oct) ──
const neg3 = { ...negocio, servicios: [{ nombre: 'depilacion', precio: 50, duracion_min: 45 }, { nombre: 'Corte de cabello', precio: 20, duracion_min: 60 }, { nombre: 'masaje corporal', precio: 20, duracion_min: 60 }] };
const ahora2 = { fecha: hoy, min: 10 * 60 + 20 };
function chat2() { let estado = null; return (texto) => { const r = procesar({ texto, telefono: '34600111222', nombre: 'Pepe', ahora: ahora2, negocio: neg3, citasDia: f => citasMap[f] || [], citasCliente: [], estado }); estado = r.estado; return r; }; }
c = chat2();
r = c('Reservar');
ok(/¿Qué servicio quieres\?/.test(r.respuesta), 'real: "Reservar" a secas pregunta el servicio', r.respuesta);
c = chat2();
r = c('Hola tienes cita para hoy');
ok(/¿Qué servicio quieres\?/.test(r.respuesta), 'real: "tienes cita para hoy"', r.respuesta);
r = c('Corte de cabello');
ok(/Horas libres/.test(r.respuesta) && /Luisa: 10:30/.test(r.respuesta) && /Pedro: 10:30/.test(r.respuesta), 'real: tras el servicio enseña las horas de hoy', r.respuesta);
r = c('Con Luisa 11:00');
ok(/¿Te reservo Corte de cabello/.test(r.respuesta) && /11:00/.test(r.respuesta) && /con Luisa/.test(r.respuesta), 'real: "Con Luisa 11:00" → confirma', r.respuesta);
r = c('sí');
ok(r.accion && r.accion.cita.start_time === '11:00:00' && r.accion.cita.barbero === 'Luisa' && r.accion.cita.appointment_date === hoy, 'real: reserva hoy 11:00 con Luisa', JSON.stringify(r));
c = chat2();
c('quiero cita hoy corte de cabello');
r = c('11:00');
ok(/a las 11:00/i.test(r.respuesta) && /¿Con quién|puedo con Luisa o Pedro/.test(r.respuesta), 'real: "11:00" solo → pregunta con quién', r.respuesta);
r = c('con Pedro');
ok(/¿Te reservo/.test(r.respuesta) && /Pedro/.test(r.respuesta), 'real: "con Pedro" → confirma', r.respuesta);
ok(extraerHora('el lunes a las 10:30 con luisa') === '10:30', 'hora 10:30 tras "a las"');
r = chat2()('reservar corte de cabello mañana');
ok(/cerrados/.test(r.respuesta), 'real: "reservar corte de cabello mañana" (domingo cerrado)', r.respuesta);
for (const f of ['Ok', 'Gracias', 'Perfecto', 'vale gracias', 'hasta luego']) { const rr = chat()(f); ok(/Aquí estoy/.test(rr.respuesta), 'cortesía: ' + f, rr.respuesta); }
process.exit(fallos);

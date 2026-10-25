const {huecosLibres:H}=require('../api/_huecos.js');
const eq=(a,b,n)=>{const ok=JSON.stringify(a)===JSON.stringify(b);console.log(ok?'OK  ':'FAIL',n,ok?'':JSON.stringify(a));if(!ok)process.exitCode=1};
const hor={"5":{a:"10:00",c:"12:00"},"6":null}; // 2026-10-23 viernes(5), 24 sábado(6)
eq(H({fecha:'2026-10-23',duracion:30,horario:hor}),['10:00','10:30','11:00','11:30'],'horario básico');
eq(H({fecha:'2026-10-24',duracion:30,horario:hor}),[],'día cerrado');
eq(H({fecha:'2026-10-23',duracion:60,horario:hor}),['10:00','10:30','11:00'],'servicio 60 min termina a cierre');
eq(H({fecha:'2026-10-23',duracion:30,horario:hor,citas:[{start_time:'10:30:00',duration_minutes:30,status:'scheduled'}]}),['10:00','11:00','11:30'],'cita ocupa hueco');
eq(H({fecha:'2026-10-23',duracion:30,horario:hor,citas:[{start_time:'10:30:00',duration_minutes:30,status:'cancelled'}]}),['10:00','10:30','11:00','11:30'],'cancelada libera');
eq(H({fecha:'2026-10-23',duracion:60,horario:hor,citas:[{start_time:'10:30:00',duration_minutes:30,status:'scheduled'}]}),['11:00'],'60 min: solo cabe tras la cita de las 10:30');
eq(H({fecha:'2026-10-23',duracion:30,horario:hor,profesional:'Ana',citas:[{start_time:'10:00:00',duration_minutes:30,status:'scheduled',barbero:'Pedro'}]}),['10:00','10:30','11:00','11:30'],'otro profesional no bloquea');
eq(H({fecha:'2026-10-23',duracion:30,horario:hor,profesional:'Pedro',citas:[{start_time:'10:00:00',duration_minutes:30,status:'scheduled',barbero:'Pedro'}]}),['10:30','11:00','11:30'],'mismo profesional bloquea');
eq(H({fecha:'2026-10-23',duracion:30,horario:hor,ahora:{fecha:'2026-10-23',min:10*60+40}}),['11:00','11:30'],'no ofrece horas pasadas');
eq(H({fecha:'2026-10-23',duracion:30,horario:null}).length,24,'sin horario 9-21 → 24 huecos');
eq(H({fecha:'2026-10-23',duracion:45,horario:hor,citas:[{start_time:'10:30:00',duration_minutes:45,status:'scheduled'}]}),['11:30'].slice(0,0).concat([]) ,'45 min con cita 10:30-11:15');

{
  const { bloqueosComoCitas } = require('../api/_huecos.js');
  const B = [{ fecha: '2026-10-27', fecha_fin: '2026-10-28', hora_desde: '11:00:00', hora_hasta: '12:30:00', profesional: 'Luisa', motivo: 'x' }, { fecha: '2026-10-30', fecha_fin: '2026-10-30', hora_desde: null, hora_hasta: null, profesional: null }];
  const h = (f, p) => H({ fecha: f, duracion: 30, horario: null, citas: bloqueosComoCitas(B, f), profesional: p });
  eq(h('2026-10-27', 'Luisa').includes('11:30') || !h('2026-10-27', 'Luisa').includes('12:30'), false, 'bloqueo con horas ocupa solo esas horas');
  eq(h('2026-10-27', 'Pedro').includes('11:30'), true, 'bloqueo de un profesional no afecta a otro');
  eq(h('2026-10-28', 'Luisa').includes('11:00'), false, 'el bloqueo se repite cada día del rango');
  eq(h('2026-10-29', 'Luisa').includes('11:00'), true, 'fuera del rango no bloquea');
  eq(h('2026-10-30', 'Pedro').length + h('2026-10-30', null).length, 0, 'día completo sin profesional bloquea a todos');
}

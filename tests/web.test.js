const { validarUrl, aTexto, ipPrivada, leerWeb, enlacesUtiles } = require('../api/_web.js');
const { extraerDatos, normalizar } = require('../api/_demo_extraer.js');
const { crearLLMSimulado } = require('../api/_llm.js');
let fallos = 0; const ok = (c, n, x) => { console.log(c ? 'OK  ' : 'FAIL', n, c ? '' : x || ''); if (!c) fallos = 1; };
const pub = async () => [{ address: '93.184.216.34' }];
const rechaza = async (u, r = pub) => { try { await validarUrl(u, r); return false; } catch (e) { return true; } };
(async () => {
  ok(await rechaza('ftp://x.com'), 'solo http/https');
  ok(await rechaza('http://localhost/a'), 'localhost bloqueado');
  ok(await rechaza('http://127.0.0.1/'), 'IP local bloqueada');
  ok(await rechaza('http://169.254.169.254/latest/meta-data'), 'metadatos de nube bloqueados');
  ok(await rechaza('http://10.0.0.5/'), 'red privada bloqueada');
  ok(await rechaza('http://[::1]/'), 'IPv6 local bloqueada');
  ok(await rechaza('https://usuario:clave@x.com/'), 'credenciales en la URL bloqueadas');
  ok(await rechaza('https://dominio-raro.com/', async () => [{ address: '192.168.1.10' }]), 'dominio que apunta a IP privada bloqueado');
  ok(!(await rechaza('https://peluqueria.es/', pub)), 'dominio público permitido');
  ok(ipPrivada('172.20.1.1') && !ipPrivada('8.8.8.8'), 'rangos privados');
  const txt = aTexto('<html><head><title>Peluquería Lola</title><meta name="description" content="Tu peluquería en Monzón"></head><body><script>x=1</script><h1>Servicios</h1><li>Corte 22&euro;</li><style>a{}</style></body></html>');
  ok(/Peluquería Lola/.test(txt) && /Corte 22€/.test(txt) && !/x=1/.test(txt) && !/a\{\}/.test(txt), 'html a texto', txt);
  ok(enlacesUtiles('<a href="/tarifas">Tarifas</a><a href="https://otra.com/servicios">x</a><a href="/blog">blog</a>', new URL('https://p.es/'))[0] === 'https://p.es/tarifas', 'enlaces útiles solo del mismo dominio');
  // redirección a IP privada bloqueada
  const f = async (u) => u.startsWith('https://p.es/a') ? { status: 302, ok: false, headers: { get: h => h === 'location' ? 'http://127.0.0.1/admin' : null } } : { status: 200, ok: true, headers: { get: () => 'text/html' }, arrayBuffer: async () => Buffer.from('<p>' + 'hola '.repeat(40) + '</p>') };
  let bloqueado = false; try { await leerWeb('https://p.es/a', { resolver: pub, fetchFn: f }); } catch (e) { bloqueado = true; }
  ok(bloqueado, 'redirección a IP privada bloqueada');
  const l = await leerWeb('https://p.es/b', { resolver: pub, fetchFn: f });
  ok(l.texto.length > 80, 'lee una web normal');
  // extracción
  const llm = crearLLMSimulado([{ content: [{ type: 'tool_use', id: 't', name: 'guardar_datos_negocio', input: { nombre: ' Peluquería  Lola ', servicios: [{ nombre: 'Corte', precio: 22, duracion_min: null }, { nombre: 'Tinte', precio: null, duracion_min: 90 }, { nombre: '', precio: 5 }], horario: [{ dias: [1, 2, 3, 4, 5], abre: '9:30', cierra: '20:00' }, { dias: [6], abre: '10:00', cierra: '09:00' }], equipo: ['Lola'], faq: [{ p: '¿Tarjeta?', r: 'Sí' }, { p: '', r: 'x' }] } }] }]);
  const d = await extraerDatos({ llm, texto: 'x', url: 'https://p.es' });
  ok(d.nombre === 'Peluquería Lola' && d.servicios.length === 2 && d.servicios[0].duracion_min === 30 && d.servicios[1].precio === null, 'normaliza servicios', JSON.stringify(d.servicios));
  ok(d.horario && d.horario[1].a === '09:30' && d.horario[1].c === '20:00' && !d.horario[6], 'horario válido; tramo incoherente descartado', JSON.stringify(d.horario));
  ok(d.faq.length === 1, 'descarta FAQ incompleta');
  ok(normalizar({ nombre: 'a', servicios: [], horario: [] }).horario === null, 'sin horario = null');
  let falla = false; try { await extraerDatos({ llm: crearLLMSimulado([{ content: [{ type: 'text', text: 'hola' }] }]), texto: 'x', url: 'u' }); } catch (e) { falla = true; }
  ok(falla, 'si la IA no usa la herramienta, error');
  process.exit(fallos);
})();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  try {
    const { mensaje, detalle, pagina, fecha } = req.body || {};

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Barbería TPV <noreply@notificaciones.escaliadigital.com>',
        to: ['jamessalasmira123@gmail.com'],
        subject: `⚠️ Error en Barbería TPV: ${mensaje || 'sin descripción'}`,
        html: `
          <p><strong>Mensaje:</strong> ${mensaje || ''}</p>
          <p><strong>Página:</strong> ${pagina || ''}</p>
          <p><strong>Fecha:</strong> ${fecha || new Date().toISOString()}</p>
          <p><strong>Detalle técnico:</strong></p>
          <pre>${detalle || ''}</pre>
        `,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('Error enviando alerta con Resend:', errText);
      return res.status(500).json({ error: 'No se pudo enviar la alerta' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Error inesperado en alert-error:', err);
    return res.status(500).json({ error: 'Error inesperado' });
  }
}

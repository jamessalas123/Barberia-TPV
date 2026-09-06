import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  /* Verificamos la sesión real del usuario contra Supabase, igual que
     en el checkout, para que nadie pueda abrir el portal de otra cuenta. */
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    return res.status(401).json({ error: 'Falta la sesión del usuario' });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Sesión no válida o caducada' });
  }

  try {
    const origin = req.headers.origin || `https://${req.headers.host}`;

    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    if (!profile || !profile.stripe_customer_id) {
      return res.status(400).json({ error: 'Aún no tienes una suscripción activa que gestionar.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${origin}/`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Error creando sesión del portal de cliente:', err);
    return res.status(500).json({ error: 'No se pudo abrir el portal de gestión. Inténtalo de nuevo.' });
  }
}

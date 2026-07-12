import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: { bodyParser: false }
};

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id;
        if (userId) {
          await supabase.from('profiles').update({
            plan_status: 'active',
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription
          }).eq('id', userId);
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const status = sub.status === 'active' ? 'active' : 'past_due';
        await supabase.from('profiles').update({ plan_status: status })
          .eq('stripe_subscription_id', sub.id);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await supabase.from('profiles').update({ plan_status: 'cancelled' })
          .eq('stripe_subscription_id', sub.id);
        break;
      }
    }
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Error processing webhook:', err);
    res.status(500).send('Internal error');
  }
}

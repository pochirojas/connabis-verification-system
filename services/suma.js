// services/suma.js — SUMA Mexico VeriDocID API Client
import fetch from 'node-fetch';

// Authenticate with SUMA and get access token
async function getSumaAccessToken() {
  console.log('[SUMA Auth] Requesting access token...');

  const baseUrl = process.env.SUMA_BASE_URL;
  if (!baseUrl) {
    throw new Error('SUMA_BASE_URL is not configured');
  }

  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: process.env.SUMA_CLIENT_ID,
      client_secret: process.env.SUMA_CLIENT_SECRET,
      grant_type: 'client_credentials'
    })
  });

  if (!res.ok) {
    const error = await res.text();
    console.error('[SUMA Auth] Failed response:', res.status, error);
    throw new Error(`SUMA authentication failed (${res.status}): ${error}`);
  }

  const data = await res.json();
  console.log('[SUMA Auth] Access token obtained successfully');
  return data.access_token;
}

// Create verification session
export async function createSumaVerification({ customerId, email, firstName, lastName }) {
  console.log('[SUMA] Creating verification session for customer:', customerId);

  const token = await getSumaAccessToken();
  const baseUrl = process.env.SUMA_BASE_URL;
  const appBaseUrl = process.env.APP_BASE_URL;

  const payload = {
    external_id: `shopify_customer_${customerId}`,
    email: email,
    first_name: firstName || '',
    last_name: lastName || '',
    redirect_url: `${appBaseUrl}/suma/callback`,
    webhook_url: `${appBaseUrl}/suma/webhook`
  };

  console.log('[SUMA] Request payload:', JSON.stringify(payload, null, 2));

  const res = await fetch(`${baseUrl}/v1/verifications`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const error = await res.text();
    console.error('[SUMA] Verification creation failed:', res.status, error);
    throw new Error(`SUMA verification creation failed (${res.status}): ${error}`);
  }

  const data = await res.json();
  console.log('[SUMA] Verification session created successfully:', JSON.stringify(data));

  return {
    id: data.verification_id || data.id,
    verification_url: data.verification_url || data.url
  };
}

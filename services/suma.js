// services/suma.js — VeriDocID API Client (SUMA Mexico)
// Base URL: https://veridocid.azure-api.net/api/
// Auth: client_credentials → Bearer token (24h)
// Flow: auth → createVerification → urlSdk → email link to customer
import fetch from 'node-fetch';

const VERIDOCID_BASE = 'https://veridocid.azure-api.net/api';

// In-memory token cache (no database, spec requirement)
let cachedToken = null;
let tokenExpiresAt = 0;

// Authenticate with VeriDocID and get Bearer token
// Uses client_credentials grant with x-www-form-urlencoded body
async function getAccessToken() {
  // Return cached token if still valid (with 5min buffer)
  if (cachedToken && Date.now() < tokenExpiresAt - 300000) {
    console.log('[VeriDocID Auth] Using cached token');
    return cachedToken;
  }

  console.log('[VeriDocID Auth] Requesting new access token...');

  const clientId = process.env.SUMA_CLIENT_ID;
  const clientSecret = process.env.SUMA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('SUMA_CLIENT_ID or SUMA_CLIENT_SECRET is not configured');
  }

  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  params.append('audience', 'veridocid');

  const res = await fetch(`${VERIDOCID_BASE}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!res.ok) {
    const error = await res.text();
    console.error('[VeriDocID Auth] Failed:', res.status, error);
    throw new Error(`VeriDocID authentication failed (${res.status}): ${error}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  // expires_in is in seconds (typically 86400 = 24h)
  tokenExpiresAt = Date.now() + (data.expires_in || 86400) * 1000;

  console.log('[VeriDocID Auth] Token obtained, expires in', data.expires_in, 'seconds');
  return cachedToken;
}

// Create a verification session via VeriDocID
// Returns the UUID needed for urlSdk and status/results
export async function createSumaVerification({ customerId, email, firstName, lastName }) {
  console.log('[VeriDocID] Creating verification for customer:', customerId, '| Email:', email);

  const token = await getAccessToken();
  const apiKey = process.env.SUMA_API_KEY;

  if (!apiKey) {
    throw new Error('SUMA_API_KEY is not configured (need private key from SUMA team)');
  }

  const appBaseUrl = process.env.APP_BASE_URL;

  // createVerification payload per VeriDocID docs
  const payload = {
    id: `shopify_${customerId}`,
    options: {
      checks: {
        selfie: true,        // Require selfie for liveness
        verifyIp: false,
        onlyVerifyId: false,
        phrase: ''
      },
      redirect_url: `${appBaseUrl}/suma/callback?status=success&customer=${customerId}`,
      language_sdk: 'es'     // Spanish for Colombian customers
    }
  };

  console.log('[VeriDocID] createVerification payload:', JSON.stringify(payload, null, 2));

  const doRequest = async (tok) => fetch(`${VERIDOCID_BASE}/id/v3/createverification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tok}`,
      'x-api-key': apiKey
    },
    body: JSON.stringify(payload)
  });

  let res = await doRequest(token);

  // If token-related error, force-refresh token and retry once
  if (!res.ok && (res.status === 400 || res.status === 401)) {
    const errText = await res.text();
    console.warn('[VeriDocID] createVerification failed, forcing token refresh and retrying. Error:', errText);
    cachedToken = null;
    tokenExpiresAt = 0;
    const freshToken = await getAccessToken();
    res = await doRequest(freshToken);
  }

  if (!res.ok) {
    const error = await res.text();
    console.error('[VeriDocID] createVerification failed:', res.status, error);
    throw new Error(`VeriDocID createVerification failed (${res.status}): ${error}`);
  }

  // Response is a UUID string (possibly in HTML wrapper)
  const rawResponse = await res.text();
  // Strip any HTML tags to get clean UUID
  const uuid = rawResponse.replace(/<[^>]*>/g, '').trim();
  console.log('[VeriDocID] Verification created, UUID:', uuid);

  // Now get the SDK URL for the customer to complete verification
  const verificationUrl = await getVerificationUrl(token, apiKey, uuid);

  return {
    id: uuid,
    verification_url: verificationUrl
  };
}

// Get the customer-facing verification URL via urlSdk endpoint
async function getVerificationUrl(token, apiKey, uuid) {
  console.log('[VeriDocID] Getting SDK URL for UUID:', uuid);

  const res = await fetch(`${VERIDOCID_BASE}/id/v3/urlSdk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-api-key': apiKey
    },
    body: JSON.stringify({ identifier: uuid })
  });

  if (!res.ok) {
    const error = await res.text();
    console.error('[VeriDocID] urlSdk failed:', res.status, error);
    throw new Error(`VeriDocID urlSdk failed (${res.status}): ${error}`);
  }

  const data = await res.text();
  // The response may be a URL string or JSON with a url field
  let url;
  try {
    const parsed = JSON.parse(data);
    url = parsed.url || parsed.verification_url || data;
  } catch {
    // Plain text URL response
    url = data.replace(/<[^>]*>/g, '').trim();
  }

  console.log('[VeriDocID] SDK URL obtained:', url);
  return url;
}

// Check verification status (polling endpoint — used as fallback if webhook fails)
export async function checkVerificationStatus(uuid) {
  console.log('[VeriDocID] Checking status for UUID:', uuid);

  const token = await getAccessToken();

  const res = await fetch(`${VERIDOCID_BASE}/id/v3/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ identifier: uuid })
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`VeriDocID status check failed (${res.status}): ${error}`);
  }

  // Returns plain text status: WaitingChecking, ManualIdentification, ManualChecking, WaitingData, Checked
  const status = (await res.text()).trim();
  console.log('[VeriDocID] Status for', uuid, ':', status);
  return status;
}

// Get full verification results (only call after status = "Checked")
export async function getVerificationResults(uuid) {
  console.log('[VeriDocID] Getting results for UUID:', uuid);

  const token = await getAccessToken();

  const res = await fetch(`${VERIDOCID_BASE}/id/v3/results`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      identifier: uuid,
      includeImages: false,
      includeVideo: false,
      includeProofAdress: false
    })
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`VeriDocID results failed (${res.status}): ${error}`);
  }

  const data = await res.json();
  console.log('[VeriDocID] Results for', uuid, ':', JSON.stringify(data, null, 2));
  return data;
}

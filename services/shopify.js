// services/shopify.js — Shopify Admin API Client
// Handles: OAuth token management, adding "Verified" tag, sequential verified number
//
// IMPORTANT (2026): Shopify deprecated static shpat_ tokens in January 2026.
// Apps created in the Dev Dashboard now use the client credentials grant:
//   POST https://{shop}.myshopify.com/admin/oauth/access_token
//   grant_type=client_credentials&client_id=...&client_secret=...
// Tokens expire every 24 hours and are refreshed automatically.

import { URLSearchParams } from 'node:url';
import fetch from 'node-fetch';

// ─── Configuration ───────────────────────────────────────────────
const VERIFIED_TAG = 'Verified';
const NOT_VERIFIED_TAG = 'Not Verified';
const METAFIELD_NAMESPACE = 'custom';
const METAFIELD_KEY = 'verified_number';
const METAFIELD_PROFILE_COMPLETE = 'profile_complete';   // 'true' once form submitted
const METAFIELD_CONSENT_SENT = 'consent_sent';           // 'true' once consent email sent
// If no verified customers exist yet, the first number assigned will be this:
const STARTING_NUMBER = 300;

// ─── Token Management ────────────────────────────────────────────
// In-memory cache for the short-lived access token
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const shop = process.env.SHOPIFY_STORE_URL; // connabis.myshopify.com
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!shop || !clientId || !clientSecret) {
    throw new Error(
      'Missing Shopify credentials. Set SHOPIFY_STORE_URL, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET.'
    );
  }

  console.log('[Shopify Auth] Requesting new access token via client credentials grant...');

  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Shopify token request failed (${res.status}): ${error}`);
  }

  const data = await res.json();
  // Response: { access_token, scope, expires_in: 86399 }
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;

  console.log('[Shopify Auth] Token obtained, expires in', data.expires_in, 'seconds');
  console.log('[Shopify Auth] Scopes:', data.scope);
  return cachedToken;
}

// ─── API Helpers ─────────────────────────────────────────────────

// Make authenticated REST request to Shopify Admin API
async function shopifyAdminFetch(endpoint, options = {}) {
  const shop = process.env.SHOPIFY_STORE_URL;
  const token = await getAccessToken();

  const url = `https://${shop}/admin/api/2024-01${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify REST ${res.status}: ${body}`);
  }
  return res.json();
}

// Make authenticated GraphQL request to Shopify Admin API
async function shopifyGraphQL(query, variables = {}) {
  const shop = process.env.SHOPIFY_STORE_URL;
  const token = await getAccessToken();

  const url = `https://${shop}/admin/api/2024-01/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify GraphQL ${res.status}: ${body}`);
  }

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

// ─── Sequential Number ───────────────────────────────────────────
// Query all customers who have the "Verified" tag, pull their
// custom.verified_number metafield, find the max, and return max + 1.
// This is stateless — Shopify is the single source of truth.

async function getNextVerifiedNumber() {
  console.log('[Shopify] Querying highest verified_number via GraphQL...');

  let maxNumber = STARTING_NUMBER - 1; // so first assigned = STARTING_NUMBER
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const afterClause = cursor ? `, after: "${cursor}"` : '';
    const query = `{
      customers(first: 100, query: "tag:Verified"${afterClause}) {
        edges {
          cursor
          node {
            metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") {
              value
            }
          }
        }
        pageInfo {
          hasNextPage
        }
      }
    }`;

    const data = await shopifyGraphQL(query);
    if (!data?.customers) break;

    for (const edge of data.customers.edges) {
      const val = edge.node.metafield?.value;
      if (val != null) {
        const num = parseInt(val, 10);
        if (!isNaN(num) && num > maxNumber) {
          maxNumber = num;
        }
      }
      cursor = edge.cursor;
    }

    hasNextPage = data.customers.pageInfo.hasNextPage;
  }

  const next = maxNumber + 1;
  console.log(`[Shopify] Highest verified_number found: ${maxNumber}, next: ${next}`);
  return next;
}

// ─── Public API ──────────────────────────────────────────────────

// Check if a customer is already verified (has the 'Verified' tag)
export async function isCustomerAlreadyVerified(customerId) {
  console.log('[Shopify] Checking if customer', customerId, 'is already verified...');
  try {
    const { customer } = await shopifyAdminFetch(`/customers/${customerId}.json`);
    const tags = (customer?.tags || '').split(',').map(t => t.trim().toLowerCase());
    const verified = tags.includes('verified');
    console.log('[Shopify] Customer', customerId, 'verified status:', verified, '| Tags:', customer?.tags);
    return verified;
  } catch (error) {
    console.error('[Shopify] Failed to check verification status:', error.message);
    // If we can't check, return false to allow the verification to proceed
    return false;
  }
}

// Check if a customer is already verified by email
export async function isEmailAlreadyVerified(email) {
  console.log('[Shopify] Checking if email', email, 'is already verified...');
  try {
    const data = await shopifyGraphQL(`{
      customers(first: 5, query: "email:${email}") {
        edges {
          node {
            id
            email
            tags
          }
        }
      }
    }`);

    for (const edge of (data?.customers?.edges || [])) {
      const tags = (edge.node.tags || []).map(t => t.toLowerCase());
      if (tags.includes('verified')) {
        console.log('[Shopify] Email', email, 'already has a verified account:', edge.node.id);
        return true;
      }
    }

    console.log('[Shopify] Email', email, 'has no verified accounts');
    return false;
  } catch (error) {
    console.error('[Shopify] Failed to check email verification status:', error.message);
    return false;
  }
}

// Search for a Shopify customer by email — returns the customer ID or null
export async function searchCustomerByEmail(email) {
  console.log('[Shopify] Searching for customer by email:', email);

  const data = await shopifyGraphQL(`{
    customers(first: 1, query: "email:${email}") {
      edges {
        node {
          id
          email
          firstName
          lastName
        }
      }
    }
  }`);

  const customer = data?.customers?.edges?.[0]?.node;
  if (!customer) {
    console.log('[Shopify] No customer found for email:', email);
    return null;
  }

  // GraphQL IDs are like "gid://shopify/Customer/12345" — extract the numeric part
  const numericId = customer.id.replace('gid://shopify/Customer/', '');
  console.log('[Shopify] Found customer:', numericId, '|', customer.firstName, customer.lastName, '|', customer.email);
  return { id: numericId, email: customer.email, firstName: customer.firstName, lastName: customer.lastName };
}

// Add "Verified" tag to a customer (appends to existing tags)
export async function addVerifiedTag(customerId) {
  console.log('[Shopify] Adding Verified tag to customer:', customerId);

  // First fetch current tags so we don't overwrite them
  const { customer } = await shopifyAdminFetch(`/customers/${customerId}.json`);
  const currentTags = customer?.tags || '';

  // Check if already tagged
  const tagsArray = currentTags.split(',').map(t => t.trim()).filter(Boolean);
  if (tagsArray.some(t => t.toLowerCase() === 'verified')) {
    console.log('[Shopify] Customer already has Verified tag, skipping');
    return { customer };
  }

  // Append the new tag
  const newTags = currentTags ? `${currentTags}, ${VERIFIED_TAG}` : VERIFIED_TAG;

  const data = await shopifyAdminFetch(`/customers/${customerId}.json`, {
    method: 'PUT',
    body: JSON.stringify({
      customer: { id: customerId, tags: newTags },
    }),
  });

  console.log('[Shopify] Verified tag added successfully');
  return data;
}

// Set the verified number metafield on a customer
export async function setVerifiedNumber(customerId, verifiedNumber) {
  console.log('[Shopify] Setting verified number for customer:', customerId, '→', verifiedNumber);

  const data = await shopifyAdminFetch(`/customers/${customerId}/metafields.json`, {
    method: 'POST',
    body: JSON.stringify({
      metafield: {
        namespace: METAFIELD_NAMESPACE,
        key: METAFIELD_KEY,
        value: String(verifiedNumber),
        type: 'number_integer',
      },
    }),
  });

  console.log('[Shopify] Verified number metafield set successfully');
  return data;
}

// Add a tag to a customer (without removing existing tags)
export async function addTag(customerId, tag) {
  const { customer } = await shopifyAdminFetch(`/customers/${customerId}.json`);
  const current = (customer?.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  if (current.some(t => t.toLowerCase() === tag.toLowerCase())) return; // already has it
  const newTags = [...current, tag].join(', ');
  await shopifyAdminFetch(`/customers/${customerId}.json`, {
    method: 'PUT',
    body: JSON.stringify({ customer: { id: customerId, tags: newTags } }),
  });
  console.log(`[Shopify] Tag '${tag}' added to customer ${customerId}`);
}

// Remove a specific tag from a customer
export async function removeTag(customerId, tag) {
  const { customer } = await shopifyAdminFetch(`/customers/${customerId}.json`);
  const current = (customer?.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const filtered = current.filter(t => t.toLowerCase() !== tag.toLowerCase());
  if (filtered.length === current.length) return; // tag wasn't there
  await shopifyAdminFetch(`/customers/${customerId}.json`, {
    method: 'PUT',
    body: JSON.stringify({ customer: { id: customerId, tags: filtered.join(', ') } }),
  });
  console.log(`[Shopify] Tag '${tag}' removed from customer ${customerId}`);
}

// Get a single customer's full data (tags, phone, company, metafields)
export async function getCustomer(customerId) {
  const { customer } = await shopifyAdminFetch(`/customers/${customerId}.json`);
  return customer;
}

// Update customer profile fields (phone, company=ID, address etc.)
export async function updateCustomerProfile(customerId, fields) {
  console.log('[Shopify] Updating profile for customer:', customerId);
  const data = await shopifyAdminFetch(`/customers/${customerId}.json`, {
    method: 'PUT',
    body: JSON.stringify({ customer: { id: customerId, ...fields } }),
  });
  console.log('[Shopify] Profile updated');
  return data.customer;
}

// Set a metafield on a customer
export async function setCustomerMetafield(customerId, key, value) {
  return shopifyAdminFetch(`/customers/${customerId}/metafields.json`, {
    method: 'POST',
    body: JSON.stringify({
      metafield: {
        namespace: METAFIELD_NAMESPACE,
        key,
        value: String(value),
        type: 'single_line_text_field',
      },
    }),
  });
}

// Get a specific metafield value for a customer
export async function getCustomerMetafield(customerId, key) {
  try {
    const data = await shopifyAdminFetch(
      `/customers/${customerId}/metafields.json?namespace=${METAFIELD_NAMESPACE}&key=${key}`
    );
    return data?.metafields?.[0]?.value || null;
  } catch { return null; }
}

// Add a note to a customer (appends, doesn't overwrite existing note)
export async function addCustomerNote(customerId, noteText) {
  console.log('[Shopify] Adding note to customer:', customerId);
  const { customer } = await shopifyAdminFetch(`/customers/${customerId}.json`);
  const existing = customer?.note || '';
  const newNote = existing ? `${existing}\n${noteText}` : noteText;
  await shopifyAdminFetch(`/customers/${customerId}.json`, {
    method: 'PUT',
    body: JSON.stringify({ customer: { id: customerId, note: newNote } }),
  });
  console.log('[Shopify] Note added');
}

// Check if a customer profile is complete (has phone + company/ID)
export function isProfileComplete(customer) {
  return !!(customer?.phone && customer?.company);
}

// Check if all 3 conditions for full approval are met:
// 1. Has 'Verified' tag (VeriDoc passed)
// 2. Profile complete (phone + company)
// 3. Consent sent (we sent the Adobe link — best proxy without Adobe API)
export async function checkFullApproval(customerId) {
  try {
    const customer = await getCustomer(customerId);
    const tags = (customer?.tags || '').split(',').map(t => t.trim().toLowerCase());
    const hasVerified = tags.includes('verified');
    const profileComplete = isProfileComplete(customer);
    // Check metafield for consent sent
    const consentSent = await getCustomerMetafield(customerId, METAFIELD_CONSENT_SENT);
    return { hasVerified, profileComplete, consentSent: consentSent === 'true', customer };
  } catch (err) {
    console.error('[Shopify] checkFullApproval error:', err.message);
    return { hasVerified: false, profileComplete: false, consentSent: false, customer: null };
  }
}

// Main entry point: Mark a customer as verified
// 1. Query Shopify for the next sequential verified number
// 2. Add "Verified" tag
// 3. Set custom.verified_number metafield
export async function markCustomerVerified(customerId) {
  console.log('[Shopify] Marking customer', customerId, 'as verified');

  // Step 1: Get next sequential number from Shopify (stateless)
  let verifiedNumber;
  try {
    verifiedNumber = await getNextVerifiedNumber();
  } catch (error) {
    console.error('[Shopify] Failed to query next verified number:', error.message);
    // Fallback: use timestamp-based number to avoid blocking verification
    verifiedNumber = STARTING_NUMBER + Date.now() % 100000;
    console.warn('[Shopify] Using fallback number:', verifiedNumber);
  }

  // Step 2: Add "Verified" tag
  try {
    await addVerifiedTag(customerId);
  } catch (error) {
    console.error('[Shopify] Failed to add Verified tag:', error.message);
    // Continue — metafield is more important than tag
  }

  // Step 3: Set verified number metafield
  try {
    await setVerifiedNumber(customerId, verifiedNumber);
  } catch (error) {
    console.error('[Shopify] Failed to set verified number:', error.message);
  }

  // Step 4: Add verification note to customer profile
  // Format: "CC 1005289529 - Verified Number: 300 - Verified Automatically by Motas"
  // We pull the company field (which stores the ID number) for the note
  try {
    const customer = await getCustomer(customerId);
    const idNumber = customer?.company || 'N/A';
    const noteText = `CC ${idNumber} (Users ID) - Verified Number: ${verifiedNumber} - Verified Automatically by Motas`;
    await addCustomerNote(customerId, noteText);
  } catch (error) {
    console.error('[Shopify] Failed to add verification note:', error.message);
  }

  // Step 5: Remove 'Not Verified' tag if present
  try {
    await removeTag(customerId, NOT_VERIFIED_TAG);
  } catch (error) {
    console.error('[Shopify] Failed to remove Not Verified tag:', error.message);
  }

  return { verifiedNumber, customerId };
}

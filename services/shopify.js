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
export async function shopifyAdminFetch(endpoint, options = {}) {
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
// Create a new customer in Shopify
export async function createCustomer(fields) {
  return shopifyAdminFetch('/customers.json', {
    method: 'POST',
    body: JSON.stringify({ customer: fields })
  });
}

export async function isCustomerAlreadyVerified(customerId) {
  console.log('[Shopify] Checking if customer', customerId, 'is already verified...');
  try {
    // True verification = has the verified_number metafield (set by our system after SUMA scan)
    // Do NOT rely on the Verified tag alone — Advanced Registration assigns it automatically
    const verifiedNumber = await getCustomerMetafield(customerId, 'verified_number');
    const verified = !!verifiedNumber;
    console.log('[Shopify] Customer', customerId, 'verified_number metafield:', verifiedNumber, '| truly verified:', verified);
    return verified;
  } catch (error) {
    console.error('[Shopify] Failed to check verification status:', error.message);
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
            legacyResourceId
            email
          }
        }
      }
    }`);

    for (const edge of (data?.customers?.edges || [])) {
      const cid = edge.node.legacyResourceId;
      // True verification = has verified_number metafield set by our system
      // Do NOT use the Verified tag — Advanced Registration assigns it automatically
      const verifiedNumber = await getCustomerMetafield(cid, 'verified_number');
      if (verifiedNumber) {
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

// Add "Verified" tag and remove "Not Verified" tag in one atomic PUT
export async function addVerifiedTag(customerId) {
  console.log('[Shopify] Setting Verified tag (removing Not Verified) for customer:', customerId);

  const { customer } = await shopifyAdminFetch(`/customers/${customerId}.json`);
  const tagsArray = (customer?.tags || '').split(',').map(t => t.trim()).filter(Boolean);

  // Strip both tags first, then add Verified — single write prevents race condition
  const cleaned = tagsArray.filter(
    t => t.toLowerCase() !== VERIFIED_TAG.toLowerCase() &&
         t.toLowerCase() !== NOT_VERIFIED_TAG.toLowerCase()
  );
  const newTags = [...cleaned, VERIFIED_TAG].join(', ');

  const data = await shopifyAdminFetch(`/customers/${customerId}.json`, {
    method: 'PUT',
    body: JSON.stringify({ customer: { id: customerId, tags: newTags } }),
  });

  console.log('[Shopify] Tags updated — Verified added, Not Verified removed. Final:', newTags);
  return data;
}

// Set the verified number metafield on a customer
// Uses GraphQL metafieldsSet mutation — bypasses REST ownership restriction
export async function setVerifiedNumber(customerId, verifiedNumber) {
  console.log('[Shopify] Setting verified number for customer:', customerId, '→', verifiedNumber);

  const gid = `gid://shopify/Customer/${customerId}`;
  const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key namespace value }
        userErrors { field message }
      }
    }
  `;
  const variables = {
    metafields: [{
      ownerId: gid,
      namespace: METAFIELD_NAMESPACE,
      key: METAFIELD_KEY,
      value: String(verifiedNumber),
      type: 'number_integer',
    }],
  };

  const data = await shopifyGraphQL(mutation, variables);
  const errors = data?.metafieldsSet?.userErrors;
  if (errors && errors.length > 0) {
    throw new Error(`metafieldsSet error: ${JSON.stringify(errors)}`);
  }

  console.log('[Shopify] Verified number metafield set via GraphQL successfully');
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

// Update customer name + shipping address name to match the ID document
// Called after successful VeriDoc verification
export async function syncNameFromDocument(customerId, firstName, lastName) {
  if (!firstName && !lastName) return;
  const first = (firstName || '').trim();
  const last  = (lastName  || '').trim();
  if (!first && !last) return;

  console.log('[Shopify] Syncing name from document for customer:', customerId, '|', first, last);
  try {
    // 1. Update account name
    const updated = await shopifyAdminFetch(`/customers/${customerId}.json`, {
      method: 'PUT',
      body: JSON.stringify({
        customer: {
          id: customerId,
          ...(first && { first_name: first }),
          ...(last  && { last_name:  last  }),
        },
      }),
    });

    // 2. Update default address name if it exists
    const addressId = updated?.customer?.default_address?.id;
    if (addressId) {
      await shopifyAdminFetch(`/customers/${customerId}/addresses/${addressId}.json`, {
        method: 'PUT',
        body: JSON.stringify({
          address: {
            ...(first && { first_name: first }),
            ...(last  && { last_name:  last  }),
          },
        }),
      }).catch(e => console.warn('[Shopify] Address name sync failed (non-critical):', e.message));
    }

    console.log('[Shopify] Name synced from document:', first, last);
  } catch (e) {
    console.error('[Shopify] syncNameFromDocument failed:', e.message);
  }
}

// Extract first/last name from a VeriDocID results payload
// VeriDocID can return names in several fields depending on document type
export function extractNameFromVeriDocResults(results) {
  if (!results) return { firstName: null, lastName: null };

  // Priority order of known VeriDocID name fields
  const d = results.documentData || results.document_data || results;

  const firstName =
    d.firstName   || d.first_name   ||
    d.Names       || d.names        ||
    d.givenName   || d.given_name   ||
    d.primerNombre|| d.nombre       ||
    results.firstName || results.first_name || null;

  const lastName =
    d.lastName    || d.last_name    ||
    d.LastNames   || d.lastNames    || d.last_names ||
    d.Surnames    || d.surnames     ||
    d.primerApellido || d.apellido  ||
    results.lastName || results.last_name || null;

  // Some providers return a single fullName — split on first space
  if (!firstName && !lastName) {
    const full = d.fullName || d.full_name || d.name || results.fullName || results.name;
    if (full && typeof full === 'string') {
      const parts = full.trim().split(/\s+/);
      return { firstName: parts[0] || null, lastName: parts.slice(1).join(' ') || null };
    }
  }

  return {
    firstName: typeof firstName === 'string' ? firstName.trim() : null,
    lastName:  typeof lastName  === 'string' ? lastName.trim()  : null,
  };
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

// Get a specific metafield value for a customer (uses GraphQL — bypasses REST ownership restriction)
export async function getCustomerMetafield(customerId, key) {
  try {
    const gid = `gid://shopify/Customer/${customerId}`;
    const query = `{
      customer(id: "${gid}") {
        metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${key}") {
          value
        }
      }
    }`;
    const data = await shopifyGraphQL(query);
    return data?.customer?.metafield?.value || null;
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
  const company = customer?.company || customer?.default_address?.company;
  return !!(customer?.phone && company);
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

  // Step 0: Check if already has a verified_number — do not assign a new one
  try {
    const existing = await getCustomerMetafield(customerId, 'verified_number');
    if (existing) {
      console.log('[Shopify] Customer', customerId, 'already has verified_number:', existing, '— skipping duplicate assignment');
      // Ensure Verified tag is set and Not Verified removed (atomic)
      await addVerifiedTag(customerId).catch(() => {});
      // Ensure note exists (write it if missing or in wrong format)
      // Skip entirely for Solo Hongos customers
      try {
        const customerData = await shopifyAdminFetch(`/customers/${customerId}.json?fields=id,company,default_address,note,tags`)
          .then(r => r.customer).catch(() => null);
        const existingTags = (customerData?.tags || '').split(',').map(t => t.trim());
        const currentNote = customerData?.note || '';
        if (!existingTags.includes('Solo Hongos') && !currentNote.includes('Verified Number:')) {
          const idNumber = customerData?.company ||
            customerData?.default_address?.company ||
            (await getCustomerMetafield(customerId, 'id_number').catch(() => null)) ||
            'N/A';
          const noteText = `CC ${idNumber} - Verified Number: ${existing} - Verified Automatically by Motas`;
          await addCustomerNote(customerId, noteText);
        }
      } catch (noteErr) {
        console.warn('[Shopify] Could not update note on re-verify:', noteErr.message);
      }
      return { verifiedNumber: existing, customerId };
    }
  } catch (e) {
    console.warn('[Shopify] Could not check existing verified_number:', e.message);
  }

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
  // Skip for Solo Hongos customers (no age verification required, no note needed)
  // ID number is stored in company AND default_address.company; metafield id_number as final fallback
  try {
    const customer = await shopifyAdminFetch(`/customers/${customerId}.json?fields=id,company,default_address,tags`)
      .then(r => r.customer).catch(() => null);

    // Skip note entirely for Solo Hongos customers
    const tags = (customer?.tags || '').split(',').map(t => t.trim());
    if (tags.includes('Solo Hongos')) {
      console.log('[Shopify] Solo Hongos customer — skipping verification note');
    } else {
      const idNumber = customer?.company ||
        customer?.default_address?.company ||
        (await getCustomerMetafield(customerId, 'id_number').catch(() => null)) ||
        'N/A';
      console.log('[Shopify] ID number for note:', idNumber, '| company:', customer?.company, '| address company:', customer?.default_address?.company);
      const noteText = `CC ${idNumber} - Verified Number: ${verifiedNumber} - Verified Automatically by Motas`;
      await addCustomerNote(customerId, noteText);
    }
  } catch (error) {
    console.error('[Shopify] Failed to add verification note:', error.message);
  }

  // Step 5: Not Verified tag removal is now handled atomically inside addVerifiedTag (Step 2)

  return { verifiedNumber, customerId };
}

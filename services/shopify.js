// services/shopify.js — Shopify Admin API Client
// Handles: adding "Verified" tag + setting sequential verified number metafield
// Sequential numbering: queries Shopify GraphQL for the highest existing
// custom.verified_number and increments by 1. No database needed.
import fetch from 'node-fetch';

// ─── Configuration ───────────────────────────────────────────────
const VERIFIED_TAG = 'Verified';
const METAFIELD_NAMESPACE = 'custom';
const METAFIELD_KEY = 'verified_number';
// If no verified customers exist yet, the first number assigned will be this:
const STARTING_NUMBER = 300;

// ─── Helpers ─────────────────────────────────────────────────────

// Make authenticated REST request to Shopify Admin API
async function shopifyAdminFetch(endpoint, options = {}) {
  const storeUrl = process.env.SHOPIFY_STORE_URL;
  const token = process.env.SHOPIFY_API_KEY;

  if (!storeUrl || !token) {
    console.warn('[Shopify] Store URL or access token not configured, skipping');
    return null;
  }

  const url = `https://${storeUrl}/admin/api/2024-01${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify REST ${res.status}: ${body}`);
  }
  return res.json();
}

// Make authenticated GraphQL request to Shopify Admin API
async function shopifyGraphQL(query, variables = {}) {
  const storeUrl = process.env.SHOPIFY_STORE_URL;
  const token = process.env.SHOPIFY_API_KEY;

  if (!storeUrl || !token) {
    console.warn('[Shopify] Store URL or access token not configured, skipping');
    return null;
  }

  const url = `https://${storeUrl}/admin/api/2024-01/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
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

  // Search for customers with the "Verified" tag and their metafield value.
  // We sort by updated_at DESC and paginate to scan through all verified customers.
  // In practice this should be a small set (hundreds, not millions).
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
      customer: { id: customerId, tags: newTags }
    })
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
        type: 'number_integer'
      }
    })
  });

  console.log('[Shopify] Verified number metafield set successfully');
  return data;
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

  return { verifiedNumber, customerId };
}

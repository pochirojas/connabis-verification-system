// services/shopify.js — Shopify Admin API Client
// Handles: adding "verified" tag + setting verified number metafield
import fetch from 'node-fetch';

// Generate the next verified number
// Format: VRF-YYYYMMDD-XXXX (e.g., VRF-20260320-0001)
// The date portion ensures uniqueness across days
// The counter portion is based on timestamp milliseconds for uniqueness
function generateVerifiedNumber() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const counter = String(now.getTime() % 10000).padStart(4, '0');
  return `VRF-${date}-${counter}`;
}

// Helper: Make authenticated request to Shopify Admin API
async function shopifyAdminFetch(endpoint, options = {}) {
  const storeUrl = process.env.SHOPIFY_STORE_URL;
  const apiKey = process.env.SHOPIFY_API_KEY;

  if (!storeUrl || !apiKey) {
    console.warn('[Shopify API] Store URL or API key not configured, skipping');
    return null;
  }

  const url = `https://${storeUrl}/admin/api/2024-01${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'X-Shopify-Access-Token': apiKey,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Shopify API error (${res.status}): ${error}`);
  }

  return res.json();
}

// Add "verified" tag to customer
export async function addVerifiedTag(customerId) {
  console.log('[Shopify API] Adding verified tag to customer:', customerId);

  // Shopify REST API for tags
  const data = await shopifyAdminFetch(`/customers/${customerId}.json`, {
    method: 'PUT',
    body: JSON.stringify({
      customer: {
        id: customerId,
        tags: 'verified'  // Shopify appends to existing tags
      }
    })
  });

  console.log('[Shopify API] Verified tag added successfully');
  return data;
}

// Set the verified number metafield on a customer
// IMPORTANT: Update namespace and key below to match your actual Shopify metafield definition
export async function setVerifiedNumber(customerId, verifiedNumber) {
  console.log('[Shopify API] Setting verified number for customer:', customerId, '→', verifiedNumber);

  const data = await shopifyAdminFetch(`/customers/${customerId}/metafields.json`, {
    method: 'POST',
    body: JSON.stringify({
      metafield: {
        // ⚠️ UPDATE THESE TO MATCH YOUR ACTUAL METAFIELD DEFINITION:
        namespace: process.env.VERIFIED_METAFIELD_NAMESPACE || 'custom',
        key: process.env.VERIFIED_METAFIELD_KEY || 'verified_number',
        value: verifiedNumber,
        type: 'single_line_text_field'
      }
    })
  });

  console.log('[Shopify API] Verified number metafield set successfully');
  return data;
}

// Main function: Mark a customer as verified (tag + metafield)
export async function markCustomerVerified(customerId) {
  const verifiedNumber = generateVerifiedNumber();
  console.log('[Shopify API] Marking customer', customerId, 'as verified with number:', verifiedNumber);

  try {
    // Step 1: Add "verified" tag
    await addVerifiedTag(customerId);
  } catch (error) {
    console.error('[Shopify API] Failed to add verified tag:', error.message);
    // Continue to try setting metafield even if tag fails
  }

  try {
    // Step 2: Set verified number metafield
    await setVerifiedNumber(customerId, verifiedNumber);
  } catch (error) {
    console.error('[Shopify API] Failed to set verified number:', error.message);
  }

  return { verifiedNumber, customerId };
}

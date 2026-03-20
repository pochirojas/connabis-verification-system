// services/shopify.js — Shopify Admin API Client (Customer Metafield Updates)
import fetch from 'node-fetch';

// Update Shopify customer metafield with verification status
export async function updateShopifyCustomerVerification(customerId, verificationData) {
  console.log('[Shopify API] Updating customer metafield:', customerId);

  const storeUrl = process.env.SHOPIFY_STORE_URL;
  const apiKey = process.env.SHOPIFY_API_KEY;

  if (!storeUrl || !apiKey) {
    console.warn('[Shopify API] Store URL or API key not configured, skipping metafield update');
    return null;
  }

  const url = `https://${storeUrl}/admin/api/2024-01/customers/${customerId}/metafields.json`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      metafield: {
        namespace: 'verification',
        key: 'status',
        value: JSON.stringify(verificationData),
        type: 'json'
      }
    })
  });

  if (!res.ok) {
    const error = await res.text();
    console.error('[Shopify API] Metafield update failed:', res.status, error);
    throw new Error(`Shopify metafield update failed (${res.status}): ${error}`);
  }

  const data = await res.json();
  console.log('[Shopify API] Customer metafield updated successfully');
  return data;
}

# Connabis Verification System

Stateless, serverless age and identity verification API for **connabis.com.co** (Shopify).

When a customer creates an account on the Shopify store, this system:
1. Receives a Shopify `customers/create` webhook
2. Creates a SUMA Mexico VeriDocID verification session
3. Sends the customer a verification email (via Resend)
4. Receives the verification result from SUMA via webhook
5. Adds the **"Verified"** tag and assigns a sequential **verified number** (custom.verified_number) to the customer

## Architecture

```
Customer → Shopify (account creation)
               ↓ webhook
         Verification API (this service)
          ↙      ↓        ↘
     SUMA API   Resend    Shopify Admin
     (verify)   (email)   (metafield)
```

## Tech Stack

| Component            | Technology               |
|----------------------|--------------------------|
| Runtime              | Node.js 22.x             |
| Framework            | Express (ESM)            |
| E-commerce           | Shopify API 2024-01      |
| ID Verification      | SUMA Mexico VeriDocID    |
| Email                | Resend                   |
| Hosting              | Render (Web Service)     |
| Database             | None (stateless)         |

## Project Structure

```
connabis-verification-system/
├── package.json
├── .env.example
├── .gitignore
├── server.js                    # Express entry point
├── routes/
│   ├── shopify.js               # Shopify webhook handlers
│   └── suma.js                  # SUMA callback/webhook handlers
├── services/
│   ├── email.js                 # Resend email client
│   ├── suma.js                  # SUMA API client
│   └── shopify.js               # Shopify Admin API client
└── utils/
    └── verifyShopify.js         # HMAC verification helper
```

## Setup

### 1. Clone and install

```bash
git clone <your-repo-url>
cd connabis-verification-system
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
# Edit .env with your actual API keys
```

### 3. Run locally

```bash
npm run dev
```

### 4. Test health check

```bash
curl http://localhost:3000/health
```

## Environment Variables

| Variable                | Required | Description                          |
|-------------------------|----------|--------------------------------------|
| `NODE_ENV`              | No       | `development` or `production`        |
| `PORT`                  | No       | Auto-set by Render (default: 3000)   |
| `APP_BASE_URL`          | Yes      | Public URL of this service           |
| `FROM_EMAIL`            | No       | Sender address (default: `Connabis <no-reply@connabis.com.co>`) |
| `NOTIFY_EMAIL`          | Yes      | Admin notification email             |
| `RESEND_API_KEY`        | Yes      | Resend API key                       |
| `SHOPIFY_STORE_URL`     | Yes      | **Must be** `connabis.myshopify.com` (not the custom domain) |
| `SHOPIFY_API_KEY`       | Yes      | Shopify Admin API access token (**must start with `shpat_`**) |
| `SHOPIFY_API_SECRET`    | Yes      | Shopify API secret key               |
| `SHOPIFY_WEBHOOK_SECRET`| Yes      | Shopify webhook signing secret       |
| `SUMA_BASE_URL`         | Yes      | SUMA API base URL                    |
| `SUMA_CLIENT_ID`        | Yes      | SUMA OAuth client ID                 |
| `SUMA_CLIENT_SECRET`    | Yes      | SUMA OAuth client secret             |

## Deploy to Render

### Step-by-step:

1. Push code to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Configure:
   - **Name:** `connabis-verification-system`
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Add all environment variables from the table above
   - Set `APP_BASE_URL` to your Render service URL (e.g., `https://connabis-verification-system.onrender.com`)
6. Deploy

### Verify deployment:

```bash
curl https://your-service.onrender.com/health
```

## Shopify Webhook Setup

### Via Shopify Admin:

1. Go to **Settings → Notifications → Webhooks**
2. Click **Create webhook**
3. Configure:
   - **Event:** Customer creation
   - **Format:** JSON
   - **URL:** `https://your-service.onrender.com/webhooks/shopify/customer-created`
   - **API version:** 2024-01
4. Save and copy the webhook signing secret to `SHOPIFY_WEBHOOK_SECRET`

## Testing

### Test 1: Health check
```bash
curl http://localhost:3000/health
```

### Test 2: Email system
```bash
curl http://localhost:3000/test/email
```

### Test 3: Simulated Shopify webhook
```bash
# Generate HMAC
BODY='{"id":123456,"email":"test@example.com","first_name":"Test","last_name":"User"}'
HMAC=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "YOUR_WEBHOOK_SECRET" -binary | base64)

# Send webhook
curl -X POST http://localhost:3000/webhooks/shopify/customer-created \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Hmac-Sha256: $HMAC" \
  -d "$BODY"
```

### Test 4: Simulated SUMA webhook
```bash
curl -X POST http://localhost:3000/suma/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "verification_id": "vrf_test123",
    "external_id": "shopify_customer_123456",
    "status": "completed",
    "email": "test@example.com",
    "document_valid": true,
    "face_match": true,
    "liveness_passed": true
  }'
```

## Endpoints

| Method | Path                                    | Description                          |
|--------|-----------------------------------------|--------------------------------------|
| GET    | `/health`                               | Health check                         |
| GET    | `/test/email`                           | Send test email to admin             |
| POST   | `/webhooks/shopify/customer-created`    | Shopify customer creation webhook    |
| POST   | `/webhooks/shopify/order-created`       | Shopify order creation webhook       |
| GET    | `/suma/callback`                        | User redirect after SUMA verification|
| POST   | `/suma/webhook`                         | SUMA verification result webhook     |

## Key Design Decisions

- **Stateless:** No database. All state lives in Shopify (customer metafields) and SUMA.
- **Sequential Verified Numbers:** Queries Shopify GraphQL API for the highest existing `custom.verified_number` across all "Verified"-tagged customers, then assigns max + 1. Currently at 299, so next = 300.
- **ESM Only:** All code uses ES Modules (`type: "module"` in package.json).
- **Async Webhook Processing:** Shopify webhook responds immediately with 200, then processes verification asynchronously to avoid Shopify's 5-second timeout.
- **Secure:** HMAC verification for Shopify webhooks. Timing-safe comparison to prevent timing attacks.
- **Graceful Failures:** Non-critical failures (like Shopify metafield updates) don't break the main flow. If the sequential number query fails, a timestamp-based fallback is used.

## Troubleshooting

| Symptom | Cause | Solution |
|---------|-------|----------|
| App crashes on Render with no logs | Not binding to `PORT` | Verify `app.listen(process.env.PORT)` |
| "Module does not provide export" | Import/export mismatch | Check named exports match imports |
| "Cannot find module" | Missing `.js` extension | Add `.js` to all relative imports |
| Shopify webhook returns 401 | Invalid HMAC | Verify `SHOPIFY_WEBHOOK_SECRET` matches |
| SUMA auth fails | Bad credentials | Check `SUMA_CLIENT_ID` and `SUMA_CLIENT_SECRET` |
| No emails received | Resend not configured | Verify `RESEND_API_KEY` and domain verification |

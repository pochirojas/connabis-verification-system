// routes/profile.js — Profile completion form for external/Google login customers
import express from 'express';
import { logEvent } from '../services/logger.js';
import {
  getCustomer,
  updateCustomerProfile,
  addTag,
  removeTag,
  isProfileComplete,
  checkFullApproval
} from '../services/shopify.js';
import { startVerificationFlow } from './shopify.js';

const router = express.Router();

// GET /profile/complete?cid=<shopifyCustomerId>&email=<email>
// Serves the profile completion form
router.get('/complete', async (req, res) => {
  const { cid, email } = req.query;

  if (!cid || !email) {
    return res.status(400).send(errorPage('Enlace inválido. Por favor contacta a connabisco@gmail.com'));
  }

  // Verify this customer exists and still needs profile completion
  try {
    const customer = await getCustomer(cid);
    if (!customer) {
      return res.status(404).send(errorPage('Cuenta no encontrada.'));
    }

    // If already fully verified, show success page instead
    const tags = (customer.tags || '').split(',').map(t => t.trim().toLowerCase());
    if (tags.includes('verified')) {
      return res.send(successPage('Tu perfil ya está completo y verificado. ¡Gracias!'));
    }

    res.send(formPage({ cid, email, customer }));
  } catch (err) {
    console.error('[Profile] Error loading customer:', err.message);
    res.status(500).send(errorPage('Error al cargar tu perfil. Por favor intenta más tarde.'));
  }
});

// POST /profile/complete — Handle form submission
router.post('/complete', express.urlencoded({ extended: true }), async (req, res) => {
  const { cid, email, phone, id_type, id_number, address, zip } = req.body;

  console.log('[Profile] Form submitted for customer:', cid, '| Email:', email);

  if (!cid || !email || !phone || !id_type || !id_number || !address) {
    return res.status(400).send(errorPage('Por favor completa todos los campos requeridos.'));
  }

  try {
    // Build Shopify customer update payload
    // company = ID number (for Dataico compatibility)
    const profileFields = {
      phone: phone.trim(),
      company: id_number.trim(), // ID number stored as company for Dataico
      addresses: [{
        address1: address.trim(),
        zip: (zip || '').trim(),
        country: 'CO',
        city: 'Colombia',
      }]
    };

    // Update customer profile in Shopify
    await updateCustomerProfile(cid, profileFields);
    console.log('[Profile] Customer profile updated:', cid);

    // Remove "Not Verified" tag now that profile is complete
    await removeTag(cid, 'Not Verified');
    console.log('[Profile] Not Verified tag removed');

    // Start the full verification flow (VeriDocID + emails)
    // Get customer name for the session
    const customer = await getCustomer(cid);
    startVerificationFlow({
      id: cid,
      email,
      first_name: customer?.first_name || '',
      last_name: customer?.last_name || ''
    }).catch(err => {
      console.error('[Profile] Verification flow failed after profile complete:', err.message);
    });

    logEvent({ type: 'profile', status: 'ok', detail: 'Profile completed — verification flow started', customerId: cid, email });
    res.send(successPage(`¡Perfil completado! En un momento recibirás un correo con los pasos para verificar tu identidad y firmar tu consentimiento.`));

  } catch (err) {
    console.error('[Profile] Error updating customer:', err.message);
    logEvent({ type: 'error', status: 'error', detail: `Profile form submission failed: ${err.message}`, customerId: cid, email });
    res.status(500).send(errorPage('Error al guardar tu información. Por favor intenta más tarde.'));
  }
});

// ─── HTML Page Templates ─────────────────────────────────────────

function formPage({ cid, email, customer }) {
  const name = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || 'Miembro';
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Completa tu Perfil - Connabis</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5; min-height: 100vh;
      display: flex; align-items: flex-start; justify-content: center;
      padding: 40px 16px;
    }
    .card {
      background: #fff; border-radius: 12px; max-width: 520px; width: 100%;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08); overflow: hidden;
    }
    .header {
      background: #2d6a4f; padding: 28px 32px; text-align: center;
    }
    .header h1 { color: #fff; font-size: 24px; font-weight: 700; }
    .header p { color: rgba(255,255,255,0.85); margin-top: 6px; font-size: 14px; }
    .body { padding: 32px; }
    .greeting { color: #1a1a1a; font-size: 18px; font-weight: 600; margin-bottom: 8px; }
    .subtitle { color: #555; font-size: 14px; line-height: 1.6; margin-bottom: 28px; }
    .field { margin-bottom: 20px; }
    label { display: block; font-size: 13px; font-weight: 600; color: #333; margin-bottom: 6px; }
    label .req { color: #c0392b; margin-left: 2px; }
    input, select {
      width: 100%; padding: 11px 14px; border: 1px solid #ddd; border-radius: 6px;
      font-size: 15px; color: #1a1a1a; background: #fff;
      transition: border-color 0.15s;
      -webkit-appearance: none;
    }
    input:focus, select:focus { outline: none; border-color: #2d6a4f; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .hint { font-size: 12px; color: #888; margin-top: 4px; }
    button {
      width: 100%; background: #2d6a4f; color: #fff; border: none;
      padding: 14px; border-radius: 6px; font-size: 16px; font-weight: 600;
      cursor: pointer; margin-top: 8px; transition: background 0.2s;
    }
    button:hover { background: #1b4332; }
    .privacy { text-align: center; font-size: 12px; color: #999; margin-top: 16px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>Connabis</h1>
      <p>Completa tu perfil de membresía</p>
    </div>
    <div class="body">
      <p class="greeting">Hola, ${name}</p>
      <p class="subtitle">
        Para activar tu cuenta necesitamos algunos datos adicionales.
        Esta información es requerida por regulación para la compra de productos de cannabis.
      </p>

      <form method="POST" action="/profile/complete">
        <input type="hidden" name="cid" value="${cid}">
        <input type="hidden" name="email" value="${email}">

        <div class="row">
          <div class="field">
            <label>Tipo de Documento <span class="req">*</span></label>
            <select name="id_type" required>
              <option value="">Seleccionar</option>
              <option value="CC">Cédula de Ciudadanía (CC)</option>
              <option value="CE">Cédula de Extranjería (CE)</option>
              <option value="PA">Pasaporte (PA)</option>
              <option value="TI">Tarjeta de Identidad (TI)</option>
            </select>
          </div>
          <div class="field">
            <label>Número de Documento <span class="req">*</span></label>
            <input type="text" name="id_number" placeholder="Ej: 1005289529" required
                   pattern="[0-9A-Za-z\-]+" minlength="5">
            <p class="hint">Sin puntos ni espacios</p>
          </div>
        </div>

        <div class="field">
          <label>Celular <span class="req">*</span></label>
          <input type="tel" name="phone" placeholder="+57 300 123 4567" required>
        </div>

        <div class="field">
          <label>Dirección <span class="req">*</span></label>
          <input type="text" name="address" placeholder="Calle 123 # 45-67, Barrio" required>
        </div>

        <div class="field">
          <label>Código Postal <span class="req" style="color:#999">(opcional)</span></label>
          <input type="text" name="zip" placeholder="Ej: 680003" maxlength="10">
        </div>

        <button type="submit">Guardar y Continuar →</button>
      </form>

      <p class="privacy">
        Tus datos están protegidos y solo se usan para verificar tu membresía.<br>
        Al continuar, confirmas que tienes 18 años o más.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function successPage(message) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>¡Listo! - Connabis</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f5;
      display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #fff; border-radius: 12px; max-width: 480px; width: 100%;
      padding: 48px 40px; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .icon { font-size: 56px; margin-bottom: 16px; }
    h2 { color: #2d6a4f; font-size: 22px; margin-bottom: 12px; }
    p { color: #555; font-size: 15px; line-height: 1.6; margin-bottom: 28px; }
    a { display: inline-block; background: #2d6a4f; color: #fff; padding: 13px 28px;
      text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h2>¡Todo listo!</h2>
    <p>${message}</p>
    <a href="https://connabis.com.co">Volver a Connabis</a>
  </div>
</body>
</html>`;
}

function errorPage(message) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error - Connabis</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f5;
      display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #fff; border-radius: 12px; max-width: 480px; width: 100%;
      padding: 48px 40px; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .icon { font-size: 56px; margin-bottom: 16px; }
    h2 { color: #c0392b; font-size: 22px; margin-bottom: 12px; }
    p { color: #555; font-size: 15px; line-height: 1.6; margin-bottom: 28px; }
    a { display: inline-block; background: #555; color: #fff; padding: 13px 28px;
      text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">❌</div>
    <h2>Algo salió mal</h2>
    <p>${message}</p>
    <a href="https://connabis.com.co">Volver a Connabis</a>
  </div>
</body>
</html>`;
}

export default router;

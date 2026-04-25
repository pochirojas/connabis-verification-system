// routes/profile.js — Profile completion form for external/Google login customers
import express from 'express';
import { logEvent } from '../services/logger.js';
import {
  getCustomer,
  updateCustomerProfile,
  addTag,
  removeTag,
  isProfileComplete,
  checkFullApproval,
  setCustomerMetafield
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
  const { cid, email, phone, id_type, id_number, address, address2, city, province, zip, birth_date } = req.body;

  console.log('[Profile] Form submitted for customer:', cid, '| Email:', email);

  // Normalize phone: user types digits only, we prepend +57
  const normalizePhone = (p = '') => {
    let d = p.replace(/[\s\-().]/g, '');
    if (!d.startsWith('+')) d = '+57' + d.replace(/^0+/, '').replace(/^57/, '');
    return d;
  };
  const normalizedPhone = normalizePhone(phone?.trim());

  const missing = [];
  if (!cid || !email) return res.status(400).send(errorPage('Enlace inválido. Por favor contacta a connabisco@gmail.com'));
  if (!id_type) missing.push('Tipo de documento');
  if (!id_number?.trim()) missing.push('Número de documento');
  if (!normalizedPhone || normalizedPhone === '+57') missing.push('Celular');
  if (!birth_date) missing.push('Fecha de nacimiento');
  if (!address?.trim()) missing.push('Dirección');
  if (!city?.trim()) missing.push('Ciudad');
  if (!province) missing.push('Departamento');

  if (missing.length > 0) {
    const customer = await getCustomer(cid).catch(() => null);
    return res.send(formPage({ cid, email, customer, error: `Por favor completa: ${missing.join(', ')}.` }));
  }

  // Age check (must be 18+)
  const dob = new Date(birth_date);
  const age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  if (isNaN(age) || age < 18) {
    const customer = await getCustomer(cid).catch(() => null);
    return res.send(formPage({ cid, email, customer, error: 'Debes tener al menos 18 años para registrarte.' }));
  }

  try {
    const profileFields = {
      phone: normalizedPhone,
      company: id_number.trim(),
      addresses: [{
        address1: address.trim(),
        address2: address2?.trim() || '',
        city: city.trim(),
        province: province.trim(),
        zip: (zip || '').trim(),
        country_code: 'CO',
      }]
    };

    await updateCustomerProfile(cid, profileFields);
    // Save extra fields as metafields
    await Promise.allSettled([
      setCustomerMetafield(cid, 'id_type', id_type),
      setCustomerMetafield(cid, 'birth_date', birth_date),
    ]);
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

    // Friendly errors for known Shopify validation issues
    if (err.message.includes('phone') && err.message.includes('already been taken')) {
      return res.send(errorPage('Ese número de celular ya está registrado en otra cuenta. Por favor usa un número diferente o contáctanos por WhatsApp al +57 310 475 2111.'));
    }
    if (err.message.includes('phone') && err.message.includes('invalid')) {
      return res.send(errorPage('El formato del número de celular no es válido. Usa el formato: +57 300 123 4567.'));
    }

    res.status(500).send(errorPage('Error al guardar tu información. Por favor intenta más tarde.'));
  }
});

// ─── HTML Page Templates ─────────────────────────────────────────

const DEPARTAMENTOS = ['Amazonas','Antioquia','Arauca','Atlántico','Bolívar','Boyacá','Caldas','Caquetá','Casanare','Cauca','Cesar','Chocó','Córdoba','Cundinamarca','Guainía','Guaviare','Huila','La Guajira','Magdalena','Meta','Nariño','Norte de Santander','Putumayo','Quindío','Risaralda','San Andrés y Providencia','Santander','Sucre','Tolima','Valle del Cauca','Vaupes','Vichada','Bogotá D.C.'];

function formPage({ cid, email, customer, error = null }) {
  const name = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || 'Miembro';
  const maxDate = new Date(Date.now() - 18*365.25*24*60*60*1000).toISOString().split('T')[0];
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Completa tu Perfil - Connabis</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: #f7f7f7; min-height: 100vh; display: flex; flex-direction: column; align-items: center; }
    .topbar { width: 100%; background: #1a2235; padding: 10px 20px; text-align: center;
      font-size: 13px; color: rgba(255,255,255,0.85); letter-spacing: 0.2px; }
    .site-header { width: 100%; background: #fff; border-bottom: 1px solid #e8e8e8;
      padding: 18px 20px; text-align: center; }
    .site-header img { height: 60px; width: auto; }
    .page-wrap { width: 100%; max-width: 580px; padding: 36px 16px 60px; }
    .card { background: #fff; border-radius: 4px; border: 1px solid #e0e0e0; overflow: hidden; }
    .card-header { background: #2d6a4f; padding: 24px 32px; text-align: center; }
    .card-header h1 { color: #fff; font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }
    .card-header p { color: rgba(255,255,255,0.8); font-size: 13px; margin-top: 5px; }
    .card-body { padding: 32px; }
    .greeting { font-size: 17px; font-weight: 600; color: #111; margin-bottom: 6px; }
    .subtitle { font-size: 14px; color: #666; line-height: 1.65; margin-bottom: 24px;
      padding-bottom: 24px; border-bottom: 1px solid #f0f0f0; }
    .section-title { font-size: 11px; font-weight: 700; color: #2d6a4f;
      text-transform: uppercase; letter-spacing: 1px; margin: 24px 0 14px;
      padding-bottom: 8px; border-bottom: 2px solid #e8f5e9; }
    .section-title:first-of-type { margin-top: 0; }
    .error-box { background: #fdf0f0; border: 1px solid #f5c6c6; border-radius: 4px;
      padding: 12px 16px; margin-bottom: 20px; font-size: 14px; color: #c0392b; line-height: 1.5; }
    .field { margin-bottom: 18px; }
    label { display: block; font-size: 12px; font-weight: 700; color: #444;
      text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 7px; }
    .req { color: #c0392b; margin-left: 1px; }
    .opt { color: #aaa; font-weight: 400; text-transform: none; font-size: 11px; letter-spacing: 0; }
    input[type="text"], input[type="tel"], input[type="date"], select {
      width: 100%; padding: 12px 14px; border: 1px solid #d5d5d5; border-radius: 4px;
      font-size: 15px; color: #111; background: #fff; -webkit-appearance: none; appearance: none;
      transition: border-color 0.15s, box-shadow 0.15s; line-height: 1.4; }
    input:focus, select:focus { outline: none; border-color: #2d6a4f;
      box-shadow: 0 0 0 3px rgba(45,106,79,0.1); }
    .select-wrap { position: relative; }
    .select-wrap::after { content: ''; position: absolute; right: 14px; top: 50%;
      transform: translateY(-50%); width: 0; height: 0;
      border-left: 5px solid transparent; border-right: 5px solid transparent;
      border-top: 6px solid #888; pointer-events: none; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    @media (max-width: 420px) { .row { grid-template-columns: 1fr; } }
    .hint { font-size: 11px; color: #999; margin-top: 5px; }
    .phone-wrap { display: flex; }
    .phone-prefix { display: flex; align-items: center; padding: 12px 14px; background: #f0f0f0;
      border: 1px solid #d5d5d5; border-right: none; border-radius: 4px 0 0 4px;
      font-size: 15px; color: #444; white-space: nowrap; font-weight: 600; }
    .phone-input { border-radius: 0 4px 4px 0 !important; flex: 1; }
    .submit-btn { width: 100%; background: #2d6a4f; color: #fff; border: none;
      padding: 15px; border-radius: 50px; font-size: 15px; font-weight: 700;
      letter-spacing: 0.3px; cursor: pointer; margin-top: 24px; transition: background 0.2s; }
    .submit-btn:hover { background: #1b4332; }
    .submit-btn:disabled { background: #aaa; cursor: not-allowed; }
    .privacy { text-align: center; font-size: 12px; color: #aaa; margin-top: 20px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="topbar">Connabis Colombia &mdash; Membresía Regulada</div>
  <header class="site-header">
    <a href="https://connabis.com.co">
      <img src="https://cdn.shopify.com/s/files/1/0581/4121/2749/files/Logo_Negro_sin_fondo.png"
           alt="Connabis" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
      <span style="display:none;font-size:22px;font-weight:800;color:#111;letter-spacing:-0.5px;">CO·NNABIS</span>
    </a>
  </header>

  <div class="page-wrap">
    <div class="card">
      <div class="card-header">
        <h1>Completa tu Perfil</h1>
        <p>Requerido para activar tu membresía</p>
      </div>
      <div class="card-body">
        <p class="greeting">Hola, ${name} 👋</p>
        <p class="subtitle">
          Registraste tu cuenta con Google. Para activarla necesitamos algunos
          datos adicionales requeridos por regulación.
        </p>

        ${error ? `<div class="error-box">${error}</div>` : ''}

        <form method="POST" action="/profile/complete" autocomplete="on" id="profileForm">
          <input type="hidden" name="cid" value="${cid}">
          <input type="hidden" name="email" value="${email}">

          <p class="section-title">Documento de Identidad</p>

          <div class="row">
            <div class="field">
              <label>Tipo de Doc. <span class="req">*</span></label>
              <div class="select-wrap">
                <select name="id_type" required>
                  <option value="">Seleccionar</option>
                  <option value="CC">C.C. &mdash; Cédula Ciudadanía</option>
                  <option value="CE">C.E. &mdash; Cédula Extranjería</option>
                  <option value="PA">PA &mdash; Pasaporte</option>
                  <option value="TI">T.I. &mdash; Tarjeta Identidad</option>
                </select>
              </div>
            </div>
            <div class="field">
              <label>Número de Doc. <span class="req">*</span></label>
              <input type="text" name="id_number" placeholder="Ej: 1005289529"
                     required minlength="5" inputmode="numeric">
              <p class="hint">Sin puntos ni espacios</p>
            </div>
          </div>

          <p class="section-title">Datos Personales</p>

          <div class="field">
            <label>Fecha de Nacimiento <span class="req">*</span></label>
            <input type="date" name="birth_date" required max="${maxDate}" min="1900-01-01">
            <p class="hint">Debes tener 18 años o más</p>
          </div>

          <div class="field">
            <label>Celular <span class="req">*</span></label>
            <div class="phone-wrap">
              <span class="phone-prefix">+57</span>
              <input type="tel" name="phone" class="phone-input"
                     placeholder="300 123 4567" required inputmode="numeric" autocomplete="tel">
            </div>
            <p class="hint">Solo dígitos, sin código de país</p>
          </div>

          <p class="section-title">Dirección</p>

          <div class="field">
            <label>Dirección <span class="req">*</span></label>
            <input type="text" name="address" placeholder="Calle 123 # 45-67" required autocomplete="address-line1">
          </div>

          <div class="field">
            <label>Apartamento / Casa / Oficina <span class="opt">(opcional)</span></label>
            <input type="text" name="address2" placeholder="Apto 301, Casa 5, etc." autocomplete="address-line2">
          </div>

          <div class="row">
            <div class="field">
              <label>Ciudad <span class="req">*</span></label>
              <input type="text" name="city" placeholder="Bogotá" required autocomplete="address-level2">
            </div>
            <div class="field">
              <label>Código Postal <span class="opt">(opcional)</span></label>
              <input type="text" name="zip" placeholder="Ej: 110111" maxlength="10" inputmode="numeric">
            </div>
          </div>

          <div class="field">
            <label>Departamento <span class="req">*</span></label>
            <div class="select-wrap">
              <select name="province" required>
                <option value="">Seleccionar</option>
                ${DEPARTAMENTOS.map(d => `<option value="${d}">${d}</option>`).join('')}
              </select>
            </div>
          </div>

          <button type="submit" class="submit-btn" id="submitBtn">Guardar y Continuar</button>
        </form>

        <p class="privacy">Tu información está protegida y solo se usa para verificar tu membresía.</p>
      </div>
    </div>
  </div>

  <script>
    document.getElementById('profileForm').addEventListener('submit', function() {
      var btn = document.getElementById('submitBtn');
      btn.disabled = true;
      btn.textContent = 'Guardando...';
    });
    // iframe: hide header, send height
    (function() {
      if (window.self !== window.top) {
        var tb = document.querySelector('.topbar');
        var hd = document.querySelector('.site-header');
        if (tb) tb.style.display = 'none';
        if (hd) hd.style.display = 'none';
        document.body.style.background = 'transparent';
      }
      function sendHeight() {
        if (window.parent !== window)
          window.parent.postMessage({ height: document.body.scrollHeight }, 'https://connabis.com.co');
      }
      sendHeight();
      new ResizeObserver(sendHeight).observe(document.body);
    })();
  </script>
</body>
</html>`;
}

const sharedShell = (content) => `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: #f7f7f7; min-height: 100vh; display: flex; flex-direction: column; align-items: center; }
    .topbar { width: 100%; background: #1a2235; padding: 10px 20px; text-align: center;
      font-size: 13px; color: rgba(255,255,255,0.85); }
    .site-header { width: 100%; background: #fff; border-bottom: 1px solid #e8e8e8;
      padding: 18px 20px; text-align: center; }
    .site-header img { height: 60px; width: auto; }
    .page-wrap { width: 100%; max-width: 480px; padding: 48px 16px 60px;
      display: flex; align-items: center; justify-content: center; flex: 1; }
    .card { background: #fff; border: 1px solid #e0e0e0; border-radius: 4px;
      width: 100%; padding: 48px 40px; text-align: center; }
    @media (max-width: 480px) { .card { padding: 36px 24px; } }
  </style>
</head>
<body>
  <div class="topbar">Connabis Colombia &mdash; Membersía Regulada</div>
  <header class="site-header">
    <a href="https://connabis.com.co">
      <img src="https://cdn.shopify.com/s/files/1/0581/4121/2749/files/Logo_Negro_sin_fondo.png" alt="Connabis"
           onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
      <span style="display:none;font-size:22px;font-weight:800;color:#111;">CO·NNABIS</span>
    </a>
  </header>
  <div class="page-wrap"><div class="card">${content}</div></div>
</body></html>`;

function successPage(message) {
  return sharedShell(`
    <div style="font-size:52px;margin-bottom:16px;">✅</div>
    <h2 style="color:#2d6a4f;font-size:22px;font-weight:700;margin-bottom:10px;">¡Todo listo!</h2>
    <p style="color:#555;font-size:15px;line-height:1.65;margin-bottom:28px;">${message}</p>
    <a href="https://connabis.com.co"
       style="display:inline-block;background:#2d6a4f;color:#fff;padding:13px 28px;
              text-decoration:none;border-radius:4px;font-weight:700;font-size:15px;">
      Volver a Connabis
    </a>`);
}

function errorPage(message) {
  return sharedShell(`
    <div style="font-size:52px;margin-bottom:16px;">❌</div>
    <h2 style="color:#c0392b;font-size:22px;font-weight:700;margin-bottom:10px;">Algo salió mal</h2>
    <p style="color:#555;font-size:15px;line-height:1.65;margin-bottom:28px;">${message}</p>
    <a href="https://connabis.com.co"
       style="display:inline-block;background:#555;color:#fff;padding:13px 28px;
              text-decoration:none;border-radius:4px;font-weight:700;font-size:15px;">
      Volver a Connabis
    </a>`);
}

export default router;

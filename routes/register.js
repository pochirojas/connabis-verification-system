// routes/register.js — Custom registration form (AR replacement)
// Accessible at /register — AR stays untouched until this is approved
import express from 'express';
import { logEvent } from '../services/logger.js';
import { addTag, setCustomerMetafield, createCustomer } from '../services/shopify.js';
import { startVerificationFlow } from './shopify.js';

const router = express.Router();

// ─── GET /register — Show the form ───────────────────────────────────────────
router.get('/', (req, res) => {
  const error = req.query.error || null;
  res.send(registerPage({ error }));
});

// ─── POST /register — Handle submission ──────────────────────────────────────
router.post('/', async (req, res) => {
  const {
    first_name, last_name, email, password, password_confirm,
    phone, id_type, id_number,
    birth_date, purchase_intent,
    address, address2, city, province, zip,
    privacy_policy
  } = req.body;

  // Basic server-side validation
  if (!first_name || !last_name || !email || !password || !phone || !id_type || !id_number || !birth_date || !address || !city || !province || !privacy_policy) {
    return res.send(registerPage({ error: 'Por favor completa todos los campos requeridos.', prefill: req.body }));
  }

  if (password.length < 8) {
    return res.send(registerPage({ error: 'La contraseña debe tener al menos 8 caracteres.', prefill: req.body }));
  }

  if (password !== password_confirm) {
    return res.send(registerPage({ error: 'Las contraseñas no coinciden.', prefill: req.body }));
  }

  // Age check (must be 18+)
  const dob = new Date(birth_date);
  const age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  if (age < 18) {
    return res.send(registerPage({ error: 'Debes tener al menos 18 años para registrarte.', prefill: req.body }));
  }

  try {
    // Create customer in Shopify
    const data = await createCustomer({
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      email: email.trim().toLowerCase(),
      password,
      password_confirmation: password,
      phone: phone.trim(),
      company: id_number.trim(), // ID number stored as company for Dataico
      tags: 'Not Verified',
      send_email_welcome: false,
      addresses: [{
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        phone: phone.trim(),
        address1: address.trim(),
        address2: address2?.trim() || '',
        city: city.trim(),
        province: province.trim(),
        zip: zip?.trim() || '',
        country: 'Colombia',
        country_code: 'CO'
      }]
    });

    // Shopify returns errors.email if duplicate
    if (data.errors) {
      const emailErr = data.errors.email?.[0];
      const msg = emailErr
        ? 'Ya existe una cuenta con ese correo electrónico. <a href="https://connabis.com.co/account/login">Inicia sesión aquí</a>.'
        : 'Error al crear la cuenta. Por favor intenta de nuevo.';
      return res.send(registerPage({ error: msg, prefill: req.body }));
    }

    const customer = data.customer;
    const id = String(customer.id);

    // Store extra fields as metafields
    await Promise.allSettled([
      setCustomerMetafield(id, 'id_type', id_type),
      setCustomerMetafield(id, 'birth_date', birth_date),
      setCustomerMetafield(id, 'purchase_intent', purchase_intent || 'No especificado'),
    ]);

    logEvent({ type: 'webhook', status: 'ok', detail: 'New customer registered via custom form', customerId: id, email: customer.email });

    // Trigger verification flow async (don't block the redirect)
    startVerificationFlow({
      id,
      email: customer.email,
      first_name: customer.first_name,
      last_name: customer.last_name
    }).catch(err => {
      console.error('[Register] Verification flow failed:', err.message);
      logEvent({ type: 'error', status: 'error', detail: `Post-register verification flow failed: ${err.message}`, customerId: id, email: customer.email });
    });

    // Redirect to success page
    res.redirect('/register/success');

  } catch (err) {
    console.error('[Register] Error:', err.message);
    logEvent({ type: 'error', status: 'error', detail: `Registration failed: ${err.message}`, email });
    res.send(registerPage({ error: 'Error inesperado. Por favor intenta de nuevo en unos momentos.', prefill: req.body }));
  }
});

// ─── GET /register/success ────────────────────────────────────────────────────
router.get('/success', (req, res) => {
  res.send(successPage());
});

// ─── HTML ─────────────────────────────────────────────────────────────────────
function registerPage({ error = null, prefill = {} } = {}) {
  const v = (field) => prefill[field] ? `value="${escHtml(prefill[field])}"` : '';
  const sel = (field, val) => prefill[field] === val ? 'selected' : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Crear Cuenta - Connabis</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: #f7f7f7;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .topbar {
      width: 100%; background: #1a2235; padding: 10px 20px;
      text-align: center; font-size: 13px; color: rgba(255,255,255,0.85);
    }

    .site-header {
      width: 100%; background: #fff; border-bottom: 1px solid #e8e8e8;
      padding: 18px 20px; text-align: center;
    }
    .site-header img { height: 60px; width: auto; }

    .page-wrap {
      width: 100%; max-width: 600px; padding: 36px 16px 60px;
    }

    .card {
      background: #fff; border-radius: 4px; border: 1px solid #e0e0e0; overflow: hidden;
    }

    .card-header {
      background: #2d6a4f; padding: 24px 32px; text-align: center;
    }
    .card-header h1 { color: #fff; font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }
    .card-header p { color: rgba(255,255,255,0.8); font-size: 13px; margin-top: 5px; }

    .card-body { padding: 32px; }

    .intro {
      text-align: center;
      margin-bottom: 28px;
      padding-bottom: 24px;
      border-bottom: 1px solid #f0f0f0;
    }
    .intro h2 {
      font-size: 22px;
      font-weight: 800;
      color: #111;
      margin-bottom: 12px;
      line-height: 1.3;
    }
    .intro p {
      font-size: 14px;
      color: #555;
      line-height: 1.7;
    }

    .error-box {
      background: #fdf0f0; border: 1px solid #f5c6c6; border-radius: 4px;
      padding: 12px 16px; margin-bottom: 24px;
      font-size: 14px; color: #c0392b; line-height: 1.5;
    }
    .error-box a { color: #c0392b; }

    .section-title {
      font-size: 11px; font-weight: 700; color: #2d6a4f;
      text-transform: uppercase; letter-spacing: 1px;
      margin: 28px 0 16px; padding-bottom: 8px;
      border-bottom: 2px solid #e8f5e9;
    }
    .section-title:first-of-type { margin-top: 0; }

    .field { margin-bottom: 18px; }

    label {
      display: block; font-size: 12px; font-weight: 700; color: #444;
      text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 7px;
    }
    .req { color: #c0392b; margin-left: 1px; }
    .opt { color: #aaa; font-weight: 400; text-transform: none; font-size: 11px; letter-spacing: 0; }

    input[type="text"],
    input[type="email"],
    input[type="password"],
    input[type="tel"],
    input[type="date"],
    select {
      width: 100%; padding: 12px 14px; border: 1px solid #d5d5d5;
      border-radius: 4px; font-size: 15px; color: #111; background: #fff;
      -webkit-appearance: none; appearance: none;
      transition: border-color 0.15s, box-shadow 0.15s;
      line-height: 1.4;
    }
    input:focus, select:focus {
      outline: none; border-color: #2d6a4f;
      box-shadow: 0 0 0 3px rgba(45,106,79,0.1);
    }
    input[type="date"] { color: #111; }

    .select-wrap { position: relative; }
    .select-wrap::after {
      content: ''; position: absolute; right: 14px; top: 50%;
      transform: translateY(-50%); width: 0; height: 0;
      border-left: 5px solid transparent; border-right: 5px solid transparent;
      border-top: 6px solid #888; pointer-events: none;
    }

    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    @media (max-width: 480px) { .row { grid-template-columns: 1fr; } }

    .hint { font-size: 11px; color: #999; margin-top: 5px; }

    /* Password strength */
    .pwd-wrap { position: relative; }
    .pwd-toggle {
      position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
      background: none; border: none; cursor: pointer; color: #888;
      font-size: 13px; padding: 4px;
    }

    /* Checkbox */
    .checkbox-wrap {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 14px; background: #f9f9f9; border: 1px solid #e8e8e8;
      border-radius: 4px; cursor: pointer;
    }
    .checkbox-wrap input[type="checkbox"] {
      width: 18px; height: 18px; min-width: 18px; margin-top: 1px;
      accent-color: #2d6a4f; cursor: pointer;
    }
    .checkbox-wrap label {
      font-size: 13px; font-weight: 400; color: #444;
      text-transform: none; letter-spacing: 0; cursor: pointer; margin: 0;
    }
    .checkbox-wrap a { color: #2d6a4f; }

    .submit-btn {
      width: 100%; background: #2d6a4f; color: #fff; border: none;
      padding: 15px; border-radius: 50px; font-size: 15px; font-weight: 700;
      letter-spacing: 0.3px; cursor: pointer; margin-top: 24px;
      transition: background 0.2s;
    }
    .submit-btn:hover { background: #1b4332; }
    .submit-btn:disabled { background: #aaa; cursor: not-allowed; }

    .login-link {
      text-align: center; font-size: 13px; color: #888; margin-top: 20px;
    }
    .login-link a { color: #2d6a4f; font-weight: 600; text-decoration: none; }

    .privacy {
      text-align: center; font-size: 12px; color: #aaa;
      margin-top: 16px; line-height: 1.6;
    }
  </style>
</head>
<body>

  <div class="topbar">Connabis Colombia &mdash; Membresía Regulada</div>

  <header class="site-header">
    <a href="https://connabis.com.co">
      <img src="https://cdn.shopify.com/s/files/1/0581/4121/2749/files/Logo_Negro_sin_fondo.png"
           alt="Connabis"
           onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
      <span style="display:none;font-size:22px;font-weight:800;color:#111;letter-spacing:-0.5px;">CO·NNABIS</span>
    </a>
  </header>

  <div class="page-wrap">
    <div class="card">
      <div class="card-body">

        <div class="intro">
          <h2>¡Vuélvete miembro Connábico!</h2>
          <p>
            Si deseas comprar <strong>exclusivamente hongos medicinales,</strong> NO requerimos
            una foto de tu documento, pero sí es necesario que completes tu información en el
            siguiente formulario.
          </p>
        </div>

        ${error ? `<div class="error-box">${error}</div>` : ''}

        <form method="POST" action="/register" autocomplete="on" id="regForm">

          <p class="section-title">Información Personal</p>

          <div class="row">
            <div class="field">
              <label>Nombre <span class="req">*</span></label>
              <input type="text" name="first_name" placeholder="Juan" required
                     autocomplete="given-name" ${v('first_name')}>
            </div>
            <div class="field">
              <label>Apellido <span class="req">*</span></label>
              <input type="text" name="last_name" placeholder="Pérez" required
                     autocomplete="family-name" ${v('last_name')}>
            </div>
          </div>

          <div class="field">
            <label>Correo Electrónico <span class="req">*</span></label>
            <input type="email" name="email" placeholder="juan@correo.com" required
                   autocomplete="email" inputmode="email" ${v('email')}>
          </div>

          <div class="field">
            <label>Contraseña <span class="req">*</span></label>
            <div class="pwd-wrap">
              <input type="password" name="password" id="pwdInput"
                     placeholder="Mínimo 8 caracteres" required
                     autocomplete="new-password" minlength="8">
              <button type="button" class="pwd-toggle" onclick="togglePwd('pwdInput')" aria-label="Mostrar contraseña">
                👁
              </button>
            </div>
            <p class="hint">Mínimo 8 caracteres</p>
          </div>

          <div class="field">
            <label>Volver a Introducir Contraseña <span class="req">*</span></label>
            <div class="pwd-wrap">
              <input type="password" name="password_confirm" id="pwdConfirm"
                     placeholder="Repite tu contraseña" required
                     autocomplete="new-password" minlength="8">
              <button type="button" class="pwd-toggle" onclick="togglePwd('pwdConfirm')" aria-label="Mostrar contraseña">
                👁
              </button>
            </div>
          </div>

          <div class="field">
            <label>Fecha de Nacimiento <span class="req">*</span></label>
            <input type="date" name="birth_date" required
                   max="${new Date(Date.now() - 18*365.25*24*60*60*1000).toISOString().split('T')[0]}"
                   min="1900-01-01" ${v('birth_date')}>
            <p class="hint">Debes tener 18 años o más</p>
          </div>

          <p class="section-title">Documento de Identidad</p>

          <div class="row">
            <div class="field">
              <label>Tipo de Doc. <span class="req">*</span></label>
              <div class="select-wrap">
                <select name="id_type" required>
                  <option value="">Seleccionar</option>
                  <option value="CC" ${sel('id_type','CC')}>C.C. — Cédula Ciudadanía</option>
                  <option value="CE" ${sel('id_type','CE')}>C.E. — Cédula Extranjería</option>
                  <option value="PA" ${sel('id_type','PA')}>PA — Pasaporte</option>
                  <option value="TI" ${sel('id_type','TI')}>T.I. — Tarjeta Identidad</option>
                </select>
              </div>
            </div>
            <div class="field">
              <label>Número de Doc. <span class="req">*</span></label>
              <input type="text" name="id_number" placeholder="Ej: 1005289529"
                     required pattern="[0-9A-Za-z\\-]+" minlength="5"
                     inputmode="numeric" ${v('id_number')}>
              <p class="hint">Sin puntos ni espacios</p>
            </div>
          </div>

          <p class="section-title">Contacto</p>

          <div class="field">
            <label>Celular <span class="req">*</span></label>
            <input type="tel" name="phone" placeholder="+57 300 123 4567"
                   required autocomplete="tel" ${v('phone')}>
          </div>

          <div class="field">
            <label>Dirección <span class="req">*</span></label>
            <input type="text" name="address" placeholder="Calle 123 # 45-67"
                   required autocomplete="address-line1" ${v('address')}>
          </div>

          <div class="field">
            <label>Apartamento, Casa, Oficina <span class="opt">(opcional)</span></label>
            <input type="text" name="address2" placeholder="Apto 301, Casa 5, etc."
                   autocomplete="address-line2" ${v('address2')}>
          </div>

          <div class="row">
            <div class="field">
              <label>Ciudad <span class="req">*</span></label>
              <input type="text" name="city" placeholder="Bogotá"
                     required autocomplete="address-level2" ${v('city')}>
            </div>
            <div class="field">
              <label>Código Postal <span class="opt">(opcional)</span></label>
              <input type="text" name="zip" placeholder="Ej: 110111"
                     maxlength="10" inputmode="numeric" ${v('zip')}>
            </div>
          </div>

          <div class="field">
            <label>Departamento <span class="req">*</span></label>
            <div class="select-wrap">
              <select name="province" required>
                <option value="">Seleccionar</option>
                ${['Amazonas','Antioquia','Arauca','Atlántico','Bolívar','Boyacá','Caldas','Caquetá','Casanare','Cauca','Cesar','Chocó','Córdoba','Cundinamarca','Guainía','Guaviare','Huila','La Guajira','Magdalena','Meta','Nariño','Norte de Santander','Putumayo','Quindío','Risaralda','San Andrés y Providencia','Santander','Sucre','Tolima','Valle del Cauca','Vaupés','Vichada','Bogotá D.C.'].map(d => `<option value="${d}" ${sel('province', d)}>${d}</option>`).join('')}
              </select>
            </div>
          </div>

          <p class="section-title">Tu Interés</p>

          <div class="field">
            <label>¿Qué productos te interesan? <span class="req">*</span></label>
            <div class="select-wrap">
              <select name="purchase_intent" required>
                <option value="">Seleccionar</option>
                <option value="Adquirir todos los productos" ${sel('purchase_intent','Adquirir todos los productos')}>
                  Todos los productos (cannábicos + hongos)
                </option>
                <option value="Adquirir exclusivamente hongos" ${sel('purchase_intent','Adquirir exclusivamente hongos')}>
                  Solo hongos funcionales
                </option>
              </select>
            </div>
          </div>

          <p class="section-title">Términos y Condiciones</p>

          <div class="field">
            <label class="checkbox-wrap">
              <input type="checkbox" name="privacy_policy" value="true" required>
              <span>He leído y acepto la
                <a href="https://connabis.com.co/policies/privacy-policy" target="_blank">Política de Privacidad</a>
                y los
                <a href="https://connabis.com.co/policies/terms-of-service" target="_blank">Términos de Servicio</a>
                de Connabis. Confirmo que tengo 18 años o más.
              </span>
            </label>
          </div>

          <button type="submit" class="submit-btn" id="submitBtn">
            Crear Cuenta
          </button>

        </form>

        <p class="login-link">
          ¿Ya tienes cuenta? <a href="https://connabis.com.co/account/login">Inicia sesión aquí</a>
        </p>

        <p class="privacy">
          Tu información está protegida y solo se usa para verificar tu membresía.
        </p>
      </div>
    </div>
  </div>

  <script>
    function togglePwd(id) {
      const input = document.getElementById(id);
      input.type = input.type === 'password' ? 'text' : 'password';
    }

    // Prevent double submit
    document.getElementById('regForm').addEventListener('submit', function() {
      const btn = document.getElementById('submitBtn');
      btn.disabled = true;
      btn.textContent = 'Creando cuenta...';
    });
  </script>

</body>
</html>`;
}

function successPage() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>¡Cuenta Creada! - Connabis</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: #f7f7f7; min-height: 100vh; display: flex; flex-direction: column; align-items: center; }
    .topbar { width: 100%; background: #1a2235; padding: 10px 20px; text-align: center;
      font-size: 13px; color: rgba(255,255,255,0.85); }
    .site-header { width: 100%; background: #fff; border-bottom: 1px solid #e8e8e8;
      padding: 18px 20px; text-align: center; }
    .site-header img { height: 60px; width: auto; }
    .page-wrap { width: 100%; max-width: 520px; padding: 48px 16px 60px;
      display: flex; align-items: flex-start; justify-content: center; flex: 1; }
    .card { background: #fff; border: 1px solid #e0e0e0; border-radius: 4px;
      width: 100%; padding: 48px 40px; text-align: center; }
    .icon { font-size: 56px; margin-bottom: 20px; }
    h2 { color: #2d6a4f; font-size: 22px; font-weight: 700; margin-bottom: 12px; }
    p { color: #555; font-size: 15px; line-height: 1.7; margin-bottom: 10px; }
    .steps { background: #f0f7f4; border-radius: 4px; padding: 16px 20px;
      text-align: left; margin: 20px 0 28px; }
    .step { display: flex; gap: 12px; align-items: flex-start;
      font-size: 14px; color: #333; line-height: 1.5; margin-bottom: 10px; }
    .step:last-child { margin-bottom: 0; }
    .step-num { background: #2d6a4f; color: #fff; border-radius: 50%;
      width: 22px; height: 22px; min-width: 22px; font-size: 12px;
      font-weight: 700; display: flex; align-items: center; justify-content: center; }
    a.btn { display: inline-block; background: #2d6a4f; color: #fff; padding: 13px 32px;
      text-decoration: none; border-radius: 50px; font-weight: 700; font-size: 15px; }
  </style>
</head>
<body>
  <div class="topbar">Connabis Colombia &mdash; Membresía Regulada</div>
  <header class="site-header">
    <a href="https://connabis.com.co">
      <img src="https://cdn.shopify.com/s/files/1/0581/4121/2749/files/Logo_Negro_sin_fondo.png" alt="Connabis"
           onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
      <span style="display:none;font-size:22px;font-weight:800;color:#111;">CO·NNABIS</span>
    </a>
  </header>
  <div class="page-wrap">
    <div class="card">
      <div class="icon">🎉</div>
      <h2>¡Cuenta creada!</h2>
      <p>Te hemos enviado un correo con los pasos para verificar tu identidad y completar tu membresía.</p>
      <div class="steps">
        <div class="step">
          <span class="step-num">1</span>
          <span>Revisa tu correo y haz clic en el enlace de verificación de identidad.</span>
        </div>
        <div class="step">
          <span class="step-num">2</span>
          <span>Firma el consentimiento de membresía incluido en el mismo correo.</span>
        </div>
        <div class="step">
          <span class="step-num">3</span>
          <span>Una vez completados, tu cuenta se activa automáticamente. ✅</span>
        </div>
      </div>
      <a href="https://connabis.com.co" class="btn">Ir a la Tienda</a>
    </div>
  </div>
</body>
</html>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default router;

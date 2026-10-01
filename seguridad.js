// ==========================================
// SEGURIDAD COMPARTIDA (formulario público + panel)
// ==========================================
// El PIN personal nunca se guarda tal cual: se guardan dos huellas (hash) distintas.
//  - pin_hash: va en la ficha privada y sirve para demostrar que la persona conoce su PIN.
//  - clave de autocompletado: es la "dirección" donde están sus datos básicos para autocompletar.
// Ninguna de las dos permite recuperar el PIN.

import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app-check.js";

// ==========================================
// APP CHECK: la base solo responde a pedidos que vienen de natproducciones.cl
// ==========================================
// Pega aquí la "clave del sitio" de reCAPTCHA v3 cuando registres App Check en la consola de Firebase.
// Mientras esté vacía, App Check no se activa (el sitio funciona igual que antes).
const RECAPTCHA_SITE_KEY = "";

export function activarAppCheck(app) {
    if (!RECAPTCHA_SITE_KEY) return;
    try {
        initializeAppCheck(app, { provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true });
    } catch (e) {
        console.error("No se pudo activar App Check", e);
    }
}

// Datos que SOLO pueden ver los administradores (van en 1p_privado/{rut})
export const CAMPOS_PRIVADOS = ['afp', 'salud', 'banco', 'tipoCuenta', 'numeroCuenta', 'enfermedades'];

// Datos que se devuelven al autocompletar con RUT + PIN (nada bancario ni médico)
export const CAMPOS_AUTOCOMPLETAR = [
    'nombres', 'apellidos', 'fechaNacimiento', 'telefono', 'email',
    'calle', 'numero_dir', 'comuna', 'direccion', 'sexo', 'nacionalidad',
    'emergenciaNombre', 'emergenciaTelefono', 'esVegetariano'
];

async function sha256(texto) {
    const datos = new TextEncoder().encode(texto);
    const hash = await crypto.subtle.digest('SHA-256', datos);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export const normalizarRut = (rut) => String(rut || '').trim().toUpperCase();

export const hashPin = (rut, pin) => sha256(`nat-pin|${normalizarRut(rut)}|${pin}`);
export const claveAutocompletar = (rut, pin) => sha256(`nat-auto|${normalizarRut(rut)}|${pin}`);

// 'verif' cambia en cada actualización: así las reglas de Firebase pueden exigir que
// quien modifica una ficha conozca el PIN en ese momento.
export function nuevoVerif(pinHash) {
    const azar = crypto.getRandomValues(new Uint8Array(8));
    return `${pinHash}_${Array.from(azar).map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

export const pinValido = (pin) => /^[0-9]{4}$/.test(String(pin || ''));

// Firebase no admite '.' en las claves: los correos se guardan con ',' en su lugar
export const claveCorreo = (correo) => String(correo || '').trim().toLowerCase().replace(/\./g, ',');

// Separa una ficha completa en su parte básica (visible al staff) y su parte privada (solo admins)
export function separarFicha(ficha) {
    const basica = {};
    const privada = {};
    for (const campo in ficha) {
        if (CAMPOS_PRIVADOS.includes(campo)) privada[campo] = ficha[campo];
        else basica[campo] = ficha[campo];
    }
    return { basica, privada };
}

// Arma los datos de autocompletado a partir de la ficha básica
export function datosAutocompletar(rut, basica) {
    const datos = { rut: normalizarRut(rut) };
    CAMPOS_AUTOCOMPLETAR.forEach(c => { if (basica[c] !== undefined && basica[c] !== null) datos[c] = basica[c]; });
    return datos;
}

// Escapa texto antes de insertarlo en HTML (evita que alguien inyecte código con su nombre)
export function escaparHTML(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

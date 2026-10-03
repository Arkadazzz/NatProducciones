import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDatabase, ref, get, set, remove, child, onValue, update, query, orderByKey, startAt, endAt, startAfter, limitToFirst, runTransaction } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { CAMPOS_PRIVADOS, separarFicha, datosAutocompletar, resumenBancario, hashPin, claveAutocompletar, nuevoVerif, pinValido, claveCorreo, escaparHTML, activarAppCheck } from "./seguridad.js?v=v21";

const firebaseConfig = {
    apiKey: "AIzaSyC5M5p6deAJu4qPeLxy1FdKDNLic5LoVpE",
    authDomain: "natproducciones.firebaseapp.com",
    projectId: "natproducciones",
    storageBucket: "natproducciones.firebasestorage.app",
    messagingSenderId: "553451405946",
    appId: "1:553451405946:web:3a9f5a4a1429466641f1c3"
};

const app = initializeApp(firebaseConfig);
activarAppCheck(app);
const auth = getAuth(app);
const db = getDatabase(app);

// ==========================================
// ROLES (se leen desde la base: 0_roles/{correo} = "admin" | "staff")
// ==========================================
// La firma de producción y la lista de administradores ya NO viven en el código:
// están en Firebase y las reglas de la base deciden quién puede leerlas.
window.esAdmin = false;
window.firmaProduccion = null;
window.invitadoresNat = [];
let resolverRol;
window.rolListo = new Promise(r => { resolverRol = r; });

function mostrarSinAcceso(correo) {
    document.body.innerHTML = `
        <div class="container text-center" style="max-width: 520px; margin-top: 15vh; color: #fff;">
            <h3 style="color: #b066ff;">🔒 Sin permisos</h3>
            <p class="text-muted">Tu cuenta <b id="correoSinAcceso" class="text-white"></b> todavía no tiene acceso al panel.<br>Pídele a un administrador que te agregue en <b>Mantenimiento → Usuarios</b>.</p>
            <button class="btn btn-outline-light mt-3" id="btnSalirSinAcceso">Cerrar sesión</button>
        </div>`;
    document.getElementById('correoSinAcceso').textContent = correo;
    // Primera vez (todavía no hay usuarios cargados): el dueño del proyecto puede nombrarse admin.
    // Las reglas de Firebase solo lo permiten si 0_roles está vacío y el correo es el del dueño.
    const btnInicial = document.createElement('button');
    btnInicial.className = 'btn btn-outline-info mt-3 ms-2';
    btnInicial.textContent = 'Soy el primer administrador';
    btnInicial.onclick = async () => {
        try {
            await set(ref(db, `0_roles/${claveCorreo(correo)}`), 'admin');
            window.location.reload();
        } catch (e) {
            alert("No autorizado. Pide a un administrador que te agregue.");
        }
    };
    document.getElementById('btnSalirSinAcceso').after(btnInicial);
    document.getElementById('btnSalirSinAcceso').onclick = () => signOut(auth).then(() => window.location.href = "login.html");
}

onAuthStateChanged(auth, async (user) => { 
    if (!user) {
        window.location.href = "login.html"; 
        return;
    }
    const correoLimpio = user.email.trim().toLowerCase();
    window.localStorage.setItem('correoStaffNat', correoLimpio); // Guardamos para uso en tabs dinámicos

    let rol = null;
    try {
        const rolSnap = await get(ref(db, `0_roles/${claveCorreo(correoLimpio)}`));
        rol = rolSnap.exists() ? rolSnap.val() : null;
    } catch (e) {
        console.error("No se pudo leer el rol", e);
    }
    if (rol !== 'admin' && rol !== 'staff') return mostrarSinAcceso(correoLimpio);

    // Si en este equipo antes entró alguien con otro rol, se borra la caché de trabajadores (puede tener datos privados)
    if (window.localStorage.getItem('rolCacheNat') !== rol) {
        await window.borrarCacheTrabajadores();
        window.localStorage.setItem('rolCacheNat', rol);
    }

    window.esAdmin = rol === 'admin';
    if (!window.esAdmin) {
        const pestanasBloqueadas = ['crm-tab', 'finanzas-tab', 'efectivo-tab', 'seguridad-tab', 'mantenimiento-tab', 'contratos-dt-tab', 'contador-tab', 'previred-tab'];
        pestanasBloqueadas.forEach(id => {
            const tab = document.getElementById(id);
            if (tab && tab.parentElement) tab.parentElement.classList.add('d-none');
        });
    }

    try {
        const [firmaSnap, invSnap] = await Promise.all([
            get(ref(db, '0_config/firma_produccion')),
            get(ref(db, '0_config/invitadores'))
        ]);
        window.firmaProduccion = firmaSnap.exists() ? firmaSnap.val() : null;
        window.invitadoresNat = invSnap.exists() ? Object.values(invSnap.val()) : [];
    } catch (e) {
        console.error("No se pudo leer la configuración", e);
    }
    resolverRol(rol);
});

if (document.getElementById('btnCerrarSesion')) document.getElementById('btnCerrarSesion').addEventListener('click', async () => { 
    // No dejar datos de trabajadores en el equipo. La caché de asistencias se mantiene para no volver a descargarla.
    await window.borrarCacheTrabajadores();
    window.localStorage.removeItem('rolCacheNat');
    signOut(auth).then(() => { 
        window.localStorage.removeItem('correoStaffNat');
        window.location.href = "login.html"; 
    }); 
});

const mapaBancos = { "CHILE": "1", "ESTADO": "12", "SCOTIABANK": "14", "BCI": "16", "SANTANDER": "37", "ITAU": "39", "SECURITY": "49", "RIPLEY": "53", "CONSORCIO": "55", "BICE": "28", "MERCADOPAGO": "875" };

let nombrePrograma = ""; 
let fechaPrograma = ""; 
let montoPago = 0; 
let horaTerminoGeneral = ""; 
let horaCitacionGeneral = ""; 
let pinActivo = "";
let valorHoraExtraGlobal = 0;
    window.almuerzoActivo = false;

let html5QrcodeScanner = null; 
let signaturePad; 
let rutActual = ""; 
let claveActual = "";
let listaGlobalCRM = {}; 
let blacklistGlobal = {}; 
let modalFichaInstance;

let totalEsperados = 0; 
let totalFirmados = 0; 
let reservasGlobales = {};
let asistenciasGlobales = {};
let totalIPGlobal = 0;
let totalCortesiaGlobal = 0;
let faltanIPGlobal = 0;
let faltanCortesiaGlobal = 0;
window.siguienteTicketAutomatico = 1;
window.asistentesSinSalida = 0; 
let unsubscribeReservas = null; 
let unsubscribeAsistencias = null;

// ==========================================
// CACHÉ GLOBAL PERSISTENTE EN DISCO (INDEXEDDB)
// ==========================================
window.cacheAsistencias = null;
window.cacheTrabajadores = null;

class FakeSnapshot {
    constructor(data) { this.data = data; }
    exists() { return this.data !== null && this.data !== undefined; }
    val() { return this.data; }
}

const localDBName = "NatProduccionesDB";
const storeName = "cacheStore";

function initLocalDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(localDBName, 1);
        request.onupgradeneeded = (e) => {
            const ldb = e.target.result;
            if (!ldb.objectStoreNames.contains(storeName)) ldb.createObjectStore(storeName);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function setLocalCache(key, data) {
    try {
        const ldb = await initLocalDB();
        return new Promise((resolve) => {
            const tx = ldb.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put(data, key);
            tx.oncomplete = () => resolve(true);
        });
    } catch(e) { console.error("Error guardando cache local", e); }
}

async function getLocalCache(key) {
    try {
        const ldb = await initLocalDB();
        return new Promise((resolve) => {
            const tx = ldb.transaction(storeName, 'readonly');
            const req = tx.objectStore(storeName).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        });
    } catch(e) { return null; }
}

window.obtenerAsistencias = async function(forzar = false) {
    const diskCache = await getLocalCache('asistencias_nat');
    if (diskCache && !forzar) {
        console.log("♻️ Usando caché de DISCO (0 bytes descargados)");
        window.cacheAsistencias = diskCache;
        return new FakeSnapshot(diskCache);
    }
    // Si otra pestaña ya está descargando el historial, se espera esa misma descarga (no se baja dos veces)
    if (window._descargaAsistencias) return window._descargaAsistencias;
    window._descargaAsistencias = (async () => {
        console.log("⬇️ Descargando Asistencias de Firebase...");
        const snap = await get(ref(db, '2_asistencias'));
        const val = snap.exists() ? snap.val() : null;
        window.cacheAsistencias = val;
        if (val) await setLocalCache('asistencias_nat', val);
        return snap;
    })();
    try { return await window._descargaAsistencias; } finally { window._descargaAsistencias = null; }
};

// Campos internos de la ficha privada que nunca se muestran ni se mezclan
const CAMPOS_PIN_INTERNOS = ['pin_hash', 'verif', 'auto_key'];

// Mezcla la ficha básica (1_trabajadores) con la privada (1p_privado, solo admins)
function mezclarFichas(basicos, privados) {
    const resultado = {};
    for (const rut in (basicos || {})) {
        resultado[rut] = { ...basicos[rut] };
        const priv = (privados || {})[rut];
        if (priv) {
            for (const campo in priv) {
                if (!CAMPOS_PIN_INTERNOS.includes(campo)) resultado[rut][campo] = priv[campo];
            }
        }
    }
    return resultado;
}

window.obtenerTrabajadores = async function(forzar = false) {
    await window.rolListo;
    const diskCache = await getLocalCache('trabajadores_nat');
    if (diskCache && !forzar) {
        console.log("♻️ Usando caché de DISCO (0 bytes descargados)");
        window.cacheTrabajadores = diskCache;
        listaGlobalCRM = diskCache;
        return new FakeSnapshot(diskCache);
    }
    // Si ya hay una descarga en curso, se reutiliza (varias pestañas piden la lista al mismo tiempo)
    if (window._descargaTrabajadores) return window._descargaTrabajadores;
    window._descargaTrabajadores = (async () => {
        console.log("⬇️ Descargando Trabajadores de Firebase...");
        const snap = await get(ref(db, '1_trabajadores'));
        let val = snap.exists() ? snap.val() : null;
        if (val && window.esAdmin) {
            const privSnap = await get(ref(db, '1p_privado'));
            val = mezclarFichas(val, privSnap.exists() ? privSnap.val() : {});
        }
        window.cacheTrabajadores = val;
        listaGlobalCRM = val || {};
        if (val) await setLocalCache('trabajadores_nat', val);
        return new FakeSnapshot(val);
    })();
    try { return await window._descargaTrabajadores; } finally { window._descargaTrabajadores = null; }
};

// Lee la ficha de una persona (con sus datos privados si quien consulta es admin)
window.leerFichaCompleta = async function(rut) {
    const basica = (await get(ref(db, `1_trabajadores/${rut}`))).val();
    if (!basica || !window.esAdmin) return basica;
    const privada = (await get(ref(db, `1p_privado/${rut}`))).val() || {};
    return mezclarFichas({ [rut]: basica }, { [rut]: privada })[rut];
};

// Guarda cambios de una ficha repartiéndolos entre la parte básica y la privada
window.guardarCamposFicha = async function(rut, campos) {
    const { basica, privada } = separarFicha(campos);
    const updates = {};
    for (const c in basica) updates[`1_trabajadores/${rut}/${c}`] = basica[c];
    for (const c in privada) updates[`1p_privado/${rut}/${c}`] = privada[c];
    // Si la persona tiene autocompletado, se actualiza para que no muestre datos viejos
    // (incluye el resumen bancario: banco, tipo y últimos 2 dígitos, nunca el número completo)
    if (window.esAdmin) {
        const privActual = (await get(ref(db, `1p_privado/${rut}`))).val() || {};
        const autoKey = privActual.auto_key;
        if (autoKey) {
            const actual = (await get(ref(db, `1_trabajadores/${rut}`))).val() || {};
            updates[`1a_autocompletar/${autoKey}`] = datosAutocompletar(rut, { ...actual, ...basica }, resumenBancario({ ...privActual, ...privada }));
        }
    }
    await update(ref(db), updates);
};

// Borra solo la caché de trabajadores (la que puede tener datos bancarios/médicos si entró un admin)
window.borrarCacheTrabajadores = async function() {
    window.cacheTrabajadores = null;
    try {
        const ldb = await initLocalDB();
        await new Promise((resolve) => {
            const tx = ldb.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).delete('trabajadores_nat');
            tx.oncomplete = resolve;
            tx.onerror = resolve;
        });
    } catch(e) {}
};

window.limpiarCache = async function() {
    window.cacheAsistencias = null;
    window.cacheTrabajadores = null;
    try {
        const ldb = await initLocalDB();
        const tx = ldb.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).clear();
    } catch(e) {}
    console.log("🧹 Caché borrado por actualización de datos.");
};

// ==========================================
// FIRMAS OPTIMIZADAS (AHORRO DE DESCARGAS)
// Las firmas nuevas se guardan comprimidas y en un nodo aparte (10_firmas),
// así las pestañas de Finanzas/Contratos/etc. no descargan imágenes.
// Las firmas antiguas (guardadas dentro de 2_asistencias) se siguen leyendo igual.
// ==========================================
const NODO_FIRMAS = '10_firmas';

window.comprimirFirma = function(pad) {
    try {
        const original = pad && pad.canvas;
        if (original && original.width > 0 && original.height > 0) {
            const ANCHO_MAX = 800;
            const escala = Math.min(1, ANCHO_MAX / original.width);
            const w = Math.max(1, Math.round(original.width * escala));
            const h = Math.max(1, Math.round(original.height * escala));
            const lienzo = document.createElement('canvas');
            lienzo.width = w;
            lienzo.height = h;
            const ctx = lienzo.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(original, 0, 0, w, h);
            const comprimida = lienzo.toDataURL('image/jpeg', 0.75);
            if (comprimida && comprimida.startsWith('data:image/jpeg') && comprimida.length > 500) return comprimida;
        }
    } catch (e) {
        console.error("No se pudo comprimir la firma, se usa la original", e);
    }
    return pad.toDataURL("image/jpeg"); // Respaldo: firma original sin comprimir
};

window.tieneFirma = function(asis) {
    return !!(asis && (asis.firma_digital || asis.tiene_firma));
};

window.obtenerFirma = async function(fecha, prog, rut, asis) {
    if (asis && asis.firma_digital) return asis.firma_digital; // Formato antiguo
    if (!asis || !asis.tiene_firma) return null;
    try {
        const s = await get(ref(db, `${NODO_FIRMAS}/${fecha}/${prog}/${rut}`));
        return s.exists() ? s.val() : null;
    } catch (e) {
        console.error("Error leyendo firma", e);
        return null;
    }
};

// Firmas de los recibos de efectivo: nodo aparte (12_firmas_recibos/{idRecibo}).
// Los recibos antiguos que aún traen "firma" dentro se siguen leyendo igual.
const NODO_FIRMAS_RECIBOS = '12_firmas_recibos';

window.obtenerFirmaRecibo = async function(id, rec) {
    if (rec && rec.firma) return rec.firma; // Formato antiguo
    if (!rec || !rec.tiene_firma) return null;
    try {
        const s = await get(ref(db, `${NODO_FIRMAS_RECIBOS}/${id}`));
        return s.exists() ? s.val() : null;
    } catch (e) {
        console.error("Error leyendo firma del recibo", e);
        return null;
    }
};

window.obtenerFirmasPrograma = async function(fecha, prog) {
    try {
        const s = await get(ref(db, `${NODO_FIRMAS}/${fecha}/${prog}`));
        return s.exists() ? s.val() : {};
    } catch (e) {
        console.error("Error leyendo firmas del programa", e);
        return {};
    }
};

// ==========================================
function poblarSelectoresHora() {
    let opcionesHTML = '<option value="">-- Selecciona --</option>';
    const horas = [8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,0,1];
    
    for (let h of horas) {
        for (let m of [0, 30]) {
            let hh24 = h.toString().padStart(2, '0');
            let mm = m.toString().padStart(2, '0');
            let ampm = (h >= 12 && h < 24) ? 'PM' : 'AM';
            let h12 = h % 12; 
            if (h12 === 0) h12 = 12;
            let hh12 = h12.toString().padStart(2, '0');
            opcionesHTML += `<option value="${hh24}:${mm}">${hh12}:${mm} ${ampm}</option>`;
        }
    }
    const selectCitacion = document.getElementById('horaCitacion');
    const selectTermino = document.getElementById('horaTermino');
    
    if (selectCitacion) selectCitacion.innerHTML = opcionesHTML;
    if (selectTermino) selectTermino.innerHTML = opcionesHTML;
}
poblarSelectoresHora();

// Carga de la base de datos de trabajadores al iniciar para que la puerta muestre los nombres
window.obtenerTrabajadores().then(snap => { 
    if (snap.exists()) {
        window.cacheTrabajadores = snap.val();
        listaGlobalCRM = snap.val();
        // Si la sala ya cargó antes que los nombres, forzamos un refresco visual:
        if (typeof actualizarTablero === "function") actualizarTablero();
        if (typeof window.renderTablaPuerta === "function") window.renderTablaPuerta();
    }
});




// ==========================================
// CIERRE CONTABLE MENSUAL (CONTADOR)
// ==========================================
function inicializarContador() {
    const selectMes = document.getElementById('selectMesContador');
    const btnDescargar = document.getElementById('btnDescargarMesElegido');
    const resumenMes = document.getElementById('resumenMesContador');

    if (!selectMes) return;

    if (selectMes.options.length > 1 && window.infoMesesGlobal) return; 

    selectMes.innerHTML = '<option value="">⏳ Sincronizando Base de Datos...</option>';
    if (btnDescargar) btnDescargar.disabled = true;
    if (resumenMes) resumenMes.classList.add('d-none');

    window.obtenerAsistencias().then((snap) => {
        if (!snap.exists()) {
            selectMes.innerHTML = '<option value="">❌ No hay registros históricos</option>';
            return;
        }

        const todas = snap.val();
        let infoMeses = {};

        Object.keys(todas).forEach(fecha => {
            if (!fecha || typeof fecha !== 'string' || !fecha.includes('-')) return;

            const mes = fecha.substring(0, 7); 
            if (!infoMeses[mes]) infoMeses[mes] = { fechas: [], programas: new Set(), totalPago: 0 };
            
            if (!infoMeses[mes].fechas.includes(fecha)) infoMeses[mes].fechas.push(fecha);
            
            const nodosProgramas = todas[fecha];
            if (typeof nodosProgramas !== 'object') return;

            Object.keys(nodosProgramas).forEach(prog => {
                infoMeses[mes].programas.add(`${fecha}|${prog}`);
                const asistentes = nodosProgramas[prog];
                
                if (typeof asistentes !== 'object') return;

                Object.keys(asistentes).forEach(rut => {
                    const asis = asistentes[rut];
                    if (asis && asis.tipo_ingreso !== "Cortesía" && asis.monto) {
                        const montoLimpio = parseInt(String(asis.monto).replace(/\D/g, '')) || 0;
                        infoMeses[mes].totalPago += montoLimpio;
                    }
                });
            });
        });

        window.infoMesesGlobal = infoMeses;
        window.todasAsistenciasGlobal = todas;

        const mesesOrdenados = Object.keys(infoMeses).sort().reverse();
        if (mesesOrdenados.length === 0) {
            selectMes.innerHTML = '<option value="">⚠️ No hay asistencias válidas</option>';
            return;
        }

        let htmlOptions = '<option value="">-- Selecciona el mes a analizar --</option>';
        const nombresMeses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

        mesesOrdenados.forEach(m => {
            const partes = m.split('-');
            if (partes.length >= 2) {
                const yyyy = partes[0];
                const mm = parseInt(partes[1]) - 1;
                if (!isNaN(mm) && mm >= 0 && mm < 12) {
                    htmlOptions += `<option value="${m}">📆 ${nombresMeses[mm].toUpperCase()} ${yyyy}</option>`;
                }
            }
        });

        selectMes.innerHTML = htmlOptions;

    }).catch((error) => {
        console.error("Error al cargar contador:", error);
        selectMes.innerHTML = '<option value="">❌ Error de conexión con el servidor</option>';
    });
}

// ---- Separa apellidos manteniendo compuestos (San Martín, De la Fuente) y conservando tildes ----
function separarApellidosOriginal(texto) {
    const particulas = ['DE', 'DEL', 'LA', 'LAS', 'LOS', 'SAN', 'SANTA', 'DA', 'DAS', 'DO', 'DOS', 'DI', 'VAN', 'VON', 'DER', 'MAC', 'MC'];
    const palabras = String(texto || '').trim().split(/\s+/).filter(Boolean);
    const grupos = [];
    let actual = [];
    for (const p of palabras) {
        actual.push(p);
        if (!particulas.includes(limpiarTextoPrevired(p, 30))) { grupos.push(actual.join(' ')); actual = []; }
    }
    if (actual.length) grupos.push(actual.join(' '));
    return { paterno: grupos[0] || '', materno: grupos.slice(1).join(' ') };
}

// Carga todo lo necesario para el reporte del contador de un mes (mismo cálculo que Previred)
async function filasContadorMes(mes) {
    await cargarConfigPrevired();
    const [datos, ajustes] = await Promise.all([window.leerAsistenciasMes(mes), leerAjustesPreviredMes(mes)]);
    const filas = await construirFilasMes(mes, ajustes, datos);
    return { filas, datos };
}

const selectMesContador = document.getElementById('selectMesContador');
if (selectMesContador) {
    selectMesContador.addEventListener('change', async (e) => {
        const m = e.target.value;
        const resumenMes = document.getElementById('resumenMesContador');
        const btnDescargar = document.getElementById('btnDescargarMesElegido');
        const btnDetalle = document.getElementById('btnDetallePagosMes');
        if (btnDescargar) btnDescargar.disabled = true;
        if (btnDetalle) btnDetalle.disabled = true;

        if (!m) {
            if (resumenMes) resumenMes.classList.add('d-none');
            return;
        }
        if (resumenMes) {
            resumenMes.classList.remove('d-none');
            resumenMes.innerHTML = "<div class='text-center'><div class='spinner-border text-success'></div><div class='small text-muted mt-2'>Leyendo datos frescos del mes...</div></div>";
        }

        try {
            const { filas, datos } = await filasContadorMes(m);
            window.__contadorMes = { mes: m, filas, datos };
            const fechasOrd = Object.keys(datos).sort();
            const programas = new Set();
            for (const f in datos) for (const p in datos[f]) programas.add(`${f}|${p}`);
            const total = filas.reduce((a, f) => a + f.liquido, 0);
            const pagado = filas.reduce((a, f) => a + (f.pagado || 0), 0);
            const pendiente = filas.reduce((a, f) => a + (f.pendiente || 0), 0);
            const anterior = filas.filter(f => f.anterior || !f.enSistema).length;
            const editados = filas.filter(f => f.forzado).length;
            const conPendiente = filas.filter(f => (f.pendiente || 0) > 0).length;
            const nombresMeses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
            const $ = n => '$' + Math.round(n).toLocaleString('es-CL');
            const fmt = f => f ? f.split('-').reverse().join('-') : '-';

            if (resumenMes) resumenMes.innerHTML = `
                <h5 class="text-success text-center mb-3 border-bottom border-success pb-2">Mes de ${nombresMeses[parseInt(m.split('-')[1], 10) - 1]} ${m.split('-')[0]}</h5>
                <div class="row text-center py-2">
                    <div class="col-md-3 border-end border-secondary"><h6 class="text-muted mb-1" style="font-size: 0.8em; text-transform: uppercase;">Rango de Fechas</h6><span class="text-info fw-bold fs-6">Del ${fmt(fechasOrd[0])}<br>al ${fmt(fechasOrd[fechasOrd.length - 1])}</span></div>
                    <div class="col-md-3 border-end border-secondary"><h6 class="text-muted mb-1" style="font-size: 0.8em; text-transform: uppercase;">Programas / Personas</h6><span class="text-warning fw-bold fs-4">${programas.size} / ${filas.length}</span></div>
                    <div class="col-md-3 border-end border-secondary"><h6 class="text-muted mb-1" style="font-size: 0.8em; text-transform: uppercase;">Total Líquido del Mes</h6><span class="text-success fw-bold fs-4">${$(total)}</span></div>
                    <div class="col-md-3"><h6 class="text-muted mb-1" style="font-size: 0.8em; text-transform: uppercase;">Pagado / Pendiente</h6><span class="text-success fw-bold">${$(pagado)}</span><br><span class="text-warning fw-bold">${$(pendiente)} (${conPendiente} pers.)</span>${(total - pagado - pendiente) > 0 ? `<br><span class="text-info small">Sist. anterior / ajustes: ${$(total - pagado - pendiente)}</span>` : ''}</div>
                </div>
                <div class="small text-muted text-center mt-2">✅ Incluye pagados y pendientes (todo lo trabajado en el mes)${anterior ? ` · ${anterior} persona(s) con días del sistema anterior` : ''}${editados ? ` · ${editados} editada(s) a mano en Previred` : ''}. Mismos días y montos que el Previred.</div>`;
            if (btnDescargar) btnDescargar.disabled = filas.length === 0;
            if (btnDetalle) btnDetalle.disabled = filas.length === 0;
        } catch (err) {
            console.error(err);
            if (resumenMes) resumenMes.innerHTML = "<p class='text-danger text-center mb-0'>❌ No se pudieron leer los datos del mes. Revisa tu conexión.</p>";
        }
    });
}

const btnDescargarMesElegido = document.getElementById('btnDescargarMesElegido');
if (btnDescargarMesElegido) {
    btnDescargarMesElegido.addEventListener('click', async () => {
        const mesElegido = document.getElementById('selectMesContador').value;
        if (!mesElegido) return;
        const btn = document.getElementById('btnDescargarMesElegido');
        btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Procesando Excel...';
        btn.disabled = true;

        try {
            // Datos frescos en el momento de descargar
            const { filas } = await filasContadorMes(mesElegido);
            let csv = "﻿RUT (completo);(*) RUT sin DV;(*) DV;Nombre (Completo);(*) Apellido Paterno;(*) Apellido Materno;(*) Nombres;Fec. Nacimiento;Fec. Ingreso;Fec. Contrato;Sexo;Cargo(30);Región;Dirección(40);Comuna;Ciudad;Tipo S.Base;Valor S.Base;AFP;FONASA / ISAPRE;Teléfono;Correo Electrónico\n";

            for (const f of filas) {
                const tr = f.tr || {};
                const r = f.rut;
                const parts = r.split('-');
                const ap = separarApellidosOriginal(tr.apellidos);
                const [y, m, d] = (tr.fechaNacimiento || "").split('-');
                csv += `${r};${parts[0]};${parts[1] || ''};${tr.nombres || ''} ${tr.apellidos || ''};${ap.paterno};${ap.materno};${tr.nombres || ''};${d ? d + '-' + m + '-' + y : ''};${fechaPrevired(f.inicio)};${fechaPrevired(f.termino)};${tr.sexo || ''};extra publico (televisión);;${tr.direccion || ''};;Santiago;Pesos;${f.liquido};${f.afpPorRegla ? f.afpKey : (tr.afp || '')};${tr.salud || ''};${tr.telefono || ''};${tr.email || ''}\n`;
            }

            const nombresMeses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
            const mesNombreDescarga = nombresMeses[parseInt(mesElegido.split('-')[1], 10) - 1];
            descargarCSV(csv, `Reporte_Contable_${mesNombreDescarga}_${mesElegido.split('-')[0]}_NAT.csv`);
        } catch (e) {
            console.error(e);
            alert("Error generando el archivo contable.");
        }
        btn.innerText = "📥 Descargar Excel del Mes";
        btn.disabled = false;
    });

    // Botón adicional: detalle jornada por jornada con estado de pago
    if (!document.getElementById('btnDetallePagosMes')) {
        const btnDet = document.createElement('button');
        btnDet.type = 'button';
        btnDet.id = 'btnDetallePagosMes';
        btnDet.className = 'btn btn-outline-warning fw-bold py-2 px-4 shadow ms-md-2 mt-2 mt-md-0';
        btnDet.disabled = true;
        btnDet.innerText = '📋 Detalle de Pagos (Pagado / Pendiente)';
        btnDescargarMesElegido.insertAdjacentElement('afterend', btnDet);
        btnDet.addEventListener('click', async () => {
            const mesElegido = document.getElementById('selectMesContador').value;
            if (!mesElegido) return;
            btnDet.disabled = true;
            try {
                const { filas } = await filasContadorMes(mesElegido);
                let csv = "﻿RUT;Nombre;Fecha;Programa;Ticket;Tipo;Monto Líquido;Estado de Pago;Origen\n";
                for (const f of filas) {
                    const nombre = `${(f.tr && f.tr.nombres) || ''} ${(f.tr && f.tr.apellidos) || ''}`.trim();
                    for (const d of (f.detalle || []).sort((a, b) => a.fecha.localeCompare(b.fecha))) {
                        csv += `${f.rut};${nombre};${d.fecha.split('-').reverse().join('-')};${d.prog.replace(' - ', ' / ')};${d.ticket};${d.tipo};${d.monto};${d.estado || 'Pagado'};Sistema\n`;
                    }
                    if (f.anterior) {
                        csv += `${f.rut};${nombre};${f.anterior.inicio.split('-').reverse().join('-')};Sistema anterior (${f.anterior.dias} día(s));;;${f.anterior.liquido};Según sistema anterior;Agregado a mano\n`;
                    }
                    if (f.forzado) {
                        csv += `${f.rut};${nombre};;AJUSTE MANUAL EN PREVIRED (total final ${f.dias} día(s));;;${f.liquido};;Total corregido a mano\n`;
                    }
                }
                const nombresMeses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
                descargarCSV(csv, `Detalle_Pagos_${nombresMeses[parseInt(mesElegido.split('-')[1], 10) - 1]}_${mesElegido.split('-')[0]}_NAT.csv`);
            } catch (e) {
                console.error(e);
                alert("Error generando el detalle de pagos.");
            }
            btnDet.disabled = false;
        });
    }
}

// Ahorro de descargas: el historial de asistencias se baja solo al abrir Contador o Finanzas (no al entrar al panel)
const tabFinanzas = document.getElementById('finanzas-tab');
if (tabFinanzas) {
    tabFinanzas.addEventListener('click', inicializarContador);
}
const tabContador = document.getElementById('contador-tab');
if (tabContador) {
    tabContador.addEventListener('click', inicializarContador);
}

// ==========================================
// CONTROL DE PROGRAMAS
// ==========================================
// El PIN de captador ya no viaja con el programa público: vive en 0_config/pins_captador/{fecha}/{nombre},
// que solo puede leer el staff. Firebase lo valida por dentro cuando alguien se inscribe.
window.pinsCaptador = {};
window.programasActivosNat = null;
const pinDePrograma = (p) => ((window.pinsCaptador[p.fecha] || {})[p.nombre]) || p.pin || "";

window.rolListo.then(() => {
    onValue(ref(db, '0_config/pins_captador'), (snap) => {
        window.pinsCaptador = snap.exists() ? snap.val() : {};
        renderProgramasActivos();
    });
});

onValue(ref(db, '0_estado_sistema/programas_activos'), (snapshot) => {
    window.programasActivosNat = snapshot;
    renderProgramasActivos();
});

function renderProgramasActivos() {
    const snapshot = window.programasActivosNat;
    if (!snapshot) return;
    const container = document.getElementById('contenedorProgramasActivos'); 
    if(!container) return;
    container.innerHTML = "";
    
    if (snapshot.exists()) {
        const programas = snapshot.val();
        for (const clave in programas) {
            const p = programas[clave];
            const pinP = pinDePrograma(p);
            let badgePin = pinP ? `<span class="badge bg-warning text-dark ms-2 fw-bold fs-6">PIN I/P: ${pinP}</span>` : "";
            
            container.innerHTML += `
                <div class="alert mb-2 d-flex justify-content-between align-items-center" style="background: #1c103f; border: 1px solid #b066ff;">
                    <div>
                        <strong class="text-white">${p.nombre.replace(" - ", " / ")}</strong> ${badgePin}<br>
                        <small style="color: #d6b3ff;">${p.fecha} | Citación: ${p.hora_citacion || 'N/A'} | Salida: ${p.hora_termino || 'N/A'} | H.Extra: $${p.valor_hora_extra || 0}</small>
                    </div>
                    <div>
                        <button class="btn btn-success btn-sm fw-bold" onclick="window.unirseASala('${clave}', '${p.nombre}', '${p.fecha}', '${p.monto}', '${pinP}', '${p.hora_termino}', '${p.valor_hora_extra || 0}', '${p.hora_citacion || ''}', ${p.incluye_almuerzo || false})">🚪 Entrar</button>
                        <button class="btn btn-danger btn-sm fw-bold ms-1" onclick="window.cerrarProgramaGlobal('${clave}')">X</button>
                    </div>
                </div>`;
        }
    } else {
        container.innerHTML = "<p class='text-muted' style='font-size: 0.9em;'>No hay programas corriendo.</p>";
        salirDeSala();
    }
}

if (document.getElementById('btnActivarWeb')) document.getElementById('btnActivarWeb').addEventListener('click', async () => {
    const nom = document.getElementById('nombrePrograma').value;
    const fec = document.getElementById('fechaPrograma').value;
    const mon = document.getElementById('montoPago').value;
    const horaCitacion = document.getElementById('horaCitacion').value; 
    const valorHE = document.getElementById('valorHoraExtra').value || 0;
    const horaSal = document.getElementById('horaTermino').value;
    
    if (!nom || !fec || !mon || !horaSal || !horaCitacion) {
        return alert("Completa todos los campos obligatorios.");
    }

    let pinGenerado = ""; 
    if (nom.includes("Detrás del Muro")) {
        pinGenerado = Math.floor(1000 + Math.random() * 9000).toString();
    }
    
    const claveSegura = nom.replace(/[.#$\[\]]/g, "_");
    
    if (pinGenerado) await set(ref(db, `0_config/pins_captador/${fec}/${nom}`), pinGenerado);
    await set(ref(db, `0_estado_sistema/programas_activos/${claveSegura}`), { 
        nombre: nom, 
        fecha: fec, 
        monto: mon, 
        requiere_pin: !!pinGenerado, // El formulario solo sabe SI pide PIN, nunca cuál es
        hora_termino: horaSal, 
        valor_hora_extra: valorHE, 
        hora_citacion: horaCitacion,
        incluye_almuerzo: document.getElementById('checkAlmuerzo') ? document.getElementById('checkAlmuerzo').checked : false
    });
    
    window.unirseASala(claveSegura, nom, fec, mon, pinGenerado, horaSal, valorHE, horaCitacion, document.getElementById('checkAlmuerzo') ? document.getElementById('checkAlmuerzo').checked : false);
});

window.unirseASala = function(clave, nom, fec, mon, pin, horaSal, valorHE, horaCit, incluyeAlm) {
    window.almuerzoActivo = incluyeAlm || false;
    claveActual = clave; 
    nombrePrograma = nom; 
    fechaPrograma = fec; 
    montoPago = mon; 
    pinActivo = pin || ""; 
    horaTerminoGeneral = horaSal || ""; 
    valorHoraExtraGlobal = parseInt(valorHE) || 0;
    horaCitacionGeneral = horaCit || "";
    
    let titulo = `Sala: ${nom.replace(" - ", " / ")}`; 
    if (pinActivo) {
        titulo += ` <span class="badge bg-warning text-dark ms-2">PIN: ${pinActivo}</span>`;
    }
    
    document.getElementById('tituloEscaner').innerHTML = titulo;
    document.getElementById('seccionConfiguracion').classList.add('d-none');
    document.getElementById('seccionEscaner').classList.remove('d-none');
    document.getElementById('seccionLista').classList.remove('d-none');
    
    if (!html5QrcodeScanner) {
        html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: {width: 250, height: 250} }, false);
        html5QrcodeScanner.render(onScanSuccess, () => {});
    }
    
    activarRadares();
}

window.cerrarProgramaGlobal = async function(clave) {
    if(confirm("¿TERMINAR programa para todos? Desaparecerá de la web pública.")) {
        await remove(ref(db, `0_estado_sistema/programas_activos/${clave}`));
    }
}

function calcularPagoYBonos(horaCitacion, horaTermino, horaSalidaReal, montoBaseOriginal, valorHE, fechaProg) {
    let nuevoMontoBase = parseInt(montoBaseOriginal) || 0;
    let bonoExtra = 0;

    if (!horaCitacion || !horaTermino) return { montoBaseNuevo: nuevoMontoBase, bonoExtra: 0 };

    let [y, m, d] = fechaProg.split('-').map(Number);
    let [hcH, hcM] = horaCitacion.split(':').map(Number);
    let [htH, htM] = horaTermino.split(':').map(Number);
    let [hsH, hsM] = horaSalidaReal.split(':').map(Number);

    let tCit = new Date(y, m - 1, d, hcH, hcM);
    let tTer = new Date(y, m - 1, d, htH, htM);
    if (htH === 0 || htH === 1) tTer.setDate(tTer.getDate() + 1);
    
    let tSal = new Date(y, m - 1, d, hsH, hsM);
    if (hsH < 8 && hcH >= 8) tSal.setDate(tSal.getDate() + 1);

    let expectedDuration = (tTer - tCit) / 60000; 
    let actualDuration = (tSal - tCit) / 60000;

    if (actualDuration < (expectedDuration / 2)) {
        nuevoMontoBase = 0; 
    } else if (actualDuration < expectedDuration) {
        nuevoMontoBase = Math.round(nuevoMontoBase / 2); 
    } else {
        let diffMins = Math.floor((tSal - tTer) / 60000);
        if (diffMins > 0 && valorHE > 0) {
            let horasCompletas = Math.floor(diffMins / 60); // Ahora requiere 60 mins exactos para sumar 1
            bonoExtra = horasCompletas * parseInt(valorHE);
        }
    }

    return { montoBaseNuevo: nuevoMontoBase, bonoExtra: bonoExtra };
}

if (document.getElementById('btnEsUnDia')) document.getElementById('btnEsUnDia').addEventListener('click', async () => {
    if (!claveActual) return;
    const now = new Date();
    const horaSalidaMasiva = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

    if (!confirm(`🎬 ¡ATENCIÓN EQUIPO! 🎬\n\n¿Cerrar la jornada y dar por terminado el evento?\n\nEl sistema marcará la salida a las ${horaSalidaMasiva} y calculará horas extras o penalizaciones para todos.\n\n¿Proceder?`)) return;

    try {
        const snap = await get(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}`));
        if (snap.exists()) {
            const asistencias = snap.val();
            let actualizacionesFirebase = {};
            let procesados = 0;

            for (const rut in asistencias) {
                const asis = asistencias[rut];
                if (!asis.hora_salida) {
                    let pagoFinal = 0;
                    let bonoFinal = 0;

                    if (asis.tipo_ingreso === "Cortesía") {
                        pagoFinal = 0;
                        bonoFinal = 0;
                    } else {
                        let calculo = calcularPagoYBonos(horaCitacionGeneral, horaTerminoGeneral, horaSalidaMasiva, asis.monto, valorHoraExtraGlobal, fechaPrograma);
                        let montoIntacto = parseInt(String(asis.monto).replace(/\D/g, '')) || 0;
                        pagoFinal = montoIntacto + calculo.bonoExtra;
                        bonoFinal = calculo.bonoExtra;
                    }
                    
                    actualizacionesFirebase[`2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}/hora_salida`] = horaSalidaMasiva;
                    actualizacionesFirebase[`2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}/bono_horas_extras`] = bonoFinal;
                    actualizacionesFirebase[`2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}/monto`] = pagoFinal;
                    procesados++;
                }
            }

            if (Object.keys(actualizacionesFirebase).length > 0) {
                await update(ref(db), actualizacionesFirebase);
        window.limpiarCache();
                alert(`✅ Checkout Masivo Exitoso.
Se calculó la salida y el pago a ${procesados} personas.`);
            }
        }
        await remove(ref(db, `0_estado_sistema/programas_activos/${claveActual}`));
        alert("¡Jornada terminada con éxito!");
        salirDeSala();
    } catch (error) { 
        alert("Error al intentar cerrar la jornada masivamente."); 
    }
});

if (document.getElementById('btnVolverMenu')) document.getElementById('btnVolverMenu').addEventListener('click', salirDeSala);

function salirDeSala() {
    claveActual = ""; 
    nombrePrograma = ""; 
    fechaPrograma = ""; 
    montoPago = 0; 
    pinActivo = ""; 
    horaTerminoGeneral = ""; 
    horaCitacionGeneral = ""; 
    valorHoraExtraGlobal = 0;
    window.almuerzoActivo = false;
    
    document.getElementById('seccionConfiguracion').classList.remove('d-none');
    document.getElementById('seccionEscaner').classList.add('d-none');
    document.getElementById('seccionFirma').classList.add('d-none');
    document.getElementById('seccionLista').classList.add('d-none');
    document.getElementById('tablaAsistentes').innerHTML = "";
    
    if (unsubscribeReservas) unsubscribeReservas();
    if (unsubscribeAsistencias) unsubscribeAsistencias();
    if (html5QrcodeScanner) { 
        try { html5QrcodeScanner.clear(); } catch(e) {} 
        html5QrcodeScanner = null; 
    }
}

function activarRadares() {
    if (unsubscribeReservas) unsubscribeReservas(); 
    if (unsubscribeAsistencias) unsubscribeAsistencias();
    
    unsubscribeReservas = onValue(ref(db, `3_reservas/${fechaPrograma}/${nombrePrograma}`), (snapshot) => {
        reservasGlobales = snapshot.exists() ? snapshot.val() : {};
        totalEsperados = Object.keys(reservasGlobales).length; 
        
        totalIPGlobal = 0;
        totalCortesiaGlobal = 0;
        for (const r in reservasGlobales) {
            if (reservasGlobales[r].tipo === "Cortesía") totalCortesiaGlobal++;
            else totalIPGlobal++;
        }
        actualizarTablero();
    });

    unsubscribeAsistencias = onValue(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}`), (snapshot) => {
        asistenciasGlobales = snapshot.exists() ? snapshot.val() : {};
        totalFirmados = 0;
        window.adentroIP = 0;
        window.adentroCortesia = 0;
        for (const r in asistenciasGlobales) {
            if (asistenciasGlobales[r].tipo_ingreso !== "Anulado") {
                totalFirmados++;
                if (asistenciasGlobales[r].tipo_ingreso === "Cortesía") window.adentroCortesia++;
                else window.adentroIP++;
            }
        }
        actualizarTablero();
        
        // Inyectar barra de búsqueda y orden
        let seccionLista = document.getElementById('seccionLista');
        if(seccionLista && !document.getElementById('controlesPuerta')) {
            let div = document.createElement('div');
            div.id = 'controlesPuerta';
            div.className = 'row mb-3 align-items-center bg-dark p-2 rounded border border-info';
            div.innerHTML = `
                <div class="col-md-6 mb-2 mb-md-0">
                    <input type="text" id="buscadorPuerta" class="form-control bg-dark text-white border-info" placeholder="🔍 Buscar por Nombre, RUT o Ticket...">
                </div>
                <div class="col-md-6 text-md-end">
                    <label class="text-info me-2 small fw-bold">Ordenar por:</label>
                    <select id="ordenPuerta" class="form-select bg-dark text-white border-info d-inline-block w-auto">
                        <option value="ticket_desc">Últimos en entrar</option>
                        <option value="ticket_asc">Ticket (Menor a Mayor)</option>
                        <option value="nombre_asc">Nombre (A-Z)</option>
                        <option value="rut_asc">RUT</option>
                    </select>
                </div>
            `;
            const tableResp = seccionLista.querySelector('.table-responsive');
            if(tableResp) {
                seccionLista.insertBefore(div, tableResp);
            } else {
                seccionLista.prepend(div);
            }

            if (document.getElementById('buscadorPuerta')) document.getElementById('buscadorPuerta').addEventListener('input', (e) => {
                window.termBusquedaPuerta = e.target.value.toLowerCase();
                window.renderTablaPuerta();
            });
            if (document.getElementById('ordenPuerta')) document.getElementById('ordenPuerta').addEventListener('change', (e) => {
                window.criterioOrdenPuerta = e.target.value;
                window.renderTablaPuerta();
            });
        }
        
        window.renderTablaPuerta();
    });

    window.renderTablaPuerta = function() {
        let maxNumero = 0; 
        const conteoStaff = {}; 
        window.asistentesSinSalida = 0; 
        
        const tbody = document.getElementById('tablaAsistentes'); 
        if(!tbody) return;
        tbody.innerHTML = "";
        
        let arrAsistentes = [];
        completarFichasPuerta(Object.keys(asistenciasGlobales));
        
        for (const rut in asistenciasGlobales) {
            const asis = asistenciasGlobales[rut]; 
            const trab = fichaPuerta(rut);
            const num = parseInt(asis.numero_asignado) || 0; 
            
            if (num > maxNumero) { maxNumero = num; }
            
            if (asis.tipo_ingreso === "Anulado") continue;
            
            if (asis.tipo_ingreso === "Cortesía" && asis.invitado_por) {
                conteoStaff[asis.invitado_por] = (conteoStaff[asis.invitado_por] || 0) + 1;
            }
            
            const nombreCompleto = `${trab.nombres} ${trab.apellidos}`.toLowerCase();
            const ticketStr = String(num);
            const rutStr = rut.toLowerCase();
            const term = window.termBusquedaPuerta || "";

            if (term && !nombreCompleto.includes(term) && !rutStr.includes(term) && !ticketStr.includes(term)) {
                continue; 
            }

            arrAsistentes.push({ rut, asis, trab, num, nombreOriginal: `${trab.nombres} ${trab.apellidos}` });
        }
        
        const sortVal = window.criterioOrdenPuerta || "ticket_desc";
        arrAsistentes.sort((a, b) => {
            if (sortVal === "ticket_asc") return a.num - b.num;
            if (sortVal === "ticket_desc") return b.num - a.num;
            if (sortVal === "nombre_asc") return a.nombreOriginal.localeCompare(b.nombreOriginal);
            if (sortVal === "rut_asc") return a.rut.localeCompare(b.rut);
            return 0;
        });
        
        arrAsistentes.forEach(item => {
            const { rut, asis, trab, num } = item;
            
            let esMenorLista = false;
            if (trab.fechaNacimiento) {
                const [y, m, d] = trab.fechaNacimiento.split('-');
                const hoy = new Date();
                const cumple = new Date(y, m - 1, d);
                let edad = hoy.getFullYear() - cumple.getFullYear();
                if (hoy.getMonth() - cumple.getMonth() < 0 || (hoy.getMonth() - cumple.getMonth() === 0 && hoy.getDate() < cumple.getDate())) { edad--; }
                if (edad < 18) esMenorLista = true;
            }

            let badgeDT = "";
            if (asis.tipo_ingreso === "Pago" && asis.aplica_contrato) {
                badgeDT = `<span class="badge bg-dark text-secondary border border-secondary" style="font-size: 0.75em;">Aplica</span>`;
            } else if (esMenorLista) {
                badgeDT = `<span class="badge bg-danger text-white border border-danger" style="font-size: 0.75em;">Menor</span>`;
            } else {
                badgeDT = `<span class="text-muted" style="font-size: 0.8em;">N/A</span>`;
            }
            
            const btnPDFInstante = `<button class="btn btn-outline-info btn-sm fw-bold ms-1" onclick="window.generarContratoPDF('${rut}')" title="Descargar PDF ahora">📄 PDF</button>`;

            let btnSalidaContrato = "";
            if (asis.hora_salida) {
                btnSalidaContrato = `<span class="badge bg-secondary">Salió: ${asis.hora_salida}</span>`;
            } else { 
                window.asistentesSinSalida++; 
                btnSalidaContrato = `<button class="btn btn-outline-warning btn-sm" onclick="window.marcarSalida('${rut}', '${asis.tipo_ingreso}', ${asis.monto})">Marcar Salida</button>`; 
            }
            
            const btnEditarPago = `<span class="badge bg-success fs-6 btn-pago-editable" onclick="window.editarMontoIndividual('${rut}', ${asis.monto}, '${escaparHTML(String(trab.nombres || '').replace(/['\"\`]/g, ''))}')" title="Click para editar sueldo">✏️ $${asis.monto}</span>`;

            const tr = document.createElement('tr');
            tr.innerHTML = `<td><span class="badge bg-secondary fs-6">${num || '-'}</span></td>
                            <td>${escaparHTML(trab.nombres)} ${escaparHTML(trab.apellidos)}<br>${btnEditarPago}</td>
                            <td>${asis.hora_ingreso}</td>
                            <td>${badgeDT} ${btnPDFInstante}</td>
                            <td>${btnSalidaContrato}</td>
                            <td><button class="btn btn-danger btn-sm" onclick="window.anularAsistencia('${rut}')">X</button></td>`;
            tbody.appendChild(tr);
        });
        
        window.siguienteTicketAutomatico = maxNumero + 1;
        
        if (nombrePrograma.includes("Detrás del Muro")) {
            if (document.getElementById('seccionConteoInvitados')) document.getElementById('seccionConteoInvitados').classList.remove('d-none');
            let htmlConteo = "";
            for(const staff in conteoStaff) {
                htmlConteo += `<span class="badge bg-dark border border-warning fs-6 text-white">${escaparHTML(staff)}: <b class="text-warning fs-5 ms-1">${conteoStaff[staff]}</b></span>`;
            }
            if (document.getElementById('listaConteoInvitados')) document.getElementById('listaConteoInvitados').innerHTML = htmlConteo || "<small style='color: #aaaaaa;'>Nadie ha llegado.</small>";
        } else { 
            if (document.getElementById('seccionConteoInvitados')) document.getElementById('seccionConteoInvitados').classList.add('d-none'); 
        }
    };
}

// ==========================================
// FICHAS QUE FALTAN EN LA PUERTA
// ==========================================
// La lista de trabajadores se carga una vez (caché), pero reservas y asistencias llegan en vivo.
// Si alguien se inscribe después de abrir el panel, se lee SOLO su ficha (una vez por RUT) y se vuelve a pintar.
// Staff: ficha básica (1_trabajadores/{rut}). Admin: ficha completa (con datos privados).
const fichasEnCurso = new Map();   // rut -> promesa de lectura
const rutsSinFicha = new Map();    // rut -> momento en que se supo que no existe (se reintenta en 1 minuto)

window.asegurarFichas = function(ruts) {
    const promesas = [];
    for (const rut of ruts) {
        if (!rut || listaGlobalCRM[rut]) continue;
        const sinFichaDesde = rutsSinFicha.get(rut);
        if (sinFichaDesde && Date.now() - sinFichaDesde < 60000) continue;
        if (!fichasEnCurso.has(rut)) {
            const leer = window.esAdmin ? window.leerFichaCompleta(rut) : get(ref(db, `1_trabajadores/${rut}`)).then(s => s.val());
            const lectura = leer.then(async (ficha) => {
                if (!ficha) { rutsSinFicha.set(rut, Date.now()); return false; }
                listaGlobalCRM[rut] = ficha;
                if (window.cacheTrabajadores) {
                    window.cacheTrabajadores[rut] = ficha;
                    await setLocalCache('trabajadores_nat', window.cacheTrabajadores);
                }
                return true;
            }).catch((e) => {
                console.error("No se pudo leer la ficha", rut, e);
                return false;
            }).finally(() => fichasEnCurso.delete(rut));
            fichasEnCurso.set(rut, lectura);
        }
        promesas.push(fichasEnCurso.get(rut));
    }
    return Promise.all(promesas);
};

// Pide las fichas que falten y, cuando termina alguna lectura (exista o no la ficha), vuelve a pintar la puerta
function completarFichasPuerta(ruts) {
    window.asegurarFichas(ruts).then((resultados) => {
        if (resultados.length === 0) return;
        actualizarTablero();
        if (typeof window.renderTablaPuerta === "function") window.renderTablaPuerta();
    });
}

// Ficha para mostrar: la real, o una etiqueta clara mientras carga / si no existe
function fichaPuerta(rut) {
    if (listaGlobalCRM[rut]) return listaGlobalCRM[rut];
    return { nombres: fichasEnCurso.has(rut) ? "Cargando ficha…" : `Sin ficha (RUT ${rut})`, apellidos: "" };
}

function actualizarTablero() {
    try {
        faltanIPGlobal = 0;
        faltanCortesiaGlobal = 0;
        let htmlFaltantes = "";
        
        // Coliseo también se comporta sin cortesías en el tablero principal
        let esDalePlay = nombrePrograma.includes("Dale Play") || nombrePrograma.includes("Coliseo");
        completarFichasPuerta([...Object.keys(reservasGlobales), ...Object.keys(asistenciasGlobales)]);

        for (const rut in reservasGlobales) {
            if (!asistenciasGlobales[rut] || asistenciasGlobales[rut].tipo_ingreso === "Anulado") {
                const res = reservasGlobales[rut];
                const tr = fichaPuerta(rut);
                
                const badge = esDalePlay ? '' : (res.tipo === "Cortesía" ? `<span class="badge bg-warning text-dark">Cortesía (${escaparHTML(res.invitado_por || '-')})</span>` : `<span class="badge bg-secondary">I/P</span>`);

                htmlFaltantes += `
                <li class="list-group-item bg-dark text-white border-danger d-flex justify-content-between align-items-center" style="font-size: 0.9em; border-bottom: 1px solid #333;">
                    <div><span class="text-muted" style="font-size: 0.8em;">${escaparHTML(rut)}</span><br><strong class="text-danger">${escaparHTML(tr.nombres)} ${escaparHTML(tr.apellidos)}</strong></div>
                    ${badge}
                </li>`;

                if (res.tipo === "Cortesía") {
                    faltanCortesiaGlobal++;
                } else {
                    faltanIPGlobal++;
                }
            }
        }

        
        if (htmlFaltantes === "") {
            htmlFaltantes = "<p class='text-success p-3 fw-bold mb-0 text-center'>✅ ¡Todos los inscritos ya están adentro!</p>";
        }
        
        let htmlContadorComida = "";
        if (window.almuerzoActivo) {
            let adentroVeggies = 0;
            let adentroNormales = 0;
            for (const rut in asistenciasGlobales) {
                const tr = listaGlobalCRM[rut] || {};
                if (tr.esVegetariano === 'Sí') {
                    adentroVeggies++;
                } else {
                    adentroNormales++;
                }
            }
            htmlContadorComida = `
                <div class="row mb-4">
                    <div class="col-12">
                        <div class="p-3 rounded d-flex justify-content-around align-items-center shadow-sm" style="background: #0a1a0a; border: 1px solid #00d26a;">
                            <span class="text-success fw-bold fs-5">🍽️ Almuerzos en sala:</span>
                            <span class="badge bg-dark border border-success fs-5 text-white">🥩 Normal: <b class="text-success">${adentroNormales}</b></span>
                            <span class="badge bg-dark border border-success fs-5 text-white">🥗 Veggie: <b class="text-success">${adentroVeggies}</b></span>
                        </div>
                    </div>
                </div>
            `;
        }
        
        if (document.getElementById('contenedorAlmuerzosTablero')) {
            document.getElementById('contenedorAlmuerzosTablero').innerHTML = htmlContadorComida;
        } else if(htmlContadorComida) {
            let divAlm = document.createElement('div');
            divAlm.id = 'contenedorAlmuerzosTablero';
            divAlm.innerHTML = htmlContadorComida;
            let secLista = document.getElementById('seccionLista');
            let metricBoxesRow = secLista.querySelector('.row.mb-4');
            if(metricBoxesRow) {
                metricBoxesRow.parentNode.insertBefore(divAlm, metricBoxesRow.nextSibling);
            }
        } else if (!window.almuerzoActivo && document.getElementById('contenedorAlmuerzosTablero')) {
            document.getElementById('contenedorAlmuerzosTablero').innerHTML = "";
        }


        if (esDalePlay) {
            if (document.getElementById('contEsperados')) document.getElementById('contEsperados').innerHTML = `${totalEsperados}`;
            if (document.getElementById('contFirmados')) document.getElementById('contFirmados').innerHTML = `${totalFirmados}`;
        } else {
            if (document.getElementById('contEsperados')) document.getElementById('contEsperados').innerHTML = `${totalEsperados} <br><span style="font-size:0.35em; color:#d6b3ff; display:block; margin-top:2px; font-weight:normal;">I/P: ${totalIPGlobal} | CORT: ${totalCortesiaGlobal}</span>`;
            if (document.getElementById('contFirmados')) document.getElementById('contFirmados').innerHTML = `${totalFirmados} <br><span style="font-size:0.35em; color:#00d26a; display:block; margin-top:2px; font-weight:normal;">I/P: ${window.adentroIP || 0} | CORT: ${window.adentroCortesia || 0}</span>`;
        }
        
        let faltan = totalEsperados - totalFirmados; 
        let textoFaltan = faltan < 0 ? 0 : faltan;
        
        if (faltan > 0) {
            if (!esDalePlay) {
                textoFaltan += ` <br><span style="font-size:0.35em; color:#d6b3ff; display:block; margin-top:2px;">Faltan: ${faltanIPGlobal} I/P | ${faltanCortesiaGlobal} CORT</span>`;
            }
            textoFaltan += `<img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/56.gif" style="height: 30px; margin-top:2px;" title="En camino"> <span style="font-size: 0.4em; display:block; color:#ffcc00; margin-top:1px;">¡EN CAMINO!</span>`;
        }
        
        if (document.getElementById('contFaltan')) document.getElementById('contFaltan').innerHTML = textoFaltan;

        let divFaltantes = document.getElementById('listaFaltantesPanel');
        if(!divFaltantes) {
            divFaltantes = document.createElement('div');
            divFaltantes.id = 'listaFaltantesPanel';
            divFaltantes.className = 'mt-3 mb-4';
            
            const seccionLista = document.getElementById('seccionLista');
            const tableResp = seccionLista ? seccionLista.querySelector('.table-responsive') : null;
            if(tableResp) {
                seccionLista.insertBefore(divFaltantes, tableResp);
            } else if (seccionLista) {
                seccionLista.prepend(divFaltantes);
            }
        }

        if (divFaltantes && !divFaltantes.innerHTML.includes('accFaltantes')) {
            divFaltantes.innerHTML = `
                <div class="accordion shadow-sm" id="accFaltantes">
                  <div class="accordion-item" style="background: #1a0a0a; border: 1px solid #ff3333;">
                    <h2 class="accordion-header">
                      <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#colFaltantes" style="background: #330000; color: #ff9999; font-weight: bold;" id="btnAccFaltantes">
                        🚨 Ver Lista y Descargar para el Canal (<span id="countFaltantesHeader">${faltan}</span>)
                      </button>
                    </h2>
                    <div id="colFaltantes" class="accordion-collapse collapse" data-bs-parent="#accFaltantes">
                      <div class="accordion-body p-0">
                        <div class="p-3 bg-dark border-bottom border-danger">
                            <button class="btn btn-primary w-100 fw-bold shadow-sm" onclick="window.descargarListaCanal()" style="font-size: 0.95em;">
                                📥 DESCARGAR EXCEL CANAL (Salud y Emergencia)
                            </button>
                        </div>
                        <ul class="list-group list-group-flush" id="ulFaltantes" style="max-height: 280px; overflow-y: auto;">
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
            `;
        }
        
        const countHeader = document.getElementById('countFaltantesHeader');
        if(countHeader) countHeader.innerText = faltan;
        
        const ulFaltantes = document.getElementById('ulFaltantes');
        if(ulFaltantes) {
            ulFaltantes.innerHTML = `
                <li class="list-group-item bg-dark text-white fw-bold text-center" style="font-size: 0.85em; background:#222;">👇 AÚN FALTAN POR LLEGAR (${faltan}) 👇</li>
                ${htmlFaltantes}
            `;
        }

    } catch(e) {
        console.error("Error crítico evitado:", e);
    }
}

window.descargarListaCanal = async function() {
    if (!reservasGlobales || Object.keys(reservasGlobales).length === 0) {
        return alert("No hay personas inscritas en el formulario todavía.");
    }
    // Antes de armar el archivo se leen las fichas que falten (nunca sale "No registrado")
    await window.asegurarFichas(Object.keys(reservasGlobales));
    const diaPrograma = (fechaPrograma || '').split('-')[2] || 'TICKET';
    const limpiar = (v) => String(v ?? '').replace(/[;\r\n]+/g, ' ').trim();
    let csv = `\uFEFF${diaPrograma};NOMBRE;RUT;TELÉFONO;CORREO;CONDICIÓN;CONTACTO EMERGENCIA (NOMBRE);CONTACTO EMERGENCIA (TELÉFONO);ENFERMEDADES DE BASE Y ALERGIAS\n`;
    
    for (const rut in reservasGlobales) {
        const res = reservasGlobales[rut];
        const tr = fichaPuerta(rut);
        const cond = res.tipo === "Cortesía" ? `Cortesía (${res.invitado_por || ''})` : "I/P";
        const asis = asistenciasGlobales[rut];
        const ticket = asis && asis.tipo_ingreso !== "Anulado" ? (asis.numero_asignado || '') : '';
        const nombre = `${tr.nombres || ''} ${tr.apellidos || ''}`.trim().toUpperCase();
        const enfermedades = window.esAdmin ? (tr.enfermedades || 'No indica') : 'Solo visible para admin';
        
        csv += [ticket, nombre, rut, tr.telefono || '', tr.email || '', cond, tr.emergenciaNombre || 'No indica', tr.emergenciaTelefono || 'No indica', enfermedades].map(limpiar).join(';') + "\n";
    }
    descargarCSV(csv, `Lista_Canal_${nombrePrograma.replace(/[ \/]/g, "_")}_${fechaPrograma}.csv`);
}



window.editarMontoIndividual = async function(rut, montoActual, nombrePersona) {
    let nuevoMonto = prompt(`¿Cuánto será el NUEVO PAGO TOTAL de ${nombrePersona} para la jornada de hoy?\n(Monto actual: $${montoActual})`, montoActual);
    if (nuevoMonto === null || nuevoMonto === "") return;
    
    nuevoMonto = parseInt(nuevoMonto);
    if (isNaN(nuevoMonto)) return alert("Por favor ingresa solo números.");
    
    try { 
        window.limpiarCache();
        await update(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}`), { monto: nuevoMonto }); 
    } catch (e) { 
        alert("Error al actualizar el pago."); 
    }
}

window.marcarSalida = async function(rut, tipoIngreso, montoBaseActual) {
    const now = new Date();
    const horaSalida = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    
    if (tipoIngreso === "Cortesía") {
        if (!confirm(`¿Marcar salida para este Invitado de Cortesía a las ${horaSalida}?\n(Se mantendrá su pago en $0).`)) return;
        try { 
            window.limpiarCache();
        await update(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}`), { hora_salida: horaSalida, bono_horas_extras: 0, monto: 0 }); 
        } catch (e) {}
        return;
    } 
    
    let calculo = calcularPagoYBonos(horaCitacionGeneral, horaTerminoGeneral, horaSalida, montoBaseActual, valorHoraExtraGlobal, fechaPrograma);
    
    let msj = `Hora de salida marcada: ${horaSalida}\n\n`;
    if (calculo.montoBaseNuevo === 0) {
        msj += `⚠️ ABANDONO ANTICIPADO ⚠️\nSe retiró antes de cumplir la mitad de la jornada. El sistema ajustará su pago base a $0.\n`;
    } else if (calculo.montoBaseNuevo < parseInt(montoBaseActual)) {
        msj += `⚠️ RETIRO ANTICIPADO ⚠️\nSe retiró pasada la media jornada, pero no la completó. El sistema ajustará su pago base a la mitad: $${calculo.montoBaseNuevo}.\n`;
    } else if (calculo.bonoExtra > 0) {
        msj += `✅ Completó Horas Extras.\nBono extra calculado automáticamente: $${calculo.bonoExtra}\n`;
    } else {
        msj += `Jornada regular completada. Sin horas extra.\n`;
    }

    msj += `\nConfirma el BONO EXTRA que recibirá (Su pago base será modificado a $${calculo.montoBaseNuevo}):`;
    
    let respuesta = prompt(msj, calculo.bonoExtra);
    if (respuesta === null) return; 
    let bonoExtraConfirmado = parseInt(respuesta) || 0;
    
    const nuevoMontoTotal = calculo.montoBaseNuevo + bonoExtraConfirmado;

    try { 
        window.limpiarCache();
        await update(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}`), { 
            hora_salida: horaSalida, 
            bono_horas_extras: bonoExtraConfirmado, 
            monto: nuevoMontoTotal 
        }); 
    } catch (error) { 
        alert("Error al marcar salida."); 
    }
}

if (document.getElementById('btnIngresoManual')) document.getElementById('btnIngresoManual').addEventListener('click', () => {
    const rutIngresado = document.getElementById('rutManual').value.trim();
    if (!rutIngresado) return alert("Por favor, ingresa el RUT para buscarlo.");
    
    if (!/^[0-9]+[-|‐]{1}[0-9kK]{1}$/.test(rutIngresado)) return alert("❌ Formato inválido. Usa guión (Ej: 12345678-9).");
    let tmp = rutIngresado.split('-');
    let digv = tmp[1].toLowerCase(); 
    let rutNum = parseInt(tmp[0], 10);
    let m = 0, s = 1;
    for(; rutNum; rutNum = Math.floor(rutNum / 10)) { s = (s + rutNum % 10 * (9 - m++ % 6)) % 11; }
    let dvEsperado = s ? s - 1 : 'k';
    if(dvEsperado != digv) return alert("❌ RUT INVÁLIDO. El dígito verificador es incorrecto.");
    
    onScanSuccess(rutIngresado); 
    document.getElementById('rutManual').value = "";
});

async function onScanSuccess(decodedText) {
    try { if(html5QrcodeScanner) html5QrcodeScanner.pause(); } catch(e) {} 
    
    if (document.getElementById('mensajeEscaneo')) document.getElementById('mensajeEscaneo').classList.remove('d-none'); 
    rutActual = decodedText; 
    
    try {
        const blacklistSnap = await get(ref(db, `4_blacklist/${rutActual}`));
        if (blacklistSnap.exists()) { 
            alert(`⛔ ACCESO DENEGADO ⛔\nLa persona no tiene permitido el ingreso.`); 
            try { if(html5QrcodeScanner) html5QrcodeScanner.resume(); } catch(e) {} 
            if (document.getElementById('mensajeEscaneo')) document.getElementById('mensajeEscaneo').classList.add('d-none'); 
            return; 
        }
        
        const reservaSnap = await get(ref(db, `3_reservas/${fechaPrograma}/${nombrePrograma}/${rutActual}`));
        const snapshot = await get(ref(db, `1_trabajadores/${rutActual}`));
        
        if (snapshot.exists()) {
            // Admin: ficha completa (con datos privados) para no perderlos en la lista en memoria (Excel canal, finanzas)
            const datos = window.esAdmin ? await window.leerFichaCompleta(rutActual) : snapshot.val(); 
            listaGlobalCRM[rutActual] = datos; 
            if (document.getElementById('nombreAsistenteDisplay')) document.getElementById('nombreAsistenteDisplay').innerText = `${datos.nombres} ${datos.apellidos}`;
            window.fichaEscaneada = datos;
            const infoInvitado = document.getElementById('infoInvitado');
            
            let esCortesia = reservaSnap.exists() && reservaSnap.val().tipo === "Cortesía";
            
            // FORZAR I/P Y CONTRATO SI ES COLISEO
            if (nombrePrograma.includes("Coliseo")) {
                esCortesia = false; 
            }

            let esMenorCalculado = false;
            if (datos.fechaNacimiento) {
                const [y, m, d] = datos.fechaNacimiento.split('-');
                const hoy = new Date();
                const cumple = new Date(y, m - 1, d);
                let edad = hoy.getFullYear() - cumple.getFullYear();
                if (hoy.getMonth() - cumple.getMonth() < 0 || (hoy.getMonth() - cumple.getMonth() === 0 && hoy.getDate() < cumple.getDate())) { edad--; }
                if (edad < 18) esMenorCalculado = true;
            }

            if (infoInvitado) {
                if (esMenorCalculado) {
                    infoInvitado.innerHTML = esCortesia ? `⭐ INVITADO DE CORTESÍA (Por: ${escaparHTML(reservaSnap.val().invitado_por)}) <span class="badge bg-danger ms-2">👶 MENOR DE EDAD</span>` : `✅ EXTRA CON PAGO ($${montoPago}) <span class="badge bg-danger ms-2">👶 MENOR DE EDAD</span>`;
                } else {
                    infoInvitado.innerText = esCortesia ? `⭐ INVITADO DE CORTESÍA (Por: ${reservaSnap.val().invitado_por})` : `✅ EXTRA CON PAGO ($${montoPago})`; 
                }
            }

            const opcionesDiv = document.getElementById('opcionesFirmaAdmin');
            if (opcionesDiv) opcionesDiv.classList.remove('d-none');
            
            if (esMenorCalculado) {
                if (opcionesDiv) opcionesDiv.innerHTML = `
                    <div class="alert alert-danger p-2 mb-0" style="background: #330000; border: 1px solid #ff3333;">
                        <strong class="text-white">👶 MENOR DE EDAD DETECTADO</strong><br>
                        <small class="text-white">Por ley, no se le generará contrato laboral (DT). El sistema lo contará en la capacidad pero solo se emitirá Cesión de Imagen.</small>
                    </div>
                `;
            } else if (esCortesia) {
                const nombreActual = reservaSnap.exists() ? reservaSnap.val().invitado_por : "";
                if (opcionesDiv) opcionesDiv.innerHTML = `
                    <label class="form-label text-warning mb-1">Corregir "Invitado Por":</label>
                    <select id="editInvitadoPor" class="form-select bg-dark text-white border-warning">
                        ${[...new Set([...window.invitadoresNat, nombreActual].filter(Boolean))].map(n => `<option value="${escaparHTML(n)}" ${n===nombreActual?'selected':''}>${escaparHTML(n)}</option>`).join('')}
                    </select>
                `;
            } else {
                let isColiseo = nombrePrograma.includes("Coliseo");
                let disabledAttr = isColiseo ? "disabled" : "";
                let extraText = isColiseo ? "<small class='text-warning fw-bold'>Bloqueado: Contrato obligatorio para Coliseo.</small>" : "<small class='text-muted'>Si lo apagas, solo firmará Cesión de Imagen.</small>";

                if (opcionesDiv) opcionesDiv.innerHTML = `
                    <div class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" id="checkAplicaContrato" checked ${disabledAttr} style="transform: scale(1.3); margin-right: 10px;">
                        <label class="form-check-label text-white fw-bold" for="checkAplicaContrato">Generar Contrato Laboral DT</label>
                    </div>
                    ${extraText}
                `;
            }

            mostrarBloquePinPersonal(opcionesDiv, datos);

            if (document.getElementById('seccionFirma')) document.getElementById('seccionFirma').classList.remove('d-none'); 
            if (document.getElementById('numeroAsignado')) document.getElementById('numeroAsignado').value = window.siguienteTicketAutomatico;
            
            const canvasAdmin = document.getElementById('signature-pad');
            if (canvasAdmin) {
                const ratioAdmin = Math.max(window.devicePixelRatio || 1, 1);
                canvasAdmin.width = canvasAdmin.offsetWidth * ratioAdmin;
                canvasAdmin.height = canvasAdmin.offsetHeight * ratioAdmin;
                canvasAdmin.getContext("2d").scale(ratioAdmin, ratioAdmin);

                if(!signaturePad) {
                    signaturePad = new SignaturePad(canvasAdmin, { backgroundColor: 'rgb(255, 255, 255)' }); 
                }
                signaturePad.clear(); 
            }
            if (document.getElementById('mensajeEscaneo')) document.getElementById('mensajeEscaneo').classList.add('d-none');
            
        } else { 
            alert("RUT no encontrado en la base de datos."); 
            try { if(html5QrcodeScanner) html5QrcodeScanner.resume(); } catch(e) {} 
            if (document.getElementById('mensajeEscaneo')) document.getElementById('mensajeEscaneo').classList.add('d-none'); 
        }
    } catch (error) { 
        try { if(html5QrcodeScanner) html5QrcodeScanner.resume(); } catch(e) {} 
    }
}

// ==========================================
// PIN PERSONAL DESDE EL IPAD
// ==========================================
// Si la persona todavía no tiene PIN (o un admin se lo reseteó), lo crea aquí al firmar.
// Con su RUT + PIN podrá autocompletar sus datos en el formulario público.
function mostrarBloquePinPersonal(opcionesDiv, datos) {
    const anterior = document.getElementById('bloquePinPersonal');
    if (anterior) anterior.remove();
    if (!opcionesDiv || datos.tiene_pin === true) return;

    const bloque = document.createElement('div');
    bloque.id = 'bloquePinPersonal';
    bloque.className = 'p-3 mt-3 rounded';
    bloque.style.cssText = 'background: #0d1b2a; border: 1px solid #17a2b8;';
    bloque.innerHTML = `
        <strong class="text-info">🔑 Crea tu PIN personal</strong>
        <p class="small text-white-50 mb-2">Con tu RUT y este PIN de 4 dígitos podrás autocompletar tus datos la próxima vez. Pide a la persona que lo escriba ella misma.</p>
        <div class="row g-2">
            <div class="col-6"><input type="password" inputmode="numeric" maxlength="4" id="pinPersonalNuevo" class="form-control text-center fs-4" placeholder="PIN"></div>
            <div class="col-6"><input type="password" inputmode="numeric" maxlength="4" id="pinPersonalConfirmar" class="form-control text-center fs-4" placeholder="Repetir"></div>
        </div>
        <small class="text-muted">Opcional: si lo dejan en blanco, se puede crear en su próxima visita.</small>`;
    opcionesDiv.after(bloque);
}

async function guardarPinPersonal(rut, ficha) {
    const pinEl = document.getElementById('pinPersonalNuevo');
    if (!pinEl) return;
    const pin = pinEl.value.trim();
    const confirmar = document.getElementById('pinPersonalConfirmar').value.trim();
    if (!pin && !confirmar) return;
    const pinHash = await hashPin(rut, pin);
    const autoKey = await claveAutocompletar(rut, pin);
    await update(ref(db), {
        [`1p_privado/${rut}/pin_hash`]: pinHash,
        [`1p_privado/${rut}/verif`]: nuevoVerif(pinHash),
        [`1p_privado/${rut}/auto_key`]: autoKey,
        [`1_trabajadores/${rut}/tiene_pin`]: true,
        // Si quien crea el PIN es admin, la ficha trae el banco y se incluye el resumen; el staff no lo ve
        [`1a_autocompletar/${autoKey}`]: datosAutocompletar(rut, ficha || {}, resumenBancario(ficha))
    });
}

function validarPinPersonalIngresado() {
    const pinEl = document.getElementById('pinPersonalNuevo');
    if (!pinEl) return true;
    const pin = pinEl.value.trim();
    const confirmar = document.getElementById('pinPersonalConfirmar').value.trim();
    if (!pin && !confirmar) return true;
    if (!pinValido(pin)) { alert("El PIN debe tener exactamente 4 números."); return false; }
    if (pin !== confirmar) { alert("Los dos PIN no coinciden. Pídele que lo escriba de nuevo."); return false; }
    return true;
}

// ==========================================
// TICKETS ÚNICOS CON VARIOS IPADS
// ==========================================
// El número se pide al guardar a un contador compartido (2_tickets/{fecha}/{programa}) con una transacción:
// dos iPads que confirman al mismo tiempo nunca reciben el mismo número.
// Nunca entrega un número menor al más alto ya usado en la sala (salas abiertas antes de este cambio).
async function asignarTicket(rut) {
    const previo = asistenciasGlobales[rut];
    if (previo && previo.tipo_ingreso !== "Anulado" && previo.numero_asignado) return String(previo.numero_asignado); // ya había entrado: conserva su ticket
    const maxLocal = Math.max(0, (parseInt(window.siguienteTicketAutomatico, 10) || 1) - 1);
    try {
        const r = await runTransaction(ref(db, `2_tickets/${fechaPrograma}/${nombrePrograma}`), (actual) => Math.max(Number(actual) || 0, maxLocal) + 1);
        if (r.committed && r.snapshot.exists()) return String(r.snapshot.val());
    } catch (e) {
        console.error("No se pudo usar el contador de tickets; se usa el número local", e);
    }
    return String(maxLocal + 1);
}

// Muestra en grande el ticket definitivo mientras ya se escanea a la siguiente persona
function mostrarTicketAsignado(numero, nombre) {
    const escaner = document.getElementById('seccionEscaner');
    if (!escaner) return;
    let aviso = document.getElementById('avisoTicketAsignado');
    if (!aviso) {
        aviso = document.createElement('div');
        aviso.id = 'avisoTicketAsignado';
        aviso.className = 'alert text-center fw-bold mb-3';
        aviso.style.cssText = 'background: #0a2a12; border: 2px solid #00d26a; color: #fff; font-size: 1.3em;';
        escaner.prepend(aviso);
    }
    aviso.textContent = `🎟️ Ticket N° ${numero}${nombre ? ' — ' + nombre : ''}`;
    aviso.classList.remove('d-none');
    clearTimeout(window.__ocultarAvisoTicket);
    window.__ocultarAvisoTicket = setTimeout(() => aviso.classList.add('d-none'), 10000);
}

if (document.getElementById('btnLimpiarFirma')) document.getElementById('btnLimpiarFirma').addEventListener('click', () => signaturePad.clear());

if (document.getElementById('btnCancelarEscaneo')) document.getElementById('btnCancelarEscaneo').addEventListener('click', () => {
    if (document.getElementById('seccionFirma')) document.getElementById('seccionFirma').classList.add('d-none');
    if (typeof signaturePad !== 'undefined' && signaturePad) signaturePad.clear();
    rutActual = "";
    try { if(html5QrcodeScanner) html5QrcodeScanner.resume(); } catch(e) {}
    if (document.getElementById('mensajeEscaneo')) document.getElementById('mensajeEscaneo').classList.add('d-none');
});


if (document.getElementById('btnGuardarIngreso')) document.getElementById('btnGuardarIngreso').addEventListener('click', async () => {
    if (signaturePad.isEmpty()) return alert("El trabajador debe firmar.");
    if (!validarPinPersonalIngresado()) return;
    
    const firmaBase64 = window.comprimirFirma(signaturePad); 
    const now = new Date();
    const horaActual = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    let numeroFinal = document.getElementById('numeroAsignado').value; // estimado; el definitivo lo entrega el contador al guardar
    
    const textoInfo = document.getElementById('infoInvitado').innerText; 
    const tipo = textoInfo.includes("CORTESÍA") ? "Cortesía" : "Pago";
    
    let invitadoPor = "";
    let aplicaContrato = false;
    
    let esMenor = false;
    const trabData = listaGlobalCRM[rutActual];
    if (trabData && trabData.fechaNacimiento) {
        const [y, m, d] = trabData.fechaNacimiento.split('-');
        const hoy = new Date();
        const cumple = new Date(y, m - 1, d);
        let edad = hoy.getFullYear() - cumple.getFullYear();
        if (hoy.getMonth() - cumple.getMonth() < 0 || (hoy.getMonth() - cumple.getMonth() === 0 && hoy.getDate() < cumple.getDate())) { edad--; }
        if (edad < 18) esMenor = true;
    }

    if (tipo === "Cortesía") {
        invitadoPor = document.getElementById('editInvitadoPor') ? document.getElementById('editInvitadoPor').value : "";
        aplicaContrato = false; 
    } else {
        if (esMenor) {
            aplicaContrato = false;
        } else {
            aplicaContrato = document.getElementById('checkAplicaContrato') ? document.getElementById('checkAplicaContrato').checked : true;
        }
    }

    if (nombrePrograma.includes("Coliseo") && !esMenor) {
        aplicaContrato = true;
    }

    try {
        window.limpiarCache();
        window.limpiarCache();
        const rutaAsistencia = `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rutActual}`;
        numeroFinal = await asignarTicket(rutActual);
        const datosAsistencia = { 
            rut: rutActual, 
            nombre_programa: nombrePrograma, 
            monto: (tipo === "Pago" ? montoPago : 0), 
            tipo_ingreso: tipo, 
            hora_ingreso: horaActual, 
            tiene_firma: true, 
            estado_pago: "Pendiente", 
            numero_asignado: numeroFinal, 
            invitado_por: invitadoPor, 
            aplica_contrato: aplicaContrato, 
            estado_dt: "Pendiente" 
        };
        try {
            // Guardado atómico: la asistencia y su firma se guardan juntas o no se guarda nada
            await update(ref(db), {
                [rutaAsistencia]: datosAsistencia,
                [`${NODO_FIRMAS}/${fechaPrograma}/${nombrePrograma}/${rutActual}`]: firmaBase64
            });
        } catch (errorNodoFirmas) {
            // Respaldo de seguridad: si el nodo de firmas no está permitido, se guarda como antes (firma dentro de la asistencia)
            console.warn("No se pudo usar el nodo de firmas, se guarda en formato clásico", errorNodoFirmas);
            const datosClasicos = { ...datosAsistencia, firma_digital: firmaBase64 };
            delete datosClasicos.tiene_firma;
            await set(ref(db, rutaAsistencia), datosClasicos);
        }
        
        try {
            await guardarPinPersonal(rutActual, window.fichaEscaneada || listaGlobalCRM[rutActual]);
        } catch (errorPin) {
            console.error("No se pudo guardar el PIN personal", errorPin);
            alert("⚠️ La asistencia quedó guardada, pero no se pudo crear el PIN. Se puede crear en su próxima visita.");
        }
        const bloquePin = document.getElementById('bloquePinPersonal');
        if (bloquePin) bloquePin.remove();

        mostrarTicketAsignado(numeroFinal, document.getElementById('nombreAsistenteDisplay') ? document.getElementById('nombreAsistenteDisplay').innerText : '');
        if (document.getElementById('seccionFirma')) document.getElementById('seccionFirma').classList.add('d-none'); 
        signaturePad.clear(); 
        try { if(html5QrcodeScanner) html5QrcodeScanner.resume(); } catch(e) {} 
        rutActual = "";
    } catch (error) { 
        alert("Error al guardar."); 
    }
});

window.anularAsistencia = async function(rut) { 
    if(confirm("¿Seguro que deseas anular esta asistencia?\nLa persona se ocultará de la lista, pero su Ticket quedará bloqueado para mantener el orden numérico exacto.")) {
        window.limpiarCache();
        window.limpiarCache();
        await update(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}`), {
            tipo_ingreso: "Anulado",
            monto: 0,
            estado_pago: "Anulado",
            aplica_contrato: false,
            estado_dt: "Anulado",
            hora_salida: "Anulado"
        }); 
    }
}

// ==========================================
// CONTRATOS PDF 
// ==========================================
window.generarContratoPDF = async function(rut) {
    await window.asegurarFichas([rut]); // puede haber ingresado desde otro iPad
    const trab = listaGlobalCRM[rut]; 
    const asisSnap = await get(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}`));
    
    if (!trab || !asisSnap.exists()) return alert("Faltan datos.");
    
    const asis = asisSnap.val(); 
    if (!asis.firma_digital && asis.tiene_firma) {
        asis.firma_digital = await window.obtenerFirma(fechaPrograma, nombrePrograma, rut, asis);
    }
    const doc = window.crearDocumentoIngreso(rut, trab, asis, fechaPrograma, nombrePrograma.replace(" - ", " / "));
    
    const nombreCompletoLimpio = `${trab.nombres || ''}_${trab.apellidos || ''}`.replace(/[^a-zA-Z0-9_]/g, "");
    const ticketStr = asis.numero_asignado ? `Ticket${asis.numero_asignado}` : `SinTicket`;
    
    let nombreArchivo = "";
    if (asis.tipo_ingreso === "Cortesía" || asis.aplica_contrato === false) {
        nombreArchivo = `Cesion_Imagen_${ticketStr}_${nombreCompletoLimpio}_${rut}.pdf`;
    } else {
        nombreArchivo = `Contrato_${ticketStr}_${nombreCompletoLimpio}_${rut}.pdf`;
    }
    
    doc.save(nombreArchivo);
}

// ==========================================
// CESIÓN Y AUTORIZACIÓN MEGAMEDIA (formato oficial, mayor de edad)
// ==========================================
// Texto literal del documento "Cesión y Autorización Imagen Tipo (Mayor Edad) MEGAMEDIA".
// Las partes entre ** van en negrita, igual que en el documento oficial.
const PARRAFOS_CESION_MEGAMEDIA = [
    "En Santiago de Chile, quien suscribe la presente autorización, declara y deja expresa constancia de lo siguiente:",
    "**PRIMERO**: Por el presente instrumento y, en este acto, autorizo a **MEGAMEDIA S.A.**, en adelante **MEGAMEDIA**, y a los terceros que ésta designe, para que utilicen mi imagen personal y/o artística, nombre, seudónimo, fotografías, voz y/o, en general, cualquier otra manifestación material o externa de mi imagen o personalidad, en adelante “mi imagen” (i) en los programas de televisión o casting de estos, en que haya intervenido, participado o haya tenido alguna presencia; (ii) en aquellos productos, bienes, servicios y/o negocios que se comercialicen y/o desarrollen por **MEGAMEDIA** o por los terceros que designe, que incluyan mi imagen; y (iii) en la publicidad o promoción de (i) y (ii) anteriores. La autorización de que da cuenta este instrumento se presta en forma exclusiva; sin cargo adicional alguno; en forma irrevocable; ilimitada; por el plazo durante el cual se transmitan los programas de televisión en los cuales participe o haya participado o aparecido, en forma individual o en conjunto, y/o durante el plazo en que se comercialicen los productos, bienes, servicios y/o negocios en los que se utilice mi imagen personal y/o artística, nombre, seudónimo, fotografías, voz y/o, en general, cualquier otra manifestación material o externa de mi imagen o personalidad – ya sea en forma individual o en conjunto con otros – y en Chile y el Extranjero; y tanto para sistemas de televisión de libre recepción, servicios limitados de televisión, televisión satelital, televisión digital, internet, radio o en cualquier otro medio o sistema de comunicación como para cualquier otro soporte material; y/o de audio; y/o audiovisual que se utilicen para estos efectos por **MEGAMEDIA** o por los terceros que **MEGAMEDIA** determine. Todos los soportes materiales; y/o de audio; y/o de audio y video en que se incluya o aparezca mi imagen personal y/o artística, nombre, seudónimo, fotografías, voz y/o, en general, cualquier otra manifestación material de mi imagen o personalidad, es y será de propiedad exclusiva de **MEGAMEDIA**. En consecuencia, podrán proceder, personalmente o a través de terceros, a la elaboración y comercialización de cuantos productos considere oportunos y sin que esta enumeración se considere taxativa: discos compactos con obras musicales ejecutadas o interpretadas por mi, en forma individual o en conjunto con otros, dvds, u otros soportes de audio, video y/o de audio y video, entre otros, en los que aparezca, por ejemplo, mi imagen o nombre, así como expresiones que se hayan podido popularizar durante la emisión del programa de televisión. Asimismo y sin perjuicio de los derechos de televisión que corresponden a **MEGAMEDIA**, en forma exclusiva, podrán proceder a la grabación, publicación y copia de actuaciones, ejecuciones o interpretaciones, en cualquier tipo de forma o soporte; la reproducción y adaptación de la actuación como cantante, solista o como parte de un grupo musical o de mi intervención en el programa de televisión, el muestreo, la representación mímica, la mezcla y el doblaje de la actuación o intervención, la reproducción y comunicación pública mediante la utilización de cualquier soporte, así como, en general, cualquier otro medio. También y sin perjuicio de los derechos de televisión y de los derechos musicales que corresponden a **MEGAMEDIA**, en forma exclusiva, podrá difundir, en cualquier otra forma, información respecto mi persona mediante imágenes y/o sonido, incluyéndose los pases o transmisiones mediante sistemas de comunicación de libre recepción, sistemas de comunicación por satélite, sistemas de comunicación por cable (por ejemplo; como parte de una suscripción o abono a una cadena de televisión de pago o a través de la modalidad de “pay per view” o a través de un circuito cerrado de televisión e incluso como parte de un paquete o compilación de programas), internet, radio, música y cualquier otro medio actualmente conocido o que se conozca en el futuro. Sin perjuicio de lo ya señalado, autorizo la cesión, en este mismo acto, a **MEGAMEDIA** por lo que respecta a los derechos de televisión y musicales, la totalidad de los derechos de explotación y, en especial, los de reproducción, distribución y/o comunicación pública que me pudieren corresponder sobre mi intervención o participación o presencia en el programa de televisión de acuerdo con la legislación vigente en la República de Chile en materia de propiedad intelectual, efectuándose dicha cesión por el plazo máximo de protección legal, en forma ilimitada, por un número ilimitado de veces, en Chile y el extranjero. Por último, **MEGAMEDIA**, por lo que respecta a los derechos de televisión y musicales, gozará del derecho a explotar el programa de televisión y las obras musicales en que cante o ejecute, en cualquier forma y a través de cualquier medio, actualmente conocido o que se conozca en el futuro, pudiendo hacerlo, directamente, o a través de cualquier tercero al que, a su vez, ceda, total o parcialmente, los derechos de explotación cuya titularidad ostenta. Asimismo, reconozco y acepto que **MEGAMEDIA** podrá, directamente o a través de un tercero, producir discos, álbumes musicales u otros soportes materiales conteniendo fonogramas interpretados por mi, en forma individual o en conjunto con otros, en el programa de televisión y que podrá o no – a criterio de **MEGAMEDIA** – contener fonogramas interpretados por mi. En tal sentido, en conformidad a la presente autorización, otorgo a **MEGAMEDIA** el derecho exclusivo para efectuar grabaciones fonográficas de las interpretaciones efectuadas por mi, sea como solista y/o en conjunto con otro u otros participantes del programa de televisión y/o artistas, con o sin imágenes, efectuadas por cualquier medio creado o crearse en el futuro y el derecho exclusivo para fabricar, producir, licenciar, promover y/o de cualquier otra forma explotar fonogramas y/o álbumes y/o videogramas conteniendo dichas grabaciones sin límite de tiempo, ni de territorios, pudiendo ceder este derecho a terceros, sin limitación alguna. Durante toda la vigencia de la presente autorización, ya sea como solista o en conjunto, otorgo a **MEGAMEDIA** la plena y absoluta exclusividad de mis interpretaciones para fijaciones sonoras y audiovisuales, que se realicen por cualquier medio o tecnología creada o a crearse, comprometiéndome a no grabarlas para mí mismo ni para terceros, ya sea actuando como solista o como integrante de un conjunto y aun sin mención de mi nombre o seudónimo. Asimismo, me obligo a no re-grabar ningún trabajo musical contenido en las grabaciones y/o en los videogramas y/o álbumes y/o fonogramas en los que se incluyan interpretaciones y/o grabaciones, durante un período de 2 años contados desde la finalización del periodo de vigencia de la presente autorización",
    "**SEGUNDO**: Sin perjuicio de lo señalado en la cláusula anterior, en particular y sin que ello importe limitación alguna, y sólo a título ejemplar, MEGAMEDIA estará autorizada y será titular de todos los derechos de:",
    "1) Transmisión televisiva, en directo o diferido, por sistemas de televisión de libre recepción, servicios limitados de televisión, televisión digital, televisión satelital, internet o por cualquier otro medio conocido o que se conozca en el futuro del programa de televisión y de mi imagen, en Chile y en el extranjero, a través de los sistemas de televisión de libre recepción, servicios limitados de televisión, televisión digital, televisión satelital, internet o por cualquier otro medio conocido o que se conozca en el futuro que MEGAMEDIA designe.",
    "2) Grabación, reproducción, adaptación y/o edición del programa de televisión y de mi imagen en cualesquiera soportes materiales que permitan la retransmisión televisiva del programa de televisión y de mi imagen o de sus adaptaciones y/o ediciones, por sistemas de televisión de libre recepción, servicios limitados de televisión, televisión digital, televisión satelital, internet o por cualquier otro medio conocido o que se conozca en el futuro. Todo el material de fijación de imágenes y/o sonidos sobre cualquier base material del programa de televisión y de mi imagen es y será única y exclusivamente de propiedad de MEGAMEDIA.",
    "3) La retransmisión televisiva por sistemas de televisión de libre recepción, servicios limitados de televisión, televisión digital, televisión satelital, internet o por cualquier otro medio conocido o que se conozca en el futuro de las grabaciones, adaptaciones y/o ediciones de las imágenes, referidas en el Nº 2 anterior, en Chile y en el extranjero, a través de los sistemas de televisión de libre recepción, servicios limitados de televisión, televisión digital, televisión satelital, internet o por cualquier otro medio conocido o que se conozca en el futuro que MEGA designe, por un número ilimitado de veces y por el plazo máximo de protección legal del programa de televisión y de mi imagen.",
    "Lo anteriormente declarado, es aceptado por MEGAMEDIA a través de su representante."
];

// Escribe un párrafo justificado admitiendo negritas (**texto**). Devuelve la nueva posición vertical.
function escribirParrafoJustificado(doc, texto, x, y, ancho, interlinea, limiteY, margenSuperior) {
    const palabras = [];
    let actual = [];
    texto.split(/(\*\*[^*]+\*\*)/).filter(Boolean).forEach(seg => {
        const negrita = seg.startsWith('**');
        const contenido = negrita ? seg.slice(2, -2) : seg;
        contenido.split(' ').forEach((parte, i) => {
            if (i > 0 && actual.length) { palabras.push(actual); actual = []; }
            if (parte) actual.push({ t: parte, b: negrita });
        });
    });
    if (actual.length) palabras.push(actual);
    const ancho_ = (p) => p.reduce((s, r) => { doc.setFont("helvetica", r.b ? "bold" : "normal"); return s + doc.getTextWidth(r.t); }, 0);
    doc.setFont("helvetica", "normal");
    const espacio = doc.getTextWidth(' ');
    const lineas = [];
    let linea = [], anchoLinea = 0;
    palabras.forEach(p => {
        const w = ancho_(p);
        if (linea.length && anchoLinea + espacio + w > ancho) { lineas.push(linea); linea = []; anchoLinea = 0; }
        anchoLinea += (linea.length ? espacio : 0) + w; linea.push({ p, w });
    });
    if (linea.length) lineas.push(linea);
    lineas.forEach((l, i) => {
        if (y > limiteY) { doc.addPage(); y = margenSuperior; }
        const ultima = i === lineas.length - 1;
        const sumaPalabras = l.reduce((s, e) => s + e.w, 0);
        const separacion = (!ultima && l.length > 1) ? (ancho - sumaPalabras) / (l.length - 1) : espacio;
        let cx = x;
        l.forEach(e => {
            let px = cx;
            e.p.forEach(r => { doc.setFont("helvetica", r.b ? "bold" : "normal"); doc.text(r.t, px, y); px += doc.getTextWidth(r.t); });
            cx += e.w + separacion;
        });
        y += interlinea;
    });
    doc.setFont("helvetica", "normal");
    return y;
}

// Dibuja la cesión MEGAMEDIA en un PDF tamaño carta (igual al documento oficial digitalizado).
window.dibujarCesionMegamedia = function(doc, { fecha, nombre, rut, telefono, firma }) {
    const X = 30, ANCHO = 156, INTERLINEA = 3.9, LIMITE = 262, MARGEN_SUP = 22;
    doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text("CESION Y AUTORIZACION", X + ANCHO / 2, 27, null, null, "center");
    doc.setFontSize(9.5);
    let y = 38;
    PARRAFOS_CESION_MEGAMEDIA.forEach((p, i) => {
        y = escribirParrafoJustificado(doc, p, X, y, ANCHO, INTERLINEA, LIMITE, MARGEN_SUP);
        y += (i >= 2 && i <= 4) ? 3.5 : 2.2;
    });
    // Tabla final de datos y firma
    y += 8;
    if (y + 6 * 6.2 + 10 + 6.2 + 14 + 5 > 272) { doc.addPage(); y = MARGEN_SUP + 10; } // la tabla de firma no se corta entre páginas
    const fechaTexto = String(fecha || '').split('-').reverse().join('-');
    const filas = [["Fecha", fechaTexto], ["Nombre", nombre], ["RUT", rut], ["Empresa (si aplica)", ""], ["RUT (si aplica)", ""], ["Teléfono", telefono], ["Firma", ""]];
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    filas.forEach(([etiqueta, valor]) => {
        if (etiqueta === "Firma") y += 10; // espacio para que la firma quede sobre su línea sin tapar las filas de arriba
        doc.text(etiqueta, X, y);
        doc.text(":", X + 40, y);
        if (valor) { doc.setFont("helvetica", "bold"); doc.text(String(valor), X + 43, y); doc.setFont("helvetica", "normal"); }
        else doc.text("……………………………………………………………………", X + 43, y);
        if (etiqueta === "Firma" && firma) {
            try { doc.addImage(firma, 'JPEG', X + 48, y - 13.5, 44, 13); } catch (e) { console.error("Firma de cesión", e); }
        }
        y += 6.2;
    });
    // pp. MEGAMEDIA S.A.
    y += 14;
    doc.setLineWidth(0.3);
    doc.line(X + 85, y, X + 130, y);
    doc.text("pp. MEGAMEDIA S.A.", X + 107.5, y + 4.5, null, null, "center");
};

// Documento del botón PDF / respaldo: cesión MEGAMEDIA para cortesías o sin contrato (mayores de edad);
// contrato de trabajo en los demás casos. Los menores mantienen el documento anterior.
window.crearDocumentoIngreso = function(rut, trab, asis, fechaProg, nombreProg) {
    const { jsPDF } = window.jspdf;
    const esCesion = asis.tipo_ingreso === "Cortesía" || asis.aplica_contrato === false;
    let esMenor = false;
    if (trab && trab.fechaNacimiento) {
        const [a, m, d] = trab.fechaNacimiento.split('-').map(Number), [fa, fm, fd] = String(fechaProg).split('-').map(Number);
        let edad = fa - a; if (fm < m || (fm === m && fd < d)) edad--;
        esMenor = edad < 18;
    }
    if (esCesion && !esMenor) {
        const doc = new jsPDF({ format: 'letter' });
        window.dibujarCesionMegamedia(doc, { fecha: fechaProg, nombre: `${trab.nombres || ''} ${trab.apellidos || ''}`.trim().toUpperCase(), rut, telefono: trab.telefono || '', firma: asis.firma_digital });
        return doc;
    }
    const doc = new jsPDF({ format: 'legal' });
    dibujarContratoEnPDF(doc, rut, trab, asis, fechaProg, nombreProg);
    return doc;
};

function dibujarContratoEnPDF(doc, rut, trab, asis, fechaProg, nombreProg) {
    let y = 15; 
    doc.setFont("helvetica", "bold"); 
    doc.setFontSize(11);
    
    const mesNombres = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const [yearF, monthF, dayF] = fechaProg.split('-'); 
    const fechaTexto = `${dayF} de ${mesNombres[parseInt(monthF)-1]} de ${yearF}`;
    const fechaNac = trab.fechaNacimiento ? trab.fechaNacimiento.split('-').reverse().join('-') : '___________';
    const nombreCompleto = `${trab.nombres || ''} ${trab.apellidos || ''}`.toUpperCase();
    const direccion = trab.direccion ? trab.direccion.toUpperCase() : '_______________________';

    let titulo = ""; 
    let textoContrato = "";

    if (asis.aplica_contrato === false || asis.tipo_ingreso === "Cortesía") {
        titulo = "Acuerdo de Cesión de Derechos de Imagen y Voz";
        textoContrato = `En Santiago, a ${fechaTexto}, don/a ${nombreCompleto}, nacido/a el ${fechaNac}, cédula de identidad Nº ${rut}, domiciliado/a en calle ${direccion}, ciudad de Santiago, en adelante “el/la Cedente”, declara y acepta lo siguiente:

PRIMERO. El Cedente asiste a la producción "${nombreProg}" en calidad de invitado/a o extra sin relación de subordinación ni dependencia.

SEGUNDO. Por el presente acto, el Cedente autoriza a Camila Alejandra Fevre Seguel Produccion E.I.R.L de forma gratuita, irrevocable y sin límite territorial, la fijación, fijación audiovisual, reproducción y difusión de su imagen y voz captadas durante su asistencia a la producción.

TERCERO. Se deja expresa constancia de que la participación es voluntaria y no existe remuneración laboral asociada a este acuerdo.`;
    } else {
        titulo = "Contrato de Trabajo Extras Público (Televisión)";
        textoContrato = `En Santiago, a ${fechaTexto}, entre Camila Alejandra Fevre Seguel Produccion E.I.R.L, RUT 76.932.592-1, representada por don/a Camila Alejandra Fevre Seguel en su calidad de representante legal, cédula de identidad Nº 19.700.978-0, correo electrónico nat.producciones2020@gmail.com, ambos domiciliados en calle Carriel Sur, Nº 3106, comuna de Cerrillos, ciudad de Santiago, que en adelante se denominará “el/la empleador/a”, y don/a ${nombreCompleto}, de nacionalidad chilena, nacido/a el ${fechaNac}, cédula de identidad Nº ${rut}, de profesión u oficio Extra de Televisión, correo electrónico ${trab.email || '___________________________'}, domiciliado/a en ${direccion}, ciudad de Santiago, que en adelante se denominará “el/la trabajador/a”, se ha convenido el siguiente contrato de trabajo temporal, de acuerdo a lo señalado en el Artículo 145 A y siguientes del Código del Trabajo:

PRIMERO. El trabajador se compromete a desempeñar los servicios de Público para la producción "${nombreProg}", en adelante “La Producción”, que el empleador grabará en Canal de televisión Mega Media ubicado en Vicuña Mackenna 1348, Santiago, entre el ${fechaTexto}. Las funciones que comprende el rol de trabajador son las siguientes: Participar activamente en las etapas de realización del proyecto para el que fue contratado/a, lo que comprende ensayos y repeticiones u otras labores que deban desempeñarse acorde al rol.

SEGUNDO. El empleador podrá establecer el recinto donde deben prestarse los servicios, con la limitación que el nuevo sitio quede dentro de la misma ciudad o localidad donde se celebró el contrato y no ocasione un menoscabo al trabajador. Por su parte “el empleador” deberá costear el traslado, alimentación y alojamiento del trabajador, en condiciones adecuadas de higiene y seguridad, cuando las labores de preparación y/o las grabaciones deban realizarse en una ciudad distinta a la señalada en el presente contrato de trabajo como domicilio del trabajador.

TERCERO. El trabajador/a cumplirá una jornada ordinaria de trabajo que estará establecida en la citación a la jornada, que será entregado al trabajador/a con un mínimo anticipación 24 horas. La jornada diaria no excederá de 10 horas. Lo anterior, sin perjuicio de lo establecido en el Párrafo 2°, del Capítulo IV, del Título I, del Libro I, del Código del Trabajo, relativo a horas extraordinarias.

CUARTO. El empleador se compromete a pagar al trabajador $${asis.monto} por jornada el que será liquidado y pagado mediante transferencia bancaria.

QUINTO. El trabajador autoriza en este acto al empleador a filmar, divulgar, editar, grabar total o parcialmente su imagen y voz, sin restricciones ni límites temporales mediante cualquier soporte o medio de registro, reproducción o difusión.

SEXTO. La duración del presente contrato estará determinada por toda la duración de la jornada señalada, pudiendo tener término de acuerdo a las causales que la ley señala.

SÉPTIMO. El empleador se obliga a pagar la totalidad de obligaciones previsionales que establece la ley, debiendo retener de la remuneración bruta las cotizaciones que sean de cargo del trabajador, y enterarlas en la institución correspondiente.

OCTAVO. El empleador deberá registrar en el sitio electrónico de la Dirección del Trabajo el contrato de trabajo.

NOVENO. Se deja constancia que el trabajador ingresó al servicio del empleador, el día ${fechaTexto}.

DÉCIMO. El presente contrato se firma en dos ejemplares del mismo tenor y fecha.

UNDÉCIMO. De conformidad a la Ley N° 19.799 sobre Documentos Electrónicos y Firma Electrónica, el presente contrato se suscribe mediante Firma Electrónica Simple validada en plataforma.

DUODÉCIMO. El trabajador autoriza expresamente a la Productora para que la firma electrónica estampada en el presente instrumento sea almacenada y reutilizada para firmar el respectivo comprobante o recibo de pago de honorarios, sirviendo este como prueba plena de la recepción conforme de los dineros pactados.`;
    }

    doc.text(titulo, 105, y, null, null, "center"); 
    y += 15; 
    
    doc.setFont("helvetica", "normal"); 
    doc.setFontSize(10);
    
    const lineas = doc.splitTextToSize(textoContrato, 175); 
    doc.text(lineas, 20, y); 
    y += (lineas.length * 4.8) + 20; 

    doc.setFont("helvetica", "bold"); 
    doc.text("_________________________________", 50, y, null, null, "center"); 
    doc.text("Firma Producción", 50, y + 5, null, null, "center"); 
    doc.setFont("helvetica", "normal"); 
    doc.text("CAMILA FEVRE SEGUEL", 50, y + 10, null, null, "center"); 

    
    // Dibujar firma de Camila
    // La firma se carga desde Firebase (0_config/firma_produccion) al iniciar sesión
    if (window.firmaProduccion) {
        try {
            const firmaCamiLimpia = window.firmaProduccion.replace(/\s/g, '');
            let formatoCami = firmaCamiLimpia.toUpperCase().includes("IMAGE/PNG") ? "PNG" : "JPEG";
            const firmaCamiSrc = firmaCamiLimpia.startsWith("data:") ? firmaCamiLimpia : "data:image/jpeg;base64," + firmaCamiLimpia;
            doc.addImage(firmaCamiSrc, formatoCami, 10, y - 25, 80, 25);
        } catch(e) {
            console.error("Error al cargar firma de Producción", e);
        }
    } 

    doc.setFont("helvetica", "bold"); 
    if (asis.firma_digital) { 
        try { 
            doc.addImage(asis.firma_digital, 'JPEG', 115, y - 25, 80, 25); 
        } catch(e) { 
            console.error("Error firma"); 
        } 
    }
    
    doc.text("_________________________________", 155, y, null, null, "center"); 
    doc.text("Firma Asistente", 155, y + 5, null, null, "center"); 
    doc.setFont("helvetica", "normal"); 
    doc.text(nombreCompleto, 155, y + 10, null, null, "center");
    // RUT INCLUIDO BAJO LA FIRMA
    doc.text(`RUT: ${rut}`, 155, y + 15, null, null, "center"); 
}


// ==========================================
// CRM Y EDICIÓN
// ==========================================
if (document.getElementById('crm-tab')) document.getElementById('crm-tab').addEventListener('click', async () => {
    const [trabSnap, blackSnap] = await Promise.all([ 
        window.obtenerTrabajadores(), 
        get(ref(db, '4_blacklist')) 
    ]);
    
    listaGlobalCRM = trabSnap.exists() ? trabSnap.val() : {}; 
    blacklistGlobal = blackSnap.exists() ? blackSnap.val() : {}; 
    
    renderCRM(listaGlobalCRM);
});

function renderCRM(datos) {
    const tbody = document.getElementById('tablaCRM'); 
    if(!tbody) return;
    tbody.innerHTML = "";
    
    for (const rut in datos) {
        const p = datos[rut]; 
        const bloqueado = blacklistGlobal[rut] ? true : false;
        const estadoBadge = bloqueado ? '<span class="badge bg-danger">Bloqueado</span>' : '<span class="badge bg-success">Activo</span>';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escaparHTML(rut)}</td>
            <td>${escaparHTML(p.nombres)} ${escaparHTML(p.apellidos)}</td>
            <td>${escaparHTML(p.telefono || '-')}</td>
            <td>${estadoBadge}</td>
            <td><button class="btn btn-outline-info btn-sm" onclick="window.verPerfil('${rut}')">Editar / Ficha</button></td>
        `;
        tbody.appendChild(tr);
    }
}

if (document.getElementById('buscadorCRM')) document.getElementById('buscadorCRM').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtrados = Object.keys(listaGlobalCRM).reduce((acc, rut) => {
        const nombreCompl = `${listaGlobalCRM[rut].nombres} ${listaGlobalCRM[rut].apellidos}`.toLowerCase();
        if (rut.toLowerCase().includes(term) || nombreCompl.includes(term)) {
            acc[rut] = listaGlobalCRM[rut]; 
        }
        return acc;
    }, {}); 
    
    renderCRM(filtrados);
});

let rutPerfilActual = "";

window.verPerfil = async function(rut) {
    rutPerfilActual = rut; 
    const p = listaGlobalCRM[rut] || { nombres: '', apellidos: '', rut: rut };
    
    // Lecturas protegidas: si Firebase niega el permiso, la ficha se abre igual
    let strikesActuales = 0;
    try {
        const strSnap = await get(ref(db, `9_strikes/${rut}`));
        strikesActuales = strSnap.exists() ? (strSnap.val().count || 0) : 0;
    } catch (e) {
        console.warn("No se pudieron leer los strikes (revisar reglas de Firebase para 9_strikes)", e);
    }
    
    let progBansSnap = { exists: () => false, val: () => null };
    try {
        progBansSnap = await get(ref(db, `4_blacklist_programas`));
    } catch (e) {
        console.warn("No se pudieron leer los bloqueos por programa (revisar reglas de Firebase)", e);
    }
    let programasBloqueados = [];
    if (progBansSnap.exists()) {
        const allBans = progBansSnap.val();
        for (const progName in allBans) {
            if (allBans[progName][rut]) {
                programasBloqueados.push(progName);
            }
        }
    }
    
    const contenido = document.getElementById('contenidoFicha');
    if (contenido) contenido.innerHTML = `
        <div class="row">
            <div class="col-6 mb-2"><label class="text-muted small">Nombres</label><input type="text" class="form-control bg-dark text-white" id="editNombres" value="${escaparHTML(p.nombres || '')}"></div>
            <div class="col-6 mb-2"><label class="text-muted small">Apellidos</label><input type="text" class="form-control bg-dark text-white" id="editApellidos" value="${escaparHTML(p.apellidos || '')}"></div>
            <div class="col-6 mb-2"><label class="text-muted small">RUT</label><input type="text" class="form-control bg-secondary text-white" value="${escaparHTML(p.rut || rut)}" readonly></div>
            <div class="col-6 mb-2"><label class="text-muted small">Fecha Nacimiento</label><input type="date" class="form-control bg-dark text-white" id="editNacimiento" value="${escaparHTML(p.fechaNacimiento || '')}"></div>
            <div class="col-6 mb-2"><label class="text-muted small">Teléfono</label><input type="text" class="form-control bg-dark text-white" id="editTel" value="${escaparHTML(p.telefono || '')}"></div>
            <div class="col-6 mb-2"><label class="text-muted small">Correo Electrónico</label><input type="email" class="form-control bg-dark text-white" id="editEmail" value="${escaparHTML(p.email || '')}"></div>
            <div class="col-12 mb-2"><label class="text-muted small">Dirección</label><input type="text" class="form-control bg-dark text-white" id="editDir" value="${escaparHTML(p.direccion || '')}"></div>
            <div class="col-6 mb-2"><label class="text-muted small text-warning">Contacto Emergencia</label><input type="text" class="form-control bg-dark text-white border-warning" id="editEmergenciaNombre" value="${escaparHTML(p.emergenciaNombre || '')}" placeholder="Nombre del contacto"></div>
            <div class="col-6 mb-2"><label class="text-muted small text-warning">Tel. de Emergencia</label><input type="text" class="form-control bg-dark text-white border-warning" id="editEmergenciaTelefono" value="${escaparHTML(p.emergenciaTelefono || '')}" placeholder="Número"></div>
            <div class="col-12 mb-3"><label class="text-muted small text-danger">Enfermedades Base / Alergias</label><input type="text" class="form-control bg-dark text-white border-danger" id="editEnfermedades" value="${escaparHTML(p.enfermedades || '')}" placeholder="Indicar patologías o 'Ninguna'"></div>
            
            <div class="col-6 mb-2"><label class="text-muted small text-success fw-bold">Menú Almuerzo</label>
                <select class="form-select bg-dark text-white border-success" id="editEsVegetariano">
                    <option value="No" ${p.esVegetariano==='No'?'selected':''}>Normal</option>
                    <option value="Sí" ${p.esVegetariano==='Sí'?'selected':''}>Vegetariano</option>
                </select>
            </div>
            <div class="col-6 mb-2"><label class="text-muted small">Sexo</label>
                <select class="form-select bg-dark text-white" id="editSexo">
                    <option value="M" ${p.sexo==='M'?'selected':''}>Masculino</option>
                    <option value="F" ${p.sexo==='F'?'selected':''}>Femenino</option>
                    <option value="Otro" ${p.sexo==='Otro'?'selected':''}>Otro</option>
                </select>
            </div>
            
            <div class="col-6 mb-2"><label class="text-muted small">AFP</label>
                <select class="form-select bg-dark text-white" id="editAfp">
                    <option value="No cotizo / No sé" ${p.afp==='No cotizo / No sé'?'selected':''}>No cotizo / No sé</option>
                    <option value="CAPITAL" ${p.afp==='CAPITAL'?'selected':''}>Capital</option>
                    <option value="CUPRUM" ${p.afp==='CUPRUM'?'selected':''}>Cuprum</option>
                    <option value="HABITAT" ${p.afp==='HABITAT'?'selected':''}>Habitat</option>
                    <option value="MODELO" ${p.afp==='MODELO'?'selected':''}>Modelo</option>
                    <option value="PLANVITAL" ${p.afp==='PLANVITAL'?'selected':''}>PlanVital</option>
                    <option value="PROVIDA" ${p.afp==='PROVIDA'?'selected':''}>ProVida</option>
                    <option value="UNO" ${p.afp==='UNO'?'selected':''}>Uno</option>
                    <option value="NO_COTIZA" ${p.afp==='NO_COTIZA'?'selected':''}>No cotiza (0%)</option>
                </select>
            </div>
            <div class="col-6 mb-2"><label class="text-muted small">Salud</label>
                <select class="form-select bg-dark text-white" id="editSalud">
                    <option value="FONASA" ${p.salud==='FONASA'?'selected':''}>Fonasa</option>
                    <option value="BANMEDICA" ${p.salud==='BANMEDICA'?'selected':''}>Banmédica</option>
                    <option value="COLMENA" ${p.salud==='COLMENA'?'selected':''}>Colmena</option>
                    <option value="CONSALUD" ${p.salud==='CONSALUD'?'selected':''}>Consalud</option>
                    <option value="CRUZBLANCA" ${p.salud==='CRUZBLANCA'?'selected':''}>Cruz Blanca</option>
                    <option value="ESENCIAL" ${p.salud==='ESENCIAL'?'selected':''}>Esencial</option>
                    <option value="NUEVAMASVIDA" ${p.salud==='NUEVAMASVIDA'?'selected':''}>Nueva Masvida</option>
                    <option value="VIDATRES" ${p.salud==='VIDATRES'?'selected':''}>Vida Tres</option>
                </select>
            </div>
            <div class="col-6 mb-2"><label class="text-muted small">Banco</label>
                <select class="form-select bg-dark text-white" id="editBanco">
                    <option value="ESTADO" ${p.banco==='ESTADO'?'selected':''}>Banco Estado</option>
                    <option value="CHILE" ${p.banco==='CHILE'?'selected':''}>Banco de Chile</option>
                    <option value="BCI" ${p.banco==='BCI'?'selected':''}>BCI</option>
                    <option value="SANTANDER" ${p.banco==='SANTANDER'?'selected':''}>Santander</option>
                    <option value="ITAU" ${p.banco==='ITAU'?'selected':''}>Itaú</option>
                    <option value="SCOTIABANK" ${p.banco==='SCOTIABANK'?'selected':''}>Scotiabank</option>
                    <option value="BICE" ${p.banco==='BICE'?'selected':''}>BICE</option>
                    <option value="SECURITY" ${p.banco==='SECURITY'?'selected':''}>Security</option>
                    <option value="CONSORCIO" ${p.banco==='CONSORCIO'?'selected':''}>Consorcio</option>
                    <option value="RIPLEY" ${p.banco==='RIPLEY'?'selected':''}>Ripley</option>
                    <option value="MERCADOPAGO" ${p.banco==='MERCADOPAGO'?'selected':''}>Mercado Pago</option>
                </select>
            </div>
            <div class="col-6 mb-2"><label class="text-muted small">Tipo de Cuenta</label>
                <select class="form-select bg-dark text-white" id="editTipoCuenta">
                    <option value="CUENTA_RUT" ${p.tipoCuenta==='CUENTA_RUT'?'selected':''}>Cuenta RUT</option>
                    <option value="CUENTA_CORRIENTE" ${p.tipoCuenta==='CUENTA_CORRIENTE'?'selected':''}>Cuenta Corriente</option>
                    <option value="CUENTA_VISTA" ${p.tipoCuenta==='CUENTA_VISTA'?'selected':''}>Cuenta Vista / Ahorro</option>
                </select>
            </div>
            <div class="col-6 mb-2"><label class="text-muted small">N° Cuenta</label><input type="text" class="form-control bg-dark text-white" id="editCuenta" value="${escaparHTML(p.numeroCuenta || '')}"></div>
            <div class="col-12 mt-4 pt-3 border-top border-secondary">
                <h6 class="text-danger fw-bold mb-2">🛑 Sanciones y Bloqueos</h6>
                <div class="d-flex justify-content-between align-items-center mb-2 p-2 bg-dark rounded border border-danger">
                    <div>
                        <span class="text-white">Strikes por Inasistencia:</span>
                        <span class="badge bg-warning text-dark fs-6 ms-2" id="displayStrikes">${strikesActuales}</span>
                    </div>
                    <div>
                        <button class="btn btn-outline-success btn-sm" onclick="window.modificarStrikes('${rut}', -1)">- Quitar</button>
                        <button class="btn btn-outline-danger btn-sm" onclick="window.modificarStrikes('${rut}', 1)">+ Añadir</button>
                    </div>
                </div>
                
                <div class="mb-3 p-2 bg-dark rounded border border-warning">
                    <label class="text-white mb-1 small">Bloquear de un programa específico:</label>
                    <div class="input-group">
                        <select class="form-select bg-dark text-white" id="selectProgBloqueo">
                            <option value="Dale Play">Dale Play</option>
                            <option value="Coliseo">Coliseo</option>
                            <option value="Detrás del Muro">Detrás del Muro</option>
                            <option value="Only Fama">Only Fama</option>
                            <option value="Otro">Otro (Escribir)</option>
                        </select>
                        <button class="btn btn-warning text-dark fw-bold" onclick="window.bloquearPrograma('${rut}')">Bloquear</button>
                    </div>
                    <div class="mt-2 text-muted small">
                        Bloqueos vigentes: ${programasBloqueados.length > 0 ? programasBloqueados.map(pr => `<span class="badge bg-danger me-1 mb-1">${pr} <span style="cursor:pointer;" onclick="window.desbloquearPrograma('${rut}', '${pr}')">✖</span></span>`).join('') : 'Ninguno'}
                    </div>
                </div>
            </div>

            <div class="col-12 mt-4 pt-3 border-top border-secondary">
                <h6 class="text-info fw-bold mb-2">🔑 PIN personal (autocompletado)</h6>
                <div class="d-flex justify-content-between align-items-center p-2 bg-dark rounded border border-info">
                    <span class="text-white">${p.tiene_pin ? '✅ Tiene PIN configurado' : '⚪ Sin PIN: lo creará en el iPad la próxima vez que firme'}</span>
                    ${p.tiene_pin ? `<button class="btn btn-outline-warning btn-sm fw-bold" onclick="window.resetearPinPersonal('${rut}')">Resetear PIN</button>` : ''}
                </div>
            </div>

            <div class="col-12 mt-4 pt-3 border-top border-secondary">
                <h6 class="text-info fw-bold mb-2">🛠️ Herramienta Administrativa</h6>
                <p class="text-muted small mb-2">Si olvidaste escanear a esta persona y el día ya se cerró, puedes forzar su asistencia aquí.</p>
                <button class="btn btn-outline-info w-100 fw-bold shadow-sm" onclick="window.forzarIngresoPasado('${rut}', '${(p.nombres || "Desconocido").replace(/['"`]/g, '')}')">
                    ➕ Añadir a Jornada Pasada
                </button>
            </div>
        </div>`;
    
    if (blacklistGlobal[rut]) {
        if (document.getElementById('motivoBloqueo')) document.getElementById('motivoBloqueo').classList.add('d-none'); 
        if (document.getElementById('btnBloquear')) document.getElementById('btnBloquear').classList.add('d-none'); 
        if (document.getElementById('btnDesbloquear')) document.getElementById('btnDesbloquear').classList.remove('d-none');
    } else {
        if (document.getElementById('motivoBloqueo')) document.getElementById('motivoBloqueo').classList.remove('d-none'); 
        if (document.getElementById('motivoBloqueo')) document.getElementById('motivoBloqueo').value = ""; 
        if (document.getElementById('btnBloquear')) document.getElementById('btnBloquear').classList.remove('d-none'); 
        if (document.getElementById('btnDesbloquear')) document.getElementById('btnDesbloquear').classList.add('d-none');
    }
    
    if(!modalFichaInstance) {
        modalFichaInstance = new bootstrap.Modal(document.getElementById('modalFicha'));
    }
    modalFichaInstance.show();
}


window.forzarIngresoPasado = async function(rut, nombre) {
    let fec = prompt(`Vas a ingresar a ${nombre} a una jornada pasada.\n\nIngresa la FECHA EXACTA (Ej: 2026-09-10):`, new Date().toISOString().split('T')[0]);
    if(!fec) return;
    
    let prog = prompt("Ingresa el NOMBRE EXACTO del programa (Ej: Detrás del Muro):", "Detrás del Muro");
    if(!prog) return;
    
    let monto = prompt(`¿Cuánto se le debe pagar a ${nombre} por ese día? (Sin puntos, ej: 10000)`, "10000");
    if(!monto) return;
    
    if(!confirm(`¿Seguro que deseas inyectar a ${nombre} en el programa ${prog} del día ${fec} por $${monto}?`)) return;
    
    let esMenor = false;
    const pInfo = listaGlobalCRM[rut];
    if (pInfo && pInfo.fechaNacimiento) {
        const [y, m, d] = pInfo.fechaNacimiento.split('-');
        const hoy = new Date();
        const cumple = new Date(y, m - 1, d);
        let edad = hoy.getFullYear() - cumple.getFullYear();
        if (hoy.getMonth() - cumple.getMonth() < 0 || (hoy.getMonth() - cumple.getMonth() === 0 && hoy.getDate() < cumple.getDate())) { edad--; }
        if (edad < 18) esMenor = true;
    }

    try {
        const snap = await get(ref(db, `2_asistencias/${fec}/${prog}`));
        let numReal = 0;
        if (snap.exists()) {
            let asistentes = snap.val();
            for (const r in asistentes) {
                let n = parseInt(asistentes[r].numero_asignado) || 0;
                if (n > numReal) numReal = n;
            }
        }
        const numeroFinal = numReal + 1;
        
        window.limpiarCache();
        await set(ref(db, `2_asistencias/${fec}/${prog}/${rut}`), {
            rut: rut,
            nombre_programa: prog,
            monto: parseInt(monto),
            tipo_ingreso: "Pago",
            hora_ingreso: "10:00", // Hora genérica
            hora_salida: "20:00",  // Hora genérica para que cuente como día completo
            bono_horas_extras: 0,
            firma_digital: "", // Sin firma, ingreso administrativo
            estado_pago: "Pendiente",
            numero_asignado: numeroFinal,
            invitado_por: "Administración",
            aplica_contrato: !esMenor,
            estado_dt: "Pendiente",
            ingreso_administrativo: true
        });
        
        alert(`✅ ¡Éxito! ${nombre} fue agregado a la jornada del ${fec}.\nSi vas a Finanzas o Efectivo, ya le aparecerá la deuda para pagar.`);
        
    } catch(e) {
        alert("Error al inyectar: " + e.message);
    }
}

if (document.getElementById('btnGuardarEdicion')) document.getElementById('btnGuardarEdicion').addEventListener('click', async () => {
    try {
        window.limpiarCache();
        await window.guardarCamposFicha(rutPerfilActual, {
            nombres: document.getElementById('editNombres').value, 
            apellidos: document.getElementById('editApellidos').value,
            fechaNacimiento: document.getElementById('editNacimiento').value,
            telefono: document.getElementById('editTel').value, 
            email: document.getElementById('editEmail').value,
            direccion: document.getElementById('editDir').value,
            emergenciaNombre: document.getElementById('editEmergenciaNombre').value,
            emergenciaTelefono: document.getElementById('editEmergenciaTelefono').value,
            enfermedades: document.getElementById('editEnfermedades').value,
            esVegetariano: document.getElementById('editEsVegetariano') ? document.getElementById('editEsVegetariano').value : 'No',
            sexo: document.getElementById('editSexo').value,
            afp: document.getElementById('editAfp').value, 
            salud: document.getElementById('editSalud').value,
            banco: document.getElementById('editBanco').value, 
            tipoCuenta: document.getElementById('editTipoCuenta').value,
            numeroCuenta: document.getElementById('editCuenta').value
        });
        
        alert("Datos actualizados correctamente."); 
        listaGlobalCRM[rutPerfilActual] = await window.leerFichaCompleta(rutPerfilActual);
        renderCRM(listaGlobalCRM); 
        modalFichaInstance.hide();
    } catch (e) { 
        alert("Error al guardar."); 
    }
});

if (document.getElementById('btnEliminarTrabajador')) document.getElementById('btnEliminarTrabajador').addEventListener('click', async () => {
    if(confirm("🚨 ¿ESTÁS SEGURO? 🚨\nEsto borrará a la persona de la base de datos para siempre.")) {
        const autoKey = (await get(ref(db, `1p_privado/${rutPerfilActual}/auto_key`))).val();
        const borrar = {
            [`1_trabajadores/${rutPerfilActual}`]: null,
            [`1p_privado/${rutPerfilActual}`]: null
        };
        if (autoKey) borrar[`1a_autocompletar/${autoKey}`] = null;
        await update(ref(db), borrar);
        window.limpiarCache();
        delete listaGlobalCRM[rutPerfilActual]; 
        renderCRM(listaGlobalCRM); 
        modalFichaInstance.hide(); 
        alert("Trabajador eliminado.");
    }
});

if (document.getElementById('btnBloquear')) document.getElementById('btnBloquear').addEventListener('click', async () => {
    const motivo = document.getElementById('motivoBloqueo').value.trim(); 
    if(!motivo) return alert("Debes escribir un motivo.");
    
    if(confirm("¿Bloquear permanentemente a este usuario?")) {
        // Motivo y fecha (solo staff/admin) + marca pública sí/no para el formulario, en una sola operación
        await update(ref(db), {
            [`4_blacklist/${rutPerfilActual}`]: { fecha: new Date().toISOString(), motivo: motivo },
            [`4_bloqueados/${rutPerfilActual}`]: true
        });
        blacklistGlobal[rutPerfilActual] = { motivo: motivo }; 
        modalFichaInstance.hide(); 
        renderCRM(listaGlobalCRM); 
        alert("Usuario bloqueado.");
    }
});

if (document.getElementById('btnDesbloquear')) document.getElementById('btnDesbloquear').addEventListener('click', async () => {
    if(confirm("¿Quitar de la lista negra?")) {
        await update(ref(db), { [`4_blacklist/${rutPerfilActual}`]: null, [`4_bloqueados/${rutPerfilActual}`]: null }); 
        delete blacklistGlobal[rutPerfilActual]; 
        modalFichaInstance.hide(); 
        renderCRM(listaGlobalCRM); 
        alert("Usuario desbloqueado.");
    }
});


// "Olvidé mi PIN": el admin lo borra y la persona crea uno nuevo en el iPad al firmar
window.resetearPinPersonal = async function(rut) {
    if (!confirm("¿Resetear el PIN de esta persona?\n\nSu autocompletado dejará de funcionar hasta que cree un PIN nuevo en el iPad la próxima vez que firme.")) return;
    try {
        const autoKey = (await get(ref(db, `1p_privado/${rut}/auto_key`))).val();
        const updates = {
            [`1p_privado/${rut}/pin_hash`]: null,
            [`1p_privado/${rut}/verif`]: null,
            [`1p_privado/${rut}/auto_key`]: null,
            [`1_trabajadores/${rut}/tiene_pin`]: false
        };
        if (autoKey) updates[`1a_autocompletar/${autoKey}`] = null;
        await update(ref(db), updates);
        if (listaGlobalCRM[rut]) listaGlobalCRM[rut].tiene_pin = false;
        window.limpiarCache();
        alert("✅ PIN reseteado.");
        if (modalFichaInstance) modalFichaInstance.hide();
    } catch (e) {
        console.error(e);
        alert("❌ No se pudo resetear el PIN.");
    }
};

window.modificarStrikes = async function(rut, cant) {
    const strRef = ref(db, `9_strikes/${rut}/count`);
    let nuevo = 0;
    try {
        const snap = await get(strRef);
        let actual = snap.exists() ? snap.val() : 0;
        nuevo = actual + cant;
        if (nuevo < 0) nuevo = 0;
        await set(strRef, nuevo);
    } catch (e) {
        console.error("Error modificando strikes", e);
        return alert("⚠️ No se pudo modificar los strikes: Firebase no da permiso sobre '9_strikes'. Hay que agregar esa regla en Firebase.");
    }
    if (nuevo >= 3) {
        if(confirm(`Esta persona ha alcanzado ${nuevo} strikes. ¿Deseas bloquearla GLOBALMENTE (Blacklist)?`)) {
            await update(ref(db), {
                [`4_blacklist/${rut}`]: { fecha: new Date().toISOString(), motivo: "Alcanzó 3 strikes manualmente." },
                [`4_bloqueados/${rut}`]: true
            });
        }
    }
    const display = document.getElementById('displayStrikes');
    if (display) display.innerText = nuevo;
};

window.bloquearPrograma = async function(rut) {
    let prog = document.getElementById('selectProgBloqueo').value;
    if (prog === "Otro") prog = prompt("Escribe el nombre del programa a bloquear:");
    if (!prog) return;
    
    try {
        await set(ref(db, `4_blacklist_programas/${prog}/${rut}`), {
            fecha: new Date().toISOString(),
            motivo: "Bloqueo específico de programa por administración."
        });
    } catch (e) {
        console.error("Error bloqueando programa", e);
        return alert("⚠️ No se pudo bloquear: Firebase no da permiso sobre '4_blacklist_programas'.");
    }
    alert(`Bloqueado exitosamente de ${prog}. Cierra y vuelve a abrir la ficha para ver los cambios.`);
};

window.desbloquearPrograma = async function(rut, prog) {
    if(confirm(`¿Desbloquear a esta persona de ${prog}?`)) {
        try {
            await remove(ref(db, `4_blacklist_programas/${prog}/${rut}`));
        } catch (e) {
            console.error("Error desbloqueando programa", e);
            return alert("⚠️ No se pudo desbloquear: Firebase no da permiso sobre '4_blacklist_programas'.");
        }
        alert(`Desbloqueado de ${prog}. Cierra y vuelve a abrir la ficha.`);
    }
};

// ==========================================
// FINANZAS Y BÓVEDA
// ==========================================
if (document.getElementById('finanzas-tab')) document.getElementById('finanzas-tab').addEventListener('click', async () => {
    const snap = await window.obtenerAsistencias(); 
    if (!snap.exists()) return;
    
    const trabSnap = await window.obtenerTrabajadores(); 
    if (trabSnap.exists()) listaGlobalCRM = trabSnap.val();
    
    let deudas = {}; 
    const todas = snap.val();
    
    for (const fecha in todas) { 
        for (const prog in todas[fecha]) { 
            for (const r in todas[fecha][prog]) {
                const asis = todas[fecha][prog][r];
                
                const montoLimpio = parseInt(String(asis.monto).replace(/\D/g, '')) || 0;
                
                if (asis.estado_pago === "Pendiente" && montoLimpio > 0) {
                    if (!deudas[r]) deudas[r] = { monto: 0, dias: 0, rutas_bd: [] };
                    deudas[r].monto += montoLimpio; 
                    deudas[r].dias += 1; 
                    deudas[r].rutas_bd.push(`2_asistencias/${fecha}/${prog}/${r}`);
                }
            }
        }
    }
    
    window.deudasGlobales = deudas; 
    const tbody = document.getElementById('tablaDeudas'); 
    if(tbody) {
        tbody.innerHTML = "";
        
        for (const r in deudas) {
            const tr = listaGlobalCRM[r] || { nombres: "Desconocido", apellidos: "" }; 
            const fila = document.createElement('tr');
            fila.innerHTML = `
                <td>${r}</td>
                <td>${tr.nombres} ${tr.apellidos}</td>
                <td><span class="badge bg-secondary">${deudas[r].dias} días</span></td>
                <td class="text-success fw-bold fs-5">$${deudas[r].monto}</td>
            `; 
            tbody.appendChild(fila);
        }
    }
});

if (document.getElementById('btnLiquidarSemana')) document.getElementById('btnLiquidarSemana').addEventListener('click', async () => {
    if (!window.deudasGlobales || Object.keys(window.deudasGlobales).length === 0) {
        return alert("No hay plata retenida.");
    }
    
    if (!confirm(`🚨 ATENCIÓN 🚨\n\n¿Liquidar TODOS los pagos pendientes en la bóveda y descargar el archivo del banco?`)) return;
    
    const fechaHoy = new Date().toISOString().split('T')[0];
    let csv = "﻿Cuenta origen;Moneda origen;Cuenta destino;Moneda destino;Código banco destino;RUT beneficiario;Nombre beneficiario;Monto transferir;Glosa personalizada transferencia;Correo beneficiario;Mensaje correo;Glosa cartola originador;Glosa cartola beneficiario\n";
    let actualizacionesFirebase = {};
    
    const trabSnap = await window.obtenerTrabajadores(); 
    if (trabSnap.exists()) listaGlobalCRM = trabSnap.val();
    
    for (const r in window.deudasGlobales) {
        const deuda = window.deudasGlobales[r]; 
        const tr = listaGlobalCRM[r] || await window.leerFichaCompleta(r);
        
        if (tr) { 
            const rutSin = r.replace(/[^0-9kK]/g, ''); 
            csv += `96225970;CLP;${tr.numeroCuenta || ''};CLP;${mapaBancos[tr.banco] || ''};${rutSin};${tr.nombres} ${tr.apellidos};${deuda.monto};;${tr.email || ''};;Pago Acumulado;PAGO NAT\n`; 
        }
        for (const ruta of deuda.rutas_bd) { 
            actualizacionesFirebase[`${ruta}/estado_pago`] = "Pagado"; 
        }
    }
    
    try { 
        await update(ref(db), actualizacionesFirebase);
        window.limpiarCache(); 
        descargarCSV(csv, `Nomina_Semanal_Acumulada_${fechaHoy}.csv`); 
        alert("¡Liquidación exitosa!"); 
        if (document.getElementById('tablaDeudas')) document.getElementById('tablaDeudas').innerHTML = ""; 
        window.deudasGlobales = {}; 
    } catch (error) { 
        alert("Error al liquidar."); 
    }
});

let modalPagosInstance;

if (document.getElementById('btnExcelBanco')) document.getElementById('btnExcelBanco').addEventListener('click', async () => {
    const btn = document.getElementById('btnExcelBanco');
    btn.innerText = "⏳ Buscando pendientes..."; 
    btn.disabled = true;

    try {
        const snap = await window.obtenerAsistencias();
        if (!snap.exists()) { 
            alert("No hay asistencias registradas en el sistema."); 
            btn.innerText = "Generar Nómina de Pago"; 
            btn.disabled = false; 
            return; 
        }

        const todas = snap.val(); 
        let programasPendientes = {};
        
        for (const fecha in todas) {
            for (const prog in todas[fecha]) {
                let tienePendientes = false; 
                let cantidadPersonas = 0; 
                let montoTotalPrograma = 0;
                
                for (const r in todas[fecha][prog]) {
                    const asis = todas[fecha][prog][r];
                    const montoLimpio = parseInt(String(asis.monto).replace(/\D/g, '')) || 0;
                    
                    if (asis.estado_pago === "Pendiente" && montoLimpio > 0) {
                        tienePendientes = true; 
                        cantidadPersonas++; 
                        montoTotalPrograma += montoLimpio;
                    }
                }
                
                if (tienePendientes) {
                    programasPendientes[`${fecha}|${prog}`] = { fecha, prog, cantidadPersonas, montoTotalPrograma };
                }
            }
        }

        const contenedor = document.getElementById('listaProgramasPendientes');
        if (Object.keys(programasPendientes).length === 0) {
            contenedor.innerHTML = "<div class='alert alert-success text-center fw-bold'>✅ No hay pagos pendientes en el sistema. Todo está al día.</div>";
            if (document.getElementById('btnGenerarNominaBanco')) document.getElementById('btnGenerarNominaBanco').classList.add('d-none');
        } else {
            if (document.getElementById('btnGenerarNominaBanco')) document.getElementById('btnGenerarNominaBanco').classList.remove('d-none');
            let html = "";
            Object.keys(programasPendientes).sort().reverse().forEach(key => {
                const p = programasPendientes[key];
                html += `
                <div class="form-check" style="background: #1a1a1a; padding: 12px 15px 12px 40px; border: 1px solid #444; border-radius: 8px;">
                    <input class="form-check-input check-pago" type="checkbox" value="${key}" id="chk_pago_${key}" style="transform: scale(1.4); margin-top: 5px; cursor: pointer;">
                    <label class="form-check-label ms-2 text-white w-100" for="chk_pago_${key}" style="cursor: pointer; display: flex; justify-content: space-between;">
                        <span>📅 ${p.fecha} | 🎬 ${p.prog.replace(" - ", " / ")}</span>
                        <span class="badge bg-warning text-dark border border-warning">${p.cantidadPersonas} personas ($${p.montoTotalPrograma})</span>
                    </label>
                </div>`;
            });
            contenedor.innerHTML = html;
        }
        
        if (!modalPagosInstance) {
            modalPagosInstance = new bootstrap.Modal(document.getElementById('modalPagosBanco'));
        }
        modalPagosInstance.show();
        
    } catch (e) { 
        alert("Error al cargar los pagos pendientes."); 
    }
    
    btn.innerText = "Generar Nómina de Pago"; 
    btn.disabled = false;
});

if (document.getElementById('btnGenerarNominaBanco')) document.getElementById('btnGenerarNominaBanco').addEventListener('click', async () => {
    const checkboxes = document.querySelectorAll('.check-pago:checked');
    const seleccionados = Array.from(checkboxes).map(cb => cb.value);

    if (seleccionados.length === 0) return alert("Debes seleccionar al menos un programa para pagar.");
    if (!confirm(`¿Generar nómina agrupando los ${seleccionados.length} programas seleccionados y marcarlos como PAGADOS en el sistema?`)) return;

    try {
        const [asisSnap, trabSnap] = await Promise.all([ 
            window.obtenerAsistencias(), 
            window.obtenerTrabajadores() 
        ]);
        
        const todas = asisSnap.val(); 
        const trabajadores = trabSnap.exists() ? trabSnap.val() : {};
        let agrupacionPagos = {}; 
        let actualizacionesFirebase = {};

        seleccionados.forEach(clave => {
            const [fecha, prog] = clave.split('|');
            const asistentes = todas[fecha][prog];
            
            for (const r in asistentes) {
                const asis = asistentes[r];
                const montoLimpio = parseInt(String(asis.monto).replace(/\D/g, '')) || 0;
                
                if (asis.estado_pago === "Pendiente" && montoLimpio > 0) {
                    if (!agrupacionPagos[r]) {
                        agrupacionPagos[r] = { montoTotal: 0, programas: [], rutasFirebase: [] };
                    }
                    agrupacionPagos[r].montoTotal += montoLimpio;
                    
                    if (!agrupacionPagos[r].programas.includes(prog)) {
                        agrupacionPagos[r].programas.push(prog);
                    }
                    agrupacionPagos[r].rutasFirebase.push(`2_asistencias/${fecha}/${prog}/${r}/estado_pago`);
                }
            }
        });

        let csv = "﻿Cuenta origen;Moneda origen;Cuenta destino;Moneda destino;Código banco destino;RUT beneficiario;Nombre beneficiario;Monto transferir;Glosa personalizada transferencia;Correo beneficiario;Mensaje correo;Glosa cartola originador;Glosa cartola beneficiario\n";

        for (const rut in agrupacionPagos) {
            const datosPago = agrupacionPagos[rut]; 
            const tr = trabajadores[rut] || { nombres: "Desconocido", apellidos: "" };
            const rutSin = rut.replace(/[^0-9kK]/g, ''); 
            const glosaProg = datosPago.programas.join(', ').substring(0, 40);
            
            csv += `96225970;CLP;${tr.numeroCuenta || ''};CLP;${mapaBancos[tr.banco] || ''};${rutSin};${tr.nombres} ${tr.apellidos};${datosPago.montoTotal};;${tr.email || ''};;${glosaProg};PAGO NAT\n`;
            
            datosPago.rutasFirebase.forEach(ruta => { 
                actualizacionesFirebase[ruta] = "Pagado"; 
            });
        }

        await update(ref(db), actualizacionesFirebase);
        window.limpiarCache();
        descargarCSV(csv, `Nomina_Banco_Agrupada_${new Date().toISOString().split('T')[0]}.csv`);
        
        alert("¡Nómina generada con éxito! Revisa tus descargas.");
        modalPagosInstance.hide(); 
        if (document.getElementById('finanzas-tab')) document.getElementById('finanzas-tab').click();
        
    } catch (e) { 
        alert("Error al procesar y descargar los pagos."); 
    }
});

function descargarCSV(c, n) { 
    const url = URL.createObjectURL(new Blob([c], { type: 'text/csv;charset=utf-8;' })); 
    const a = document.createElement("a"); 
    a.href = url; 
    a.download = n; 
    a.click(); 
}

// ==========================================
// EFECTIVO (REDISEÑADO: LISTADO + RECICLAJE DE FIRMAS)
// ==========================================
let rutEfectivoActual = "";
let deudaEfectivoActual = null;
let firmaRecicladaBase64 = null;

// Escuchar clic en la pestaña para cargar la lista
const tabEfectivo = document.getElementById('efectivo-tab');
if (tabEfectivo) tabEfectivo.addEventListener('click', cargarListaEfectivo);

async function cargarListaEfectivo() {
    let containerLista = document.getElementById('contenedorListaEfectivo');
    if (!containerLista) {
        const inputRef = document.getElementById('rutEfectivo');
        if(!inputRef) return;
        const searchBoxParent = inputRef.parentElement.parentElement;
        containerLista = document.createElement('div');
        containerLista.id = 'contenedorListaEfectivo';
        searchBoxParent.parentElement.insertBefore(containerLista, searchBoxParent.nextSibling);
    }
    
    containerLista.innerHTML = '<div class="alert alert-warning text-center mt-4 fw-bold">⏳ Buscando personas con pagos pendientes en efectivo...</div>';
    
    try {
        const [asisSnap, trabSnap] = await Promise.all([
            window.obtenerAsistencias(),
            window.obtenerTrabajadores()
        ]);
        
        if (!asisSnap.exists()) {
            containerLista.innerHTML = '<div class="alert alert-success text-center mt-4 fw-bold">✅ No hay pagos pendientes en el sistema.</div>';
            return;
        }
        
        const todas = asisSnap.val();
        const trabajadores = trabSnap.exists() ? trabSnap.val() : {};
        let deudasEfectivo = {};
        
        // Recorrer asistencias para armar el consolidado
        for (const f in todas) {
            for (const p in todas[f]) {
                for (const r in todas[f][p]) {
                    const asis = todas[f][p][r];
                    const montoLimpio = parseInt(String(asis.monto).replace(/\D/g, '')) || 0;
                    
                    if (asis.estado_pago === "Pendiente" && montoLimpio > 0) {
                        if (!deudasEfectivo[r]) {
                            deudasEfectivo[r] = {
                                rut: r,
                                montoTotal: 0,
                                programasDetalle: [],
                                firma: asis.firma_digital || null,
                                ticketsResumen: []
                            };
                        }
                        deudasEfectivo[r].montoTotal += montoLimpio;
                        
                        const numTicket = asis.numero_asignado ? asis.numero_asignado : "S/T";
                        if (!deudasEfectivo[r].ticketsResumen.includes(numTicket)) {
                            deudasEfectivo[r].ticketsResumen.push(numTicket);
                        }

                        deudasEfectivo[r].programasDetalle.push({
                            fecha: f,
                            prog: p,
                            nombreStr: `${p.replace(" - ", " / ")} (${f} | Ticket: ${numTicket})`,
                            monto: montoLimpio,
                            ruta: `2_asistencias/${f}/${p}/${r}`
                        });
                        
                        // Rescate de firma por si el primer registro no tenía
                        if (!deudasEfectivo[r].firma && asis.firma_digital) {
                            deudasEfectivo[r].firma = asis.firma_digital;
                        }
                        // Firma guardada en el nodo nuevo (se descarga solo al abrir el pago)
                        if (!deudasEfectivo[r].firma && !deudasEfectivo[r].firmaRef && asis.tiene_firma) {
                            deudasEfectivo[r].firmaRef = { fecha: f, prog: p };
                        }
                    }
                }
            }
        }
        
        window.deudasEfectivoGlobal = deudasEfectivo; // Guardar global para el buscador local
        renderTablaDeudasEfectivo(deudasEfectivo, trabajadores);
        
    } catch (e) {
        containerLista.innerHTML = '<div class="alert alert-danger text-center mt-4">Error de conexión al cargar la lista.</div>';
    }
}

function renderTablaDeudasEfectivo(deudasObj, trabObj) {
    const containerLista = document.getElementById('contenedorListaEfectivo');
    if(!containerLista) return;
    
    const ruts = Object.keys(deudasObj);
    
    if (ruts.length === 0) {
        containerLista.innerHTML = '<div class="alert alert-success text-center mt-4 fw-bold">✅ Ya no hay nadie esperando pago en efectivo.</div>';
        return;
    }
    
    let html = `
    <div class="table-responsive mt-4">
        <table class="table table-dark table-hover align-middle text-center" style="font-size: 0.9em; border: 1px solid #444;">
            <thead style="color: #00d26a; background: #111;">
                <tr><th>RUT</th><th>Nombre Completo</th><th>Monto Total</th><th>Acción</th></tr>
            </thead>
            <tbody>
    `;
    
    ruts.forEach(r => {
        const tr = trabObj[r] || { nombres: "Desconocido", apellidos: "" };
        const d = deudasObj[r];
        const nombreLimpio = `${tr.nombres} ${tr.apellidos}`;
        
        html += `
        <tr>
            <td class="fw-bold">${r}</td>
            <td>
                ${nombreLimpio}<br>
                <span class="badge bg-warning text-dark border border-warning mt-1">Ticket: ${d.ticketsResumen.join(' | ')}</span>
            </td>
            <td class="text-success fw-bold fs-5">$${d.montoTotal.toLocaleString('es-CL')}</td>
            <td>
                <button class="btn btn-success btn-sm fw-bold w-100" onclick="window.abrirPagoEfectivo('${r}', '${nombreLimpio.replace(/['\"\`]/g, '')}')">💸 Pagar</button>
            </td>
        </tr>
        `;
    });
    
    html += `</tbody></table></div>`;
    containerLista.innerHTML = html;
}

// Cambiar el comportamiento del botón "Buscar" para que filtre la lista ignorando tildes
if (document.getElementById('btnBuscarEfectivo')) document.getElementById('btnBuscarEfectivo').addEventListener('click', () => {
    const termOriginal = document.getElementById('rutEfectivo').value.trim().toLowerCase();
    // Normalizamos el texto de búsqueda quitando tildes y acentos
    const termSinTildes = termOriginal.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    if(!window.deudasEfectivoGlobal) return;
    
    window.obtenerTrabajadores().then(snap => {
        const trabObj = snap.exists() ? snap.val() : {};
        if(!termOriginal) {
            renderTablaDeudasEfectivo(window.deudasEfectivoGlobal, trabObj);
            return;
        }
        
        let filtrado = {};
        for (const r in window.deudasEfectivoGlobal) {
            const tr = trabObj[r] || { nombres: "", apellidos: "" };
            const nombreCompleto = `${tr.nombres} ${tr.apellidos}`.toLowerCase();
            // Normalizamos el nombre de la base de datos quitando tildes y acentos
            const nombreLimpioTildes = nombreCompleto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            
            const rutLimpio = r.replace(/[^0-9kK]/g, '');
            const inputLimpio = termOriginal.replace(/[^0-9kK]/g, '');
            
            // Comparamos los textos ya sin tildes
            if (r.toLowerCase() === termOriginal || rutLimpio === inputLimpio || nombreLimpioTildes.includes(termSinTildes)) {
                filtrado[r] = window.deudasEfectivoGlobal[r];
            }
        }
        renderTablaDeudasEfectivo(filtrado, trabObj);
    });
});

window.abrirPagoEfectivo = async function(rut, nombrePersona) {
    const deuda = window.deudasEfectivoGlobal[rut];
    if(!deuda) return;
    if (!deuda.firma && deuda.firmaRef) {
        deuda.firma = await window.obtenerFirma(deuda.firmaRef.fecha, deuda.firmaRef.prog, rut, { tiene_firma: true });
    }
    
    if (document.getElementById('nombreEfectivo')) document.getElementById('nombreEfectivo').innerText = nombrePersona;
    
    let htmlCheckboxes = '<p class="text-warning mt-3 mb-2 fw-bold" style="font-size: 0.9em;">Selecciona qué programas liquidarás en efectivo ahora:</p>';
    deuda.programasDetalle.forEach((item, idx) => {
        htmlCheckboxes += `
        <div class="form-check text-start ms-2 mb-2 p-2 rounded" style="background: #222; border: 1px solid #444;">
            <input class="form-check-input check-pago-parcial" type="checkbox" value="${idx}" id="chk_efe_${idx}" checked style="transform: scale(1.3); margin-top:5px; cursor: pointer; margin-left: -15px;">
            <label class="form-check-label ms-2 text-white w-100 d-flex justify-content-between" for="chk_efe_${idx}" style="cursor: pointer; font-size: 0.95em;">
                <span>${item.nombreStr}</span>
                <span class="text-success fw-bold">$${item.monto.toLocaleString('es-CL')}</span>
            </label>
        </div>`;
    });
    
    if (document.getElementById('detalleProgramasEfectivo')) document.getElementById('detalleProgramasEfectivo').innerHTML = htmlCheckboxes;
    
    const recalcularTotal = () => {
        let suma = 0;
        document.querySelectorAll('.check-pago-parcial:checked').forEach(chk => {
            suma += deuda.programasDetalle[chk.value].monto;
        });
        if (document.getElementById('montoEfectivo')) document.getElementById('montoEfectivo').innerText = `$${suma.toLocaleString('es-CL')}`;
        deuda.montoCalculado = suma;
    };

    document.querySelectorAll('.check-pago-parcial').forEach(chk => chk.addEventListener('change', recalcularTotal));
    recalcularTotal();
    
    // Configuración visual para Reciclaje de Firma
    firmaRecicladaBase64 = deuda.firma;
    
    const canvasElement = document.getElementById('signature-pad-efectivo');
    if (canvasElement) canvasElement.classList.add('d-none'); // Ocultar el espacio de firma manual
    
    const btnLimpiar = document.getElementById('btnLimpiarFirmaEfectivo');
    if (btnLimpiar) btnLimpiar.classList.add('d-none'); // Ocultar botón borrar firma

    let msgDiv = document.getElementById('msgFirmaReciclada');
    if (!msgDiv) {
        msgDiv = document.createElement('div');
        msgDiv.id = 'msgFirmaReciclada';
        if (canvasElement) canvasElement.parentElement.insertBefore(msgDiv, canvasElement);
    }
    
    if (firmaRecicladaBase64) {
        if (canvasElement) canvasElement.classList.add('d-none'); 
        if (btnLimpiar) btnLimpiar.classList.add('d-none'); 
        if (msgDiv) msgDiv.innerHTML = `
            <div class="alert alert-success mt-2 p-3 text-center" style="border: 2px solid #00d26a;">
                <span class="fw-bold fs-5">✅ Firma Encontrada</span><br>
                <small>Se reciclará automáticamente la firma digital que la persona realizó en la puerta.</small>
            </div>`;
    } else {
        if (canvasElement) canvasElement.classList.remove('d-none'); 
        if (btnLimpiar) btnLimpiar.classList.remove('d-none'); 
        if (msgDiv) msgDiv.innerHTML = `
            <div class="alert alert-warning mt-2 p-3 text-center" style="border: 2px dashed #ffcc00;">
                <span class="fw-bold fs-5 text-warning">⚠️ Sin Firma Previa</span><br>
                <small class="text-white">Esta persona no firmó en la puerta. <br><b>Por favor, que firme ahora en el recuadro blanco para entregarle su dinero.</b></small>
            </div>`;
        if(typeof signaturePadEfectivo !== "undefined") {
            signaturePadEfectivo.clear();
            setTimeout(() => {
                if (canvasElement) {
                    const ratioEfe = Math.max(window.devicePixelRatio || 1, 1);
                    canvasElement.width = canvasElement.offsetWidth * ratioEfe;
                    canvasElement.height = canvasElement.offsetHeight * ratioEfe;
                    canvasElement.getContext("2d").scale(ratioEfe, ratioEfe);
                }
                signaturePadEfectivo.clear();
            }, 300);
        }
    }

    if (document.getElementById('panelPagoEfectivo')) document.getElementById('panelPagoEfectivo').classList.remove('d-none');
    
    // Mover el scroll al panel para mayor fluidez
    if (document.getElementById('panelPagoEfectivo')) document.getElementById('panelPagoEfectivo').scrollIntoView({ behavior: 'smooth' });

    rutEfectivoActual = rut;
    deudaEfectivoActual = deuda;
};

if (document.getElementById('btnConfirmarPagoEfectivo')) document.getElementById('btnConfirmarPagoEfectivo').addEventListener('click', async () => {
    let seleccionados = [];
    document.querySelectorAll('.check-pago-parcial:checked').forEach(chk => {
        seleccionados.push(deudaEfectivoActual.programasDetalle[chk.value]);
    });

    if(seleccionados.length === 0) return alert("Debes seleccionar al menos un programa para pagar.");

    if (!confirm(`¿Estás seguro de entregar $${deudaEfectivoActual.montoCalculado.toLocaleString('es-CL')} en EFECTIVO a esta persona?`)) return;
    
    const btn = document.getElementById('btnConfirmarPagoEfectivo');
    const textOrg = btn.innerText;
    btn.disabled = true;
    btn.innerText = "⏳ Confirmando y Reciclando Firma...";

    try {
        const nowIso = new Date().toISOString();
        const idRecibo = Date.now().toString();
        
        const nombresProgramas = seleccionados.map(s => s.nombreStr);
        const rutasActualizar = seleccionados.map(s => s.ruta);
        
        // Guardar el recibo usando la firma reciclada. La firma va en su propio nodo (12_firmas_recibos)
        // para que abrir la pestaña Efectivo no descargue todas las imágenes.
        const firmaRecibo = firmaRecicladaBase64 || (typeof signaturePadEfectivo !== "undefined" ? window.comprimirFirma(signaturePadEfectivo) : "");
        const datosRecibo = {
            rut: rutEfectivoActual,
            monto: deudaEfectivoActual.montoCalculado,
            fecha: nowIso,
            programas: nombresProgramas
        };
        try {
            await update(ref(db), {
                [`7_pagos_efectivo/${idRecibo}`]: { ...datosRecibo, tiene_firma: !!firmaRecibo },
                [`${NODO_FIRMAS_RECIBOS}/${idRecibo}`]: firmaRecibo || null
            });
        } catch (errorNodoFirmas) {
            // Respaldo: si el nodo de firmas no está permitido, se guarda como antes (firma dentro del recibo)
            console.warn("No se pudo usar el nodo de firmas de recibos, se guarda en formato clásico", errorNodoFirmas);
            await set(ref(db, `7_pagos_efectivo/${idRecibo}`), { ...datosRecibo, firma: firmaRecibo });
        }
        
        let updates = {};
        rutasActualizar.forEach(r => updates[`${r}/estado_pago`] = "Pagado (Efectivo)");
        await update(ref(db), updates);
        window.limpiarCache();

        alert("✅ ¡Pago Exitoso!\n\nEl recibo se ha firmado automáticamente con la firma de la puerta y está archivado en la Bóveda.");
        
        if (document.getElementById('panelPagoEfectivo')) document.getElementById('panelPagoEfectivo').classList.add('d-none');
        if (document.getElementById('rutEfectivo')) document.getElementById('rutEfectivo').value = "";
        
        // Recargar la lista para que la persona desaparezca mágicamente
        cargarListaEfectivo();
        // Recargar bóveda batch abajo
        if(typeof renderPanelRecibosBatch === "function") renderPanelRecibosBatch();
        
    } catch (e) {
        console.error(e);
        alert("Error detallado al pagar: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerText = "💾 Confirmar y Guardar Recibo";
    }
});

// --- PESTAÑA EFECTIVO: GESTIÓN DE RECIBOS EN LOTE ---
if (tabEfectivo) tabEfectivo.addEventListener('click', renderPanelRecibosBatch);

async function renderPanelRecibosBatch() {
    // La bóveda de efectivo es solo para admins: el staff no la descarga
    await window.rolListo;
    if (!window.esAdmin) return;
    let container = document.getElementById('panelRecibosBatch');
    if (!container) {
        // Encontrar el contenedor correcto sin importar cómo se llame el ID en el HTML
        let paneEl = document.getElementById('tab-efectivo');
        let btnRef = document.getElementById('btnBuscarEfectivo');
        
        if (!paneEl && btnRef) {
            paneEl = btnRef.parentElement.parentElement; // Subimos dos niveles para quedar en la base de la pestaña
        }
        
        if(!paneEl) return;
        container = document.createElement('div');
        container.id = 'panelRecibosBatch';
        container.className = 'card bg-dark border-info mt-5 p-4 shadow-lg w-100';
        paneEl.appendChild(container);
    }
    
    container.innerHTML = '<div class="text-info fs-5 text-center">⏳ Revisando Bóveda de Recibos...</div>';
    try {
        const snap = await get(ref(db, '7_pagos_efectivo'));
        const recibos = snap.exists() ? snap.val() : {};
        const count = Object.keys(recibos).length;
        
        if (count === 0) {
            container.innerHTML = '<div class="text-success text-center fw-bold fs-5 p-2">✅ Bóveda Vacía. No hay recibos de efectivo por archivar.</div>';
            return;
        }
        
        container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-3 border-bottom border-info pb-2">
                <h4 class="text-info mb-0">🗂️ Recibos Guardados (${count})</h4>
            </div>
            <p class="text-muted" style="font-size: 0.95em;">Los comprobantes de los pagos en efectivo están almacenados. Descárgalos todos juntos ahora.</p>
            
            <button class="btn btn-info fw-bold py-3 shadow w-100 fs-5 text-dark" id="btnDescargarZipEfectivo" style="border-radius: 10px;">
                📥 Descargar ZIP con los ${count} Recibos
            </button>
            
            <div id="zonaEliminarRecibos" class="d-none mt-4 p-3" style="background: rgba(255, 0, 0, 0.1); border: 2px dashed #ff3333; border-radius: 8px;">
                <h5 class="text-danger fw-bold text-center mb-3">⚠️ Zona de Limpieza Segura</h5>
                <p class="text-white text-center mb-3" style="font-size: 0.9em;">¿Ya descargaste el ZIP, lo abriste y confirmaste que los PDFs están adentro?<br>Si es así, borra los registros para no volver a descargar los mismos mañana.</p>
                <button class="btn btn-danger fw-bold w-100 py-2 fs-5" id="btnVaciarRecibos" style="border-radius: 8px;">
                    🗑️ Sí, Eliminar los ${count} recibos de la Nube
                </button>
            </div>
        `;
        
        if (document.getElementById('btnDescargarZipEfectivo')) document.getElementById('btnDescargarZipEfectivo').addEventListener('click', async () => {
            const btn = document.getElementById('btnDescargarZipEfectivo');
            btn.innerText = "⏳ Empaquetando ZIP... (Puede tomar unos segundos)";
            btn.disabled = true;
            
            try {
                const zip = new JSZip();
                const { jsPDF } = window.jspdf;
                const trabSnap = await window.obtenerTrabajadores();
                const trabajadores = trabSnap.exists() ? trabSnap.val() : {};
                
                // Las firmas se leen recién aquí, en grupos de 20 (no al abrir la pestaña)
                const firmasRecibos = {};
                const idsRecibos = Object.keys(recibos);
                for (let i = 0; i < idsRecibos.length; i += 20) {
                    const grupo = idsRecibos.slice(i, i + 20);
                    const leidas = await Promise.all(grupo.map(id => window.obtenerFirmaRecibo(id, recibos[id])));
                    grupo.forEach((id, k) => { firmasRecibos[id] = leidas[k]; });
                    btn.innerText = `⏳ Leyendo firmas... ${Math.min(i + 20, idsRecibos.length)} de ${idsRecibos.length}`;
                }
                
                for (const id in recibos) {
                    const rec = recibos[id];
                    const tr = trabajadores[rec.rut] || { nombres: "Desconocido", apellidos: "" };
                    
                    const doc = new jsPDF();
                    doc.setFont("helvetica", "bold"); doc.setFontSize(16);
                    doc.text("COMPROBANTE DE PAGO EN EFECTIVO", 105, 20, null, null, "center");
                    
                    doc.setFontSize(12); doc.setFont("helvetica", "normal");
                    const dateObj = new Date(rec.fecha);
                    const dateStr = `${dateObj.getDate().toString().padStart(2,'0')}-${(dateObj.getMonth()+1).toString().padStart(2,'0')}-${dateObj.getFullYear()}`;
                    const nombreCompleto = `${tr.nombres} ${tr.apellidos}`;
                    
                    const textoCentral = `En Santiago, con fecha ${dateStr}, NAT PRODUCCIONES (Camila Alejandra Fevre Seguel Produccion E.I.R.L) realiza el pago integro en EFECTIVO por la suma de $${rec.monto.toLocaleString('es-CL')} pesos a don/na ${nombreCompleto}, Cedula de Identidad N° ${rec.rut}.\n\nEste pago corresponde a la liquidacion de honorarios por su participacion como publico / extra en los siguientes programas:\n\n${rec.programas.join('\n')}\n\nEl trabajador declara mediante su firma recibir el dinero conforme y a su entera satisfaccion, liberando a la productora de cualquier deuda asociada a estas jornadas, no teniendo reclamos posteriores que realizar de indole civil ni laboral.`;
                    
                    const lineas = doc.splitTextToSize(textoCentral, 170);
                    doc.text(lineas, 20, 40);
                    
                    const firmaRec = firmasRecibos[id];
                    if (firmaRec) {
                        try { doc.addImage(firmaRec, 'JPEG', 65, 130, 80, 25); } catch(e) {}
                    }
                    
                    doc.setFont("helvetica", "bold");
                    doc.text("_________________________________", 105, 160, null, null, "center");
                    doc.text("Firma Recibí Conforme", 105, 165, null, null, "center");
                    doc.setFont("helvetica", "normal");
                    doc.text(nombreCompleto, 105, 170, null, null, "center");
                    doc.text(rec.rut, 105, 175, null, null, "center");
                    
                    const pdfBlob = doc.output('blob');
                    const safeName = nombreCompleto.replace(/[^a-zA-Z0-9]/g, "_");
                    
                    // Crear carpeta dinámica usando el nombre y fecha del programa
                    const primerPrograma = (rec.programas && rec.programas.length > 0) ? rec.programas[0] : "Pagos_Varios";
                    let nombreCarpeta = primerPrograma.replace(/[^a-zA-Z0-9\-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, '');
                    
                    // Si se le pagaron varios programas a la vez, lo indicamos en la carpeta
                    if (rec.programas && rec.programas.length > 1) {
                        nombreCarpeta += "_Y_OTROS";
                    }
                    
                    zip.folder(nombreCarpeta).file(`Recibo_Efectivo_${safeName}_${rec.rut}_${id}.pdf`, pdfBlob);
                }
                
                const zipContent = await zip.generateAsync({type:"blob"});
                const a = document.createElement("a");
                a.href = URL.createObjectURL(zipContent);
                a.download = `Recibos_Efectivo_NAT_${new Date().toISOString().split('T')[0]}.zip`;
                a.click();
                
                btn.innerText = "✅ ZIP Descargado Exitosamente";
                if (document.getElementById('zonaEliminarRecibos')) document.getElementById('zonaEliminarRecibos').classList.remove('d-none');
                
            } catch(e) {
                alert("Error armando el ZIP: " + e.message);
                btn.innerText = "📥 Intentar de nuevo";
                btn.disabled = false;
            }
        });
        
        if (document.getElementById('btnVaciarRecibos')) document.getElementById('btnVaciarRecibos').addEventListener('click', async () => {
            if(confirm(`⚠️ ALERTA DE BORRADO ⚠️\n\n¿Confirmas que abriste el archivo ZIP y los recibos están guardados en tu dispositivo?\n\nSi aceptas, todos estos registros se esfumarán de la base de datos para no repetirse el próximo mes.`)) {
                // Se borran solo los recibos incluidos en el ZIP (y sus firmas), no los que hayan llegado después
                const borrar = {};
                Object.keys(recibos).forEach(id => {
                    borrar[`7_pagos_efectivo/${id}`] = null;
                    borrar[`${NODO_FIRMAS_RECIBOS}/${id}`] = null;
                });
                await update(ref(db), borrar);
                alert("✅ La Bóveda de Recibos de Efectivo ha sido vaciada.");
                renderPanelRecibosBatch();
            }
        });
    } catch(e) {
        console.error("Error", e);
    }
}
// Ahorro de descargas: la bóveda de efectivo se carga solo al abrir la pestaña Efectivo

// ==========================================
// CONTRATOS DT
// ==========================================
if (document.getElementById('contratos-dt-tab')) document.getElementById('contratos-dt-tab').addEventListener('click', () => {
    if (document.getElementById('btnCargarContratosDT')) document.getElementById('btnCargarContratosDT').click();
});

window.agrupacionDTGlobal = {};

function getWeekIdentifier(dateStr) {
    const parts = dateStr.split('-'); 
    if(parts.length !== 3) return { label: "Fecha Desconocida", sortKey: "0000-00-00" };
    
    const d = new Date(parts[0], parts[1]-1, parts[2]);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); 
    const monday = new Date(d.setDate(diff));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    
    const monStr = monday.getDate().toString().padStart(2, '0') + '/' + (monday.getMonth()+1).toString().padStart(2, '0');
    const sunStr = sunday.getDate().toString().padStart(2, '0') + '/' + (sunday.getMonth()+1).toString().padStart(2, '0');
    const sortKey = monday.getFullYear() + "-" + (monday.getMonth()+1).toString().padStart(2, '0') + "-" + monday.getDate().toString().padStart(2, '0');
    
    return { label: `Semana del ${monStr} al ${sunStr}`, sortKey: sortKey };
}

if (document.getElementById('btnCargarContratosDT')) document.getElementById('btnCargarContratosDT').addEventListener('click', async () => {
    const contenedor = document.getElementById('contenedorContratosDT');
    contenedor.innerHTML = "<div class='text-center'><div class='spinner-border text-info'></div></div>";

    try {
        const [asisSnap, trabSnap] = await Promise.all([ window.obtenerAsistencias(), window.obtenerTrabajadores() ]);
        
        if (!asisSnap.exists()) {
            contenedor.innerHTML = "<div class='alert alert-success text-center fw-bold'>✅ No hay contratos pendientes.</div>";
            return;
        }

        const todas = asisSnap.val();
        const trabajadores = trabSnap.exists() ? trabSnap.val() : {};
        window.agrupacionDTGlobal = {};

        for (const fecha in todas) {
            const weekInfo = getWeekIdentifier(fecha);
            
            for (const prog in todas[fecha]) {
                if (!window.agrupacionDTGlobal[prog]) window.agrupacionDTGlobal[prog] = {};
                if (!window.agrupacionDTGlobal[prog][weekInfo.sortKey]) {
                    window.agrupacionDTGlobal[prog][weekInfo.sortKey] = { label: weekInfo.label, ruts: {}, totalAplica: 0, totalArchivados: 0 };
                }
                
                for (const rut in todas[fecha][prog]) {
                    const asis = todas[fecha][prog][rut];
                    
                    if (asis.tipo_ingreso === "Pago" && asis.aplica_contrato !== false) {
                        window.agrupacionDTGlobal[prog][weekInfo.sortKey].totalAplica++;
                        
                        if (asis.dt_archivado) {
                            window.agrupacionDTGlobal[prog][weekInfo.sortKey].totalArchivados++;
                        } else {
                            let objRut = window.agrupacionDTGlobal[prog][weekInfo.sortKey].ruts[rut];
                            if (!objRut) {
                                const tr = trabajadores[rut] || { nombres: "Desconocido", apellidos: "", email: "-", telefono: "-", direccion: "-" };
                                
                                const telefonoLimpio = (tr.telefono || "-").replace(/^\+56\s*9/, '9').replace(/^\+56/, '9');
                                
                                objRut = {
                                    nombres: `${tr.nombres} ${tr.apellidos}`,
                                    email: tr.email || "-",
                                    telefono: telefonoLimpio,
                                    direccion: tr.direccion || "-",
                                    fechas: [],
                                    tickets: [],
                                    rutasFirebase: [],
                                    todoLiquidado: !!asis.dt_liquidado,
                                    montoSuma: 0
                                };
                                window.agrupacionDTGlobal[prog][weekInfo.sortKey].ruts[rut] = objRut;
                            }
                            
                            objRut.fechas.push(fecha);
                            objRut.tickets.push(asis.numero_asignado || '-');
                            
                            const montoLimpio = parseInt(String(asis.monto).replace(/\D/g, '')) || 0;
                            objRut.montoSuma += montoLimpio;
                            
                            objRut.rutasFirebase.push(`2_asistencias/${fecha}/${prog}/${rut}`);
                            
                            if (!asis.dt_liquidado) objRut.todoLiquidado = false;
                        }
                    }
                }
            }
        }

        for (const prog in window.agrupacionDTGlobal) {
            for (const wk in window.agrupacionDTGlobal[prog]) {
                if (window.agrupacionDTGlobal[prog][wk].totalAplica === 0) {
                    delete window.agrupacionDTGlobal[prog][wk]; 
                }
            }
            if (Object.keys(window.agrupacionDTGlobal[prog]).length === 0) {
                delete window.agrupacionDTGlobal[prog];
            }
        }

        if (Object.keys(window.agrupacionDTGlobal).length === 0) {
            contenedor.innerHTML = "<div class='alert alert-success text-center fw-bold'>✅ Todos los contratos están listos y archivados.</div>";
            return;
        }

        let html = `<div id="contadorDTGlobal" class="mb-3" style="position: sticky; top: 0; z-index: 5;"></div>`;
        html += '<div class="accordion" id="accProgramas">';
        let progIdx = 0;
        
        const progKeys = Object.keys(window.agrupacionDTGlobal).sort();
        for (const prog of progKeys) {
            progIdx++;
            html += `
            <div class="accordion-item" style="border: 1px solid #b066ff; margin-bottom: 10px; background: #1a1a1a;">
                <h2 class="accordion-header">
                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#colProg_${progIdx}" style="background: #2d1b4e; color: white; font-size: 1.1em;">
                        🎬 Programa: ${prog.replace(" - ", " / ")}
                        <span class="badge ms-2 contador-dt-prog" data-prog="${encodeURIComponent(prog)}"></span>
                    </button>
                </h2>
                <div id="colProg_${progIdx}" class="accordion-collapse collapse" data-bs-parent="#accProgramas">
                    <div class="accordion-body" style="background: #141414;">
                        <div class="accordion" id="accWeeks_${progIdx}">`;
            
            let wkIdx = 0;
            const weekKeys = Object.keys(window.agrupacionDTGlobal[prog]).sort().reverse();
            for (const wk of weekKeys) {
                wkIdx++;
                const weekData = window.agrupacionDTGlobal[prog][wk];
                const todosArchivados = (weekData.totalArchivados > 0 && weekData.totalArchivados === weekData.totalAplica);
                
                if (todosArchivados) {
                    html += `
                    <div class="accordion-item" style="border: 1px solid #00d26a; margin-bottom: 5px; background: #0a1a0a;">
                        <h2 class="accordion-header">
                            <button class="accordion-button collapsed" type="button" style="background: #0a1a0a; color: #00d26a;" disabled>
                                📅 ${weekData.label} &nbsp; <span class="badge bg-success ms-auto fs-6">✅ Contratos Listos</span>
                            </button>
                        </h2>
                    </div>`;
                } else {
                    const numPersonas = Object.keys(weekData.ruts).length;
                    html += `
                    <div class="accordion-item" style="border: 1px solid #444; margin-bottom: 5px; background: #111;">
                        <h2 class="accordion-header">
                            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#colProg_${progIdx}_wk_${wkIdx}" style="background: #1a1a1a; color: #00d26a;">
                                📅 ${weekData.label} &nbsp; <span class="badge ms-2 contador-dt-wk" data-prog="${encodeURIComponent(prog)}" data-wk="${wk}">${numPersonas} personas</span>
                            </button>
                        </h2>
                        <div id="colProg_${progIdx}_wk_${wkIdx}" class="accordion-collapse collapse" data-bs-parent="#accWeeks_${progIdx}">
                            <div class="accordion-body p-0">
                                <div class="table-responsive">
                                    <table class="table table-dark table-hover table-bordered mb-0 align-middle text-center" style="font-size: 0.9em;">
                                        <thead style="color: #b066ff;">
                                            <tr><th>N° Ticket</th><th>RUT</th><th>Nombre</th><th>Correo</th><th>Teléfono</th><th>Domicilio</th><th>Fechas Asistidas</th><th>Montos (Base / +25%)</th><th>Acción</th></tr>
                                        </thead>
                                        <tbody>`;
                    
                    // ORDENAR POR CANTIDAD DE TICKETS (DESCENDENTE)
                    const rutsOrdenados = Object.keys(weekData.ruts).sort((a, b) => {
                        return weekData.ruts[b].fechas.length - weekData.ruts[a].fechas.length;
                    });
                    
                    for (const rut of rutsOrdenados) {
                        const asisData = weekData.ruts[rut];
                        const rowClass = asisData.todoLiquidado ? 'table-success' : '';
                        const textColor = asisData.todoLiquidado ? 'text-dark' : 'text-white';
                        const btnClass = asisData.todoLiquidado ? 'btn-success text-dark' : 'btn-outline-success';
                        const btnText = asisData.todoLiquidado ? '✅ Listo' : 'Marcar Contrato';
                        const montoImpuestos = Math.round(asisData.montoSuma * 1.25);
                        
                        const trId = `tr_${progIdx}_${wkIdx}_${rut}`;
                        const btnId = `btn_${progIdx}_${wkIdx}_${rut}`;

                        html += `
                                            <tr class="${rowClass}" style="transition: 0.3s;" id="${trId}">
                                                <td class="fw-bold text-warning dt-text-element">${asisData.tickets.join(', ')}</td>
                                                <td class="fw-bold ${textColor} dt-text-element">${rut}</td>
                                                <td class="${textColor} dt-text-element">${asisData.nombres}</td>
                                                <td class="${textColor} dt-text-element">${asisData.email}</td>
                                                <td class="${textColor} dt-text-element">${asisData.telefono}</td>
                                                <td class="${textColor} dt-text-element">${asisData.direccion}</td>
                                                <td><span class="badge bg-info text-dark">${asisData.fechas.join(', ')}</span></td>
                                                <td class="${textColor} dt-text-element">Base: $${asisData.montoSuma} <br><b class="text-warning">DT (+25%): $${montoImpuestos}</b></td>
                                                <td>
                                                    <div class="d-flex justify-content-center gap-1">
                                                        <button id="${btnId}" class="btn ${btnClass} btn-sm fw-bold" onclick="window.toggleContratoSemana(event, '${rut}', '${prog}', '${wk}', '${trId}', '${btnId}')">
                                                            ${btnText}
                                                        </button>
                                                        <button class="btn btn-outline-danger btn-sm fw-bold" onclick="window.eliminarContratoDT(event, '${rut}', '${prog}', '${wk}')">
                                                            🗑️ Se retiró
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>`;
                    }
                    html += `
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>`;
                }
            }
            html += `
                        </div>
                    </div>
                </div>
            </div>`;
        }
        html += '</div>';
        contenedor.innerHTML = html;
        window.actualizarContadoresDT();

    } catch (e) {
        contenedor.innerHTML = "<p class='text-danger text-center'>Error al cargar los datos.</p>";
    }
});

// ==========================================
// CONTADOR EN VIVO DE CONTRATOS POR MARCAR
// Se recalcula al instante cada vez que se marca/desmarca un contrato (0 MB de descarga)
// ==========================================
window.actualizarContadoresDT = function() {
    const datos = window.agrupacionDTGlobal || {};
    let pendientesTotal = 0, listosTotal = 0;
    const porProg = {}, porSemana = {};

    for (const prog in datos) {
        porProg[prog] = { pendientes: 0, listos: 0 };
        for (const wk in datos[prog]) {
            const semana = { pendientes: 0, listos: 0 };
            const ruts = datos[prog][wk].ruts || {};
            for (const rut in ruts) {
                if (ruts[rut].todoLiquidado) semana.listos++; else semana.pendientes++;
            }
            porSemana[prog + '||' + wk] = semana;
            porProg[prog].pendientes += semana.pendientes;
            porProg[prog].listos += semana.listos;
            pendientesTotal += semana.pendientes;
            listosTotal += semana.listos;
        }
    }

    const total = pendientesTotal + listosTotal;
    const porcentaje = total > 0 ? Math.round((listosTotal / total) * 100) : 100;
    const cajaGlobal = document.getElementById('contadorDTGlobal');
    if (cajaGlobal) {
        const colorBorde = pendientesTotal > 0 ? '#ffcc00' : '#00d26a';
        cajaGlobal.innerHTML = `
            <div class="p-3 rounded" style="background: #1a1a1a; border: 2px solid ${colorBorde};">
                <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
                    <span class="fs-5 fw-bold" style="color: ${colorBorde};">
                        ${pendientesTotal > 0 ? `⏳ Faltan ${pendientesTotal} contrato${pendientesTotal === 1 ? '' : 's'} por marcar` : '✅ Todos los contratos están marcados'}
                    </span>
                    <span class="text-white">✅ ${listosTotal} marcados de ${total}</span>
                </div>
                <div class="progress mt-2" style="height: 8px; background: #333;">
                    <div class="progress-bar bg-success" style="width: ${porcentaje}%;"></div>
                </div>
            </div>`;
    }

    document.querySelectorAll('.contador-dt-prog').forEach(el => {
        const c = porProg[decodeURIComponent(el.dataset.prog)];
        if (!c) return;
        el.className = 'badge ms-2 contador-dt-prog ' + (c.pendientes > 0 ? 'bg-warning text-dark' : 'bg-success');
        el.innerText = c.pendientes > 0 ? `⏳ ${c.pendientes} por marcar` : '✅ Todo marcado';
    });

    document.querySelectorAll('.contador-dt-wk').forEach(el => {
        const c = porSemana[decodeURIComponent(el.dataset.prog) + '||' + el.dataset.wk];
        if (!c) return;
        el.className = 'badge ms-2 contador-dt-wk ' + (c.pendientes > 0 ? 'bg-warning text-dark' : 'bg-success');
        el.innerText = c.pendientes > 0 ? `⏳ ${c.pendientes} por marcar · ✅ ${c.listos} listos` : `✅ ${c.listos} listos para archivar`;
    });
};


window.toggleContratoSemana = async function(event, rut, prog, wkSortKey, trId, btnId) {
    event.preventDefault();
    event.stopPropagation();

    const asisData = window.agrupacionDTGlobal[prog][wkSortKey].ruts[rut];
    const nuevoEstado = !asisData.todoLiquidado;
    
    const tr = document.getElementById(trId);
    const btn = document.getElementById(btnId);
    const textElements = tr.querySelectorAll('.dt-text-element'); 

    const pintarFila = (estado) => {
    if (estado) {
        tr.classList.add('table-success');
        textElements.forEach(el => { el.classList.remove('text-white'); el.classList.add('text-dark'); });
        btn.classList.remove('btn-outline-success');
        btn.classList.add('btn-success', 'text-dark');
        btn.innerText = '✅ Listo';
    } else {
        tr.classList.remove('table-success');
        textElements.forEach(el => { el.classList.remove('text-dark'); el.classList.add('text-white'); });
        btn.classList.remove('btn-success', 'text-dark');
        btn.classList.add('btn-outline-success');
        btn.innerText = 'Marcar Contrato';
    }
    };
    pintarFila(nuevoEstado);

    let updates = {};
    asisData.rutasFirebase.forEach(ruta => {
        updates[`${ruta}/dt_liquidado`] = nuevoEstado;
    });

    try {
        await update(ref(db), updates);
        if (window.cacheAsistencias) {
            asisData.fechas.forEach(fecha => {
                if (window.cacheAsistencias[fecha] && window.cacheAsistencias[fecha][prog] && window.cacheAsistencias[fecha][prog][rut]) {
                    window.cacheAsistencias[fecha][prog][rut].dt_liquidado = nuevoEstado;
                }
            });
            setLocalCache('asistencias_nat', window.cacheAsistencias);
        }
        asisData.todoLiquidado = nuevoEstado;
        window.actualizarContadoresDT();
    } catch (e) {
        console.error("Error al actualizar estado en BD", e);
        pintarFila(!nuevoEstado); // Se devuelve la fila a su estado real porque no se guardó
        alert("Aviso: Hubo una falla de red y el contrato NO se marcó. Verifica tu conexión e inténtalo de nuevo.");
    }
}

window.eliminarContratoDT = async function(event, rut, prog, wkSortKey) {
    event.preventDefault(); event.stopPropagation();
    if(!confirm("¿Estás seguro de que esta persona se retiró?\nEsto eliminará permanentemente su contrato DT de esta lista.")) return;
    
    const asisData = window.agrupacionDTGlobal[prog][wkSortKey].ruts[rut];
    let updates = {};
    asisData.rutasFirebase.forEach(ruta => {
        updates[`${ruta}/aplica_contrato`] = false;
        updates[`${ruta}/tipo_ingreso`] = "Se retiró";
    });
    
    try {
        await update(ref(db), updates);
        if (window.cacheAsistencias) {
            asisData.fechas.forEach(fecha => {
                if (window.cacheAsistencias[fecha] && window.cacheAsistencias[fecha][prog] && window.cacheAsistencias[fecha][prog][rut]) {
                    window.cacheAsistencias[fecha][prog][rut].aplica_contrato = false;
                    window.cacheAsistencias[fecha][prog][rut].tipo_ingreso = "Se retiró";
                }
            });
            setLocalCache('asistencias_nat', window.cacheAsistencias);
        }
        alert("Contrato anulado correctamente por retiro.");
        if (document.getElementById('btnCargarContratosDT')) document.getElementById('btnCargarContratosDT').click(); 
    } catch(e) {
        alert("Error al anular contrato.");
    }
}

if (document.getElementById('btnArchivarContratosDT')) document.getElementById('btnArchivarContratosDT').addEventListener('click', async () => {
    if (!window.agrupacionDTGlobal || Object.keys(window.agrupacionDTGlobal).length === 0) return;
    
    let updates = {};
    let rutsArchivados = 0;
    let resumenProgramas = new Set();

    for (const prog in window.agrupacionDTGlobal) {
        for (const wk in window.agrupacionDTGlobal[prog]) {
            if (!window.agrupacionDTGlobal[prog][wk].ruts) continue;
            for (const rut in window.agrupacionDTGlobal[prog][wk].ruts) {
                const asisData = window.agrupacionDTGlobal[prog][wk].ruts[rut];
                if (asisData.todoLiquidado) {
                    rutsArchivados++;
                    resumenProgramas.add(prog.replace(" - ", " / "));
                    asisData.rutasFirebase.forEach(ruta => {
                        updates[`${ruta}/dt_archivado`] = true;
                    });
                }
            }
        }
    }

    if (rutsArchivados === 0) {
        return alert("No hay contratos marcados en verde (Listos) para archivar.");
    }

    if (!confirm(`¿Archivar definitivamente los ${rutsArchivados} contratos que están en verde?\nEsto registrará la semana como 'Lista' y ya no podrás ver las filas internas.`)) return;

    const idHistorico = Date.now().toString();
    updates[`5_historial_dt/archivos/${idHistorico}`] = {
        fecha_archivo: new Date().toISOString(),
        cantidad_archivos: rutsArchivados,
        programas: Array.from(resumenProgramas)
    };

    try {
        await update(ref(db), updates);
        if (window.cacheAsistencias) {
            for (const progName in window.agrupacionDTGlobal) {
                for (const wk in window.agrupacionDTGlobal[progName]) {
                    for (const rutNum in window.agrupacionDTGlobal[progName][wk].ruts) {
                        const asisInfo = window.agrupacionDTGlobal[progName][wk].ruts[rutNum];
                        if (asisInfo.todoLiquidado) {
                            asisInfo.fechas.forEach(f => {
                                if (window.cacheAsistencias[f] && window.cacheAsistencias[f][progName] && window.cacheAsistencias[f][progName][rutNum]) {
                                    window.cacheAsistencias[f][progName][rutNum].dt_archivado = true;
                                }
                            });
                        }
                    }
                }
            }
            setLocalCache('asistencias_nat', window.cacheAsistencias);
        }
        alert(`✅ ¡Éxito! Se archivaron ${rutsArchivados} contratos de los programas:\n${Array.from(resumenProgramas).join(', ')}`);
        if (document.getElementById('btnCargarContratosDT')) document.getElementById('btnCargarContratosDT').click();
    } catch (e) {
        alert("Error al archivar en Firebase.");
    }
});


// ==========================================
// PESTAÑA 4: SEGURIDAD (ACORDEÓN MES -> PROGRAMA)
// ==========================================
async function cargarReportesDT(forzar = false) {
    const contenedor = document.getElementById('acordeonDT');
    const btnRefresh = document.getElementById('btnRefrescarSeguridad');
    
    if(btnRefresh) {
        btnRefresh.innerText = "⏳ Cargando..."; 
        btnRefresh.disabled = true;
    }
    
    const [asisSnap, trabSnap] = await Promise.all([ 
        window.obtenerAsistencias(forzar === true), 
        window.obtenerTrabajadores(forzar === true) 
    ]);
    
    if(btnRefresh) {
        btnRefresh.innerText = "🔄 Actualizar Lista en Vivo"; 
        btnRefresh.disabled = false;
    }

    if (!asisSnap.exists()) { 
        if(contenedor) contenedor.innerHTML = "<p class='text-center text-warning'>No hay registros de asistencia.</p>"; 
        return; 
    }
    
    const todasLasAsistencias = asisSnap.val(); 
    const trabajadores = trabSnap.exists() ? trabSnap.val() : {};
    
    let agrupacionSeguridad = {};
    const nombresMeses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const nombresDias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

    for (const fecha in todasLasAsistencias) {
        const mesLlave = fecha.substring(0, 7); 
        const [y, m, d] = fecha.split('-');
        const dateObj = new Date(y, parseInt(m)-1, d);
        const diaNombre = nombresDias[dateObj.getDay()];
        const nombreMes = nombresMeses[parseInt(m)-1];
        const etiquetaMes = `${nombreMes} ${y}`;
        
        if (!agrupacionSeguridad[mesLlave]) agrupacionSeguridad[mesLlave] = { etiqueta: etiquetaMes, programas: {} };
        
        for (const prog in todasLasAsistencias[fecha]) {
            if (!agrupacionSeguridad[mesLlave].programas[prog]) {
                agrupacionSeguridad[mesLlave].programas[prog] = {};
            }
            agrupacionSeguridad[mesLlave].programas[prog][fecha] = {
                diaNombre: diaNombre,
                asistentes: todasLasAsistencias[fecha][prog]
            };
        }
    }

    let htmlAcordeon = '<div class="accordion" id="accSeguridadMeses">'; 
    let mesIdx = 0;
    
    const mesesOrdenados = Object.keys(agrupacionSeguridad).sort().reverse();

    for (const mes of mesesOrdenados) {
        mesIdx++;
        const dataMes = agrupacionSeguridad[mes];
        
        htmlAcordeon += `
        <div class="accordion-item" style="border: 1px solid #00d26a; margin-bottom: 15px; background: #0a0a0a;">
            <h2 class="accordion-header">
                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#segMes_${mesIdx}" style="background: #0a1a0a; color: #00d26a; font-size: 1.2em;">
                    📅 Mes: ${dataMes.etiqueta.toUpperCase()}
                </button>
            </h2>
            <div id="segMes_${mesIdx}" class="accordion-collapse collapse" data-bs-parent="#accSeguridadMeses">
                <div class="accordion-body" style="background: #141414;">
                    <div class="accordion" id="accSegProgs_${mesIdx}">`;
        
        let progIdx = 0;
        const progsOrdenados = Object.keys(dataMes.programas).sort();
        
        for (const prog of progsOrdenados) {
            progIdx++;
            const fechasData = dataMes.programas[prog];
            
            htmlAcordeon += `
                        <div class="accordion-item" style="border: 1px solid #b066ff; margin-bottom: 10px; background: #1a1a1a;">
                            <h2 class="accordion-header">
                                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#segProg_${mesIdx}_${progIdx}" style="background: #2d1b4e; color: white;">
                                    🎬 ${prog.replace(" - ", " / ")}
                                </button>
                            </h2>
                            <div id="segProg_${mesIdx}_${progIdx}" class="accordion-collapse collapse" data-bs-parent="#accSegProgs_${mesIdx}">
                                <div class="accordion-body p-0">`;
            
            const fechasOrdenadas = Object.keys(fechasData).sort().reverse();
            for (const fecha of fechasOrdenadas) {
                const asisDia = fechasData[fecha].asistentes;
                const diaNombre = fechasData[fecha].diaNombre;
                const cantidad = Object.keys(asisDia).length;
                
                const partesF = fecha.split('-');
                const fechaBonita = `${partesF[2]}-${partesF[1]}-${partesF[0]}`;
                
                htmlAcordeon += `
                                    <div class="p-3 border-bottom border-secondary">
                                        <div class="d-flex justify-content-between align-items-center mb-3">
                                            <h6 class="text-warning fw-bold mb-0">📌 ${diaNombre} ${fechaBonita} <span class="badge bg-success ms-2">${cantidad} personas</span></h6>
                                            <button class="btn btn-outline-info btn-sm fw-bold" onclick="window.descargarListaSeguridad('${fecha}', '${prog}')">
                                                🛡️ Descargar Excel
                                            </button>
                                        </div>
                                        <div class="table-responsive">
                                            <table class="table table-dark table-hover table-sm text-center align-middle" style="font-size: 0.85em;">
                                                <thead style="color: #b066ff;">
                                                    <tr>
                                                        <th>N° Ticket</th>
                                                        <th>RUT</th>
                                                        <th>Nombre Completo</th>
                                                        <th>Condición / Invitado Por</th>
                                                        <th>Teléfono</th>
                                                        <th>Dirección</th>
                                                    </tr>
                                                </thead>
                                                <tbody>`;
                                                
                for (const rut in asisDia) {
                    const asis = asisDia[rut];
                    const tr = trabajadores[rut] || { nombres: "No registrado", apellidos: "" };
                    
                    let badgeCondicion = "";
                    if (asis.tipo_ingreso === "Cortesía") {
                        badgeCondicion = `<span class="badge bg-warning text-dark fw-bold">Cortesía (${asis.invitado_por || '-'})</span>`;
                    } else {
                        badgeCondicion = `<span class="badge bg-secondary">Trabajador</span>`;
                    }
                    
                    htmlAcordeon += `
                                                    <tr>
                                                        <td><span class="badge bg-secondary fs-6">${asis.numero_asignado || '-'}</span></td>
                                                        <td>${rut}</td>
                                                        <td>${tr.nombres} ${tr.apellidos}</td>
                                                        <td>${badgeCondicion}</td>
                                                        <td>${tr.telefono || '-'}</td>
                                                        <td>${tr.direccion || '-'}</td>
                                                    </tr>`;
                }
                htmlAcordeon += `
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>`;
            }
            
            htmlAcordeon += `
                                </div>
                            </div>
                        </div>`;
        }
        
        htmlAcordeon += `
                    </div>
                </div>
            </div>
        </div>`;
    }
    
    htmlAcordeon += '</div>';
    if(contenedor) contenedor.innerHTML = htmlAcordeon;
}

window.descargarListaSeguridad = async function(fechaElegida, programaElegido) {
    try {
        const asisSnap = await get(ref(db, `2_asistencias/${fechaElegida}/${programaElegido}`));
        if (!asisSnap.exists()) return alert("No hay datos para descargar.");
        
        const trabSnap = await window.obtenerTrabajadores();
        const trabajadores = trabSnap.exists() ? trabSnap.val() : {};
        
        const asistentes = asisSnap.val();
        let csv = "\uFEFFN° TICKET;PROGRAMA;FECHA;RUT;NOMBRES;APELLIDOS;CONDICIÓN;DIRECCIÓN\n";
        
        for (const rut in asistentes) {
            const tr = trabajadores[rut] || { nombres: "No registrado", apellidos: "" };
            const asis = asistentes[rut];
            
            const cond = asis.tipo_ingreso === "Cortesía" ? `Cortesía (${asis.invitado_por})` : "Trabajador";
            
            csv += `${asis.numero_asignado || '-'};${programaElegido.replace(" - ", " / ")};${fechaElegida};${rut};${tr.nombres};${tr.apellidos};${cond};${tr.direccion || '-'}\n`;
        }
        
        descargarCSV(csv, `Lista_Seguridad_${programaElegido.replace(/[ \/]/g, "_")}_${fechaElegida}.csv`);
    } catch (e) {
        alert("Error al descargar lista de seguridad.");
    }
}

if (document.getElementById('seguridad-tab')) document.getElementById('seguridad-tab').addEventListener('click', cargarReportesDT);
if (document.getElementById('btnRefrescarSeguridad')) document.getElementById('btnRefrescarSeguridad').addEventListener('click', () => cargarReportesDT(true));


// ==========================================
// MANTENIMIENTO 
// ==========================================
if (document.getElementById('btnRespaldoMaestro')) document.getElementById('btnRespaldoMaestro').addEventListener('click', async () => {
    try {
        const snap = await window.obtenerAsistencias(true); 
        if (!snap.exists()) return alert("No hay datos de asistencias.");
        
        const trabSnap = await window.obtenerTrabajadores(); 
        if (trabSnap.exists()) listaGlobalCRM = trabSnap.val(); 
        
        let agrupado = {};
        const todas = snap.val();
        
        for (const fecha in todas) { 
            for (const prog in todas[fecha]) { 
                for (const r in todas[fecha][prog]) {
                    const asis = todas[fecha][prog][r]; 
                    
                    if (!agrupado[r]) {
                        agrupado[r] = { 
                            programas: [], 
                            montoTotal: 0 
                        };
                    }
                    
                    let montoLimpio = parseInt(String(asis.monto).replace(/\D/g, '')) || 0;
                    agrupado[r].montoTotal += montoLimpio;
                    agrupado[r].programas.push(`${prog.replace(" - ", " / ")} (${fecha} N°${asis.numero_asignado || '-'})`);
                }
            }
        }

        let csv = "\uFEFFRUT;Nombres;Apellidos;Total Dias Asistidos;Monto Total Historico;Programas y Fechas\n";
        
        for (const r in agrupado) {
            const trab = listaGlobalCRM[r] || { nombres: "Desconocido", apellidos: "" };
            const asisData = agrupado[r];
            
            const programasStr = asisData.programas.join(" | ");
            
            csv += `${r};${trab.nombres};${trab.apellidos};${asisData.programas.length};$${asisData.montoTotal};${programasStr}\n`;
        }
        
        descargarCSV(csv, `Respaldo_Maestro_Agrupado_${new Date().toISOString().split('T')[0]}.csv`);
        
    } catch (error) { 
        alert("Error al generar el respaldo maestro."); 
    }
});

if (document.getElementById('btnRespaldoPDFs')) document.getElementById('btnRespaldoPDFs').addEventListener('click', async () => {
    const btn = document.getElementById('btnRespaldoPDFs');
    try {
        btn.innerText = "⏳ Empaquetando PDFs... (Espera)"; 
        btn.disabled = true;
        
        const snap = await window.obtenerAsistencias(); 
        if (!snap.exists()) { 
            alert("No hay contratos."); 
            resetBtnZip(btn); 
            return; 
        }
        
        const trabSnap = await window.obtenerTrabajadores(); 
        if (trabSnap.exists()) listaGlobalCRM = trabSnap.val(); 
        
        const todas = snap.val(); 
        const zip = new JSZip(); 
        let pdfsGenerados = 0; 
        const { jsPDF } = window.jspdf;
        
        for (const fecha in todas) { 
            for (const prog in todas[fecha]) {
                const carpetaPrograma = zip.folder(`${fecha}_${prog.replace(/[ \/]/g, "_")}`);
                let firmasProgZip = null;
                
                for (const r in todas[fecha][prog]) {
                    const asis = todas[fecha][prog][r]; 
                    const trab = listaGlobalCRM[r] || { nombres: "Desconocido", apellidos: "" };
                    
                    let firmaZip = asis.firma_digital || null;
                    if (!firmaZip && asis.tiene_firma) {
                        if (firmasProgZip === null) firmasProgZip = await window.obtenerFirmasPrograma(fecha, prog);
                        firmaZip = firmasProgZip[r] || null;
                    }
                    
                    if (firmaZip) {
                        const doc = window.crearDocumentoIngreso(r, trab, { ...asis, firma_digital: firmaZip }, fecha, prog.replace(" - ", " / "));
                        
                        const nombreCompletoLimpio = `${trab.nombres || ''}_${trab.apellidos || ''}`.replace(/[^a-zA-Z0-9_]/g, "");
                        const ticketStr = asis.numero_asignado ? `Ticket${asis.numero_asignado}` : `SinTicket`;
                        
                        let nombreArchivo = "";
                        if (asis.tipo_ingreso === "Cortesía" || asis.aplica_contrato === false) {
                            nombreArchivo = `Cesion_Imagen_${ticketStr}_${nombreCompletoLimpio}_${r}.pdf`;
                        } else {
                            nombreArchivo = `Contrato_${ticketStr}_${nombreCompletoLimpio}_${r}.pdf`;
                        }
                        
                        const pdfBlob = doc.output('blob'); 
                        carpetaPrograma.file(nombreArchivo, pdfBlob); 
                        pdfsGenerados++;
                    }
                }
            }
        }
        
        if (pdfsGenerados === 0) { 
            alert("No hay firmas digitales."); 
            resetBtnZip(btn); 
            return; 
        }
        
        const zipContent = await zip.generateAsync({type:"blob"}); 
        const a = document.createElement("a"); 
        a.href = URL.createObjectURL(zipContent); 
        a.download = `Respaldo_Contratos_PDF_${new Date().toISOString().split('T')[0]}.zip`; 
        a.click();
        
        alert(`¡Éxito! Se empaquetaron ${pdfsGenerados} contratos legales.`); 
        resetBtnZip(btn);
        
    } catch (error) { 
        alert("Error al empaquetar los PDFs."); 
        resetBtnZip(btn); 
    }
});

function resetBtnZip(btn) { 
    btn.innerText = "🗂️ Descargar ZIP de Contratos"; 
    btn.disabled = false; 
}

const inputConfirmar = document.getElementById('inputConfirmarLimpieza'); 
const btnEjecutar = document.getElementById('btnEjecutarLimpieza');

if(inputConfirmar) inputConfirmar.addEventListener('input', (e) => { 
    btnEjecutar.disabled = (e.target.value !== "1812"); 
});

if(btnEjecutar) btnEjecutar.addEventListener('click', async () => {
    try {
        await remove(ref(db, '2_asistencias'));
        window.limpiarCache(); 
        await remove(ref(db, '3_reservas'));
        try { await remove(ref(db, NODO_FIRMAS)); } catch (eFirmas) { console.warn("No se pudo limpiar el nodo de firmas", eFirmas); }
        alert("✅ Nube limpiada con éxito."); 
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('modalLimpieza'));
        modal.hide(); 
        inputConfirmar.value = ""; 
        btnEjecutar.disabled = true; 
        
        window.location.reload();
    } catch (error) { 
        alert("Error al limpiar."); 
    }
});

// ==========================================
// SORTEO DALE PLAY 
// ==========================================
if (document.getElementById('sorteo-tab')) document.getElementById('sorteo-tab').addEventListener('click', async () => {
    const contenedorFechas = document.getElementById('listaFechasSorteo');
    contenedorFechas.innerHTML = "<div class='spinner-border text-warning'></div> Buscando programas...";
    
    try {
        const [snapAsis, snapSorteos] = await Promise.all([ 
            window.obtenerAsistencias(), 
            get(ref(db, '6_sorteos_fechas_usadas')) 
        ]);
        
        if (!snapAsis.exists()) return contenedorFechas.innerHTML = "<p class='text-muted'>No hay asistencias registradas.</p>";
        
        const todas = snapAsis.val();
        const fechasUsadas = snapSorteos.exists() ? snapSorteos.val() : {};
        let fechasDalePlay = [];
        
        for (const fecha in todas) {
            for (const prog in todas[fecha]) {
                if (prog.includes("Dale Play")) { // Mantenemos Solo Dale Play
                    if (!fechasUsadas[fecha] && !fechasDalePlay.includes(fecha)) {
                        fechasDalePlay.push(fecha);
                    }
                }
            }
        }
        
        if (fechasDalePlay.length === 0) return contenedorFechas.innerHTML = "<p class='text-success fw-bold'>✅ No hay fechas nuevas disponibles para sortear.</p>";
        
        fechasDalePlay.sort().reverse();
        
        let htmlFechas = "";
        fechasDalePlay.forEach(fecha => {
            htmlFechas += `
            <div class="form-check" style="background: #1a1a1a; padding: 12px 15px 12px 40px; border: 1px solid #444; border-radius: 8px; width: 100%; max-width: 260px;">
                <input class="form-check-input check-sorteo" type="checkbox" value="${fecha}" id="chk_${fecha}" checked style="transform: scale(1.4); margin-top: 8px; cursor: pointer;">
                <label class="form-check-label fw-bold ms-2 text-white" for="chk_${fecha}" style="cursor: pointer; width: 100%;">
                    🎬 Dale Play<br><small class="text-warning">${fecha}</small>
                </label>
            </div>`;
        });
        
        contenedorFechas.innerHTML = htmlFechas;
        
    } catch (e) {
        contenedorFechas.innerHTML = "<p class='text-danger'>Error al cargar las fechas.</p>";
    }
});

if (document.getElementById('btnRealizarSorteo')) document.getElementById('btnRealizarSorteo').addEventListener('click', async () => {
    const checkboxes = document.querySelectorAll('.check-sorteo:checked');
    const fechasSeleccionadas = Array.from(checkboxes).map(cb => cb.value);
    const totalFechasRequeridas = fechasSeleccionadas.length;
    
    if (totalFechasRequeridas === 0) return alert("Debes seleccionar al menos una fecha de Dale Play para el sorteo.");
    
    const btnSorteo = document.getElementById('btnRealizarSorteo');
    btnSorteo.innerText = "🎰 Filtrando asistencia perfecta y girando ruleta...";
    btnSorteo.disabled = true;
    if (document.getElementById('resultadoSorteo')) document.getElementById('resultadoSorteo').classList.add('d-none');
    
    try {
        const [asisSnap, trabSnap] = await Promise.all([ 
            window.obtenerAsistencias(), 
            window.obtenerTrabajadores() 
        ]);
        
        if (!asisSnap.exists()) throw new Error("No hay datos");
        
        const todas = asisSnap.val();
        const trabajadores = trabSnap.exists() ? trabSnap.val() : {};
        let candidatosPerfectos = []; 
        
        for (const rut in trabajadores) {
            let asistenciasConfirmadas = 0;
            
            fechasSeleccionadas.forEach(fecha => {
                let asistioEnEstaFecha = false;
                for (const prog in todas[fecha]) {
                    if (prog.includes("Dale Play") && todas[fecha][prog][rut]) {
                        asistioEnEstaFecha = true;
                    }
                }
                if (asistioEnEstaFecha) asistenciasConfirmadas++;
            });
            
            if (asistenciasConfirmadas === totalFechasRequeridas) {
                candidatosPerfectos.push(rut);
            }
        }
        
        if (candidatosPerfectos.length === 0) {
            setTimeout(() => {
                if (document.getElementById('ganadorNombre')) document.getElementById('ganadorNombre').innerText = "SIN GANADOR 😔";
                if (document.getElementById('ganadorRut')) document.getElementById('ganadorRut').innerText = "";
                if (document.getElementById('ganadorFechas')) document.getElementById('ganadorFechas').innerText = "Ninguna persona cumplió con el requisito de asistir a TODAS las fechas seleccionadas.";
                
                if (document.getElementById('resultadoSorteo')) document.getElementById('resultadoSorteo').classList.remove('d-none');
                btnSorteo.innerText = "🔄 Intentar con otras fechas";
                btnSorteo.disabled = false;
            }, 1000);
            return;
        }
        
        const indiceAleatorio = Math.floor(Math.random() * candidatosPerfectos.length);
        const rutGanador = candidatosPerfectos[indiceAleatorio];
        const trabGanador = trabajadores[rutGanador];
        
        let updatesSorteo = {};
        fechasSeleccionadas.forEach(f => updatesSorteo[`6_sorteos_fechas_usadas/${f}`] = true);
        await update(ref(db), updatesSorteo);

        setTimeout(() => {
            if (document.getElementById('ganadorNombre')) document.getElementById('ganadorNombre').innerText = `${trabGanador.nombres.toUpperCase()} ${trabGanador.apellidos.toUpperCase()}`;
            if (document.getElementById('ganadorRut')) document.getElementById('ganadorRut').innerText = `RUT Acreditado: ${rutGanador}`;
            if (document.getElementById('ganadorFechas')) document.getElementById('ganadorFechas').innerText = `🏅 ASISTENCIA PERFECTA: Asistió a las ${totalFechasRequeridas} fechas requeridas (Total de personas en la tómbola: ${candidatosPerfectos.length}).`;
            
            if (document.getElementById('resultadoSorteo')) document.getElementById('resultadoSorteo').classList.remove('d-none');
            btnSorteo.innerText = "🔄 Realizar otro Sorteo";
            btnSorteo.disabled = false;
        }, 2000);
        
    } catch (e) {
        alert("Error al realizar el sorteo.");
        if(btnSorteo) btnSorteo.innerText = "🎁 ¡Girar la Ruleta Mágica!";
        if(btnSorteo) btnSorteo.disabled = false;
    }
});

// ==========================================
// MANTENIMIENTO - AUTORIZACIONES MENORES
// ==========================================
async function renderPanelMenoresBatch(cargar) {
    let mantTab = document.getElementById('mantenimiento-tab');
    if(!mantTab) return;
    
    // INYECCIÓN DE EMERGENCIA
    let tabPaneEmergencia = document.getElementById('btnRespaldoMaestro') ? document.getElementById('btnRespaldoMaestro').closest('.tab-pane') : null;
    if (!tabPaneEmergencia) {
        try {
            tabPaneEmergencia = document.getElementById('btnRespaldoMaestro').parentElement.parentElement.parentElement;
        } catch(e){}
    }
    
    if (tabPaneEmergencia && !document.getElementById('btnRestaurarSueldosError')) {
        let divEmergencia = document.createElement('div');
        divEmergencia.className = "mt-4 p-4 shadow-lg w-100 mb-4";
        divEmergencia.style.background = "rgba(255, 153, 0, 0.1)";
        divEmergencia.style.border = "3px dashed #ff9900";
        divEmergencia.style.borderRadius = "8px";
        divEmergencia.innerHTML = `
            <h5 class="text-warning fw-bold text-center mb-2">🩹 Herramienta de Emergencia (Sueldos)</h5>
            <p class="text-white text-center mb-3" style="font-size: 0.9em;">Si cerraste un día y el sistema descontó la plata por error, usa este botón para restaurar el valor original a toda la sala de un golpe.</p>
            <button class="btn btn-warning fw-bold w-100 py-3 fs-4 text-dark shadow-sm" id="btnRestaurarSueldosError" style="border-radius: 8px;">
                💰 Restaurar Sueldos de la Jornada
            </button>
        `;
        tabPaneEmergencia.appendChild(divEmergencia);
    }

    let container = document.getElementById('panelMenoresBatch');
    if (!container) {
        let baseEl = document.getElementById('btnRespaldoMaestro');
        if (baseEl) {
            let tabPane = baseEl.closest('.tab-pane');
            if(!tabPane) tabPane = baseEl.parentElement.parentElement.parentElement;
            container = document.createElement('div');
            container.id = 'panelMenoresBatch';
            container.className = 'card bg-dark border-warning mt-5 p-4 shadow-lg w-100';
            tabPane.appendChild(container);
        } else {
            return;
        }
    }
    
    // Ahorro de descargas: los permisos traen la firma del apoderado y pesan bastante;
    // se bajan solo cuando se piden con el botón (el clic en la pestaña no los descarga).
    if (cargar !== true) {
        container.innerHTML = `
            <div class="text-center">
                <h4 class="text-warning mb-2">🚸 Permisos Notariales Menores</h4>
                <p class="text-muted mb-3" style="font-size: 0.95em;">Se cargan solo cuando los necesites (incluyen la firma del apoderado).</p>
                <button class="btn btn-warning fw-bold py-3 shadow w-100 fs-5 text-dark" id="btnVerPermisosMenores" style="border-radius: 10px;">🚸 Ver permisos de menores</button>
            </div>`;
        document.getElementById('btnVerPermisosMenores').addEventListener('click', () => renderPanelMenoresBatch(true));
        return;
    }
    
    container.innerHTML = '<div class="text-warning fs-5 text-center">⏳ Revisando Permisos de Menores...</div>';
    try {
        const snap = await get(ref(db, '8_autorizaciones_menores'));
        if (!snap.exists()) {
            container.innerHTML = '<div class="text-success text-center fw-bold fs-5 p-2">✅ No hay permisos notariales de menores pendientes.</div>';
            return;
        }
        
        const datosMenores = snap.val();
        let totalPermisos = 0;
        let flatPermisos = [];
        
        for (const fecha in datosMenores) {
            for (const prog in datosMenores[fecha]) {
                for (const rut in datosMenores[fecha][prog]) {
                    totalPermisos++;
                    flatPermisos.push({
                        ...datosMenores[fecha][prog][rut],
                        rutaDB: `8_autorizaciones_menores/${fecha}/${prog}/${rut}`
                    });
                }
            }
        }
        
        if (totalPermisos === 0) {
            container.innerHTML = '<div class="text-success text-center fw-bold fs-5 p-2">✅ No hay permisos notariales de menores pendientes.</div>';
            return;
        }
        
        container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-3 border-bottom border-warning pb-2">
                <h4 class="text-warning mb-0">🚸 Permisos Notariales Menores (${totalPermisos})</h4>
            </div>
            <p class="text-muted" style="font-size: 0.95em;">Descarga el ZIP con las autorizaciones firmadas por los apoderados, organizadas por carpetas de eventos.</p>
            
            <button class="btn btn-warning fw-bold py-3 shadow w-100 fs-5 text-dark" id="btnDescargarZipMenores" style="border-radius: 10px;">
                📥 Descargar ZIP con los ${totalPermisos} Permisos
            </button>
            
            <div id="zonaEliminarMenores" class="d-none mt-4 p-3" style="background: rgba(255, 0, 0, 0.1); border: 2px dashed #ff3333; border-radius: 8px;">
                <h5 class="text-danger fw-bold text-center mb-3">⚠️ Zona de Limpieza Segura</h5>
                <p class="text-white text-center mb-3" style="font-size: 0.9em;">¿Ya descargaste el ZIP y confirmaste que los permisos están adentro?<br>Si es así, borra los registros de la nube.</p>
                <button class="btn btn-danger fw-bold w-100 py-2 fs-5" id="btnVaciarMenores" style="border-radius: 8px;">
                    🗑️ Sí, Eliminar los ${totalPermisos} permisos de la Nube
                </button>
            </div>
        `;
        
        if(document.getElementById('btnDescargarZipMenores')) document.getElementById('btnDescargarZipMenores').addEventListener('click', async () => {
            const btn = document.getElementById('btnDescargarZipMenores');
            btn.innerText = "⏳ Empaquetando ZIP de Menores...";
            btn.disabled = true;
            
            try {
                const zip = new JSZip();
                const { jsPDF } = window.jspdf;
                
                flatPermisos.forEach(auto => {
                    const doc = new jsPDF();
                    doc.setFont("helvetica", "bold"); doc.setFontSize(14);
                    doc.text("AUTORIZACIÓN PARA SER PÚBLICO", 105, 20, null, null, "center");
                    
                    doc.setFont("helvetica", "normal"); doc.setFontSize(11);
                    
                    const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
                    const partesFecha = auto.fecha_programa.split('-');
                    const dia = partesFecha[2];
                    const mes = meses[parseInt(partesFecha[1]) - 1];
                    const anio = partesFecha[0];

                    const texto = `En Santiago de Chile a ${dia} de ${mes} de ${anio}, yo ${auto.nombre_apoderado}, de nacionalidad ${auto.nacionalidad_apoderado}, profesión/oficio ${auto.profesion_apoderado}, con domicilio en ${auto.domicilio_apoderado}, Cédula de Identidad (del adulto) N° ${auto.rut_apoderado}, en mi calidad de ${auto.relacion_apoderado} del menor ${auto.nombre_menor}, Cédula de Identidad N° ${auto.rut_menor}, de ${auto.edad_menor} años de edad, vengo en otorgar mi autorización expresa para que mi hijo(a)/pupilo(a) pueda desempeñarse como público invitado con la empresa RAZÓN SOCIAL: Camila Alejandra Fevre Seguel E.I.R.L. Producción. NOMBRE DE FANTASÍA: Nat Producciones

1. Objeto de la Autorización
El menor queda autorizado para participar en las siguientes actividades:
• Participar como público en programas de televisión del canal Mega. (Dale Play)

2. Condiciones de Seguridad y Bienestar
Declaro haber sido informado(a) de que la productora garantiza las condiciones de seguridad y dignidad para el menor durante la jornada:
• Presencia de un Prevencionista de Riesgos en terreno.
• Acceso a servicio de Enfermería y primeros auxilios.
• Suministro de agua potable, servicios higiénicos y cobertura de necesidades básicas.

3. Declaración de Cumplimiento Legal
Las labores no interrumpirán los estudios del menor ni perjudicarán su salud o desarrollo físico y moral.

La presente autorización es válida para la temporada de primavera-verano 2026-2027. (Septiembre a Marzo).`;
                    
                    const lineas = doc.splitTextToSize(texto, 170);
                    doc.text(lineas, 20, 40);
                    
                    if (auto.firma_apoderado) {
                        try { doc.addImage(auto.firma_apoderado, 'JPEG', 65, 140, 80, 25); } catch(e) {}
                    }
                    
                    doc.setFont("helvetica", "bold");
                    doc.text("_________________________________", 105, 170, null, null, "center");
                    doc.text("Firma del apoderado", 105, 175, null, null, "center");
                    doc.setFont("helvetica", "normal");
                    doc.text("Nombre completo del apoderado: " + auto.nombre_apoderado, 105, 185, null, null, "center");
                    doc.text("RUN/Cédula de Identidad: " + auto.rut_apoderado, 105, 190, null, null, "center");
                    doc.text("Fecha: " + dia + "/" + partesFecha[1] + "/" + anio, 105, 195, null, null, "center");
                    
                    const pdfBlob = doc.output('blob');
                    const safeMenor = auto.nombre_menor.replace(/[^a-zA-Z0-9]/g, "_");
                    const nombreCarpeta = `${auto.fecha_programa}_${auto.nombre_programa.replace(/[^a-zA-Z0-9\-]/g, "_")}`;
                    
                    zip.folder(nombreCarpeta).file(`Permiso_Menor_${safeMenor}_${auto.rut_menor}.pdf`, pdfBlob);
                });
                
                const zipContent = await zip.generateAsync({type:"blob"});
                const a = document.createElement("a");
                a.href = URL.createObjectURL(zipContent);
                a.download = `Permisos_Notariales_Menores_${new Date().toISOString().split('T')[0]}.zip`;
                a.click();
                
                btn.innerText = "✅ ZIP Descargado Exitosamente";
                if (document.getElementById('zonaEliminarMenores')) document.getElementById('zonaEliminarMenores').classList.remove('d-none');
                
            } catch(e) {
                alert("Error armando el ZIP: " + e.message);
                btn.innerText = "📥 Intentar de nuevo";
                btn.disabled = false;
            }
        });
        
        if (document.getElementById('btnVaciarMenores')) document.getElementById('btnVaciarMenores').addEventListener('click', async () => {
            if(confirm(`⚠️ ALERTA DE BORRADO ⚠️\n\n¿Confirmas que abriste el archivo ZIP y los permisos están guardados?\n\nSi aceptas, estos registros se eliminarán de la base de datos para no mezclarse con los de mañana.`)) {
                await remove(ref(db, '8_autorizaciones_menores'));
                alert("✅ Carpeta de permisos de menores ha sido vaciada.");
                renderPanelMenoresBatch(true);
            }
        });
        
    } catch(e) {
        console.error("Error cargando menores:", e);
        if (container) container.innerHTML = `<div class="text-danger text-center fw-bold">❌ Error al cargar permisos.<br><small class="text-muted">${e.message}</small></div>`;
    }
}

// Botón de Emergencia para Restaurar Sueldos
document.body.addEventListener('click', async (e) => {
    if (e.target && e.target.id === 'btnRestaurarSueldosError') {
        let fec = prompt("Ingresa la FECHA del programa que se cerró mal (Ej: 2026-09-10):", new Date().toISOString().split('T')[0]);
        if(!fec) return;
        let prog = prompt("Ingresa el NOMBRE EXACTO del programa:", "Detrás del Muro");
        if(!prog) return;
        let montoReal = prompt(`¿Cuál era el SUELDO BASE REAL (100%) que debían recibir hoy por ${prog}? (Sin puntos)`, "10000");
        if(!montoReal) return;
        
        montoReal = parseInt(montoReal);
        
        try {
            const btn = document.getElementById('btnRestaurarSueldosError');
            if(btn) {
                btn.innerText = "⏳ Restaurando...";
                btn.disabled = true;
            }
            
            const snap = await get(ref(db, `2_asistencias/${fec}/${prog}`));
            if (!snap.exists()) {
                if(btn) {
                    btn.innerText = "💰 Restaurar Sueldos de la Jornada";
                    btn.disabled = false;
                }
                return alert("❌ No se encontró ese programa en esa fecha. Revisa que el nombre y fecha sean exactos (ej: 'Detrás del Muro').");
            }
            
            let asistentes = snap.val();
            let updates = {};
            let count = 0;
            
            for(let rut in asistentes) {
                if (asistentes[rut].tipo_ingreso !== "Cortesía") {
                    let bonos = parseInt(asistentes[rut].bono_horas_extras) || 0;
                    updates[`2_asistencias/${fec}/${prog}/${rut}/monto`] = montoReal + bonos;
                    count++;
                }
            }
            if (count > 0) {
                await update(ref(db), updates);
        window.limpiarCache();
                alert(`✅ ¡ÉXITO! Se restauraron los sueldos al 100% ($${montoReal}) a las ${count} personas afectadas.`);
            } else {
                alert("No habían personas de pago en esa sala.");
            }
            if(btn) {
                btn.innerText = "💰 Restaurar Sueldos de la Jornada";
                btn.disabled = false;
            }
        } catch(err) {
            alert("Error: " + err.message);
            const btn = document.getElementById('btnRestaurarSueldosError');
            if(btn) {
                btn.innerText = "💰 Restaurar Sueldos de la Jornada";
                btn.disabled = false;
            }
        }
    }
});


// ==========================================
// CESIONES MEGAMEDIA
// ==========================================
if (document.getElementById('cesiones-tab')) document.getElementById('cesiones-tab').addEventListener('click', cargarPanelCesiones);
if (document.getElementById('btnRefrescarCesiones')) document.getElementById('btnRefrescarCesiones').addEventListener('click', () => cargarPanelCesiones(true));

async function cargarPanelCesiones(forzar = false) {
    const contenedor = document.getElementById('contenedorCesionesMega');
    if (!contenedor) return;
    
    contenedor.innerHTML = "<div class='text-center'><div class='spinner-border text-warning'></div></div>";

    try {
        const [asisSnap, trabSnap] = await Promise.all([ window.obtenerAsistencias(forzar === true), window.obtenerTrabajadores(forzar === true) ]);
        
        if (!asisSnap.exists()) {
            contenedor.innerHTML = "<div class='alert alert-success text-center fw-bold'>✅ No hay asistencias registradas.</div>";
            return;
        }

        const todas = asisSnap.val();
        let agrupacionCesiones = {};

        // Agrupar por Programa -> Semana -> Fechas y Cantidad Total
        for (const fecha in todas) {
            const weekInfo = getWeekIdentifier(fecha);
            for (const prog in todas[fecha]) {
                if (!agrupacionCesiones[prog]) agrupacionCesiones[prog] = {};
                if (!agrupacionCesiones[prog][weekInfo.sortKey]) {
                    agrupacionCesiones[prog][weekInfo.sortKey] = {
                        label: weekInfo.label,
                        fechas: [],
                        total: 0
                    };
                }
                agrupacionCesiones[prog][weekInfo.sortKey].fechas.push(fecha);
                agrupacionCesiones[prog][weekInfo.sortKey].total += Object.keys(todas[fecha][prog]).length;
            }
        }

        if (Object.keys(agrupacionCesiones).length === 0) {
            contenedor.innerHTML = "<div class='alert alert-warning text-center fw-bold'>No se encontraron registros.</div>";
            return;
        }

        let html = '<div class="accordion" id="accCesiones">';
        let pIdx = 0;
        
        for (const prog of Object.keys(agrupacionCesiones).sort()) {
            pIdx++;
            html += `
            <div class="accordion-item" style="border: 1px solid #ff9900; margin-bottom: 10px; background: #1a1a1a;">
                <h2 class="accordion-header">
                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#cesProg_${pIdx}" style="background: #331a00; color: #ff9900; font-size: 1.1em; font-weight:bold;">
                        📺 ${prog.replace(" - ", " / ")}
                    </button>
                </h2>
                <div id="cesProg_${pIdx}" class="accordion-collapse collapse" data-bs-parent="#accCesiones">
                    <div class="accordion-body p-0" style="background: #141414;">
                        <ul class="list-group list-group-flush">`;
            
            const weeksDesc = Object.keys(agrupacionCesiones[prog]).sort().reverse();
            for (const wk of weeksDesc) {
                const dataWeek = agrupacionCesiones[prog][wk];
                const fechasStr = dataWeek.fechas.join(',');
                
                html += `
                            <li class="list-group-item d-flex flex-column flex-md-row justify-content-between align-items-md-center" style="background: transparent; color: white; border-bottom: 1px solid #333;">
                                <div class="mb-2 mb-md-0">
                                    <strong class="text-white fs-5">📅 ${dataWeek.label}</strong><br>
                                    <span class="badge bg-secondary">${dataWeek.total} personas en ${dataWeek.fechas.length} día(s)</span>
                                    <p class="mb-0 mt-1 small text-muted">Fechas: ${dataWeek.fechas.sort().reverse().map(f => f.split('-').reverse().join('-')).join(', ')}</p>
                                </div>
                                <button class="btn btn-warning fw-bold text-dark shadow-sm" onclick="window.descargarZIPCesionesSemana(event, '${prog}', '${dataWeek.label}', '${fechasStr}')">
                                    📥 Descargar ZIP Semanal
                                </button>
                            </li>`;
            }
            
            html += `   </ul>
                    </div>
                </div>
            </div>`;
        }
        html += '</div>';
        contenedor.innerHTML = html;

    } catch (e) {
        contenedor.innerHTML = "<p class='text-danger text-center'>Error al cargar los datos.</p>";
    }
}

window.descargarZIPCesionesSemana = async function(event, prog, weekLabel, fechasStr) {
    const btnId = event.target;
    const textoOriginal = btnId.innerText;
    btnId.innerText = "⏳ Generando PDFs... (Puede tardar)";
    btnId.disabled = true;

    try {
        const fechas = fechasStr.split(',');
        const zip = new JSZip();
        const { jsPDF } = window.jspdf;
        let generados = 0;

        const trabSnap = await window.obtenerTrabajadores();
        const trabajadores = trabSnap.exists() ? trabSnap.val() : {};

        for (const fecha of fechas) {
            const asisSnap = await get(ref(db, `2_asistencias/${fecha}/${prog}`));
            if (!asisSnap.exists()) continue;

            const asistentes = asisSnap.val();
            let firmasProgCesion = null;

            for (const rut in asistentes) {
                const asis = asistentes[rut];
                const trab = trabajadores[rut] || { nombres: "Desconocido", apellidos: "", telefono: "-" };
                
                let firmaCesion = asis.firma_digital || null;
                if (!firmaCesion && asis.tiene_firma) {
                    if (firmasProgCesion === null) firmasProgCesion = await window.obtenerFirmasPrograma(fecha, prog);
                    firmaCesion = firmasProgCesion[rut] || null;
                }
                
                if (firmaCesion) {
                    const nombreCompleto = `${trab.nombres || ''} ${trab.apellidos || ''}`.toUpperCase();
                    const doc = new jsPDF({ format: 'letter' });
                    window.dibujarCesionMegamedia(doc, { fecha, nombre: nombreCompleto.trim(), rut, telefono: trab.telefono || '', firma: firmaCesion });

                    const nombreCompletoLimpio = nombreCompleto.replace(/[^a-zA-Z0-9_]/g, "");
                    const pdfBlob = doc.output('blob');
                    
                    // Organize inside the ZIP by date folder
                    zip.folder(fecha).file(`Cesion_MEGAMEDIA_${nombreCompletoLimpio}_${rut}.pdf`, pdfBlob);
                    generados++;
                }
            }
        }

        if (generados === 0) {
            alert("No se encontraron firmas digitales en este grupo.");
            btnId.innerText = textoOriginal;
            btnId.disabled = false;
            return;
        }

        const zipContent = await zip.generateAsync({type:"blob"});
        const a = document.createElement("a");
        a.href = URL.createObjectURL(zipContent);
        a.download = `Cesiones_${prog.replace(/[ \/]/g, "_")}_${weekLabel.replace(/ /g, "_")}.zip`;
        a.click();

        btnId.innerText = "✅ Descargado";
        setTimeout(() => {
            btnId.innerText = textoOriginal;
            btnId.disabled = false;
        }, 3000);

    } catch (e) {
        alert("Error al generar el ZIP: " + e.message);
        btnId.innerText = textoOriginal;
        btnId.disabled = false;
    }
}
// Inicializar
const tabMant = document.getElementById('mantenimiento-tab');
if (tabMant) {
    tabMant.addEventListener('click', renderPanelMenoresBatch);
}
// Ahorro de descargas: las autorizaciones de menores se cargan solo al abrir Mantenimiento


// ==========================================
// PREVIRED: ARCHIVO DE CARGA MASIVA (FORMATO LARGO VARIABLE POR SEPARADOR, 105 CAMPOS)
// Formato oficial Previred versión 82 (rige desde remuneraciones de agosto 2025).
// Los parámetros (tasas y códigos) son editables y se guardan en 0_estado_sistema/config_previred
// ==========================================
const RUTA_CONFIG_PREVIRED = '0_estado_sistema/config_previred';

const CONFIG_PREVIRED_BASE = {
    confirmado: false,
    salud: 7,
    sis: 1.78,
    expectativaVida: 0.72,
    rentabilidadProtegida: 0.9,
    cuentaIndividualEmpleador: 0.1,
    sumarCuentaIndividualEnAFP: true,
    isl: 0.93,
    cesantiaEmpleador: 3.0,
    cesantiaTrabajador: 0,
    codigoMovimiento: 7,
    tipoJornada: 1,
    lre: { rutEmpresa: "76932592-1", region: 13, comuna: 13102, jornada: 101, causal: 7, tipoImpuesto: 1, utm: 71721 },
    afpPorDefecto: "",
    afps: {
        CAPITAL:   { nombre: "Capital",   codigo: "33", lre: "31",  tasa: 11.44 },
        CUPRUM:    { nombre: "Cuprum",    codigo: "03", lre: "13",  tasa: 11.44 },
        HABITAT:   { nombre: "Habitat",   codigo: "05", lre: "14",  tasa: 11.27 },
        MODELO:    { nombre: "Modelo",    codigo: "34", lre: "103", tasa: 10.58 },
        PLANVITAL: { nombre: "PlanVital", codigo: "29", lre: "11",  tasa: 11.16 },
        PROVIDA:   { nombre: "ProVida",   codigo: "08", lre: "6",   tasa: 11.45 },
        UNO:       { nombre: "Uno",       codigo: "35", lre: "19",  tasa: 10.46 },
        NO_COTIZA: { nombre: "No cotiza", codigo: "00", lre: "100", tasa: 0, sinAfp: true }
    },
    saludes: {
        FONASA:       { nombre: "Fonasa",        codigo: "07", lre: "102" },
        BANMEDICA:    { nombre: "Banmédica",     codigo: "01", lre: "3" },
        CONSALUD:     { nombre: "Consalud",      codigo: "02", lre: "9" },
        VIDATRES:     { nombre: "Vida Tres",     codigo: "03", lre: "12" },
        COLMENA:      { nombre: "Colmena",       codigo: "04", lre: "4" },
        CRUZBLANCA:   { nombre: "Cruz Blanca",   codigo: "05", lre: "1" },
        NUEVAMASVIDA: { nombre: "Nueva Masvida", codigo: "10", lre: "43" },
        ESENCIAL:     { nombre: "Esencial",      codigo: "28", lre: "44" }
    }
};

window.configPrevired = JSON.parse(JSON.stringify(CONFIG_PREVIRED_BASE));
window.filasPrevired = [];
let mesPreviredActual = "";

// Ajustes manuales por mes (días/líquido editados y personas del sistema anterior)
// Se guardan en 11_previred_ajustes/{mes} (solo staff). Si Firebase no da permiso, quedan en este computador.
const RUTA_AJUSTES_PREVIRED = '11_previred_ajustes';
window.ajustesPrevired = {};
let ajustesPreviredSoloLocal = false;

async function cargarAjustesPrevired(mes) {
    window.ajustesPrevired = {};
    ajustesPreviredSoloLocal = false;
    try {
        const snap = await get(ref(db, `${RUTA_AJUSTES_PREVIRED}/${mes}`));
        if (snap.exists()) window.ajustesPrevired = snap.val() || {};
    } catch (e) {
        console.warn("No se pudieron leer los ajustes Previred desde Firebase, se usan los de este computador", e);
        ajustesPreviredSoloLocal = true;
        try { window.ajustesPrevired = JSON.parse(window.localStorage.getItem('ajustesPrevired_' + mes) || '{}'); } catch (e2) { window.ajustesPrevired = {}; }
    }
}

async function guardarAjustesPrevired() {
    const mes = mesPreviredActual;
    if (!mes) return;
    try { window.localStorage.setItem('ajustesPrevired_' + mes, JSON.stringify(window.ajustesPrevired)); } catch (e) {}
    try {
        await set(ref(db, `${RUTA_AJUSTES_PREVIRED}/${mes}`), window.ajustesPrevired);
        ajustesPreviredSoloLocal = false;
    } catch (e) {
        console.warn("Ajustes Previred guardados solo en este computador (falta permiso en Firebase)", e);
        if (!ajustesPreviredSoloLocal) alert("⚠️ Los cambios se guardaron SOLO en este computador porque Firebase no dio permiso sobre '11_previred_ajustes'.\nAplica las reglas v2 para que queden guardados para todo el equipo.");
        ajustesPreviredSoloLocal = true;
    }
}

// Lee de Firebase SOLO las asistencias del mes (datos frescos, sin depender del caché)
window.leerAsistenciasMes = async function(mes) {
    const q = query(ref(db, '2_asistencias'), orderByKey(), startAt(mes + '-01'), endAt(mes + '-31'));
    const snap = await get(q);
    return snap.exists() ? snap.val() : {};
};

async function leerAjustesPreviredMes(mes) {
    try {
        const snap = await get(ref(db, `${RUTA_AJUSTES_PREVIRED}/${mes}`));
        return snap.exists() ? (snap.val() || {}) : {};
    } catch (e) {
        try { return JSON.parse(window.localStorage.getItem('ajustesPrevired_' + mes) || '{}'); } catch (e2) { return {}; }
    }
}

function fechaISOPrevired(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function numPrevired(v) {
    const n = parseFloat(String(v).replace(',', '.'));
    return isNaN(n) ? 0 : n;
}

function limpiarTextoPrevired(txt, largo) {
    return String(txt || "")
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[ñÑ]/g, 'N')
        .toUpperCase()
        .replace(/[^A-Z ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, largo);
}

// Separa "apellidos" (un solo campo en la ficha) en paterno y materno,
// manteniendo juntos los apellidos compuestos: San Martín, De la Fuente, Santa Cruz, La Torre, etc.
function separarApellidosPrevired(texto) {
    const particulas = ['DE', 'DEL', 'LA', 'LAS', 'LOS', 'SAN', 'SANTA', 'DA', 'DAS', 'DO', 'DOS', 'DI', 'VAN', 'VON', 'DER', 'MAC', 'MC'];
    const palabras = limpiarTextoPrevired(texto, 200).split(' ').filter(Boolean);
    const grupos = [];
    let actual = [];
    for (const p of palabras) {
        actual.push(p);
        if (!particulas.includes(p)) { grupos.push(actual.join(' ')); actual = []; }
    }
    if (actual.length) grupos.push(actual.join(' '));
    return {
        paterno: (grupos[0] || '').substring(0, 30),
        materno: grupos.slice(1).join(' ').substring(0, 30),
        dudoso: grupos.length > 2
    };
}

function validarRutPrevired(rutCompleto) {
    const limpio = String(rutCompleto || "").replace(/\./g, '').trim().toUpperCase();
    const m = limpio.match(/^(\d{1,9})-([\dK])$/);
    if (!m) return null;
    let cuerpo = parseInt(m[1], 10), suma = 0, mult = 2;
    for (let n = cuerpo; n > 0; n = Math.floor(n / 10)) {
        suma += (n % 10) * mult;
        mult = mult === 7 ? 2 : mult + 1;
    }
    const resto = 11 - (suma % 11);
    const dvEsperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
    if (dvEsperado !== m[2]) return null;
    return { cuerpo: m[1], dv: m[2] };
}

function fechaPrevired(d) {
    return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

async function cargarConfigPrevired() {
    try {
        const snap = await get(ref(db, RUTA_CONFIG_PREVIRED));
        const base = JSON.parse(JSON.stringify(CONFIG_PREVIRED_BASE));
        if (snap.exists()) {
            const guardada = snap.val();
            const afps = {};
            for (const k in base.afps) {
                const tasaGuardada = guardada.afps && guardada.afps[k] ? numPrevired(guardada.afps[k].tasa) : 0;
                afps[k] = { ...base.afps[k], tasa: base.afps[k].sinAfp ? 0 : (tasaGuardada > 0 ? tasaGuardada : base.afps[k].tasa) }; // códigos fijos, % editable (No cotiza = 0%)
            }
            window.configPrevired = { ...base, ...guardada, afps, saludes: JSON.parse(JSON.stringify(base.saludes)), lre: { ...base.lre, ...(guardada.lre || {}) } };
        } else {
            window.configPrevired = base;
        }
    } catch (e) {
        console.error("No se pudo leer la configuración Previred", e);
    }
}

function renderParametrosPrevired() {
    const cont = document.getElementById('contParametrosPrevired');
    if (!cont) return;
    const c = window.configPrevired;
    const inp = (id, val, paso = "0.01") => `<input type="number" step="${paso}" class="form-control form-control-sm bg-dark text-white" id="${id}" value="${val}">`;

    let filasAfp = '';
    for (const k in c.afps) {
        filasAfp += `<tr><td class="text-white">${c.afps[k].nombre}</td>
            <td class="text-center text-info fw-bold">${c.afps[k].codigo}</td>
            <td class="text-center text-info fw-bold">${c.afps[k].lre}</td>
            <td>${c.afps[k].sinAfp ? '<span class="text-info fw-bold">0% (fijo)</span>' : `<input type="number" step="0.01" class="form-control form-control-sm bg-dark text-white prev-afp-tasa" data-k="${k}" value="${c.afps[k].tasa}">`}</td></tr>`;
    }
    let filasSalud = '';
    for (const k in c.saludes) {
        filasSalud += `<tr><td class="text-white">${c.saludes[k].nombre}</td>
            <td class="text-center text-info fw-bold">${c.saludes[k].codigo}</td>
            <td class="text-center text-info fw-bold">${c.saludes[k].lre}</td></tr>`;
    }
    let opcionesAfpDef = `<option value="">— No usar (obligar a corregir) —</option>`;
    for (const k in c.afps) opcionesAfpDef += `<option value="${k}" ${c.afpPorDefecto === k ? 'selected' : ''}>${c.afps[k].nombre}</option>`;

    const aviso = c.confirmado ? '' : `<div class="alert alert-warning py-2 small fw-bold">⚠️ Parámetros sin confirmar. Revísalos con los Indicadores Previsionales de Previred del mes y presiona "Guardar parámetros".</div>`;

    cont.innerHTML = `
        ${aviso}
        <div class="row g-3">
            <div class="col-lg-5">
                <h6 class="text-info fw-bold">AFP (códigos fijos · % editable)</h6>
                <table class="table table-dark table-sm align-middle mb-0"><thead><tr><th>AFP</th><th class="text-center">Cód. Previred</th><th class="text-center">Cód. LRE</th><th>% Trabajador</th></tr></thead><tbody>${filasAfp}</tbody></table>
            </div>
            <div class="col-lg-3">
                <h6 class="text-info fw-bold">Salud (códigos fijos)</h6>
                <table class="table table-dark table-sm align-middle mb-0"><thead><tr><th>Institución</th><th class="text-center">Cód. Previred</th><th class="text-center">Cód. LRE</th></tr></thead><tbody>${filasSalud}</tbody></table>
            </div>
            <div class="col-lg-4">
                <h6 class="text-info fw-bold">Tasas (%)</h6>
                <div class="row g-2 small text-white">
                    <div class="col-7">Salud (7%)</div><div class="col-5">${inp('prevSalud', c.salud)}</div>
                    <div class="col-7">Seguro Invalidez (SIS)</div><div class="col-5">${inp('prevSis', c.sis)}</div>
                    <div class="col-7">Expectativa de Vida</div><div class="col-5">${inp('prevCev', c.expectativaVida)}</div>
                    <div class="col-7">Rentabilidad Protegida</div><div class="col-5">${inp('prevCrp', c.rentabilidadProtegida)}</div>
                    <div class="col-7">Cuenta individual (empleador)</div><div class="col-5">${inp('prevCi', c.cuentaIndividualEmpleador)}</div>
                    <div class="col-12"><div class="form-check"><input class="form-check-input" type="checkbox" id="prevSumarCi" ${c.sumarCuentaIndividualEnAFP ? 'checked' : ''}><label class="form-check-label" for="prevSumarCi">Sumar cuenta individual a la cotización AFP (campo 28)</label></div></div>
                    <div class="col-7">Tasa ISL</div><div class="col-5">${inp('prevIsl', c.isl)}</div>
                    <div class="col-7">Seg. Cesantía empleador</div><div class="col-5">${inp('prevAfcEmp', c.cesantiaEmpleador)}</div>
                    <div class="col-7">Seg. Cesantía trabajador</div><div class="col-5">${inp('prevAfcTrab', c.cesantiaTrabajador)}</div>
                    <div class="col-7">Código movimiento (7 = plazo fijo)</div><div class="col-5">${inp('prevMov', c.codigoMovimiento, "1")}</div>
                    <div class="col-7">Tipo de jornada (1 completa, 2 parcial)</div><div class="col-5">${inp('prevJornada', c.tipoJornada || 1, "1")}</div>
                    <div class="col-12 mt-2">AFP para quien no sabe su AFP:
                        <select id="prevAfpDef" class="form-select form-select-sm bg-dark text-white mt-1">${opcionesAfpDef}</select>
                    </div>
                </div>
            </div>
        </div>
        <h6 class="text-success fw-bold mt-3">📘 Libro de Remuneraciones Electrónico (LRE)</h6>
        <div class="row g-2 small text-white">
            <div class="col-md-3">RUT empresa<input id="lreRut" class="form-control form-control-sm bg-dark text-white" value="${(c.lre || {}).rutEmpresa || ''}"></div>
            <div class="col-md-1">Región<input id="lreRegion" type="number" class="form-control form-control-sm bg-dark text-white" value="${(c.lre || {}).region ?? 13}"></div>
            <div class="col-md-2">Comuna (cód.)<input id="lreComuna" type="number" class="form-control form-control-sm bg-dark text-white" value="${(c.lre || {}).comuna ?? 13102}"></div>
            <div class="col-md-2">Jornada (cód.)<input id="lreJornada" type="number" class="form-control form-control-sm bg-dark text-white" value="${(c.lre || {}).jornada ?? 101}"></div>
            <div class="col-md-2">Causal término<input id="lreCausal" type="number" class="form-control form-control-sm bg-dark text-white" value="${(c.lre || {}).causal ?? 7}"></div>
            <div class="col-md-2">Valor UTM ($)<input id="lreUtm" type="number" class="form-control form-control-sm bg-dark text-white" value="${(c.lre || {}).utm ?? ''}"></div>
            <div class="col-12 text-muted">Comuna 13102 = Cerrillos · Jornada 101 = Ordinaria Art. 22 · Causal 7 = Art. 159 N°5 Conclusión del trabajo o servicio (6 = Vencimiento del plazo). La UTM solo se usa para avisar si alguien supera 13,5 UTM (impuesto único).</div>
        </div>
        <div class="text-end mt-3">
            <button class="btn btn-outline-info fw-bold" id="btnGuardarParamPrevired">💾 Guardar parámetros</button>
        </div>
        ${c.actualizadoPor ? `<p class="small text-muted text-end mb-0 mt-1">Última actualización: ${c.actualizadoPor} · ${c.actualizadoEl ? new Date(c.actualizadoEl).toLocaleString('es-CL') : ''}</p>` : ''}`;

    document.getElementById('btnGuardarParamPrevired').addEventListener('click', guardarParametrosPrevired);
}

function leerParametrosPreviredDesdePantalla() {
    const c = JSON.parse(JSON.stringify(window.configPrevired));
    document.querySelectorAll('.prev-afp-tasa').forEach(el => { c.afps[el.dataset.k].tasa = numPrevired(el.value); });
    c.salud = numPrevired(document.getElementById('prevSalud').value);
    c.sis = numPrevired(document.getElementById('prevSis').value);
    c.expectativaVida = numPrevired(document.getElementById('prevCev').value);
    c.rentabilidadProtegida = numPrevired(document.getElementById('prevCrp').value);
    c.cuentaIndividualEmpleador = numPrevired(document.getElementById('prevCi').value);
    c.sumarCuentaIndividualEnAFP = document.getElementById('prevSumarCi').checked;
    c.isl = numPrevired(document.getElementById('prevIsl').value);
    c.cesantiaEmpleador = numPrevired(document.getElementById('prevAfcEmp').value);
    c.cesantiaTrabajador = numPrevired(document.getElementById('prevAfcTrab').value);
    c.codigoMovimiento = parseInt(document.getElementById('prevMov').value, 10) || 0;
    c.tipoJornada = parseInt(document.getElementById('prevJornada').value, 10) === 2 ? 2 : 1;
    c.afpPorDefecto = document.getElementById('prevAfpDef').value;
    c.lre = {
        rutEmpresa: document.getElementById('lreRut').value.replace(/\./g, '').trim().toUpperCase(),
        region: parseInt(document.getElementById('lreRegion').value, 10) || 13,
        comuna: parseInt(document.getElementById('lreComuna').value, 10) || 13102,
        jornada: parseInt(document.getElementById('lreJornada').value, 10) || 101,
        causal: parseInt(document.getElementById('lreCausal').value, 10) || 7,
        tipoImpuesto: 1,
        utm: numPrevired(document.getElementById('lreUtm').value)
    };
    return c;
}

async function guardarParametrosPrevired() {
    const c = leerParametrosPreviredDesdePantalla();
    for (const k in c.afps) {
        if (!c.afps[k].sinAfp && (c.afps[k].tasa <= 0 || c.afps[k].tasa >= 20)) return alert(`Revisa el % de ${c.afps[k].nombre}.`);
    }
    if (c.salud <= 0 || c.salud >= 20) return alert("Revisa el % de salud.");
    c.confirmado = true;
    c.actualizadoPor = window.localStorage.getItem('correoStaffNat') || '';
    c.actualizadoEl = new Date().toISOString();
    try {
        await set(ref(db, RUTA_CONFIG_PREVIRED), c);
        window.configPrevired = c;
        renderParametrosPrevired();
        if (mesPreviredActual) calcularPrevired(mesPreviredActual);
        alert("✅ Parámetros Previred guardados para todo el equipo.");
    } catch (e) {
        console.error(e);
        alert("❌ No se pudieron guardar los parámetros (revisa tu conexión o permisos).");
    }
}

async function cargarPestanaPrevired() {
    window.__mesAjustesCargado = null; // Releer ajustes (otro miembro del equipo pudo cambiarlos)
    window.__datosMesPrevired = null;   // Releer asistencias frescas del mes
    await cargarConfigPrevired();
    renderParametrosPrevired();

    const select = document.getElementById('selectMesPrevired');
    if (!select) return;
    select.innerHTML = '<option value="">⏳ Cargando meses...</option>';
    try {
        const snap = await window.obtenerAsistencias();
        const todas = snap.exists() ? snap.val() : {};
        const meses = new Set();
        Object.keys(todas).forEach(f => { if (/^\d{4}-\d{2}-\d{2}$/.test(f)) meses.add(f.substring(0, 7)); });
        const lista = Array.from(meses).sort().reverse();
        const nombresMeses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
        if (lista.length === 0) {
            select.innerHTML = '<option value="">❌ No hay asistencias registradas</option>';
            return;
        }
        select.innerHTML = '<option value="">-- Selecciona el mes a declarar --</option>' +
            lista.map(m => `<option value="${m}">${nombresMeses[parseInt(m.split('-')[1], 10) - 1]} ${m.split('-')[0]}</option>`).join('');
        if (mesPreviredActual && lista.includes(mesPreviredActual)) {
            select.value = mesPreviredActual;
            calcularPrevired(mesPreviredActual);
        }
    } catch (e) {
        console.error(e);
        select.innerHTML = '<option value="">❌ Error al cargar</option>';
    }
}

async function calcularPrevired(mes) {
    mesPreviredActual = mes;
    const cont = document.getElementById('tablaPrevired');
    const btnTxt = document.getElementById('btnDescargarPrevired');
    const btnRev = document.getElementById('btnDescargarRevisionPrevired');
    if (btnTxt) btnTxt.disabled = true;
    if (btnRev) btnRev.disabled = true;
    if (document.getElementById('btnDescargarLRE')) document.getElementById('btnDescargarLRE').disabled = true;
    if (!mes) { if (cont) cont.innerHTML = ''; return; }
    if (cont) cont.innerHTML = "<div class='text-center'><div class='spinner-border text-info'></div></div>";

    if (window.__mesAjustesCargado !== mes) { await cargarAjustesPrevired(mes); window.__mesAjustesCargado = mes; }
    if (!window.__datosMesPrevired || window.__datosMesPrevired.mes !== mes) {
        window.__datosMesPrevired = { mes, datos: await window.leerAsistenciasMes(mes) };
    }
    window.filasPrevired = await construirFilasMes(mes, window.ajustesPrevired || {}, window.__datosMesPrevired.datos);
    renderTablaPrevired();
}

// Cálculo ÚNICO por persona para un mes: lo usan Previred y el reporte del Contador
// Edad cumplida al último día del mes "AAAA-MM" (null si la fecha no es válida)
function edadAlFinDelMesPrevired(fechaNacimiento, mes) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fechaNacimiento || '').trim());
    if (!m) return null;
    const [anio, mesNum] = mes.split('-').map(Number);
    const fin = new Date(anio, mesNum, 0); // último día del mes
    const nac = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (isNaN(nac.getTime()) || nac > fin) return null;
    let edad = fin.getFullYear() - nac.getFullYear();
    if (fin.getMonth() < nac.getMonth() || (fin.getMonth() === nac.getMonth() && fin.getDate() < nac.getDate())) edad--;
    return edad;
}

async function construirFilasMes(mes, ajustes, todas) {
    const c = window.configPrevired;
    const trabSnap = await window.obtenerTrabajadores();
    const trabajadores = trabSnap.exists() ? trabSnap.val() : {};

    // Agrupar por persona todo lo trabajado en el mes
    const porRut = {};
    for (const fecha in todas) {
        if (!fecha.startsWith(mes + '-')) continue;
        for (const prog in todas[fecha]) {
            for (const rut in todas[fecha][prog]) {
                const asis = todas[fecha][prog][rut];
                if (!asis || asis.tipo_ingreso === "Cortesía" || asis.tipo_ingreso === "Anulado") continue;
                const monto = parseInt(String(asis.monto).replace(/\D/g, ''), 10) || 0;
                if (monto <= 0) continue;
                if (!porRut[rut]) porRut[rut] = { liquido: 0, fechas: new Set(), contratoDT: false, pagado: 0, pendiente: 0, detalle: [] };
                porRut[rut].liquido += monto;
                porRut[rut].fechas.add(fecha);
                if (asis.estado_pago === "Pendiente") porRut[rut].pendiente += monto; else porRut[rut].pagado += monto;
                porRut[rut].detalle.push({ fecha, prog, monto, estado: asis.estado_pago || '', ticket: asis.numero_asignado || '', tipo: asis.tipo_ingreso || '' });
                if (asis.aplica_contrato !== false) porRut[rut].contratoDT = true;
            }
        }
    }

    // Personas que solo trabajaron en el sistema anterior (agregadas a mano)
    for (const rut in ajustes) {
        if (!porRut[rut] && (ajustes[rut].anterior || ajustes[rut].forzado)) porRut[rut] = { liquido: 0, fechas: new Set(), contratoDT: true, soloManual: true, pagado: 0, pendiente: 0, detalle: [] };
    }

    const [anio, mesNum] = mes.split('-');
    const periodo = `${mesNum}${anio}`;
    const filas = [];

    for (const rut of Object.keys(porRut).sort()) {
        const aj = ajustes[rut] || {};
        const tr = { ...(trabajadores[rut] || {}), ...(aj.persona || {}) };
        const d = porRut[rut];
        const errores = [];
        const avisos = [];

        const rutOk = validarRutPrevired(rut);
        if (!rutOk) errores.push("RUT inválido");

        const ap = separarApellidosPrevired(tr.apellidos);
        const paterno = ap.paterno;
        const materno = ap.materno;
        if (ap.dudoso) avisos.push("Revisar apellidos (más de dos)");
        const nombres = limpiarTextoPrevired(tr.nombres, 30);
        if (paterno.length < 2) errores.push("Falta apellido paterno (corregir en ficha)");
        if (nombres.length < 2) errores.push("Faltan nombres (corregir en ficha)");
        if (!materno) avisos.push("Sin apellido materno");

        const sexo = (tr.sexo === "M" || tr.sexo === "F") ? tr.sexo : "";
        if (!sexo) errores.push("Falta sexo M/F");

        let nacionalidad = "";
        if (tr.nacionalidad) nacionalidad = String(tr.nacionalidad).trim().toUpperCase().startsWith("CHILE") ? "0" : "1";
        else errores.push("Falta nacionalidad");

        let afpKey = tr.afp && c.afps[tr.afp] ? tr.afp : "";
        let afpPorDefecto = false;
        // Regla del contador para AFP desconocida (vacía o "No cotizo / No sé"). Solo se aplica al calcular;
        // no se escribe en la ficha. Mujer >= 60 u hombre >= 65 al último día del mes: No cotiza; si no: AFP UNO.
        let afpPorRegla = false;
        const afpDesconocida = !tr.afp || String(tr.afp).trim() === "No cotizo / No sé";
        if (!afpKey && afpDesconocida) {
            const edad = edadAlFinDelMesPrevired(tr.fechaNacimiento, mes);
            if (edad === null) errores.push(tr.fechaNacimiento ? "Fecha de nacimiento inválida" : "Falta fecha de nacimiento");
            if (edad !== null && sexo) {
                const noCotiza = (sexo === "F" && edad >= 60) || (sexo === "M" && edad >= 65);
                const regla = noCotiza ? "NO_COTIZA" : "UNO";
                if (c.afps[regla]) {
                    afpKey = regla;
                    afpPorRegla = true;
                    avisos.push(noCotiza ? "No cotiza por edad" : `AFP asignada por regla: ${c.afps[regla].nombre.toUpperCase()}`);
                }
            }
        }
        if (!afpKey && c.afpPorDefecto && c.afps[c.afpPorDefecto]) { afpKey = c.afpPorDefecto; afpPorDefecto = true; avisos.push(`AFP asignada por defecto (${c.afps[afpKey].nombre})`); }
        if (!afpKey) errores.push("Falta AFP");
        const afp = afpKey ? c.afps[afpKey] : null;

        const saludKey = tr.salud && c.saludes[tr.salud] ? tr.salud : "";
        if (!saludKey) errores.push("Falta salud");
        else if (!/^\d{2}$/.test(c.saludes[saludKey].codigo || "")) errores.push(`Falta código Previred de ${c.saludes[saludKey].nombre} (parámetros)`);

        // Base: lo registrado en este sistema
        const fechasOrd = Array.from(d.fechas).sort();
        let diasCalc = fechasOrd.length;
        let inicioISO = fechasOrd[0] || "";
        let liquidoCalc = d.liquido;
        // + Sistema anterior (se suma)
        if (aj.anterior) {
            diasCalc += parseInt(aj.anterior.dias, 10) || 0;
            liquidoCalc += parseInt(aj.anterior.liquido, 10) || 0;
            if (aj.anterior.inicio && (!inicioISO || aj.anterior.inicio < inicioISO)) inicioISO = aj.anterior.inicio;
        }
        // Valores escritos a mano en la tabla (reemplazan)
        const f = aj.forzado || {};
        if (f.dias !== undefined && f.dias !== "") diasCalc = parseInt(f.dias, 10) || 0;
        if (f.liquido !== undefined && f.liquido !== "") liquidoCalc = parseInt(f.liquido, 10) || 0;
        if (f.inicio) inicioISO = f.inicio;

        if (!inicioISO || !inicioISO.startsWith(mes + '-')) errores.push("Primer día fuera del mes");
        if (diasCalc < 1) errores.push("Días debe ser 1 o más");
        if (diasCalc > 30) { avisos.push("Días ajustados a 30 (máximo Previred)"); }
        if (liquidoCalc <= 0) errores.push("Líquido debe ser mayor a 0");
        const dias = Math.max(0, Math.min(diasCalc, 30));
        const [yI, mI, dI] = (inicioISO || `${mes}-01`).split('-').map(Number);
        const inicio = new Date(yI, mI - 1, dI);
        const termino = new Date(yI, mI - 1, dI);
        termino.setDate(termino.getDate() + Math.max(dias, 1) - 1); // Regla NAT (planilla): término = inicio + días trabajados - 1

        // Bruto desde líquido: =ROUND(Líquido / ((100 - (Salud + %AFP)) * 0,01); 0)
        const tasaAfp = afp ? numPrevired(afp.tasa) : 0;
        const divisor = (100 - (numPrevired(c.salud) + tasaAfp)) * 0.01;
        const bruto = afp && divisor > 0 ? Math.round(liquidoCalc / divisor) : 0;
        const pct = (base, tasa) => Math.round(base * numPrevired(tasa) / 100);

        const esFonasa = saludKey === "FONASA";
        const sinAfp = !!(afp && afp.sinAfp);
        const calc = {
            bruto,
            cotAfp: sinAfp ? 0 : pct(bruto, tasaAfp + (c.sumarCuentaIndividualEnAFP ? numPrevired(c.cuentaIndividualEmpleador) : 0)),
            sis: sinAfp ? 0 : pct(bruto, c.sis),
            salud: pct(bruto, c.salud),
            isl: pct(bruto, c.isl),
            cev: sinAfp ? 0 : pct(bruto, c.expectativaVida),
            crp: sinAfp ? 0 : pct(bruto, c.rentabilidadProtegida),
            afcTrab: pct(bruto, c.cesantiaTrabajador),
            afcEmp: pct(bruto, c.cesantiaEmpleador)
        };

        filas.push({
            rut, rutOk, paterno, materno, nombres, sexo, nacionalidad,
            afpKey, afpPorDefecto, afpPorRegla, saludKey, esFonasa,
            dias, inicio, termino, liquido: liquidoCalc, contratoDT: d.contratoDT,
            enSistema: !d.soloManual, tr, pagado: d.pagado, pendiente: d.pendiente, detalle: d.detalle, anterior: aj.anterior || null, forzado: !!(aj.forzado && Object.keys(aj.forzado).length), personaManual: !!aj.persona,
            periodo, calc, errores, avisos,
            afpActual: tr.afp || "", saludActual: tr.salud || "", sexoActual: tr.sexo || "", nacActual: tr.nacionalidad || ""
        });
    }

    return filas;
}

function construirLineaPrevired(f) {
    const c = window.configPrevired;
    // Plantilla calcada de los archivos que Previred ya aceptó a NAT (mayo y agosto 2026)
    const campos = new Array(106).fill("0"); // índice 1..105
    [35, 36, 41, 46, 51, 52, 53, 54, 56, 57, 105].forEach(i => campos[i] = "");
    campos[61] = "0000"; campos[63] = "00"; campos[67] = "0000"; campos[80] = "0000"; campos[84] = "00"; campos[96] = "00";

    const afp = c.afps[f.afpKey];
    const salud = c.saludes[f.saludKey];
    const k = f.calc;

    campos[1] = f.rutOk.cuerpo;
    campos[2] = f.rutOk.dv;
    campos[3] = f.paterno;
    campos[4] = f.materno;
    campos[5] = f.nombres;
    campos[6] = f.sexo;
    campos[7] = f.nacionalidad;
    campos[8] = "1";                        // Tipo de pago: Remuneraciones del mes
    campos[9] = f.periodo;                  // Período desde (mmaaaa)
    campos[10] = f.periodo;                 // Período hasta (mmaaaa)
    campos[11] = "AFP";                     // Régimen previsional
    campos[12] = "0";                       // Tipo trabajador: activo
    campos[13] = String(f.dias);            // Días trabajados
    campos[14] = "00";                      // Línea principal
    campos[15] = String(c.codigoMovimiento);// Movimiento de personal (7 = contratación plazo fijo)
    campos[16] = fechaPrevired(f.inicio);   // Fecha desde
    campos[17] = fechaPrevired(f.termino);  // Fecha hasta
    campos[18] = "D";                       // Tramo asignación familiar: sin derecho
    campos[25] = "N";                       // Solicitud trabajador joven
    campos[26] = afp.codigo;                // Código AFP
    campos[27] = String(k.bruto);           // Renta imponible AFP / Seguro Social
    campos[28] = String(k.cotAfp);          // Cotización obligatoria AFP (+0,1% cuenta individual)
    campos[29] = String(k.sis);             // SIS (empleador)
    campos[64] = String(k.bruto);           // Renta imponible IPS/ISL/Fonasa
    campos[70] = f.esFonasa ? String(k.salud) : "0";   // Cotización Fonasa 7%
    campos[71] = String(k.isl);             // Cotización accidentes del trabajo ISL
    campos[75] = salud.codigo;              // Código institución de salud
    campos[77] = String(k.bruto);           // Renta imponible Isapre (igual que archivos aceptados)
    if (f.esFonasa) {
        campos[78] = "2";                   // Igual que los archivos aceptados por Previred
    } else {
        campos[78] = "1";                   // Plan en pesos
        campos[79] = String(k.salud);       // Cotización pactada (7% legal)
        campos[80] = String(k.salud);       // Cotización obligatoria Isapre 7%
    }
    campos[93] = String(c.tipoJornada || 1);// Tipo de jornada (1 = completa) - OBLIGATORIO
    campos[94] = String(k.cev);             // Cotización Expectativa de Vida (empleador)
    campos[95] = String(k.crp);             // Cotización Rentabilidad Protegida (empleador)
    campos[97] = String(k.bruto);           // Renta imponible mutual (igual que archivos aceptados)
    campos[100] = String(k.bruto);          // Renta imponible Seguro de Cesantía
    campos[101] = String(k.afcTrab);        // Aporte trabajador Seguro de Cesantía
    campos[102] = String(k.afcEmp);         // Aporte empleador Seguro de Cesantía

    if (afp.sinAfp) {
        // Sin institución previsional: el formato rechaza montos AFP/SIS/Expectativa/Rentabilidad
        campos[11] = "SIP";
        campos[26] = "00";
        campos[27] = "0"; campos[28] = "0"; campos[29] = "0";
        campos[94] = "0"; campos[95] = "0";
    }
    return campos.slice(1).join(';');
}

function renderTablaPrevired() {
    const cont = document.getElementById('tablaPrevired');
    if (!cont) return;
    const filas = window.filasPrevired;
    const c = window.configPrevired;
    const mes = mesPreviredActual;
    const $ = n => '$' + Math.round(n).toLocaleString('es-CL');
    const opcionesAfp = Object.keys(c.afps).map(k => `<option value="${k}">${c.afps[k].nombre}</option>`).join('');
    const opcionesSalud = Object.keys(c.saludes).map(k => `<option value="${k}">${c.saludes[k].nombre}</option>`).join('');
    const [anioM, mesM] = mes.split('-').map(Number);
    const ultimoDia = new Date(anioM, mesM, 0).getDate();
    const minFecha = `${mes}-01`, maxFecha = `${mes}-${String(ultimoDia).padStart(2, '0')}`;

    // Formulario para agregar personas del sistema anterior
    let html = `
        <div class="p-3 rounded mb-3" style="background: #111; border: 1px dashed #ffcc00;">
            <div class="d-flex justify-content-between align-items-center">
                <span class="fw-bold text-warning">➕ Agregar persona del sistema anterior (ej: primera semana del mes)</span>
                <button class="btn btn-sm btn-outline-warning fw-bold" id="btnToggleAgregarPrev">Abrir / cerrar</button>
            </div>
            <div id="formAgregarPrev" class="d-none mt-3">
                <div class="row g-2 small text-white">
                    <div class="col-md-3"><label>RUT (con guion)</label><input id="agrRut" class="form-control form-control-sm bg-dark text-white" placeholder="12345678-5"></div>
                    <div class="col-md-2"><label>Días trabajados</label><input id="agrDias" type="number" min="1" max="30" class="form-control form-control-sm bg-dark text-white"></div>
                    <div class="col-md-3"><label>Primer día trabajado</label><input id="agrInicio" type="date" min="${minFecha}" max="${maxFecha}" class="form-control form-control-sm bg-dark text-white"></div>
                    <div class="col-md-4"><label>Sueldo líquido de esos días ($)</label><input id="agrLiquido" type="number" min="1" class="form-control form-control-sm bg-dark text-white"></div>
                </div>
                <div id="agrEstadoRut" class="small mt-2"></div>
                <div id="agrPersona" class="row g-2 small text-white mt-1 d-none">
                    <div class="col-md-3"><label>Nombres</label><input id="agrNombres" class="form-control form-control-sm bg-dark text-white"></div>
                    <div class="col-md-3"><label>Apellidos (paterno y materno)</label><input id="agrApellidos" class="form-control form-control-sm bg-dark text-white"></div>
                    <div class="col-md-1"><label>Sexo</label><select id="agrSexo" class="form-select form-select-sm bg-dark text-white"><option value="">-</option><option>M</option><option>F</option></select></div>
                    <div class="col-md-2"><label>Nacionalidad</label><select id="agrNac" class="form-select form-select-sm bg-dark text-white"><option value="">-</option><option value="Chilena">Chilena</option><option value="Extranjera">Extranjera</option></select></div>
                    <div class="col-md-1"><label>AFP</label><select id="agrAfp" class="form-select form-select-sm bg-dark text-white"><option value="">-</option>${opcionesAfp}</select></div>
                    <div class="col-md-2"><label>Salud</label><select id="agrSalud" class="form-select form-select-sm bg-dark text-white"><option value="">-</option>${opcionesSalud}</select></div>
                </div>
                <div class="text-end mt-2"><button class="btn btn-sm btn-warning fw-bold" id="btnAgregarPrev">Agregar al mes</button></div>
            </div>
        </div>`;

    if (filas.length === 0) {
        cont.innerHTML = html + "<div class='alert alert-secondary text-center'>No hay trabajadores con pago en este mes.</div>";
        conectarFormularioAgregarPrevired();
        return;
    }

    const conError = filas.filter(f => f.errores.length > 0).length;
    const tot = filas.reduce((a, f) => {
        a.liquido += f.liquido; a.bruto += f.calc.bruto;
        a.trabajador += f.calc.cotAfp + f.calc.salud + f.calc.afcTrab;
        a.empleador += f.calc.sis + f.calc.isl + f.calc.cev + f.calc.crp + f.calc.afcEmp;
        return a;
    }, { liquido: 0, bruto: 0, trabajador: 0, empleador: 0 });

    const selFix = (f, campo, texto, opciones) => `<select class="form-select form-select-sm bg-dark text-warning prev-fix" data-rut="${f.rut}" data-campo="${campo}"><option value="">${texto}</option>${opciones}</select>`;
    const inputEdit = (f, campo, tipo, valor, extra = '') => `<input type="${tipo}" class="form-control form-control-sm bg-dark text-white text-center prev-edit" data-rut="${f.rut}" data-campo="${campo}" value="${valor}" ${extra} style="min-width: ${tipo === 'date' ? 130 : 80}px;">`;

    html += `
        <div class="p-3 rounded mb-3" style="background: #1a1a1a; border: 2px solid ${conError ? '#ff4d4d' : '#00d26a'};">
            <div class="d-flex flex-wrap justify-content-between gap-2 text-white">
                <span class="fw-bold fs-5" style="color: ${conError ? '#ff4d4d' : '#00d26a'};">${conError ? `⛔ ${conError} persona${conError === 1 ? '' : 's'} con datos por corregir` : '✅ Todo listo para generar el archivo'}</span>
                <span>👥 ${filas.length} trabajadores</span>
            </div>
            <div class="d-flex flex-wrap gap-4 mt-2 small text-white">
                <span>Líquido total: <b>${$(tot.liquido)}</b></span>
                <span>Imponible total: <b>${$(tot.bruto)}</b></span>
                <span>Cotizaciones trabajador: <b>${$(tot.trabajador)}</b></span>
                <span>Aportes empleador: <b>${$(tot.empleador)}</b></span>
            </div>
            ${ajustesPreviredSoloLocal ? '<div class="small text-warning mt-2">⚠️ Los ajustes se están guardando solo en este computador (falta regla 11_previred_ajustes en Firebase).</div>' : ''}
            <div class="small text-muted mt-1">✏️ Puedes editar Días, Primer día y Líquido directamente en la tabla: el bruto y las cotizaciones se recalculan solos.</div>
        </div>
        <div class="table-responsive" style="max-height: 60vh;">
        <table class="table table-dark table-hover table-bordered align-middle text-center mb-0" style="font-size: 0.85em;">
            <thead style="color: #b066ff; position: sticky; top: 0; z-index: 2;"><tr>
                <th>RUT</th><th>Nombre</th><th>Días</th><th>Primer día</th><th>Término</th><th>Líquido</th><th>AFP</th><th>Salud</th><th>Imponible</th><th>AFP $</th><th>Salud $</th><th>Estado</th>
            </tr></thead><tbody>`;

    for (const f of filas) {
        const ok = f.errores.length === 0;
        const fijos = ["Falta AFP", "Falta salud", "Falta sexo M/F", "Falta nacionalidad"];
        const correcciones = [
            f.errores.includes("Falta AFP") ? selFix(f, 'afp', 'AFP...', opcionesAfp) : '',
            f.errores.includes("Falta salud") ? selFix(f, 'salud', 'Salud...', opcionesSalud) : '',
            f.errores.includes("Falta sexo M/F") ? selFix(f, 'sexo', 'Sexo...', '<option value="M">M</option><option value="F">F</option>') : '',
            f.errores.includes("Falta nacionalidad") ? selFix(f, 'nacionalidad', 'Nacionalidad...', '<option value="Chilena">Chilena</option><option value="Extranjera">Extranjera</option>') : ''
        ].filter(Boolean).join('');
        const otrosErrores = f.errores.filter(e => !fijos.includes(e));
        const etiquetas = [
            !f.contratoDT ? '<span class="badge bg-secondary">Sin contrato DT</span>' : '',
            f.anterior ? `<span class="badge bg-warning text-dark">+ Sist. anterior: ${f.anterior.dias} día(s), ${$(f.anterior.liquido)}</span>` : '',
            !f.enSistema ? '<span class="badge bg-info text-dark">Solo sist. anterior</span>' : '',
            f.forzado ? '<span class="badge bg-primary">✏️ Editado a mano</span>' : ''
        ].filter(Boolean).join(' ');
        const botones = [
            f.forzado ? `<button class="btn btn-sm btn-outline-light py-0 prev-accion" data-rut="${f.rut}" data-accion="deshacer" title="Volver a los valores calculados">↩️ Deshacer edición</button>` : '',
            f.anterior ? `<button class="btn btn-sm btn-outline-danger py-0 prev-accion" data-rut="${f.rut}" data-accion="quitarAnterior">🗑️ Quitar sist. anterior</button>` : ''
        ].filter(Boolean).join(' ');

        html += `<tr class="${ok ? '' : 'table-danger'}">
            <td class="fw-bold">${f.rut}</td>
            <td class="text-start">${f.nombres} ${f.paterno} ${f.materno}<div>${etiquetas}</div>${botones ? `<div class="mt-1 d-flex gap-1 flex-wrap">${botones}</div>` : ''}</td>
            <td>${inputEdit(f, 'dias', 'number', f.dias, 'min="1" max="30"')}</td>
            <td>${inputEdit(f, 'inicio', 'date', fechaISOPrevired(f.inicio), `min="${minFecha}" max="${maxFecha}"`)}</td>
            <td>${fechaPrevired(f.termino)}</td>
            <td>${inputEdit(f, 'liquido', 'number', f.liquido, 'min="1"')}</td>
            <td>${f.afpKey ? `${c.afps[f.afpKey].nombre} ${c.afps[f.afpKey].tasa}%<div class="small text-muted">Prev. ${c.afps[f.afpKey].codigo} · LRE ${c.afps[f.afpKey].lre}</div>` : '—'}</td>
            <td>${f.saludKey ? `${c.saludes[f.saludKey].nombre}<div class="small text-muted">Prev. ${c.saludes[f.saludKey].codigo} · LRE ${c.saludes[f.saludKey].lre}</div>` : '—'}</td>
            <td class="fw-bold text-warning">${$(f.calc.bruto)}</td>
            <td>${$(f.calc.cotAfp)}</td>
            <td>${$(f.calc.salud)}</td>
            <td style="min-width: 170px;">${ok ? '✅' : ''}${correcciones ? `<div class="d-flex flex-column gap-1">${correcciones}</div>` : ''}${otrosErrores.map(e => `<div class="small text-danger fw-bold">${e}</div>`).join('')}${f.avisos.map(a => `<div class="small text-warning">${a}</div>`).join('')}</td>
        </tr>`;
    }
    html += `</tbody></table></div>`;
    cont.innerHTML = html;

    document.querySelectorAll('.prev-fix').forEach(sel => sel.addEventListener('change', corregirDatoPrevired));
    document.querySelectorAll('.prev-edit').forEach(inp => inp.addEventListener('change', editarValorPrevired));
    document.querySelectorAll('.prev-accion').forEach(btn => btn.addEventListener('click', accionFilaPrevired));
    conectarFormularioAgregarPrevired();

    const btnTxt = document.getElementById('btnDescargarPrevired');
    const btnRev = document.getElementById('btnDescargarRevisionPrevired');
    const btnLre = document.getElementById('btnDescargarLRE');
    if (btnTxt) btnTxt.disabled = conError > 0;
    if (btnLre) btnLre.disabled = conError > 0;
    if (btnRev) btnRev.disabled = false;
}

function conectarFormularioAgregarPrevired() {
    const toggle = document.getElementById('btnToggleAgregarPrev');
    if (toggle) toggle.addEventListener('click', () => document.getElementById('formAgregarPrev').classList.toggle('d-none'));
    const inpRut = document.getElementById('agrRut');
    if (inpRut) inpRut.addEventListener('input', revisarRutAgregarPrevired);
    const btn = document.getElementById('btnAgregarPrev');
    if (btn) btn.addEventListener('click', agregarPersonaPrevired);
}

function revisarRutAgregarPrevired() {
    const rut = document.getElementById('agrRut').value.trim().toUpperCase().replace(/\./g, '');
    const estado = document.getElementById('agrEstadoRut');
    const persona = document.getElementById('agrPersona');
    if (!validarRutPrevired(rut)) {
        estado.innerHTML = rut.length > 7 ? '<span class="text-danger">RUT inválido (revisa el dígito verificador y usa guion).</span>' : '';
        persona.classList.add('d-none');
        return;
    }
    const enTabla = window.filasPrevired.find(f => f.rut === rut);
    const ficha = (window.cacheTrabajadores || {})[rut] || listaGlobalCRM[rut];
    if (enTabla) {
        estado.innerHTML = `<span class="text-info">✅ ${enTabla.nombres} ${enTabla.paterno} ya trabajó este mes en el sistema nuevo (${enTabla.dias} día(s), $${enTabla.liquido.toLocaleString('es-CL')}). Lo que ingreses se <b>sumará</b>.</span>`;
        persona.classList.add('d-none');
    } else if (ficha) {
        estado.innerHTML = `<span class="text-info">✅ Encontrado en la base: ${ficha.nombres || ''} ${ficha.apellidos || ''}. Se agregará como persona nueva del mes.</span>`;
        persona.classList.add('d-none');
    } else {
        estado.innerHTML = '<span class="text-warning">No está en la base: completa sus datos.</span>';
        persona.classList.remove('d-none');
    }
}

async function agregarPersonaPrevired() {
    const rut = document.getElementById('agrRut').value.trim().toUpperCase().replace(/\./g, '');
    const dias = parseInt(document.getElementById('agrDias').value, 10);
    const inicio = document.getElementById('agrInicio').value;
    const liquido = parseInt(document.getElementById('agrLiquido').value, 10);
    if (!validarRutPrevired(rut)) return alert("RUT inválido. Escríbelo con guion, ej: 12345678-5");
    if (!(dias >= 1 && dias <= 30)) return alert("Días debe estar entre 1 y 30.");
    if (!inicio || !inicio.startsWith(mesPreviredActual + '-')) return alert("El primer día debe ser dentro del mes que estás declarando.");
    if (!(liquido > 0)) return alert("Ingresa el sueldo líquido de esos días.");

    const ajuste = window.ajustesPrevired[rut] || {};
    const ficha = (window.cacheTrabajadores || {})[rut] || listaGlobalCRM[rut];
    const enTabla = window.filasPrevired.find(f => f.rut === rut);
    if (!ficha && !enTabla) {
        const persona = {
            nombres: document.getElementById('agrNombres').value.trim(),
            apellidos: document.getElementById('agrApellidos').value.trim(),
            sexo: document.getElementById('agrSexo').value,
            nacionalidad: document.getElementById('agrNac').value,
            afp: document.getElementById('agrAfp').value,
            salud: document.getElementById('agrSalud').value
        };
        if (!persona.nombres || !persona.apellidos) return alert("Completa nombres y apellidos.");
        ajuste.persona = persona;
    }
    if (ajuste.anterior && !confirm(`Esta persona ya tenía ${ajuste.anterior.dias} día(s) del sistema anterior.\n¿Reemplazarlos por los nuevos datos?`)) return;
    ajuste.anterior = { dias, inicio, liquido };
    window.ajustesPrevired[rut] = ajuste;
    await guardarAjustesPrevired();
    await calcularPrevired(mesPreviredActual);
    const form = document.getElementById('formAgregarPrev');
    if (form) form.classList.remove('d-none');
}

async function editarValorPrevired(e) {
    const inp = e.target;
    const rut = inp.dataset.rut, campo = inp.dataset.campo;
    let valor = inp.value;
    if (campo === 'dias') {
        const n = parseInt(valor, 10);
        if (!(n >= 1 && n <= 30)) { alert("Días debe estar entre 1 y 30."); return calcularPrevired(mesPreviredActual); }
        valor = n;
    } else if (campo === 'liquido') {
        const n = parseInt(valor, 10);
        if (!(n > 0)) { alert("El líquido debe ser mayor a 0."); return calcularPrevired(mesPreviredActual); }
        valor = n;
    } else if (campo === 'inicio') {
        if (!valor || !valor.startsWith(mesPreviredActual + '-')) { alert("El primer día debe ser dentro del mes."); return calcularPrevired(mesPreviredActual); }
    }
    const ajuste = window.ajustesPrevired[rut] || {};
    ajuste.forzado = { ...(ajuste.forzado || {}), [campo]: valor };
    window.ajustesPrevired[rut] = ajuste;
    await guardarAjustesPrevired();
    await calcularPrevired(mesPreviredActual);
}

async function accionFilaPrevired(e) {
    const btn = e.currentTarget;
    const rut = btn.dataset.rut, accion = btn.dataset.accion;
    const ajuste = window.ajustesPrevired[rut];
    if (!ajuste) return;
    if (accion === 'deshacer') {
        delete ajuste.forzado;
    } else if (accion === 'quitarAnterior') {
        if (!confirm("¿Quitar los días y el líquido del sistema anterior de esta persona?")) return;
        delete ajuste.anterior;
        if (!ajuste.forzado) delete ajuste.persona;
    }
    if (!ajuste.anterior && !ajuste.forzado && !ajuste.persona) delete window.ajustesPrevired[rut];
    await guardarAjustesPrevired();
    await calcularPrevired(mesPreviredActual);
}

async function corregirDatoPrevired(e) {
    const sel = e.target;
    const rut = sel.dataset.rut, campo = sel.dataset.campo, valor = sel.value;
    if (!valor) return;
    sel.disabled = true;
    try {
        const ajuste = window.ajustesPrevired[rut];
        const tieneFicha = !!(((window.cacheTrabajadores || {})[rut]) || listaGlobalCRM[rut]);
        if (ajuste && ajuste.persona && !tieneFicha) {
            // Persona agregada a mano (no existe en la base): se corrige en sus datos del ajuste
            ajuste.persona[campo] = valor;
            await guardarAjustesPrevired();
        } else {
            await window.guardarCamposFicha(rut, { [campo]: valor });
            // Actualización quirúrgica del caché local (sin volver a descargar la base)
            if (window.cacheTrabajadores && window.cacheTrabajadores[rut]) {
                window.cacheTrabajadores[rut][campo] = valor;
                await setLocalCache('trabajadores_nat', window.cacheTrabajadores);
            }
            if (listaGlobalCRM && listaGlobalCRM[rut]) listaGlobalCRM[rut][campo] = valor;
        }
        await calcularPrevired(mesPreviredActual);
    } catch (err) {
        console.error(err);
        sel.disabled = false;
        alert("❌ No se pudo guardar la corrección.");
    }
}

function descargarTxtPrevired() {
    const filas = window.filasPrevired;
    const conError = filas.filter(f => f.errores.length > 0);
    if (conError.length > 0) return alert(`Hay ${conError.length} persona(s) con datos por corregir. Corrígelos antes de generar el archivo.`);
    if (!window.configPrevired.confirmado && !confirm("⚠️ Los parámetros Previred aún no han sido confirmados/guardados.\n¿Generar el archivo de todas formas?")) return;

    const lineas = filas.map(construirLineaPrevired);
    const malas = lineas.filter(l => l.split(';').length !== 105);
    if (malas.length > 0) return alert("Error interno: hay líneas que no tienen 105 campos. No se generó el archivo.");

    const contenido = lineas.join('\r\n') + '\r\n';
    const blob = new Blob([contenido], { type: 'text/plain;charset=windows-1252' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Previred_NAT_${filas[0].periodo}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function descargarRevisionPrevired() {
    const filas = window.filasPrevired;
    const c = window.configPrevired;
    let csv = "﻿RUT;DV;Apellido Paterno;Apellido Materno;Nombres;Sexo;Nacionalidad (0=CL 1=EXT);Días;Inicio;Término;Líquido;AFP;Cód. AFP Previred;Cód. AFP LRE;% AFP;Salud;Cód. Salud Previred;Cód. Salud LRE;Imponible (Bruto);Cotización AFP;SIS;Salud 7%;ISL;Expectativa Vida;Rentabilidad Protegida;Cesantía Trabajador;Cesantía Empleador;Contrato DT;AFP asignada por regla (Sí/No);Observaciones\n";
    for (const f of filas) {
        const k = f.calc;
        csv += [
            f.rutOk ? f.rutOk.cuerpo : f.rut, f.rutOk ? f.rutOk.dv : '', f.paterno, f.materno, f.nombres, f.sexo, f.nacionalidad,
            f.dias, fechaPrevired(f.inicio), fechaPrevired(f.termino), f.liquido,
            f.afpKey ? c.afps[f.afpKey].nombre : '', f.afpKey ? c.afps[f.afpKey].codigo : '', f.afpKey ? c.afps[f.afpKey].lre : '', f.afpKey ? String(c.afps[f.afpKey].tasa).replace('.', ',') : '',
            f.saludKey ? c.saludes[f.saludKey].nombre : '', f.saludKey ? c.saludes[f.saludKey].codigo : '', f.saludKey ? c.saludes[f.saludKey].lre : '',
            k.bruto, k.cotAfp, k.sis, k.salud, k.isl, k.cev, k.crp, k.afcTrab, k.afcEmp,
            f.contratoDT ? 'Sí' : 'No', f.afpPorRegla ? 'Sí' : 'No', [
                ...(f.anterior ? [`Incluye sistema anterior: ${f.anterior.dias} día(s) y $${f.anterior.liquido} desde ${f.anterior.inicio}`] : []),
                ...(!f.enSistema ? ['Solo sistema anterior'] : []),
                ...(f.forzado ? ['Editado a mano'] : []),
                ...f.errores, ...f.avisos].join(' | ')
        ].join(';') + "\n";
    }
    descargarCSV(csv, `Revision_Previred_NAT_${filas.length ? filas[0].periodo : ''}.csv`);
}

if (document.getElementById('previred-tab')) document.getElementById('previred-tab').addEventListener('click', cargarPestanaPrevired);
if (document.getElementById('selectMesPrevired')) document.getElementById('selectMesPrevired').addEventListener('change', (e) => calcularPrevired(e.target.value));
if (document.getElementById('btnDescargarPrevired')) document.getElementById('btnDescargarPrevired').addEventListener('click', descargarTxtPrevired);
if (document.getElementById('btnDescargarRevisionPrevired')) document.getElementById('btnDescargarRevisionPrevired').addEventListener('click', descargarRevisionPrevired);
if (document.getElementById('btnToggleParamPrevired')) document.getElementById('btnToggleParamPrevired').addEventListener('click', () => {
    const p = document.getElementById('contParametrosPrevired');
    if (p) p.classList.toggle('d-none');
});


// ==========================================
// MANTENIMIENTO SEGURO (v11)
// 1) Mover firmas antiguas: aligera la base SIN borrar datos.
// 2) Limpieza por mes: elige el mes; por defecto borra solo lo CERRADO
//    (pagado + contrato listo) y nunca lo pendiente. Descarga respaldo antes.
// ==========================================
function descargarArchivoJSON(objeto, nombre) {
    const blob = new Blob([JSON.stringify(objeto)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function tamanoTextoMB(obj) {
    try { return (JSON.stringify(obj).length / (1024 * 1024)).toFixed(1); } catch (e) { return '?'; }
}

// ---------- 1) MOVER FIRMAS ANTIGUAS ----------
async function moverFirmasAntiguas() {
    const btn = document.getElementById('btnMoverFirmas');
    const estado = document.getElementById('estadoMoverFirmas');
    if (!confirm("📦 MOVER FIRMAS ANTIGUAS\n\nLas firmas guardadas dentro de las asistencias se pasarán a su propia carpeta (10_firmas).\n\n• NO se borra ninguna asistencia, pago, contrato ni firma.\n• Contratos, cesiones y vouchers siguen funcionando igual.\n• Se descargará la base una sola vez para hacerlo.\n\n¿Continuar?")) return;

    btn.disabled = true;
    const pintar = (html) => { if (estado) estado.innerHTML = html; };
    pintar("⏳ Descargando asistencias (una sola vez)...");

    let todas = {};
    try {
        const snap = await get(ref(db, '2_asistencias'));
        todas = snap.exists() ? snap.val() : {};
    } catch (e) {
        console.error(e);
        pintar("<span class='text-danger'>❌ No se pudieron leer las asistencias. Revisa tu conexión.</span>");
        btn.disabled = false;
        return;
    }
    const pesoAntes = tamanoTextoMB(todas);

    // Buscar firmas antiguas
    const pendientes = [];
    for (const f in todas) {
        for (const p in todas[f]) {
            for (const r in todas[f][p]) {
                const a = todas[f][p][r];
                if (a && typeof a.firma_digital === 'string' && a.firma_digital.length > 0) {
                    pendientes.push({ f, p, r, firma: a.firma_digital });
                }
            }
        }
    }

    if (pendientes.length === 0) {
        pintar(`<span class='text-success fw-bold'>✅ No quedan firmas antiguas por mover. Las asistencias pesan ~${pesoAntes} MB.</span>`);
        btn.disabled = false;
        return;
    }

    // Lotes de ~3 MB: cada lote se guarda de forma atómica (todo o nada)
    const lotes = [];
    let lote = {}, bytes = 0;
    for (const it of pendientes) {
        const base = `${it.f}/${it.p}/${it.r}`;
        lote[`10_firmas/${base}`] = it.firma;
        lote[`2_asistencias/${base}/tiene_firma`] = true;
        lote[`2_asistencias/${base}/firma_digital`] = null;
        bytes += it.firma.length + 200;
        if (bytes > 3 * 1024 * 1024) { lotes.push(lote); lote = {}; bytes = 0; }
    }
    if (Object.keys(lote).length) lotes.push(lote);

    let movidas = 0;
    for (let i = 0; i < lotes.length; i++) {
        const cantidad = Object.keys(lotes[i]).length / 3;
        pintar(`⏳ Moviendo firmas... ${movidas} de ${pendientes.length} (lote ${i + 1} de ${lotes.length})`);
        try {
            await update(ref(db), lotes[i]);
            movidas += cantidad;
        } catch (e) {
            console.error("Error moviendo lote de firmas", e);
            const sinPermiso = String(e && e.message || '').toLowerCase().includes('permission');
            pintar(`<span class='text-danger fw-bold'>⛔ Se detuvo en ${movidas} de ${pendientes.length}.</span><br><small>${sinPermiso ? "Firebase no dio permiso sobre '10_firmas': aplica las reglas v2 y vuelve a presionar." : "Problema de conexión: vuelve a presionar el botón para continuar donde quedó."} Lo que ya se movió está completo y correcto.</small>`);
            window.limpiarCache();
            btn.disabled = false;
            return;
        }
    }

    await window.limpiarCache();
    pintar(`<span class='text-success fw-bold'>✅ Listo: ${movidas} firmas movidas.</span><br><small>Las asistencias pasaron de ~${pesoAntes} MB a mucho menos. No se borró ningún dato.</small>`);
    btn.disabled = false;
}

// ---------- 2) LIMPIEZA POR MES ----------
function asistenciaEstaCerrada(a) {
    if (!a) return true;
    const monto = parseInt(String(a.monto).replace(/\D/g, ''), 10) || 0;
    const pagoCerrado = a.tipo_ingreso === "Cortesía" || a.tipo_ingreso === "Anulado" || monto <= 0 || (a.estado_pago && a.estado_pago !== "Pendiente");
    const contratoCerrado = a.tipo_ingreso !== "Pago" || a.aplica_contrato === false || a.dt_liquidado === true || a.dt_archivado === true;
    return pagoCerrado && contratoCerrado;
}

let analisisLimpieza = null;

async function cargarMesesLimpieza() {
    const sel = document.getElementById('selectMesLimpieza');
    if (!sel) return;
    sel.innerHTML = '<option value="">⏳ Cargando meses...</option>';
    try {
        const snap = await window.obtenerAsistencias();
        const todas = snap.exists() ? snap.val() : {};
        const meses = {};
        Object.keys(todas).forEach(f => { if (/^\d{4}-\d{2}-\d{2}$/.test(f)) meses[f.substring(0, 7)] = (meses[f.substring(0, 7)] || 0) + 1; });
        const lista = Object.keys(meses).sort();
        const nombres = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
        sel.innerHTML = lista.length
            ? '<option value="">-- Elige el mes a limpiar --</option>' + lista.map(m => `<option value="${m}">${nombres[parseInt(m.split('-')[1], 10) - 1]} ${m.split('-')[0]} (${meses[m]} jornada${meses[m] === 1 ? '' : 's'})</option>`).join('')
            : '<option value="">No hay meses con datos</option>';
    } catch (e) {
        sel.innerHTML = '<option value="">❌ Error al cargar</option>';
    }
    analisisLimpieza = null;
    const res = document.getElementById('resumenLimpieza');
    if (res) res.innerHTML = '';
    actualizarBotonLimpiezaMes();
}

async function analizarMesLimpieza() {
    const mes = document.getElementById('selectMesLimpieza').value;
    const res = document.getElementById('resumenLimpieza');
    analisisLimpieza = null;
    actualizarBotonLimpiezaMes();
    if (!mes) { res.innerHTML = ''; return; }
    res.innerHTML = "<div class='text-center'><div class='spinner-border text-warning'></div></div>";

    try {
        // Lectura FRESCA y completa del mes directamente desde Firebase
        const datos = await window.leerAsistenciasMes(mes);

        let total = 0, cerrados = 0, pendPago = 0, montoPend = 0, pendContrato = 0;
        const rutsPendPago = new Set();
        for (const f in datos) for (const p in datos[f]) for (const r in datos[f][p]) {
            const a = datos[f][p][r];
            total++;
            if (asistenciaEstaCerrada(a)) { cerrados++; continue; }
            const monto = parseInt(String(a.monto).replace(/\D/g, ''), 10) || 0;
            if (a.estado_pago === "Pendiente" && monto > 0 && a.tipo_ingreso !== "Cortesía" && a.tipo_ingreso !== "Anulado") { pendPago++; montoPend += monto; rutsPendPago.add(r); }
            if (a.tipo_ingreso === "Pago" && a.aplica_contrato !== false && !a.dt_liquidado && !a.dt_archivado) pendContrato++;
        }
        analisisLimpieza = { mes, fechas: Object.keys(datos), datos, total, cerrados };

        const hoy = new Date();
        const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
        const avisoMesActual = mes >= mesActual ? `<div class="text-danger fw-bold mt-2">⚠️ Este es el mes en curso (o futuro). Normalmente NO se limpia.</div>` : '';

        res.innerHTML = `
            <div class="p-3 rounded text-start small" style="background: #111; border: 1px solid #444;">
                <div class="text-white">📋 Registros del mes: <b>${total}</b> en ${Object.keys(datos).length} jornada(s)</div>
                <div class="text-success">✅ Cerrados (pagados y con contrato listo): <b>${cerrados}</b></div>
                <div class="text-warning">💵 Con pago PENDIENTE: <b>${pendPago}</b> (${rutsPendPago.size} persona(s), $${montoPend.toLocaleString('es-CL')})</div>
                <div class="text-warning">📝 Contratos DT sin marcar: <b>${pendContrato}</b></div>
                ${avisoMesActual}
                <div class="mt-2 pt-2 border-top border-secondary">
                    <div class="form-check"><input class="form-check-input chk-limpieza" type="checkbox" id="chkLimpiezaContador"><label class="form-check-label text-white" for="chkLimpiezaContador">Ya descargué el <b>Excel del Contador</b> y el <b>Detalle de Pagos</b> de este mes</label></div>
                    <div class="form-check"><input class="form-check-input chk-limpieza" type="checkbox" id="chkLimpiezaPrevired"><label class="form-check-label text-white" for="chkLimpiezaPrevired">Ya generé y subí el <b>Previred</b> de este mes</label></div>
                </div>
            </div>`;
        document.querySelectorAll('.chk-limpieza').forEach(c => c.addEventListener('change', actualizarBotonLimpiezaMes));
    } catch (e) {
        console.error(e);
        res.innerHTML = "<span class='text-danger'>❌ No se pudo revisar el mes. Revisa tu conexión.</span>";
    }
    actualizarBotonLimpiezaMes();
}

function actualizarBotonLimpiezaMes() {
    const btn = document.getElementById('btnEjecutarLimpiezaMes');
    const clave = document.getElementById('inputClaveLimpiezaMes');
    if (!btn) return;
    const chkC = document.getElementById('chkLimpiezaContador');
    const chkP = document.getElementById('chkLimpiezaPrevired');
    btn.disabled = !(analisisLimpieza && clave && clave.value === "1812" && chkC && chkC.checked && chkP && chkP.checked);
}

async function ejecutarLimpiezaMes() {
    if (!analisisLimpieza) return alert("Primero revisa el mes.");
    const soloCerrados = document.getElementById('checkSoloCerrados').checked;
    const { mes, fechas, datos, total, cerrados } = analisisLimpieza;
    const aBorrar = soloCerrados ? cerrados : total;
    if (aBorrar === 0) return alert("No hay registros para borrar con esta opción.");

    const texto = soloCerrados
        ? `Se borrarán ${cerrados} registro(s) CERRADOS de ${mes} (pagados y con contrato listo).\nLos ${total - cerrados} pendientes se mantienen intactos.`
        : `⛔ Se borrará TODO ${mes}: ${total} registro(s), INCLUYENDO pagos pendientes y contratos sin marcar.`;
    if (!confirm(`🗓️ LIMPIEZA DE ${mes}\n\n${texto}\n\nAntes de borrar se descargará un respaldo de este mes.\n¿Continuar?`)) return;
    if (!soloCerrados && !confirm("¿SEGURO? Esta opción borra también lo pendiente del mes.")) return;

    const btn = document.getElementById('btnEjecutarLimpiezaMes');
    const res = document.getElementById('resumenLimpieza');
    btn.disabled = true;

    try {
        // 1) Respaldo automático del mes (asistencias + firmas + reservas)
        res.innerHTML += "<div class='small text-info mt-2'>⏳ Descargando respaldo del mes...</div>";
        const respaldo = { mes, generado: new Date().toISOString(), asistencias: datos, firmas: {}, reservas: {} };
        for (const f of fechas) {
            try { const s = await get(ref(db, `10_firmas/${f}`)); if (s.exists()) respaldo.firmas[f] = s.val(); } catch (e) {}
            try { const s = await get(ref(db, `3_reservas/${f}`)); if (s.exists()) respaldo.reservas[f] = s.val(); } catch (e) {}
        }
        descargarArchivoJSON(respaldo, `Respaldo_NAT_${mes}.json`);

        // 2) Borrado por lotes
        const updates = {};
        for (const f of fechas) {
            if (!soloCerrados) {
                updates[`2_asistencias/${f}`] = null;
                updates[`10_firmas/${f}`] = null;
                updates[`3_reservas/${f}`] = null;
                continue;
            }
            for (const p in datos[f]) for (const r in datos[f][p]) {
                if (!asistenciaEstaCerrada(datos[f][p][r])) continue;
                updates[`2_asistencias/${f}/${p}/${r}`] = null;
                updates[`10_firmas/${f}/${p}/${r}`] = null;
                updates[`3_reservas/${f}/${p}/${r}`] = null;
            }
        }
        const claves = Object.keys(updates);
        for (let i = 0; i < claves.length; i += 500) {
            const parte = {};
            claves.slice(i, i + 500).forEach(k => parte[k] = null);
            try {
                await update(ref(db), parte);
            } catch (e) {
                // Si no hay permiso sobre 10_firmas (reglas antiguas), se reintenta sin esas rutas
                const sinFirmas = {};
                Object.keys(parte).filter(k => !k.startsWith('10_firmas/')).forEach(k => sinFirmas[k] = null);
                await update(ref(db), sinFirmas);
            }
        }

        await window.limpiarCache();
        alert(`✅ Limpieza de ${mes} terminada.\n${soloCerrados ? `Se borraron ${cerrados} registros cerrados. Los pendientes siguen en el sistema.` : `Se borró todo el mes.`}\n\nEl respaldo quedó descargado como Respaldo_NAT_${mes}.json`);
        document.getElementById('inputClaveLimpiezaMes').value = "";
        await cargarMesesLimpieza();
    } catch (e) {
        console.error(e);
        alert("❌ La limpieza se interrumpió. Revisa tu conexión. El respaldo del mes ya se descargó.");
        btn.disabled = false;
    }
}

if (document.getElementById('btnMoverFirmas')) document.getElementById('btnMoverFirmas').addEventListener('click', moverFirmasAntiguas);
if (document.getElementById('selectMesLimpieza')) document.getElementById('selectMesLimpieza').addEventListener('change', analizarMesLimpieza);
if (document.getElementById('inputClaveLimpiezaMes')) document.getElementById('inputClaveLimpiezaMes').addEventListener('input', actualizarBotonLimpiezaMes);
if (document.getElementById('btnEjecutarLimpiezaMes')) document.getElementById('btnEjecutarLimpiezaMes').addEventListener('click', ejecutarLimpiezaMes);
if (document.getElementById('mantenimiento-tab')) document.getElementById('mantenimiento-tab').addEventListener('click', cargarMesesLimpieza);


// ==========================================
// LIBRO DE REMUNERACIONES ELECTRÓNICO (LRE) - DIRECCIÓN DEL TRABAJO
// Plantilla oficial de 147 columnas (manual DT v6). Usa EXACTAMENTE el mismo cálculo
// por persona que Previred y el Contador (días, fechas, bruto, líquido).
// ==========================================
const COLUMNAS_LRE = [["Rut trabajador(1101)", "1101"], ["Fecha inicio contrato(1102)", "1102"], ["Fecha término de contrato(1103)", "1103"], ["Causal término de contrato(1104)", "1104"], ["Región prestación de servicios(1105)", "1105"], ["Comuna prestación de servicios(1106)", "1106"], ["Tipo impuesto a la renta(1170)", "1170"], ["Técnico extranjero exención cot. previsionales(1146)", "1146"], ["Código tipo de jornada(1107)", "1107"], ["Persona con Discapacidad - Pensionado por Invalidez(1108)", "1108"], ["Pensionado por vejez(1109)", "1109"], ["AFP(1141)", "1141"], ["IPS (ExINP)(1142)", "1142"], ["FONASA - ISAPRE(1143)", "1143"], ["AFC(1151)", "1151"], ["CCAF(1110)", "1110"], ["Org. administrador ley 16.744(1152)", "1152"], ["Nro cargas familiares legales autorizadas(1111)", "1111"], ["Nro de cargas familiares maternales(1112)", "1112"], ["Nro de cargas familiares invalidez(1113)", "1113"], ["Tramo asignación familiar(1114)", "1114"], ["Rut org sindical 1(1171)", "1171"], ["Rut org sindical 2(1172)", "1172"], ["Rut org sindical 3(1173)", "1173"], ["Rut org sindical 4(1174)", "1174"], ["Rut org sindical 5(1175)", "1175"], ["Rut org sindical 6(1176)", "1176"], ["Rut org sindical 7(1177)", "1177"], ["Rut org sindical 8(1178)", "1178"], ["Rut org sindical 9(1179)", "1179"], ["Rut org sindical 10(1180)", "1180"], ["Nro días trabajados en el mes(1115)", "1115"], ["Nro días de licencia médica en el mes(1116)", "1116"], ["Nro días de vacaciones en el mes(1117)", "1117"], ["Subsidio trabajador joven(1118)", "1118"], ["Puesto Trabajo Pesado(1154)", "1154"], ["APVI(1155)", "1155"], ["APVC(1157)", "1157"], ["Indemnización a todo evento(1131)", "1131"], ["Tasa indemnización a todo evento(1132)", "1132"], ["Sueldo(2101)", "2101"], ["Sobresueldo(2102)", "2102"], ["Comisiones(2103)", "2103"], ["Semana corrida(2104)", "2104"], ["Participación(2105)", "2105"], ["Gratificación(2106)", "2106"], ["Recargo 30% día domingo(2107)", "2107"], ["Remun. variable pagada en vacaciones(2108)", "2108"], ["Remun. variable pagada en clausura(2109)", "2109"], ["Aguinaldo(2110)", "2110"], ["Bonos u otras remun. fijas mensuales(2111)", "2111"], ["Tratos(2112)", "2112"], ["Bonos u otras remun. variables mensuales o superiores a un mes(2113)", "2113"], ["Ejercicio opción no pactada en contrato(2114)", "2114"], ["Beneficios en especie constitutivos de remun(2115)", "2115"], ["Remuneraciones bimestrales(2116)", "2116"], ["Remuneraciones trimestrales(2117)", "2117"], ["Remuneraciones cuatrimestral(2118)", "2118"], ["Remuneraciones semestrales(2119)", "2119"], ["Remuneraciones anuales(2120)", "2120"], ["Participación anual(2121)", "2121"], ["Gratificación anual(2122)", "2122"], ["Otras remuneraciones superiores a un mes(2123)", "2123"], ["Pago por horas de trabajo sindical(2124)", "2124"], ["Sueldo empresarial (2161)", "2161"], ["Subsidio por incapacidad laboral por licencia médica(2201)", "2201"], ["Beca de estudio(2202)", "2202"], ["Gratificaciones de zona(2203)", "2203"], ["Otros ingresos no constitutivos de renta(2204)", "2204"], ["Colación(2301)", "2301"], ["Movilización(2302)", "2302"], ["Viáticos(2303)", "2303"], ["Asignación de pérdida de caja(2304)", "2304"], ["Asignación de desgaste herramienta(2305)", "2305"], ["Asignación familiar legal(2311)", "2311"], ["Gastos por causa del trabajo(2306)", "2306"], ["Gastos por cambio de residencia(2307)", "2307"], ["Sala cuna(2308)", "2308"], ["Asignación trabajo a distancia o teletrabajo(2309)", "2309"], ["Depósito convenido hasta UF 900(2347)", "2347"], ["Alojamiento por razones de trabajo(2310)", "2310"], ["Asignación de traslación(2312)", "2312"], ["Indemnización por feriado legal(2313)", "2313"], ["Indemnización años de servicio(2314)", "2314"], ["Indemnización sustitutiva del aviso previo(2315)", "2315"], ["Indemnización fuero maternal(2316)", "2316"], ["Pago indemnización a todo evento(2331)", "2331"], ["Indemnizaciones voluntarias tributables(2417)", "2417"], ["Indemnizaciones contractuales tributables(2418)", "2418"], ["Cotización obligatoria previsional (AFP o IPS)(3141)", "3141"], ["Cotización obligatoria salud 7%(3143)", "3143"], ["Cotización voluntaria para salud(3144)", "3144"], ["Cotización AFC - trabajador(3151)", "3151"], ["Cotizaciones técnico extranjero para seguridad social fuera de Chile(3146)", "3146"], ["Descuento depósito convenido hasta UF 900 anual(3147)", "3147"], ["Cotización APVi Mod A(3155)", "3155"], ["Cotización APVi Mod B hasta UF50(3156)", "3156"], ["Cotización APVc Mod A(3157)", "3157"], ["Cotización APVc Mod B hasta UF50(3158)", "3158"], ["Impuesto retenido por remuneraciones(3161)", "3161"], ["Impuesto retenido por indemnizaciones(3162)", "3162"], ["Mayor retención de impuestos solicitada por el trabajador(3163)", "3163"], ["Impuesto retenido por reliquidación remun. devengadas otros períodos(3164)", "3164"], ["Diferencia impuesto reliquidación remun. devengadas en este período(3165)", "3165"], ["Retención préstamo clase media 2020 (Ley 21.252) (3166)", "3166"], ["Rebaja zona extrema DL 889 (3167)", "3167"], ["Cuota sindical 1(3171)", "3171"], ["Cuota sindical 2(3172)", "3172"], ["Cuota sindical 3(3173)", "3173"], ["Cuota sindical 4(3174)", "3174"], ["Cuota sindical 5(3175)", "3175"], ["Cuota sindical 6(3176)", "3176"], ["Cuota sindical 7(3177)", "3177"], ["Cuota sindical 8(3178)", "3178"], ["Cuota sindical 9(3179)", "3179"], ["Cuota sindical 10(3180)", "3180"], ["Crédito social CCAF(3110)", "3110"], ["Cuota vivienda o educación(3181)", "3181"], ["Crédito cooperativas de ahorro(3182)", "3182"], ["Otros descuentos autorizados y solicitados por el trabajador(3183)", "3183"], ["Cotización adicional trabajo pesado - trabajador(3154)", "3154"], ["Donaciones culturales y de reconstrucción(3184)", "3184"], ["Otros descuentos(3185)", "3185"], ["Pensiones de alimentos(3186)", "3186"], ["Descuento mujer casada(3187)", "3187"], ["Descuentos por anticipos y préstamos(3188)", "3188"], ["AFC - Aporte empleador(4151)", "4151"], ["Aporte empleador seguro accidentes del trabajo y Ley SANNA(4152)", "4152"], ["Aporte empleador indemnización a todo evento(4131)", "4131"], ["Aporte adicional trabajo pesado - empleador(4154)", "4154"], ["Aporte empleador seguro invalidez y sobrevivencia(4155)", "4155"], ["APVC - Aporte Empleador(4157)", "4157"], ["Total haberes(5201)", "5201"], ["Total haberes imponibles y tributables(5210)", "5210"], ["Total haberes imponibles no tributables(5220)", "5220"], ["Total haberes no imponibles y no tributables(5230)", "5230"], ["Total haberes no imponibles y tributables(5240)", "5240"], ["Total descuentos(5301)", "5301"], ["Total descuentos impuestos a las remuneraciones(5361)", "5361"], ["Total descuentos impuestos por indemnizaciones(5362)", "5362"], ["Total descuentos por cotizaciones del trabajador(5341)", "5341"], ["Total otros descuentos(5302)", "5302"], ["Total aportes empleador(5410)", "5410"], ["Total líquido(5501)", "5501"], ["Total indemnizaciones(5502)", "5502"], ["Total indemnizaciones tributables(5564)", "5564"], ["Total indemnizaciones no tributables(5565)", "5565"]];

function bytesANSI(texto) {
    // El LRE exige codificación ANSI (Windows-1252). Todo lo que usamos está en Latin-1.
    const out = new Uint8Array(texto.length);
    for (let i = 0; i < texto.length; i++) {
        const c = texto.charCodeAt(i);
        out[i] = c <= 255 ? c : 63; // '?' si hubiera un carácter fuera de rango
    }
    return out;
}

function fechaLRE(d) {
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function construirFilaLRE(f, c) {
    const L = c.lre || {};
    const afp = c.afps[f.afpKey];
    const salud = c.saludes[f.saludKey];
    const k = f.calc;
    const bruto = k.bruto;
    const cotSalud = Math.round(bruto * numPrevired(c.salud) / 100);              // 3143 = igual que Previred
    const cotAfc = k.afcTrab;                                                       // 3151 (plazo fijo = 0)
    const totalDescuentos = Math.max(0, bruto - f.liquido);                         // 5301 = bruto - líquido pagado
    let cotAfp = Math.max(0, totalDescuentos - cotSalud - cotAfc);                  // 3141 (absorbe el redondeo de $1)
    let cotSaludFinal = cotSalud;
    if (afp.sinAfp) { cotAfp = 0; cotSaludFinal = Math.max(0, totalDescuentos - cotAfc); } // No cotiza: el redondeo lo absorbe salud
    const aportes = k.afcEmp + k.isl + k.sis;                                       // 5410

    const v = {};
    v['1101'] = `${f.rutOk.cuerpo}-${f.rutOk.dv}`;
    v['1102'] = fechaLRE(f.inicio);
    v['1103'] = fechaLRE(f.termino);
    v['1104'] = String(L.causal ?? 7);
    v['1105'] = String(L.region ?? 13);
    v['1106'] = String(L.comuna ?? 13102);
    v['1170'] = String(L.tipoImpuesto ?? 1);
    v['1146'] = '0';
    v['1107'] = String(L.jornada ?? 101);
    v['1108'] = '0';
    v['1109'] = '0';
    v['1141'] = afp.lre;
    v['1142'] = '0';
    v['1143'] = salud.lre;
    v['1151'] = '1';
    v['1110'] = '0';
    v['1152'] = '0';
    v['1111'] = '0'; v['1112'] = '0'; v['1113'] = '0';
    v['1114'] = 'D';
    v['1115'] = String(f.dias);
    v['1116'] = '0'; v['1117'] = '0'; v['1118'] = '0';
    v['1155'] = '0'; v['1157'] = '0'; v['1131'] = '0';
    v['2101'] = String(bruto);
    v['3141'] = String(cotAfp);
    v['3143'] = String(cotSaludFinal);
    v['3151'] = String(cotAfc);
    v['3161'] = '0';
    v['4151'] = String(k.afcEmp);
    v['4152'] = String(k.isl);
    v['4155'] = String(k.sis);
    v['5201'] = String(bruto);
    v['5210'] = String(bruto);
    v['5220'] = '0'; v['5230'] = '0'; v['5240'] = '0';
    v['5301'] = String(totalDescuentos);
    v['5361'] = '0';
    v['5341'] = String(cotAfp + cotSaludFinal + cotAfc);
    v['5302'] = '0';
    v['5410'] = String(aportes);
    v['5501'] = String(f.liquido);
    v['5564'] = '0';

    // Campos opcionales de texto/RUT que deben quedar vacíos si no aplican
    const vacios = ['1171', '1172', '1173', '1174', '1175', '1176', '1177', '1178', '1179', '1180', '1154', '1132'];
    return COLUMNAS_LRE.map(([, cod]) => (v[cod] !== undefined ? v[cod] : (vacios.includes(cod) ? '' : '0'))).join(';');
}

function avisosLRE(f, c) {
    const L = c.lre || {};
    const utm = numPrevired(L.utm);
    const avisos = [];
    if (utm > 0) {
        const tributable = f.calc.bruto - Math.round(f.calc.bruto * numPrevired(c.salud) / 100) - Math.round(f.calc.bruto * numPrevired(c.afps[f.afpKey] ? c.afps[f.afpKey].tasa : 0) / 100);
        if (tributable > 13.5 * utm) avisos.push(`${f.rut}: renta tributable $${tributable.toLocaleString('es-CL')} supera 13,5 UTM: revisar Impuesto Único (3161)`);
    }
    return avisos;
}

function descargarLRE() {
    const filas = window.filasPrevired || [];
    const c = window.configPrevired;
    const conError = filas.filter(f => f.errores.length > 0);
    if (!filas.length) return alert("No hay trabajadores en este mes.");
    if (conError.length) return alert(`Hay ${conError.length} persona(s) con datos por corregir (en rojo). Corrígelos antes de generar el LRE.`);
    const L = c.lre || {};
    const rutEmp = String(L.rutEmpresa || '').replace(/\./g, '').trim().toUpperCase();
    if (!validarRutPrevired(rutEmp)) return alert("Revisa el RUT de la empresa en los parámetros del LRE (ej: 76932592-1).");

    const avisos = filas.flatMap(f => avisosLRE(f, c));
    if (avisos.length && !confirm(`⚠️ Revisa antes de subir:\n\n${avisos.slice(0, 10).join('\n')}${avisos.length > 10 ? `\n... y ${avisos.length - 10} más` : ''}\n\n¿Generar el LRE de todas formas?`)) return;

    const encabezado = COLUMNAS_LRE.map(([t]) => t).join(';');
    const lineas = filas.map(f => construirFilaLRE(f, c));
    if (lineas.some(l => l.split(';').length !== COLUMNAS_LRE.length)) return alert("Error interno: columnas incorrectas. No se generó el LRE.");

    const contenido = encabezado + '\r\n' + lineas.join('\r\n') + '\r\n';
    const periodo = filas[0].periodo; // mmaaaa
    const nombre = `${rutEmp}_${periodo.substring(2)}${periodo.substring(0, 2)}.csv`; // rutempleador_aaaamm
    const blob = new Blob([bytesANSI(contenido)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Botón LRE junto a los de Previred (se crea solo, sin tocar panel.html)
(function crearBotonLRE() {
    const btnTxt = document.getElementById('btnDescargarPrevired');
    if (!btnTxt || document.getElementById('btnDescargarLRE')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'btnDescargarLRE';
    b.className = 'btn btn-success fw-bold';
    b.disabled = true;
    b.innerText = '📘 Descargar LRE (Dirección del Trabajo)';
    btnTxt.insertAdjacentElement('afterend', b);
    b.addEventListener('click', descargarLRE);
})();


// ==========================================
// MANTENIMIENTO - SEGURIDAD (usuarios, firma, invitadores, migración)
// ==========================================
// Lista que tenía el formulario público escrita en el código; solo se usa la primera vez
// para llenar 0_config/invitadores. Después se edita desde esta misma pestaña.
const INVITADORES_INICIALES = ["Luis Jorquera", "Agustin Pino", "Martina Pino", "Ariela Rojas", "Javier Rojas", "Matias Puentes", "Mario Orbenes", "Hana Lizama", "Fakundo", "Karina Abstangen"];

async function cargarSeguridadNat() {
    if (!window.esAdmin) return;
    // Usuarios
    const lista = document.getElementById('listaRolesNat');
    if (lista) {
        try {
            const snap = await get(ref(db, '0_roles'));
            const roles = snap.exists() ? snap.val() : {};
            const miCorreo = window.localStorage.getItem('correoStaffNat') || '';
            lista.innerHTML = '';
            Object.keys(roles).sort().forEach(clave => {
                const correo = clave.replace(/,/g, '.');
                const fila = document.createElement('div');
                fila.className = 'd-flex justify-content-between align-items-center border-bottom border-secondary py-1';
                fila.innerHTML = `<span><span class="badge ${roles[clave] === 'admin' ? 'bg-danger' : 'bg-secondary'} me-2">${escaparHTML(roles[clave])}</span><span class="text-white"></span></span>`;
                fila.querySelector('.text-white').textContent = correo;
                if (correo !== miCorreo) {
                    const btn = document.createElement('button');
                    btn.className = 'btn btn-outline-danger btn-sm py-0';
                    btn.textContent = 'Quitar';
                    btn.onclick = async () => {
                        if (!confirm(`¿Quitar el acceso de ${correo}?`)) return;
                        await remove(ref(db, `0_roles/${clave}`));
                        cargarSeguridadNat();
                    };
                    fila.appendChild(btn);
                }
                lista.appendChild(fila);
            });
            if (!lista.children.length) lista.textContent = 'No hay usuarios cargados.';
        } catch (e) {
            lista.textContent = 'No se pudo leer la lista de usuarios.';
        }
    }
    // Firma
    const img = document.getElementById('previewFirmaProduccion');
    const sinFirma = document.getElementById('sinFirmaProduccion');
    if (img && sinFirma) {
        img.classList.toggle('d-none', !window.firmaProduccion);
        sinFirma.classList.toggle('d-none', !!window.firmaProduccion);
        if (window.firmaProduccion) img.src = window.firmaProduccion.startsWith('data:') ? window.firmaProduccion : 'data:image/jpeg;base64,' + window.firmaProduccion;
    }
    // Invitadores
    const txt = document.getElementById('textareaInvitadores');
    if (txt) txt.value = window.invitadoresNat.join('\n');
}

if (document.getElementById('mantenimiento-tab')) document.getElementById('mantenimiento-tab').addEventListener('click', cargarSeguridadNat);

if (document.getElementById('btnAgregarRol')) document.getElementById('btnAgregarRol').addEventListener('click', async () => {
    const correo = document.getElementById('nuevoRolCorreo').value.trim().toLowerCase();
    const tipo = document.getElementById('nuevoRolTipo').value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return alert("Escribe un correo válido.");
    if (tipo === 'admin' && !confirm(`${correo} podrá ver datos bancarios y médicos de todos los trabajadores. ¿Continuar?`)) return;
    try {
        await set(ref(db, `0_roles/${claveCorreo(correo)}`), tipo);
        document.getElementById('nuevoRolCorreo').value = '';
        cargarSeguridadNat();
    } catch (e) {
        alert("❌ No se pudo guardar el usuario.");
    }
});

if (document.getElementById('inputFirmaProduccion')) document.getElementById('inputFirmaProduccion').addEventListener('change', (e) => {
    const archivo = e.target.files[0];
    if (!archivo) return;
    if (archivo.size > 300 * 1024) return alert("La imagen es muy pesada (máximo 300 KB).");
    const lector = new FileReader();
    lector.onload = async () => {
        if (!confirm("¿Usar esta imagen como firma de producción en todos los contratos nuevos?")) return;
        try {
            await set(ref(db, '0_config/firma_produccion'), lector.result);
            window.firmaProduccion = lector.result;
            cargarSeguridadNat();
            alert("✅ Firma guardada.");
        } catch (err) {
            alert("❌ No se pudo guardar la firma.");
        }
    };
    lector.readAsDataURL(archivo);
    e.target.value = '';
});

if (document.getElementById('btnGuardarInvitadores')) document.getElementById('btnGuardarInvitadores').addEventListener('click', async () => {
    const nombres = document.getElementById('textareaInvitadores').value.split('\n').map(n => n.trim()).filter(Boolean);
    if (nombres.some(n => /[<>"`]/.test(n))) return alert("Los nombres no pueden tener los caracteres < > \" `");
    try {
        await set(ref(db, '0_config/invitadores'), nombres);
        window.invitadoresNat = nombres;
        alert("✅ Lista guardada. El formulario público ya la muestra.");
    } catch (e) {
        alert("❌ No se pudo guardar la lista.");
    }
});

if (document.getElementById('btnMigrarSeguridad')) document.getElementById('btnMigrarSeguridad').addEventListener('click', async () => {
    if (!window.esAdmin) return;
    if (!confirm("🔒 MIGRACIÓN DE SEGURIDAD\n\n• Banco, AFP, salud y enfermedades pasan a la ficha privada (solo admins).\n• El PIN de captador sale de la web pública.\n• El público solo podrá saber si un RUT está bloqueado (sin motivo ni fecha).\n• No se borra a ningún trabajador.\n\n¿Ejecutar?")) return;
    const estado = document.getElementById('estadoMigracionSeguridad');
    const pintar = (html) => { if (estado) estado.innerHTML = html; };
    const btn = document.getElementById('btnMigrarSeguridad');
    btn.disabled = true;
    try {
        pintar("⏳ Leyendo trabajadores...");
        const [basSnap, privSnap] = await Promise.all([get(ref(db, '1_trabajadores')), get(ref(db, '1p_privado'))]);
        const basicos = basSnap.exists() ? basSnap.val() : {};
        const privados = privSnap.exists() ? privSnap.val() : {};
        const ruts = Object.keys(basicos);
        let movidos = 0;
        const LOTE = 250;
        for (let i = 0; i < ruts.length; i += LOTE) {
            const updates = {};
            for (const rut of ruts.slice(i, i + LOTE)) {
                const ficha = basicos[rut] || {};
                let tocado = false;
                for (const campo of CAMPOS_PRIVADOS) {
                    if (ficha[campo] === undefined) continue;
                    // Si la ficha privada ya tiene ese dato (más nuevo), no se pisa
                    if (!privados[rut] || privados[rut][campo] === undefined) updates[`1p_privado/${rut}/${campo}`] = ficha[campo];
                    updates[`1_trabajadores/${rut}/${campo}`] = null;
                    tocado = true;
                }
                if (ficha.tiene_pin === undefined) updates[`1_trabajadores/${rut}/tiene_pin`] = !!(privados[rut] && privados[rut].pin_hash);
                if (tocado) movidos++;
            }
            if (Object.keys(updates).length) await update(ref(db), updates);
            pintar(`⏳ Trabajadores revisados: ${Math.min(i + LOTE, ruts.length)} de ${ruts.length}...`);
        }

        pintar("⏳ Moviendo PIN de captador...");
        const progSnap = await get(ref(db, '0_estado_sistema/programas_activos'));
        let pinsMovidos = 0;
        if (progSnap.exists()) {
            const progs = progSnap.val();
            const updates = {};
            for (const clave in progs) {
                const p = progs[clave];
                if (p.pin) {
                    updates[`0_config/pins_captador/${p.fecha}/${p.nombre}`] = String(p.pin);
                    updates[`0_estado_sistema/programas_activos/${clave}/pin`] = null;
                    updates[`0_estado_sistema/programas_activos/${clave}/requiere_pin`] = true;
                    pinsMovidos++;
                }
            }
            if (pinsMovidos) await update(ref(db), updates);
        }

        pintar("⏳ Separando el motivo de la lista negra...");
        const negraSnap = await get(ref(db, '4_blacklist'));
        let bloqueados = 0;
        if (negraSnap.exists()) {
            const marcas = {};
            Object.keys(negraSnap.val()).forEach(rut => { marcas[`4_bloqueados/${rut}`] = true; bloqueados++; });
            await update(ref(db), marcas);
        }

        const invSnap = await get(ref(db, '0_config/invitadores'));
        if (!invSnap.exists()) {
            await set(ref(db, '0_config/invitadores'), INVITADORES_INICIALES);
            window.invitadoresNat = [...INVITADORES_INICIALES];
        }

        await window.limpiarCache();
        pintar(`<span class="text-success fw-bold">✅ Listo. ${movidos} ficha(s) migradas de ${ruts.length}. PIN de captador movidos: ${pinsMovidos}. RUT bloqueados publicados (sin motivo): ${bloqueados}.</span>`);
    } catch (e) {
        console.error(e);
        pintar(`<span class="text-danger fw-bold">⛔ Se detuvo: ${escaparHTML(e.message)}. Se puede volver a ejecutar sin problema.</span>`);
    } finally {
        btn.disabled = false;
    }
});


// ==========================================
// MANTENIMIENTO - MOVER FIRMAS DE RECIBOS DE EFECTIVO (7_pagos_efectivo -> 12_firmas_recibos)
// ==========================================
// Por lotes y reanudable: copia la firma, la relee y la compara; solo si coincide la quita del recibo.
// Si se corta a mitad, al volver a presionar sigue donde quedó. Nunca borra un recibo.
async function moverFirmasRecibos() {
    if (!window.esAdmin) return;
    const estado = document.getElementById('estadoMoverFirmasRecibos');
    const pintar = (html) => { if (estado) estado.innerHTML = html; };
    if (!confirm("📦 MOVER FIRMAS DE RECIBOS\n\nLas firmas de los recibos de efectivo pasarán a su propia carpeta (12_firmas_recibos).\n\n• NO se borra ningún recibo.\n• Cada firma se copia, se verifica y recién ahí se quita del recibo.\n• Si se corta, se puede volver a presionar y sigue donde quedó.\n\n¿Continuar?")) return;
    const btn = document.getElementById('btnMoverFirmasRecibos');
    if (btn) btn.disabled = true;
    const LOTE = 25;
    let ultimo = null, revisados = 0, movidas = 0, yaMovidas = 0, sinFirma = 0, fallidas = 0;
    try {
        while (true) {
            const q = ultimo === null
                ? query(ref(db, '7_pagos_efectivo'), orderByKey(), limitToFirst(LOTE))
                : query(ref(db, '7_pagos_efectivo'), orderByKey(), startAfter(ultimo), limitToFirst(LOTE));
            const snap = await get(q);
            if (!snap.exists()) break;
            const lote = snap.val();
            const ids = Object.keys(lote).sort();
            if (ids.length === 0) break;
            for (const id of ids) {
                const rec = lote[id];
                revisados++;
                if (!rec.firma) { if (rec.tiene_firma) yaMovidas++; else sinFirma++; continue; }
                // 1) Copiar
                await set(ref(db, `${NODO_FIRMAS_RECIBOS}/${id}`), rec.firma);
                // 2) Verificar leyendo la copia
                const copia = (await get(ref(db, `${NODO_FIRMAS_RECIBOS}/${id}`))).val();
                if (copia !== rec.firma) { fallidas++; continue; }
                // 3) Recién ahora se quita la firma del recibo
                await update(ref(db, `7_pagos_efectivo/${id}`), { firma: null, tiene_firma: true });
                movidas++;
            }
            ultimo = ids[ids.length - 1];
            pintar(`⏳ Revisados ${revisados} recibos · movidas ${movidas} · ya estaban ${yaMovidas}`);
            if (ids.length < LOTE) break;
        }
        pintar(`<span class='${fallidas ? "text-warning" : "text-success"} fw-bold'>${fallidas ? "⚠️" : "✅"} Listo: ${movidas} firmas movidas, ${yaMovidas} ya estaban movidas, ${sinFirma} recibos sin firma${fallidas ? `, ${fallidas} no se pudieron verificar (siguen intactas en su recibo; vuelve a presionar)` : ""}.</span>`);
    } catch (e) {
        console.error(e);
        pintar(`<span class='text-danger fw-bold'>⛔ Se detuvo tras ${revisados} recibos (${movidas} movidas). No se perdió nada: vuelve a presionar para continuar.</span>`);
    } finally {
        if (btn) btn.disabled = false;
    }
}
if (document.getElementById('btnMoverFirmasRecibos')) document.getElementById('btnMoverFirmasRecibos').addEventListener('click', moverFirmasRecibos);

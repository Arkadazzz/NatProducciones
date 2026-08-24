import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDatabase, ref, get, set, remove, child, onValue, update } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyC5M5p6deAJu4qPeLxy1FdKDNLic5LoVpE",
    authDomain: "natproducciones.firebaseapp.com",
    projectId: "natproducciones",
    storageBucket: "natproducciones.firebasestorage.app",
    messagingSenderId: "553451405946",
    appId: "1:553451405946:web:3a9f5a4a1429466641f1c3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const mapaBancos = { "CHILE": "1", "ESTADO": "12", "SCOTIABANK": "14", "BCI": "16", "SANTANDER": "37", "ITAU": "39", "SECURITY": "49", "FALABELLA": "52", "RIPLEY": "53", "CONSORCIO": "55", "BICE": "28" };

onAuthStateChanged(auth, (user) => { if (!user) window.location.href = "login.html"; });
document.getElementById('btnCerrarSesion').addEventListener('click', () => { signOut(auth).then(() => { window.location.href = "login.html"; }); });

let nombrePrograma = ""; let fechaPrograma = ""; let montoPago = 0; let rutActual = "";
let html5QrcodeScanner = null; let signaturePad;
let listaGlobalCRM = {}; let blacklistGlobal = {}; let modalFichaInstance;

let totalEsperados = 0; let totalFirmados = 0; window.siguienteTicketAutomatico = 1;

get(ref(db, '1_trabajadores')).then(snap => { if (snap.exists()) listaGlobalCRM = snap.val(); });

// ==========================================
// PESTAÑA 1: PUERTA, ESCÁNER Y MONITOREO
// ==========================================
onValue(ref(db, '0_estado_sistema/programa_activo'), (snapshot) => {
    if (snapshot.exists()) {
        const data = snapshot.val();
        nombrePrograma = data.nombre; fechaPrograma = data.fecha; montoPago = data.monto;

        document.getElementById('seccionConfiguracion').classList.add('d-none');
        document.getElementById('seccionEscaner').classList.remove('d-none');
        document.getElementById('seccionLista').classList.remove('d-none');

        if (!html5QrcodeScanner) {
            html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: {width: 250, height: 250} }, false);
            html5QrcodeScanner.render(onScanSuccess, () => {});
        }
        activarRadares();
    } else {
        document.getElementById('seccionConfiguracion').classList.remove('d-none');
        document.getElementById('seccionEscaner').classList.add('d-none');
        document.getElementById('seccionFirma').classList.add('d-none');
        document.getElementById('seccionLista').classList.add('d-none');
        document.getElementById('tablaAsistentes').innerHTML = "";
        
        if (html5QrcodeScanner) { try { html5QrcodeScanner.clear(); } catch(e) {} html5QrcodeScanner = null; }
    }
});

document.getElementById('btnActivarWeb').addEventListener('click', async () => {
    const nom = document.getElementById('nombrePrograma').value;
    const fec = document.getElementById('fechaPrograma').value;
    const mon = document.getElementById('montoPago').value;
    if (!nom || !fec) return alert("Selecciona programa y fecha.");
    await set(ref(db, '0_estado_sistema/programa_activo'), { nombre: nom, fecha: fec, monto: mon });
});

document.getElementById('btnCerrarPuertas').addEventListener('click', async () => {
    if(confirm("¿Cerrar puertas y volver al inicio?")) await remove(ref(db, '0_estado_sistema/programa_activo'));
});

function activarRadares() {
    onValue(ref(db, `3_reservas/${fechaPrograma}/${nombrePrograma}`), (snapshot) => {
        totalEsperados = snapshot.exists() ? Object.keys(snapshot.val()).length : 0;
        actualizarTablero();
    });

    onValue(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}`), (snapshot) => {
        const asistencias = snapshot.exists() ? snapshot.val() : {};
        totalFirmados = Object.keys(asistencias).length;
        actualizarTablero();
        
        let maxNumero = 0;
        const conteoStaff = {}; // <- AQUI SE GUARDA EL RANKING DE INVITADOS
        const tbody = document.getElementById('tablaAsistentes');
        tbody.innerHTML = "";
        
        for (const rut in asistencias) {
            const asis = asistencias[rut];
            const trab = listaGlobalCRM[rut] || { nombres: "Desconocido", apellidos: "" };
            const num = parseInt(asis.numero_asignado) || 0;
            if (num > maxNumero) maxNumero = num; 

            // Sumatoria automática de invitados por Staff
            if (asis.tipo_ingreso === "Cortesía" && asis.invitado_por) {
                conteoStaff[asis.invitado_por] = (conteoStaff[asis.invitado_por] || 0) + 1;
            }
            
            const tr = document.createElement('tr');
            tr.innerHTML = `<td><span class="badge bg-secondary fs-6">${num || '-'}</span></td><td>${trab.nombres} ${trab.apellidos}</td><td>${asis.hora_ingreso}</td><td><span class="badge ${asis.tipo_ingreso === 'Pago' ? 'bg-success' : 'bg-warning text-dark'}">${asis.tipo_ingreso}</span></td><td><button class="btn btn-danger btn-sm" onclick="anularAsistencia('${rut}')">X</button></td>`;
            tbody.appendChild(tr);
        }
        window.siguienteTicketAutomatico = maxNumero + 1;

        // DIBUJAR EL RANKING SOLO SI ES PROGRAMA DE CORTESÍA
        if (nombrePrograma === "Detrás del Muro Cortesía") {
            document.getElementById('seccionConteoInvitados').classList.remove('d-none');
            let htmlConteo = "";
            for(const staff in conteoStaff) {
                htmlConteo += `<span class="badge bg-dark border border-warning fs-6 text-white">${staff}: <b class="text-warning fs-5 ms-1">${conteoStaff[staff]}</b></span>`;
            }
            document.getElementById('listaConteoInvitados').innerHTML = htmlConteo || "<small style='color: #aaaaaa;'>Aún no cruza la puerta ningún invitado.</small>";
        } else {
            document.getElementById('seccionConteoInvitados').classList.add('d-none');
        }
    });
}

function actualizarTablero() {
    document.getElementById('contEsperados').innerText = totalEsperados;
    document.getElementById('contFirmados').innerText = totalFirmados;
    let faltan = totalEsperados - totalFirmados;
    document.getElementById('contFaltan').innerText = faltan < 0 ? 0 : faltan;
}

async function onScanSuccess(decodedText) {
    html5QrcodeScanner.pause(); document.getElementById('mensajeEscaneo').classList.remove('d-none');
    rutActual = decodedText; 

    try {
        const blacklistSnap = await get(child(ref(db, `4_blacklist/${rutActual}`)));
        if (blacklistSnap.exists()) {
            alert(`⛔ ACCESO DENEGADO ⛔\nMotivo: ${blacklistSnap.val().motivo}`);
            html5QrcodeScanner.resume(); document.getElementById('mensajeEscaneo').classList.add('d-none');
            return;
        }

        const reservaSnap = await get(child(ref(db, `3_reservas/${fechaPrograma}/${nombrePrograma}/${rutActual}`)));
        const snapshot = await get(child(ref(db, `1_trabajadores/${rutActual}`)));
        
        if (snapshot.exists()) {
            const datos = snapshot.val();
            document.getElementById('nombreAsistenteDisplay').innerText = `${datos.nombres} ${datos.apellidos}`;
            const infoInvitado = document.getElementById('infoInvitado');
            
            if (reservaSnap.exists() && reservaSnap.val().tipo === "Cortesía") {
                infoInvitado.innerText = `⭐ INVITADO DE CORTESÍA (Por: ${reservaSnap.val().invitado_por})`;
            } else { 
                infoInvitado.innerText = `✅ EXTRA CON PAGO ($${montoPago})`; 
            }

            document.getElementById('seccionFirma').classList.remove('d-none');
            document.getElementById('numeroAsignado').value = window.siguienteTicketAutomatico;
            
            if(!signaturePad) signaturePad = new SignaturePad(document.getElementById('signature-pad'));
            signaturePad.clear(); document.getElementById('mensajeEscaneo').classList.add('d-none');
        } else {
            alert("RUT no encontrado en la base de datos.");
            html5QrcodeScanner.resume(); document.getElementById('mensajeEscaneo').classList.add('d-none');
        }
    } catch (error) { html5QrcodeScanner.resume(); }
}

document.getElementById('btnLimpiarFirma').addEventListener('click', () => signaturePad.clear());

document.getElementById('btnGuardarIngreso').addEventListener('click', async () => {
    if (signaturePad.isEmpty()) return alert("El trabajador debe firmar.");
    const firmaBase64 = signaturePad.toDataURL(); 
    const horaActual = new Date().toLocaleTimeString(); 
    const numeroFinal = document.getElementById('numeroAsignado').value;

    // EXTRACCIÓN INTELIGENTE DEL STAFF QUE LO INVITÓ
    const textoInfo = document.getElementById('infoInvitado').innerText;
    const tipo = textoInfo.includes("CORTESÍA") ? "Cortesía" : "Pago";
    let invitadoPor = "";
    if (tipo === "Cortesía" && textoInfo.includes("Por: ")) {
        invitadoPor = textoInfo.split("Por: ")[1].replace(")", "");
    }

    try {
        await set(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rutActual}`), { 
            rut: rutActual, nombre_programa: nombrePrograma, monto: (tipo === "Pago" ? montoPago : 0), 
            tipo_ingreso: tipo, hora_ingreso: horaActual, firma_digital: firmaBase64, estado_pago: "Pendiente",
            numero_asignado: numeroFinal, invitado_por: invitadoPor // <-- SE GUARDA EN FIREBASE PARA EL RANKING
        });
        document.getElementById('seccionFirma').classList.add('d-none');
        signaturePad.clear(); html5QrcodeScanner.resume(); rutActual = "";
    } catch (error) { alert("Error al guardar."); }
});

window.anularAsistencia = async function(rut) { 
    if(confirm("¿Seguro que deseas anular esta asistencia?")) await remove(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}`)); 
}

// ==========================================
// PESTAÑA 2: CRM Y BLACKLIST
// ==========================================
document.getElementById('crm-tab').addEventListener('click', async () => {
    const [trabSnap, blackSnap] = await Promise.all([ get(ref(db, '1_trabajadores')), get(ref(db, '4_blacklist')) ]);
    listaGlobalCRM = trabSnap.exists() ? trabSnap.val() : {};
    blacklistGlobal = blackSnap.exists() ? blackSnap.val() : {};
    renderCRM(listaGlobalCRM);
});

function renderCRM(datos) {
    const tbody = document.getElementById('tablaCRM'); tbody.innerHTML = "";
    for (const rut in datos) {
        const p = datos[rut]; const bloqueado = blacklistGlobal[rut] ? true : false;
        const estadoBadge = bloqueado ? '<span class="badge bg-danger">Bloqueado</span>' : '<span class="badge bg-success">Activo</span>';
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${rut}</td><td>${p.nombres} ${p.apellidos}</td><td>${p.telefono || '-'}</td><td>${estadoBadge}</td><td><button class="btn btn-outline-info btn-sm" onclick="verPerfil('${rut}')">Ver Ficha</button></td>`;
        tbody.appendChild(tr);
    }
}
document.getElementById('buscadorCRM').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtrados = Object.keys(listaGlobalCRM).reduce((acc, rut) => {
        const nombreCompl = `${listaGlobalCRM[rut].nombres} ${listaGlobalCRM[rut].apellidos}`.toLowerCase();
        if (rut.toLowerCase().includes(term) || nombreCompl.includes(term)) acc[rut] = listaGlobalCRM[rut];
        return acc;
    }, {});
    renderCRM(filtrados);
});

let rutPerfilActual = "";
window.verPerfil = function(rut) {
    rutPerfilActual = rut; const p = listaGlobalCRM[rut];
    document.getElementById('contenidoFicha').innerHTML = `
        <p><strong>Nombres:</strong> ${p.nombres} ${p.apellidos}</p>
        <p><strong>Fecha Nacimiento:</strong> ${p.fechaNacimiento || '-'} | <strong>Sexo:</strong> ${p.sexo || '-'}</p>
        <p><strong>RUT:</strong> ${p.rut} | <strong>Tel:</strong> ${p.telefono || '-'}</p>
        <p><strong>Dirección:</strong> ${p.direccion || '-'}</p><hr style="border-color: #333;">
        <p><strong>Banco:</strong> ${p.banco || '-'} | <strong>Cuenta:</strong> ${p.tipoCuenta || '-'}</p>
        <p><strong>N°:</strong> ${p.numeroCuenta || '-'}</p><p><strong>AFP:</strong> ${p.afp || '-'} | <strong>Salud:</strong> ${p.salud || '-'}</p>`;
    if (blacklistGlobal[rut]) {
        document.getElementById('motivoBloqueo').classList.add('d-none'); document.getElementById('btnBloquear').classList.add('d-none'); document.getElementById('btnDesbloquear').classList.remove('d-none');
    } else {
        document.getElementById('motivoBloqueo').classList.remove('d-none'); document.getElementById('motivoBloqueo').value = ""; document.getElementById('btnBloquear').classList.remove('d-none'); document.getElementById('btnDesbloquear').classList.add('d-none');
    }
    if(!modalFichaInstance) modalFichaInstance = new bootstrap.Modal(document.getElementById('modalFicha'));
    modalFichaInstance.show();
}
document.getElementById('btnBloquear').addEventListener('click', async () => {
    const motivo = document.getElementById('motivoBloqueo').value.trim();
    if(!motivo) return alert("Debes escribir un motivo.");
    if(confirm("¿Bloquear permanentemente a este usuario?")) {
        await set(ref(db, `4_blacklist/${rutPerfilActual}`), { fecha: new Date().toISOString(), motivo: motivo });
        blacklistGlobal[rutPerfilActual] = { motivo: motivo };
        modalFichaInstance.hide(); renderCRM(listaGlobalCRM); alert("Usuario bloqueado con éxito.");
    }
});
document.getElementById('btnDesbloquear').addEventListener('click', async () => {
    if(confirm("¿Quitar de la lista negra?")) {
        await remove(ref(db, `4_blacklist/${rutPerfilActual}`)); delete blacklistGlobal[rutPerfilActual];
        modalFichaInstance.hide(); renderCRM(listaGlobalCRM); alert("Usuario desbloqueado.");
    }
});

// ==========================================
// PESTAÑA 3: FINANZAS Y BÓVEDA
// ==========================================
document.getElementById('finanzas-tab').addEventListener('click', async () => {
    const snap = await get(ref(db, '2_asistencias'));
    if (!snap.exists()) return;
    if(Object.keys(listaGlobalCRM).length === 0) {
        const trabSnap = await get(ref(db, '1_trabajadores'));
        if (trabSnap.exists()) listaGlobalCRM = trabSnap.val();
    }
    let deudas = {}; const todas = snap.val();
    for (const fecha in todas) {
        for (const prog in todas[fecha]) {
            for (const r in todas[fecha][prog]) {
                const asis = todas[fecha][prog][r];
                if (asis.estado_pago === "Pendiente" && asis.monto > 0) {
                    if (!deudas[r]) deudas[r] = { monto: 0, dias: 0, rutas_bd: [] };
                    deudas[r].monto += parseInt(asis.monto); deudas[r].dias += 1; deudas[r].rutas_bd.push(`2_asistencias/${fecha}/${prog}/${r}`);
                }
            }
        }
    }
    window.deudasGlobales = deudas;
    const tbody = document.getElementById('tablaDeudas'); tbody.innerHTML = "";
    for (const r in deudas) {
        const tr = listaGlobalCRM[r] || { nombres: "Desconocido", apellidos: "" };
        const fila = document.createElement('tr');
        fila.innerHTML = `<td>${r}</td><td>${tr.nombres} ${tr.apellidos}</td><td><span class="badge bg-secondary">${deudas[r].dias} días</span></td><td class="text-success fw-bold fs-5">$${deudas[r].monto}</td>`;
        tbody.appendChild(fila);
    }
});

document.getElementById('btnLiquidarSemana').addEventListener('click', async () => {
    if (!window.deudasGlobales || Object.keys(window.deudasGlobales).length === 0) return alert("No hay plata retenida para liquidar.");
    if (!confirm("🚨 ATENCIÓN 🚨\n\n¿Estás seguro de liquidar TODOS los pagos pendientes?\n\nEsto descargará el archivo del banco y dejará la bóveda en cero.")) return;
    const fechaHoy = new Date().toISOString().split('T')[0];
    let csv = "\uFEFFCuenta origen (obligatorio);Moneda origen (obligatorio);Cuenta destino (obligatorio);Moneda destino (obligatorio);Código banco destino (obligatorio solo si banco destino no es Santander);RUT beneficiario (obligatorio solo si banco destino no es Santander);Nombre beneficiario (obligatorio solo si banco destino no es Santander);Monto transferir (obligatorio);Glosa personalizada transferencia (opcional);Correo beneficiario (opcional);Mensaje correo beneficiario (opcional);Glosa cartola originador (opcional);Glosa cartola beneficiario (opcional, solo Santander)\n";
    let actualizacionesFirebase = {};
    for (const r in window.deudasGlobales) {
        const deuda = window.deudasGlobales[r]; const tr = listaGlobalCRM[r];
        if (tr) {
            const rutSin = r.replace(/[^0-9kK]/g, '');
            csv += `96225970;CLP;${tr.numeroCuenta || ''};CLP;${mapaBancos[tr.banco] || ''};${rutSin};${tr.nombres} ${tr.apellidos};${deuda.monto};;${tr.email || ''};;Pago Acumulado;PAGO NAT\n`;
        }
        for (const ruta of deuda.rutas_bd) { actualizacionesFirebase[`${ruta}/estado_pago`] = "Pagado"; }
    }
    try {
        await update(ref(db), actualizacionesFirebase);
        descargarCSV(csv, `Nomina_Semanal_Acumulada_${fechaHoy}.csv`);
        alert("¡Liquidación exitosa!"); document.getElementById('tablaDeudas').innerHTML = ""; window.deudasGlobales = {};
    } catch (error) { alert("Error al procesar la liquidación."); }
});

document.getElementById('btnExcelBanco').addEventListener('click', async () => {
    if (!nombrePrograma) return alert("Ve a la pestaña Puerta y abre un programa primero.");
    if (nombrePrograma === "Dale Play") {
        if (!confirm("⚠️ ATENCIÓN: Seleccionaste 'Dale Play'.\n\nEste programa normalmente se acumula en la semana. Si descargas esta nómina diaria, estas personas desaparecerán de la Bóveda del viernes.\n\n¿Estás seguro?")) return;
    } else {
        if (!confirm(`¿Descargar nómina diaria para ${nombrePrograma}?\n\nAl confirmar, los asistentes de HOY se marcarán como PAGADOS.`)) return;
    }
    try {
        const snap = await get(child(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}`)));
        if (!snap.exists()) return alert("No hay asistentes hoy.");
        const asistencias = snap.val();
        let csv = "\uFEFFCuenta origen (obligatorio);Moneda origen (obligatorio);Cuenta destino (obligatorio);Moneda destino (obligatorio);Código banco destino (obligatorio solo si banco destino no es Santander);RUT beneficiario (obligatorio solo si banco destino no es Santander);Nombre beneficiario (obligatorio solo si banco destino no es Santander);Monto transferir (obligatorio);Glosa personalizada transferencia (opcional);Correo beneficiario (opcional);Mensaje correo beneficiario (opcional);Glosa cartola originador (opcional);Glosa cartola beneficiario (opcional, solo Santander)\n";
        let actualizacionesFirebase = {}; let hayPagosNuevos = false;
        for (const r in asistencias) {
            if (asistencias[r].estado_pago === "Pendiente" && asistencias[r].monto > 0) {
                hayPagosNuevos = true;
                const tr = listaGlobalCRM[r] || (await get(child(ref(db, `1_trabajadores/${r}`)))).val();
                if (tr) {
                    const rutSin = r.replace(/[^0-9kK]/g, '');
                    csv += `96225970;CLP;${tr.numeroCuenta || ''};CLP;${mapaBancos[tr.banco] || ''};${rutSin};${tr.nombres} ${tr.apellidos};${asistencias[r].monto};;${tr.email || ''};;${nombrePrograma};PAGO NAT\n`;
                }
                actualizacionesFirebase[`2_asistencias/${fechaPrograma}/${nombrePrograma}/${r}/estado_pago`] = "Pagado";
            }
        }
        if (!hayPagosNuevos) return alert("Las personas de hoy ya fueron marcadas como Pagadas.");
        await update(ref(db), actualizacionesFirebase);
        
        // Evitar que un "/" en el nombre del archivo rompa la descarga en Windows/Mac
        const nombreArchivoLimpio = nombrePrograma.replace(/[ \/]/g, "_");
        descargarCSV(csv, `Nomina_Banco_DIARIA_${nombreArchivoLimpio}_${fechaPrograma}.csv`);
        alert("¡Nómina diaria descargada con éxito!");
    } catch (e) { alert("Error al generar Excel Diario."); console.error(e); }
});

document.getElementById('btnExcelContador').addEventListener('click', async () => {
    const mes = new Date().toISOString().substring(0, 7);
    if (!confirm(`¿Descargar reporte contable de ${mes}?`)) return;
    try {
        const snap = await get(ref(db, '2_asistencias'));
        if (!snap.exists()) return alert("No hay asistencias.");
        let tot = {}; const todas = snap.val();
        for (const f in todas) {
            if (f.startsWith(mes)) {
                for (const prog in todas[f]) {
                    for (const r in todas[f][prog]) {
                        if (!tot[r]) tot[r] = { monto: 0, fechaIn: f };
                        tot[r].monto += parseInt(todas[f][prog][r].monto) || 0;
                    }
                }
            }
        }
        let csv = "\uFEFFRUT (completo);(*) RUT sin DV;(*) DV;Nombre (Completo);(*) Apellido Paterno;(*) Apellido Materno;(*) Nombres;Fec. Nacimiento;Fec. Ingreso;Fec. Contrato;Sexo;Cargo(30);Región;Dirección(40);Comuna;Ciudad;Tipo S.Base;Valor S.Base;AFP;FONASA / ISAPRE;Teléfono;Correo Electrónico\n";
        for (const r in tot) {
            const tr = listaGlobalCRM[r] || (await get(child(ref(db, `1_trabajadores/${r}`)))).val();
            if (tr) {
                const parts = r.split('-'); const aps = tr.apellidos ? tr.apellidos.trim().split(' ') : [""];
                const [y, m, d] = (tr.fechaNacimiento||"").split('-');
                csv += `${r};${parts[0]};${parts[1]||''};${tr.nombres} ${tr.apellidos};${aps[0]};${aps.slice(1).join(' ')};${tr.nombres};${d?d+'-'+m+'-'+y:''};${tot[r].fechaIn.split('-').reverse().join('-')};${tot[r].fechaIn.split('-').reverse().join('-')};${tr.sexo||''};extra publico (televisión);;${tr.direccion||''};;Santiago;Pesos;${tot[r].monto};${tr.afp||''};${tr.salud||''};${tr.telefono||''};${tr.email||''}\n`;
            }
        }
        descargarCSV(csv, `Contador_${mes}.csv`);
    } catch (e) { alert("Error al generar Excel."); }
});

function descargarCSV(c, n) { const url = URL.createObjectURL(new Blob([c], { type: 'text/csv;charset=utf-8;' })); const a = document.createElement("a"); a.href = url; a.download = n; a.click(); }

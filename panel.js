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

// ==========================================
// SISTEMA DE SEGURIDAD POR CORREOS (LISTA VIP)
// ==========================================
const CORREOS_ADMINISTRADORES = [
    "cami.fevreseguel@gmail.com",
    "pinoelgueta@gmail.com", 
    "natalyseguel.va@gmail.com",
    "javier.rojas.fer@gmail.com",
    "luisemilio.jorquera.avaria@gmail.com",
];

onAuthStateChanged(auth, (user) => { 
    if (!user) {
        window.location.href = "login.html"; 
    } else {
        const correoLimpio = user.email.trim().toLowerCase();
        const esAdmin = CORREOS_ADMINISTRADORES.includes(correoLimpio);
        
        if (!esAdmin) {
            const pestanasBloqueadas = ['crm-tab', 'finanzas-tab', 'seguridad-tab', 'mantenimiento-tab', 'contratos-dt-tab'];
            pestanasBloqueadas.forEach(id => {
                const tab = document.getElementById(id);
                if (tab && tab.parentElement) tab.parentElement.classList.add('d-none');
            });
        }
    }
});

document.getElementById('btnCerrarSesion').addEventListener('click', () => { signOut(auth).then(() => { window.location.href = "login.html"; }); });

const mapaBancos = { "CHILE": "1", "ESTADO": "12", "SCOTIABANK": "14", "BCI": "16", "SANTANDER": "37", "ITAU": "39", "SECURITY": "49", "RIPLEY": "53", "CONSORCIO": "55", "BICE": "28" };

let nombrePrograma = ""; let fechaPrograma = ""; let montoPago = 0; let horaTerminoGeneral = ""; let pinActivo = "";
let valorHoraExtraGlobal = 0;
let html5QrcodeScanner = null; let signaturePad; let rutActual = ""; let claveActual = "";
let listaGlobalCRM = {}; let blacklistGlobal = {}; let modalFichaInstance;

let totalEsperados = 0; let totalFirmados = 0; window.siguienteTicketAutomatico = 1;
window.asistentesSinSalida = 0; 
let unsubscribeReservas = null; let unsubscribeAsistencias = null;

function poblarSelectoresHora() {
    let opcionesHTML = '<option value="">-- Selecciona --</option>';
    const horas = [8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,0,1];
    for (let h of horas) {
        for (let m of [0, 30]) {
            let hh24 = h.toString().padStart(2, '0');
            let mm = m.toString().padStart(2, '0');
            let ampm = (h >= 12 && h < 24) ? 'PM' : 'AM';
            let h12 = h % 12; if (h12 === 0) h12 = 12;
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

get(ref(db, '1_trabajadores')).then(snap => { if (snap.exists()) listaGlobalCRM = snap.val(); });

onValue(ref(db, '0_estado_sistema/programas_activos'), (snapshot) => {
    const container = document.getElementById('contenedorProgramasActivos'); container.innerHTML = "";
    if (snapshot.exists()) {
        const programas = snapshot.val();
        for (const clave in programas) {
            const p = programas[clave];
            let badgePin = p.pin ? `<span class="badge bg-warning text-dark ms-2 fw-bold fs-6">PIN I/P: ${p.pin}</span>` : "";
            container.innerHTML += `
                <div class="alert mb-2 d-flex justify-content-between align-items-center" style="background: #1c103f; border: 1px solid #b066ff;">
                    <div>
                        <strong class="text-white">${p.nombre.replace(" - ", " / ")}</strong> ${badgePin}<br>
                        <small style="color: #d6b3ff;">${p.fecha} | Citación: ${p.hora_citacion || 'N/A'} | Salida: ${p.hora_termino || 'N/A'} | H.Extra: $${p.valor_hora_extra || 0}</small>
                    </div>
                    <div>
                        <button class="btn btn-success btn-sm fw-bold" onclick="window.unirseASala('${clave}', '${p.nombre}', '${p.fecha}', '${p.monto}', '${p.pin}', '${p.hora_termino}', '${p.valor_hora_extra || 0}')">🚪 Entrar</button>
                        <button class="btn btn-danger btn-sm fw-bold ms-1" onclick="window.cerrarProgramaGlobal('${clave}')">X</button>
                    </div>
                </div>`;
        }
    } else {
        container.innerHTML = "<p class='text-muted' style='font-size: 0.9em;'>No hay programas corriendo.</p>";
        salirDeSala();
    }
});

document.getElementById('btnActivarWeb').addEventListener('click', async () => {
    const nom = document.getElementById('nombrePrograma').value;
    const fec = document.getElementById('fechaPrograma').value;
    const mon = document.getElementById('montoPago').value;
    const horaCitacion = document.getElementById('horaCitacion').value; 
    const valorHE = document.getElementById('valorHoraExtra').value || 0;
    const horaSal = document.getElementById('horaTermino').value;
    
    if (!nom || !fec || !mon || !horaSal || !horaCitacion) return alert("Completa todos los campos obligatorios.");

    let pinGenerado = ""; if (nom.includes("Detrás del Muro")) pinGenerado = Math.floor(1000 + Math.random() * 9000).toString();
    const claveSegura = nom.replace(/[.#$\[\]]/g, "_");
    
    await set(ref(db, `0_estado_sistema/programas_activos/${claveSegura}`), { 
        nombre: nom, fecha: fec, monto: mon, pin: pinGenerado, hora_termino: horaSal, valor_hora_extra: valorHE, hora_citacion: horaCitacion 
    });
    window.unirseASala(claveSegura, nom, fec, mon, pinGenerado, horaSal, valorHE);
});

window.unirseASala = function(clave, nom, fec, mon, pin, horaSal, valorHE) {
    claveActual = clave; nombrePrograma = nom; fechaPrograma = fec; montoPago = mon; 
    pinActivo = pin || ""; horaTerminoGeneral = horaSal || ""; valorHoraExtraGlobal = parseInt(valorHE) || 0;
    
    let titulo = `Sala: ${nom.replace(" - ", " / ")}`; if (pinActivo) titulo += ` <span class="badge bg-warning text-dark ms-2">PIN: ${pinActivo}</span>`;
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
    if(confirm("¿TERMINAR programa para todos? Desaparecerá de la web pública.")) await remove(ref(db, `0_estado_sistema/programas_activos/${clave}`));
}

function calcularBonoExtraUsandoNow(horaTerminoProg, valorHoraExtra, fechaProg) {
    if (!horaTerminoProg || !valorHoraExtra || valorHoraExtra <= 0) return 0;
    let [y, m, d] = fechaProg.split('-');
    let [hE, mE] = horaTerminoProg.split(':').map(Number);
    let expectedEnd = new Date(y, m - 1, d, hE, mE);
    
    if (hE === 0 || hE === 1) expectedEnd.setDate(expectedEnd.getDate() + 1);
    
    const now = new Date();
    let diffMins = Math.floor((now - expectedEnd) / 60000);
    
    if (diffMins >= 60) return Math.floor(diffMins / 60) * valorHoraExtra;
    return 0;
}

document.getElementById('btnEsUnDia').addEventListener('click', async () => {
    if (!claveActual) return;
    const now = new Date();
    const horaSalidaMasiva = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

    if (!confirm(`🎬 ¡ATENCIÓN EQUIPO! 🎬\n\n¿Cerrar la jornada y dar por terminado el evento?\n\nEl sistema marcará la salida a las ${horaSalidaMasiva} y calculará horas extras para todos.\n\n¿Proceder?`)) return;

    try {
        const snap = await get(child(ref(db), `2_asistencias/${fechaPrograma}/${nombrePrograma}`));
        if (snap.exists()) {
            const asistencias = snap.val();
            let actualizacionesFirebase = {};
            let procesados = 0;

            let bonoExtraMasivo = 0;
            if (horaTerminoGeneral && valorHoraExtraGlobal > 0) {
                bonoExtraMasivo = calcularBonoExtraUsandoNow(horaTerminoGeneral, valorHoraExtraGlobal, fechaPrograma);
            }

            for (const rut in asistencias) {
                const asis = asistencias[rut];
                if (!asis.hora_salida) {
                    let bonoFinal = (asis.tipo_ingreso !== "Cortesía") ? bonoExtraMasivo : 0;
                    const nuevoMontoTotal = (parseInt(asis.monto) || 0) + bonoFinal;
                    
                    actualizacionesFirebase[`2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}/hora_salida`] = horaSalidaMasiva;
                    actualizacionesFirebase[`2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}/bono_horas_extras`] = bonoFinal;
                    actualizacionesFirebase[`2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}/monto`] = nuevoMontoTotal;
                    procesados++;
                }
            }

            if (Object.keys(actualizacionesFirebase).length > 0) {
                await update(ref(db), actualizacionesFirebase);
                alert(`✅ Checkout Masivo Exitoso.\nSe calculó la salida y el pago a ${procesados} personas.`);
            }
        }
        await remove(ref(db, `0_estado_sistema/programas_activos/${claveActual}`));
        alert("¡Jornada terminada con éxito!");
        salirDeSala();
    } catch (error) { alert("Error al intentar cerrar la jornada masivamente."); }
});

document.getElementById('btnVolverMenu').addEventListener('click', salirDeSala);
function salirDeSala() {
    claveActual = ""; nombrePrograma = ""; fechaPrograma = ""; montoPago = 0; pinActivo = ""; horaTerminoGeneral = ""; valorHoraExtraGlobal = 0;
    document.getElementById('seccionConfiguracion').classList.remove('d-none');
    document.getElementById('seccionEscaner').classList.add('d-none');
    document.getElementById('seccionFirma').classList.add('d-none');
    document.getElementById('seccionLista').classList.add('d-none');
    document.getElementById('tablaAsistentes').innerHTML = "";
    if (unsubscribeReservas) unsubscribeReservas();
    if (unsubscribeAsistencias) unsubscribeAsistencias();
    if (html5QrcodeScanner) { try { html5QrcodeScanner.clear(); } catch(e) {} html5QrcodeScanner = null; }
}

function activarRadares() {
    if (unsubscribeReservas) unsubscribeReservas(); if (unsubscribeAsistencias) unsubscribeAsistencias();
    unsubscribeReservas = onValue(ref(db, `3_reservas/${fechaPrograma}/${nombrePrograma}`), (snapshot) => {
        totalEsperados = snapshot.exists() ? Object.keys(snapshot.val()).length : 0; actualizarTablero();
    });
    unsubscribeAsistencias = onValue(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}`), (snapshot) => {
        const asistencias = snapshot.exists() ? snapshot.val() : {};
        totalFirmados = Object.keys(asistencias).length; actualizarTablero();
        
        let maxNumero = 0; const conteoStaff = {}; window.asistentesSinSalida = 0; 
        const tbody = document.getElementById('tablaAsistentes'); tbody.innerHTML = "";
        
        for (const rut in asistencias) {
            const asis = asistencias[rut]; const trab = listaGlobalCRM[rut] || { nombres: "Desconocido", apellidos: "" };
            const num = parseInt(asis.numero_asignado) || 0; if (num > maxNumero) maxNumero = num; 
            if (asis.tipo_ingreso === "Cortesía" && asis.invitado_por) conteoStaff[asis.invitado_por] = (conteoStaff[asis.invitado_por] || 0) + 1;
            
            let btnDT = "";
            if (asis.aplica_contrato) {
                if (asis.estado_dt === "Subido") {
                    btnDT = `<button class="btn btn-success btn-sm fw-bold" onclick="window.toggleDT('${rut}', 'Pendiente')">✅ DT Listo</button>`;
                } else {
                    btnDT = `<button class="btn btn-outline-warning btn-sm fw-bold" onclick="window.toggleDT('${rut}', 'Subido')">⏳ Subir DT</button>`;
                }
            } else {
                btnDT = `<span class="badge bg-secondary">No aplica</span>`;
            }

            let btnSalidaContrato = "";
            let textPDF = asis.tipo_ingreso === "Cortesía" || !asis.aplica_contrato ? "📄 Cesión Imagen" : "📄 Contrato";
            
            if (asis.hora_salida) {
                btnSalidaContrato = `<span class="badge bg-secondary">Salió: ${asis.hora_salida}</span> <button class="btn btn-outline-info btn-sm ms-1" onclick="window.generarContratoPDF('${rut}')">${textPDF}</button>`;
            } else { 
                window.asistentesSinSalida++; 
                btnSalidaContrato = `<button class="btn btn-outline-warning btn-sm" onclick="window.marcarSalida('${rut}', '${asis.tipo_ingreso}', ${asis.monto})">Marcar Salida</button>`; 
            }
            
            const btnEditarPago = `<span class="badge bg-success fs-6 btn-pago-editable" onclick="window.editarMontoIndividual('${rut}', ${asis.monto}, '${trab.nombres}')" title="Click para editar sueldo">✏️ $${asis.monto}</span>`;

            const tr = document.createElement('tr');
            tr.innerHTML = `<td><span class="badge bg-secondary fs-6">${num || '-'}</span></td>
                            <td>${trab.nombres} ${trab.apellidos}<br>${btnEditarPago}</td>
                            <td>${asis.hora_ingreso}</td>
                            <td>${btnDT}</td>
                            <td>${btnSalidaContrato}</td>
                            <td><button class="btn btn-danger btn-sm" onclick="window.anularAsistencia('${rut}')">X</button></td>`;
            tbody.appendChild(tr);
        }
        window.siguienteTicketAutomatico = maxNumero + 1;
        if (nombrePrograma.includes("Detrás del Muro")) {
            document.getElementById('seccionConteoInvitados').classList.remove('d-none');
            let htmlConteo = "";
            for(const staff in conteoStaff) htmlConteo += `<span class="badge bg-dark border border-warning fs-6 text-white">${staff}: <b class="text-warning fs-5 ms-1">${conteoStaff[staff]}</b></span>`;
            document.getElementById('listaConteoInvitados').innerHTML = htmlConteo || "<small style='color: #aaaaaa;'>Nadie ha llegado.</small>";
        } else { document.getElementById('seccionConteoInvitados').classList.add('d-none'); }
    });
}

function actualizarTablero() {
    document.getElementById('contEsperados').innerText = totalEsperados;
    document.getElementById('contFirmados').innerText = totalFirmados;
    let faltan = totalEsperados - totalFirmados; document.getElementById('contFaltan').innerText = faltan < 0 ? 0 : faltan;
}

window.toggleDT = async function(rut, nuevoEstado) {
    try { await update(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}`), { estado_dt: nuevoEstado }); } 
    catch (e) { alert("Error al actualizar el estado DT."); }
}

window.editarMontoIndividual = async function(rut, montoActual, nombrePersona) {
    let nuevoMonto = prompt(`¿Cuánto será el NUEVO PAGO TOTAL de ${nombrePersona} para la jornada de hoy?\n(Monto actual: $${montoActual})`, montoActual);
    if (nuevoMonto === null || nuevoMonto === "") return;
    nuevoMonto = parseInt(nuevoMonto);
    if (isNaN(nuevoMonto)) return alert("Por favor ingresa solo números.");
    try { await update(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}`), { monto: nuevoMonto }); } catch (e) { alert("Error al actualizar el pago."); }
}

window.marcarSalida = async function(rut, tipoIngreso, montoBaseActual) {
    const now = new Date();
    const horaSalida = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    let bonoExtra = 0;
    
    if (tipoIngreso === "Cortesía") {
        if (!confirm(`¿Marcar salida para este Invitado de Cortesía a las ${horaSalida}?\n(Se mantendrá su pago en $0).`)) return;
    } else {
        let bonoSugerido = 0;
        if (horaTerminoGeneral && valorHoraExtraGlobal > 0) {
            bonoSugerido = calcularBonoExtraUsandoNow(horaTerminoGeneral, valorHoraExtraGlobal, fechaPrograma);
        }
        
        let msj = bonoSugerido > 0 ? `¡ATENCIÓN! La persona completó horas extras.\nCÁLCULO AUTOMÁTICO: $${bonoSugerido}\nPuedes aceptar o escribir otro valor:` : `Ingresa el monto de bono por horas extra (si no, pon 0):`;
        
        let respuesta = prompt(msj, bonoSugerido);
        if (respuesta === null) return; bonoExtra = parseInt(respuesta) || 0;
    }
    
    const nuevoMontoTotal = (parseInt(montoBaseActual) || 0) + bonoExtra;
    try { await update(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}`), { hora_salida: horaSalida, bono_horas_extras: bonoExtra, monto: nuevoMontoTotal }); } 
    catch (error) { alert("Error al marcar salida."); }
}

document.getElementById('btnIngresoManual').addEventListener('click', () => {
    const rutIngresado = document.getElementById('rutManual').value.trim();
    if (!rutIngresado) return alert("Por favor, ingresa el RUT para buscarlo.");
    onScanSuccess(rutIngresado); document.getElementById('rutManual').value = "";
});

async function onScanSuccess(decodedText) {
    try { if(html5QrcodeScanner) html5QrcodeScanner.pause(); } catch(e) {} 
    document.getElementById('mensajeEscaneo').classList.remove('d-none'); rutActual = decodedText; 
    try {
        const blacklistSnap = await get(child(ref(db), `4_blacklist/${rutActual}`));
        if (blacklistSnap.exists()) { 
            alert(`⛔ ACCESO DENEGADO ⛔\nLa persona no tiene permitido el ingreso.`); 
            try { if(html5QrcodeScanner) html5QrcodeScanner.resume(); } catch(e) {} 
            document.getElementById('mensajeEscaneo').classList.add('d-none'); return; 
        }
        
        const reservaSnap = await get(child(ref(db), `3_reservas/${fechaPrograma}/${nombrePrograma}/${rutActual}`));
        const snapshot = await get(child(ref(db), `1_trabajadores/${rutActual}`));
        
        if (snapshot.exists()) {
            const datos = snapshot.val(); listaGlobalCRM[rutActual] = datos; 
            document.getElementById('nombreAsistenteDisplay').innerText = `${datos.nombres} ${datos.apellidos}`;
            const infoInvitado = document.getElementById('infoInvitado');
            
            const esCortesia = reservaSnap.exists() && reservaSnap.val().tipo === "Cortesía";
            infoInvitado.innerText = esCortesia ? `⭐ INVITADO DE CORTESÍA (Por: ${reservaSnap.val().invitado_por})` : `✅ EXTRA CON PAGO ($${montoPago})`; 

            const opcionesDiv = document.getElementById('opcionesFirmaAdmin');
            opcionesDiv.classList.remove('d-none');
            
            if (esCortesia) {
                const nombreActual = reservaSnap.exists() ? reservaSnap.val().invitado_por : "";
                opcionesDiv.innerHTML = `
                    <label class="form-label text-warning mb-1">Corregir "Invitado Por":</label>
                    <select id="editInvitadoPor" class="form-select bg-dark text-white border-warning">
                        <option value="Luis Jorquera" ${nombreActual==="Luis Jorquera"?'selected':''}>Luis Jorquera</option>
                        <option value="Agustin Pino" ${nombreActual==="Agustin Pino"?'selected':''}>Agustin Pino</option>
                        <option value="Martina Pino" ${nombreActual==="Martina Pino"?'selected':''}>Martina Pino</option>
                        <option value="Ariela Rojas" ${nombreActual==="Ariela Rojas"?'selected':''}>Ariela Rojas</option>
                        <option value="Javier Rojas" ${nombreActual==="Javier Rojas"?'selected':''}>Javier Rojas</option>
                        <option value="Matias Puentes" ${nombreActual==="Matias Puentes"?'selected':''}>Matias Puentes</option>
                        <option value="Mario Orbenes" ${nombreActual==="Mario Orbenes"?'selected':''}>Mario Orbenes</option>
                        <option value="Hana Lizama" ${nombreActual==="Hana Lizama"?'selected':''}>Hana Lizama</option>
                        <option value="Fakundo" ${nombreActual==="Fakundo"?'selected':''}>Fakundo</option>
                    </select>
                `;
            } else {
                opcionesDiv.innerHTML = `
                    <div class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" id="checkAplicaContrato" checked style="transform: scale(1.3); margin-right: 10px;">
                        <label class="form-check-label text-white fw-bold" for="checkAplicaContrato">Generar Contrato Laboral DT</label>
                    </div>
                    <small class="text-muted">Si lo apagas, solo firmará Cesión de Imagen.</small>
                `;
            }

            document.getElementById('seccionFirma').classList.remove('d-none'); 
            document.getElementById('numeroAsignado').value = window.siguienteTicketAutomatico;
            
            if(!signaturePad) signaturePad = new SignaturePad(document.getElementById('signature-pad'), { backgroundColor: 'rgb(255, 255, 255)' }); 
            signaturePad.clear(); document.getElementById('mensajeEscaneo').classList.add('d-none');
        } else { 
            alert("RUT no encontrado en la base de datos."); 
            try { if(html5QrcodeScanner) html5QrcodeScanner.resume(); } catch(e) {} 
            document.getElementById('mensajeEscaneo').classList.add('d-none'); 
        }
    } catch (error) { try { if(html5QrcodeScanner) html5QrcodeScanner.resume(); } catch(e) {} }
}

document.getElementById('btnLimpiarFirma').addEventListener('click', () => signaturePad.clear());
document.getElementById('btnGuardarIngreso').addEventListener('click', async () => {
    if (signaturePad.isEmpty()) return alert("El trabajador debe firmar.");
    const firmaBase64 = signaturePad.toDataURL("image/jpeg"); const now = new Date();
    const horaActual = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    const numeroFinal = document.getElementById('numeroAsignado').value;
    
    const textoInfo = document.getElementById('infoInvitado').innerText; 
    const tipo = textoInfo.includes("CORTESÍA") ? "Cortesía" : "Pago";
    
    let invitadoPor = "";
    let aplicaContrato = false;

    if (tipo === "Cortesía") {
        invitadoPor = document.getElementById('editInvitadoPor') ? document.getElementById('editInvitadoPor').value : "";
        aplicaContrato = false; 
    } else {
        aplicaContrato = document.getElementById('checkAplicaContrato') ? document.getElementById('checkAplicaContrato').checked : true;
    }

    try {
        await set(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rutActual}`), { 
            rut: rutActual, nombre_programa: nombrePrograma, monto: (tipo === "Pago" ? montoPago : 0), 
            tipo_ingreso: tipo, hora_ingreso: horaActual, firma_digital: firmaBase64, estado_pago: "Pendiente", 
            numero_asignado: numeroFinal, invitado_por: invitadoPor, aplica_contrato: aplicaContrato, estado_dt: "Pendiente" 
        });
        document.getElementById('seccionFirma').classList.add('d-none'); signaturePad.clear(); 
        try { if(html5QrcodeScanner) html5QrcodeScanner.resume(); } catch(e) {} rutActual = "";
    } catch (error) { alert("Error al guardar."); }
});

window.anularAsistencia = async function(rut) { if(confirm("¿Seguro que deseas anular esta asistencia?")) await remove(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}`)); }

window.generarContratoPDF = async function(rut) {
    const trab = listaGlobalCRM[rut]; const asisSnap = await get(child(ref(db), `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}`));
    if (!trab || !asisSnap.exists()) return alert("Faltan datos.");
    const asis = asisSnap.val(); const { jsPDF } = window.jspdf; const doc = new jsPDF({ format: 'legal' });
    dibujarContratoEnPDF(doc, rut, trab, asis, fechaPrograma, nombrePrograma.replace(" - ", " / "));
    
    const nombreCompletoLimpio = `${trab.nombres || ''}_${trab.apellidos || ''}`.replace(/[^a-zA-Z0-9_]/g, "");
    let nombreArchivo = asis.tipo_ingreso === "Cortesía" || !asis.aplica_contrato ? `Cesion_Imagen_${nombreCompletoLimpio}_${rut}.pdf` : `Contrato_${nombreCompletoLimpio}_${rut}.pdf`;
    doc.save(nombreArchivo);
}

function dibujarContratoEnPDF(doc, rut, trab, asis, fechaProg, nombreProg) {
    let y = 15; doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    const mesNombres = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const [yearF, monthF, dayF] = fechaProg.split('-'); const fechaTexto = `${dayF} de ${mesNombres[parseInt(monthF)-1]} de ${yearF}`;
    const fechaNac = trab.fechaNacimiento ? trab.fechaNacimiento.split('-').reverse().join('-') : '___________';
    const nombreCompleto = `${trab.nombres || ''} ${trab.apellidos || ''}`.toUpperCase();
    const direccion = trab.direccion ? trab.direccion.toUpperCase() : '_______________________';

    let titulo = ""; let textoContrato = "";

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

UNDÉCIMO. De conformidad a la Ley N° 19.799 sobre Documentos Electrónicos y Firma Electrónica, el presente contrato se suscribe mediante Firma Electrónica Simple validada en plataforma.`;
    }

    doc.text(titulo, 105, y, null, null, "center"); y += 15;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    
    const lineas = doc.splitTextToSize(textoContrato, 175); doc.text(lineas, 20, y); y += (lineas.length * 4.8) + 20; 

    doc.setFont("helvetica", "bold"); doc.text("_________________________________", 50, y, null, null, "center"); doc.text("Firma Producción", 50, y + 5, null, null, "center"); doc.setFont("helvetica", "normal"); doc.text("CAMILA FEVRE SEGUEL", 50, y + 10, null, null, "center"); 

    doc.setFont("helvetica", "bold"); 
    if (asis.firma_digital) { try { doc.addImage(asis.firma_digital, 'JPEG', 115, y - 25, 80, 25); } catch(e) { console.error("Error firma"); } }
    doc.text("_________________________________", 155, y, null, null, "center"); doc.text("Firma Asistente", 155, y + 5, null, null, "center"); doc.setFont("helvetica", "normal"); doc.text(nombreCompleto, 155, y + 10, null, null, "center"); 
}

// ==========================================
// PESTAÑA 2: CRM & EDICIÓN
// ==========================================
document.getElementById('crm-tab').addEventListener('click', async () => {
    const [trabSnap, blackSnap] = await Promise.all([ get(ref(db, '1_trabajadores')), get(ref(db, '4_blacklist')) ]);
    listaGlobalCRM = trabSnap.exists() ? trabSnap.val() : {}; blacklistGlobal = blackSnap.exists() ? blackSnap.val() : {}; renderCRM(listaGlobalCRM);
});

function renderCRM(datos) {
    const tbody = document.getElementById('tablaCRM'); tbody.innerHTML = "";
    for (const rut in datos) {
        const p = datos[rut]; const bloqueado = blacklistGlobal[rut] ? true : false;
        const estadoBadge = bloqueado ? '<span class="badge bg-danger">Bloqueado</span>' : '<span class="badge bg-success">Activo</span>';
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${rut}</td><td>${p.nombres} ${p.apellidos}</td><td>${p.telefono || '-'}</td><td>${estadoBadge}</td><td><button class="btn btn-outline-info btn-sm" onclick="verPerfil('${rut}')">Editar / Ficha</button></td>`;
        tbody.appendChild(tr);
    }
}
document.getElementById('buscadorCRM').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtrados = Object.keys(listaGlobalCRM).reduce((acc, rut) => {
        const nombreCompl = `${listaGlobalCRM[rut].nombres} ${listaGlobalCRM[rut].apellidos}`.toLowerCase();
        if (rut.toLowerCase().includes(term) || nombreCompl.includes(term)) acc[rut] = listaGlobalCRM[rut]; return acc;
    }, {}); renderCRM(filtrados);
});

let rutPerfilActual = "";
window.verPerfil = function(rut) {
    rutPerfilActual = rut; const p = listaGlobalCRM[rut];
    document.getElementById('contenidoFicha').innerHTML = `
        <div class="row">
            <div class="col-6 mb-2"><label class="text-muted small">Nombres</label><input type="text" class="form-control bg-dark text-white" id="editNombres" value="${p.nombres}"></div>
            <div class="col-6 mb-2"><label class="text-muted small">Apellidos</label><input type="text" class="form-control bg-dark text-white" id="editApellidos" value="${p.apellidos}"></div>
            <div class="col-6 mb-2"><label class="text-muted small">RUT</label><input type="text" class="form-control bg-secondary text-white" value="${p.rut}" readonly></div>
            <div class="col-6 mb-2"><label class="text-muted small">Fecha Nacimiento</label><input type="date" class="form-control bg-dark text-white" id="editNacimiento" value="${p.fechaNacimiento || ''}"></div>
            <div class="col-6 mb-2"><label class="text-muted small">Teléfono</label><input type="text" class="form-control bg-dark text-white" id="editTel" value="${p.telefono || ''}"></div>
            <div class="col-6 mb-2"><label class="text-muted small">Correo Electrónico</label><input type="email" class="form-control bg-dark text-white" id="editEmail" value="${p.email || ''}"></div>
            <div class="col-12 mb-2"><label class="text-muted small">Dirección</label><input type="text" class="form-control bg-dark text-white" id="editDir" value="${p.direccion || ''}"></div>
            <div class="col-6 mb-2"><label class="text-muted small">Banco</label><input type="text" class="form-control bg-dark text-white" id="editBanco" value="${p.banco || ''}"></div>
            <div class="col-6 mb-2"><label class="text-muted small">N° Cuenta</label><input type="text" class="form-control bg-dark text-white" id="editCuenta" value="${p.numeroCuenta || ''}"></div>
            <div class="col-6 mb-2"><label class="text-muted small">AFP</label><input type="text" class="form-control bg-dark text-white" id="editAfp" value="${p.afp || ''}"></div>
            <div class="col-6 mb-2"><label class="text-muted small">Salud</label><input type="text" class="form-control bg-dark text-white" id="editSalud" value="${p.salud || ''}"></div>
        </div>`;
    
    if (blacklistGlobal[rut]) {
        document.getElementById('motivoBloqueo').classList.add('d-none'); document.getElementById('btnBloquear').classList.add('d-none'); document.getElementById('btnDesbloquear').classList.remove('d-none');
    } else {
        document.getElementById('motivoBloqueo').classList.remove('d-none'); document.getElementById('motivoBloqueo').value = ""; document.getElementById('btnBloquear').classList.remove('d-none'); document.getElementById('btnDesbloquear').classList.add('d-none');
    }
    if(!modalFichaInstance) modalFichaInstance = new bootstrap.Modal(document.getElementById('modalFicha'));
    modalFichaInstance.show();
}

document.getElementById('btnGuardarEdicion').addEventListener('click', async () => {
    try {
        await update(ref(db, `1_trabajadores/${rutPerfilActual}`), {
            nombres: document.getElementById('editNombres').value, 
            apellidos: document.getElementById('editApellidos').value,
            fechaNacimiento: document.getElementById('editNacimiento').value,
            telefono: document.getElementById('editTel').value, 
            email: document.getElementById('editEmail').value,
            direccion: document.getElementById('editDir').value,
            banco: document.getElementById('editBanco').value, 
            numeroCuenta: document.getElementById('editCuenta').value,
            afp: document.getElementById('editAfp').value, 
            salud: document.getElementById('editSalud').value
        });
        alert("Datos actualizados correctamente."); 
        listaGlobalCRM[rutPerfilActual] = (await get(child(ref(db, `1_trabajadores/${rutPerfilActual}`)))).val();
        renderCRM(listaGlobalCRM); modalFichaInstance.hide();
    } catch (e) { alert("Error al guardar."); }
});

document.getElementById('btnEliminarTrabajador').addEventListener('click', async () => {
    if(confirm("🚨 ¿ESTÁS SEGURO? 🚨\nEsto borrará a la persona de la base de datos para siempre.")) {
        await remove(ref(db, `1_trabajadores/${rutPerfilActual}`));
        delete listaGlobalCRM[rutPerfilActual]; renderCRM(listaGlobalCRM); modalFichaInstance.hide(); alert("Trabajador eliminado.");
    }
});

document.getElementById('btnBloquear').addEventListener('click', async () => {
    const motivo = document.getElementById('motivoBloqueo').value.trim(); if(!motivo) return alert("Debes escribir un motivo.");
    if(confirm("¿Bloquear permanentemente a este usuario?")) {
        await set(ref(db, `4_blacklist/${rutPerfilActual}`), { fecha: new Date().toISOString(), motivo: motivo });
        blacklistGlobal[rutPerfilActual] = { motivo: motivo }; modalFichaInstance.hide(); renderCRM(listaGlobalCRM); alert("Usuario bloqueado.");
    }
});
document.getElementById('btnDesbloquear').addEventListener('click', async () => {
    if(confirm("¿Quitar de la lista negra?")) {
        await remove(ref(db, `4_blacklist/${rutPerfilActual}`)); delete blacklistGlobal[rutPerfilActual]; modalFichaInstance.hide(); renderCRM(listaGlobalCRM); alert("Usuario desbloqueado.");
    }
});

// ==========================================
// PESTAÑA 3: FINANZAS Y BÓVEDA
// ==========================================
document.getElementById('finanzas-tab').addEventListener('click', async () => {
    const snap = await get(ref(db, '2_asistencias')); if (!snap.exists()) return;
    const trabSnap = await get(ref(db, '1_trabajadores')); if (trabSnap.exists()) listaGlobalCRM = trabSnap.val();
    
    let deudas = {}; const todas = snap.val();
    for (const fecha in todas) { for (const prog in todas[fecha]) { for (const r in todas[fecha][prog]) {
        const asis = todas[fecha][prog][r];
        if (asis.estado_pago === "Pendiente" && asis.monto > 0) {
            if (!deudas[r]) deudas[r] = { monto: 0, dias: 0, rutas_bd: [] };
            deudas[r].monto += parseInt(asis.monto); deudas[r].dias += 1; deudas[r].rutas_bd.push(`2_asistencias/${fecha}/${prog}/${r}`);
        }
    }}}
    window.deudasGlobales = deudas; const tbody = document.getElementById('tablaDeudas'); tbody.innerHTML = "";
    for (const r in deudas) {
        const tr = listaGlobalCRM[r] || { nombres: "Desconocido", apellidos: "" }; const fila = document.createElement('tr');
        fila.innerHTML = `<td>${r}</td><td>${tr.nombres} ${tr.apellidos}</td><td><span class="badge bg-secondary">${deudas[r].dias} días</span></td><td class="text-success fw-bold fs-5">$${deudas[r].monto}</td>`; tbody.appendChild(fila);
    }
});

document.getElementById('btnLiquidarSemana').addEventListener('click', async () => {
    if (!window.deudasGlobales || Object.keys(window.deudasGlobales).length === 0) return alert("No hay plata retenida.");
    if (!confirm("🚨 ATENCIÓN 🚨\n\n¿Liquidar TODOS los pagos pendientes en la bóveda y descargar el archivo del banco?")) return;
    const fechaHoy = new Date().toISOString().split('T')[0];
    let csv = "\uFEFFCuenta origen;Moneda origen;Cuenta destino;Moneda destino;Código banco destino;RUT beneficiario;Nombre beneficiario;Monto transferir;Glosa personalizada transferencia;Correo beneficiario;Mensaje correo;Glosa cartola originador;Glosa cartola beneficiario\n";
    let actualizacionesFirebase = {};
    
    const trabSnap = await get(ref(db, '1_trabajadores')); if (trabSnap.exists()) listaGlobalCRM = trabSnap.val();
    
    for (const r in window.deudasGlobales) {
        const deuda = window.deudasGlobales[r]; 
        const tr = listaGlobalCRM[r] || (await get(child(ref(db, `1_trabajadores/${r}`)))).val();
        
        if (tr) { const rutSin = r.replace(/[^0-9kK]/g, ''); csv += `96225970;CLP;${tr.numeroCuenta || ''};CLP;${mapaBancos[tr.banco] || ''};${rutSin};${tr.nombres} ${tr.apellidos};${deuda.monto};;${tr.email || ''};;Pago Acumulado;PAGO NAT\n`; }
        for (const ruta of deuda.rutas_bd) { actualizacionesFirebase[`${ruta}/estado_pago`] = "Pagado"; }
    }
    try { await update(ref(db), actualizacionesFirebase); descargarCSV(csv, `Nomina_Semanal_Acumulada_${fechaHoy}.csv`); alert("¡Liquidación exitosa!"); document.getElementById('tablaDeudas').innerHTML = ""; window.deudasGlobales = {}; } catch (error) { alert("Error al liquidar."); }
});

let modalPagosInstance;

document.getElementById('btnExcelBanco').addEventListener('click', async () => {
    const btn = document.getElementById('btnExcelBanco');
    btn.innerText = "⏳ Buscando pendientes..."; btn.disabled = true;

    try {
        const snap = await get(ref(db, '2_asistencias'));
        if (!snap.exists()) {
            alert("No hay asistencias registradas en el sistema.");
            btn.innerText = "Generar Nómina de Pago"; btn.disabled = false;
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
                    if (asis.estado_pago === "Pendiente" && asis.monto > 0) {
                        tienePendientes = true;
                        cantidadPersonas++;
                        montoTotalPrograma += parseInt(asis.monto);
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
            document.getElementById('btnGenerarNominaBanco').classList.add('d-none');
        } else {
            document.getElementById('btnGenerarNominaBanco').classList.remove('d-none');
            let html = "";
            const sortedKeys = Object.keys(programasPendientes).sort().reverse();
            
            sortedKeys.forEach(key => {
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

        if (!modalPagosInstance) modalPagosInstance = new bootstrap.Modal(document.getElementById('modalPagosBanco'));
        modalPagosInstance.show();

    } catch (e) {
        alert("Error al cargar los pagos pendientes.");
    }
    
    btn.innerText = "Generar Nómina de Pago"; btn.disabled = false;
});

document.getElementById('btnGenerarNominaBanco').addEventListener('click', async () => {
    const checkboxes = document.querySelectorAll('.check-pago:checked');
    const seleccionados = Array.from(checkboxes).map(cb => cb.value);

    if (seleccionados.length === 0) return alert("Debes seleccionar al menos un programa para pagar.");
    if (!confirm(`¿Generar nómina agrupando los ${seleccionados.length} programas seleccionados y marcarlos como PAGADOS en el sistema?`)) return;

    try {
        const [asisSnap, trabSnap] = await Promise.all([ get(ref(db, '2_asistencias')), get(ref(db, '1_trabajadores')) ]);
        const todas = asisSnap.val();
        const trabajadores = trabSnap.exists() ? trabSnap.val() : {};

        let agrupacionPagos = {}; 
        let actualizacionesFirebase = {};

        seleccionados.forEach(clave => {
            const [fecha, prog] = clave.split('|');
            const asistentes = todas[fecha][prog];
            
            for (const r in asistentes) {
                const asis = asistentes[r];
                if (asis.estado_pago === "Pendiente" && asis.monto > 0) {
                    if (!agrupacionPagos[r]) {
                        agrupacionPagos[r] = { montoTotal: 0, programas: [], rutasFirebase: [] };
                    }
                    agrupacionPagos[r].montoTotal += parseInt(asis.monto);
                    
                    if (!agrupacionPagos[r].programas.includes(prog)) {
                        agrupacionPagos[r].programas.push(prog);
                    }
                    agrupacionPagos[r].rutasFirebase.push(`2_asistencias/${fecha}/${prog}/${r}/estado_pago`);
                }
            }
        });

        let csv = "\uFEFFCuenta origen;Moneda origen;Cuenta destino;Moneda destino;Código banco destino;RUT beneficiario;Nombre beneficiario;Monto transferir;Glosa personalizada transferencia;Correo beneficiario;Mensaje correo;Glosa cartola originador;Glosa cartola beneficiario\n";

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
        descargarCSV(csv, `Nomina_Banco_Agrupada_${new Date().toISOString().split('T')[0]}.csv`);
        alert("¡Nómina generada con éxito! Revisa tus descargas.");
        
        modalPagosInstance.hide();
        document.getElementById('finanzas-tab').click();

    } catch (e) {
        alert("Error al procesar y descargar los pagos.");
    }
});

document.getElementById('btnExcelContador').addEventListener('click', async () => {
    const mes = new Date().toISOString().substring(0, 7); if (!confirm(`¿Descargar reporte contable de ${mes}?`)) return;
    try {
        const snap = await get(ref(db, '2_asistencias')); if (!snap.exists()) return alert("No hay asistencias.");
        let tot = {}; const todas = snap.val();
        for (const f in todas) { if (f.startsWith(mes)) { for (const prog in todas[f]) { for (const r in todas[f][prog]) {
            if (!tot[r]) tot[r] = { monto: 0, fechaIn: f }; tot[r].monto += parseInt(todas[f][prog][r].monto) || 0;
        }}}}
        let csv = "\uFEFFRUT (completo);(*) RUT sin DV;(*) DV;Nombre (Completo);(*) Apellido Paterno;(*) Apellido Materno;(*) Nombres;Fec. Nacimiento;Fec. Ingreso;Fec. Contrato;Sexo;Cargo(30);Región;Dirección(40);Comuna;Ciudad;Tipo S.Base;Valor S.Base;AFP;FONASA / ISAPRE;Teléfono;Correo Electrónico\n";
        for (const r in tot) {
            const tr = listaGlobalCRM[r] || (await get(child(ref(db, `1_trabajadores/${r}`)))).val();
            if (tr) {
                const parts = r.split('-'); const aps = tr.apellidos ? tr.apellidos.trim().split(' ') : [""]; const [y, m, d] = (tr.fechaNacimiento||"").split('-');
                csv += `${r};${parts[0]};${parts[1]||''};${tr.nombres} ${tr.apellidos};${aps[0]};${aps.slice(1).join(' ')};${tr.nombres};${d?d+'-'+m+'-'+y:''};${tot[r].fechaIn.split('-').reverse().join('-')};${tot[r].fechaIn.split('-').reverse().join('-')};${tr.sexo||''};extra publico (televisión);;${tr.direccion||''};;Santiago;Pesos;${tot[r].monto};${tr.afp||''};${tr.salud||''};${tr.telefono||''};${tr.email||''}\n`;
            }
        }
        descargarCSV(csv, `Contador_${mes}.csv`);
    } catch (e) { alert("Error al generar Excel."); }
});

function descargarCSV(c, n) { const url = URL.createObjectURL(new Blob([c], { type: 'text/csv;charset=utf-8;' })); const a = document.createElement("a"); a.href = url; a.download = n; a.click(); }

// ==========================================
// PESTAÑA NUEVA: CONTRATOS DT
// ==========================================
document.getElementById('contratos-dt-tab').addEventListener('click', () => {
    document.getElementById('btnCargarContratosDT').click();
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

document.getElementById('btnCargarContratosDT').addEventListener('click', async () => {
    const contenedor = document.getElementById('contenedorContratosDT');
    contenedor.innerHTML = "<div class='text-center'><div class='spinner-border text-info'></div></div>";

    try {
        const [asisSnap, trabSnap] = await Promise.all([ get(ref(db, '2_asistencias')), get(ref(db, '1_trabajadores')) ]);
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
                    window.agrupacionDTGlobal[prog][weekInfo.sortKey] = { label: weekInfo.label, ruts: {} };
                }
                
                for (const rut in todas[fecha][prog]) {
                    const asis = todas[fecha][prog][rut];
                    
                    if (asis.tipo_ingreso !== "Cortesía" && asis.aplica_contrato !== false && !asis.dt_archivado) {
                        let objRut = window.agrupacionDTGlobal[prog][weekInfo.sortKey].ruts[rut];
                        if (!objRut) {
                            const tr = trabajadores[rut] || { nombres: "Desconocido", apellidos: "", email: "-", telefono: "-", direccion: "-" };
                            objRut = {
                                nombres: `${tr.nombres} ${tr.apellidos}`,
                                email: tr.email || "-",
                                telefono: tr.telefono || "-",
                                direccion: tr.direccion || "-",
                                fechas: [],
                                rutasFirebase: [],
                                todoLiquidado: !!asis.dt_liquidado,
                                montoSuma: 0
                            };
                            window.agrupacionDTGlobal[prog][weekInfo.sortKey].ruts[rut] = objRut;
                        }
                        objRut.fechas.push(fecha);
                        objRut.montoSuma += (parseInt(asis.monto) || 0);
                        objRut.rutasFirebase.push(`2_asistencias/${fecha}/${prog}/${rut}`);
                        // Si encuentra alguno falso, marca el grupo como false
                        if (!asis.dt_liquidado) objRut.todoLiquidado = false;
                    }
                }
            }
        }

        for (const prog in window.agrupacionDTGlobal) {
            for (const wk in window.agrupacionDTGlobal[prog]) {
                if (Object.keys(window.agrupacionDTGlobal[prog][wk].ruts).length === 0) {
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

        let html = '<div class="accordion" id="accProgramas">';
        let progIdx = 0;
        
        const progKeys = Object.keys(window.agrupacionDTGlobal).sort();
        for (const prog of progKeys) {
            progIdx++;
            html += `
            <div class="accordion-item" style="border: 1px solid #b066ff; margin-bottom: 10px; background: #1a1a1a;">
                <h2 class="accordion-header">
                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#colProg_${progIdx}" style="background: #2d1b4e; color: white; font-size: 1.1em;">
                        🎬 Programa: ${prog.replace(" - ", " / ")}
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
                const numPersonas = Object.keys(weekData.ruts).length;
                
                html += `
                <div class="accordion-item" style="border: 1px solid #444; margin-bottom: 5px; background: #111;">
                    <h2 class="accordion-header">
                        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#colProg_${progIdx}_wk_${wkIdx}" style="background: #1a1a1a; color: #00d26a;">
                            📅 ${weekData.label} &nbsp; <span class="badge bg-secondary ms-2">${numPersonas} personas pendientes</span>
                        </button>
                    </h2>
                    <div id="colProg_${progIdx}_wk_${wkIdx}" class="accordion-collapse collapse" data-bs-parent="#accWeeks_${progIdx}">
                        <div class="accordion-body p-0">
                            <div class="table-responsive">
                                <table class="table table-dark table-hover table-bordered mb-0 align-middle text-center" style="font-size: 0.9em;">
                                    <thead style="color: #b066ff;">
                                        <tr><th>RUT</th><th>Nombre</th><th>Correo</th><th>Teléfono</th><th>Domicilio</th><th>Fechas Asistidas</th><th>Montos (Base / +25%)</th><th>Acción</th></tr>
                                    </thead>
                                    <tbody>`;
                
                for (const rut in weekData.ruts) {
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
                                            <td class="fw-bold ${textColor} dt-text-element">${rut}</td>
                                            <td class="${textColor} dt-text-element">${asisData.nombres}</td>
                                            <td class="${textColor} dt-text-element">${asisData.email}</td>
                                            <td class="${textColor} dt-text-element">${asisData.telefono}</td>
                                            <td class="${textColor} dt-text-element">${asisData.direccion}</td>
                                            <td><span class="badge bg-info text-dark">${asisData.fechas.join(', ')}</span></td>
                                            <td class="${textColor} dt-text-element">Base: $${asisData.montoSuma} <br><b class="text-warning">DT (+25%): $${montoImpuestos}</b></td>
                                            <td>
                                                <button id="${btnId}" class="btn ${btnClass} btn-sm fw-bold" onclick="window.toggleContratoSemana(event, '${rut}', '${prog}', '${wk}', '${trId}', '${btnId}')">
                                                    ${btnText}
                                                </button>
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
            html += `
                        </div>
                    </div>
                </div>
            </div>`;
        }
        html += '</div>';
        contenedor.innerHTML = html;

    } catch (e) {
        contenedor.innerHTML = "<p class='text-danger text-center'>Error al cargar los datos.</p>";
    }
});

// FUNCIÓN DE ACTUALIZACIÓN VISUAL EN TIEMPO REAL (SIN RECARGAR LA LISTA NI COLAPSAR ACORDEÓN)
window.toggleContratoSemana = async function(event, rut, prog, wkSortKey, trId, btnId) {
    // Bloquear que el navegador crea que se le hizo clic al acordeón
    event.preventDefault();
    event.stopPropagation();

    const asisData = window.agrupacionDTGlobal[prog][wkSortKey].ruts[rut];
    const nuevoEstado = !asisData.todoLiquidado;
    
    // 1. Modificar visualmente la tabla de inmediato sin recargar nada
    const tr = document.getElementById(trId);
    const btn = document.getElementById(btnId);
    const textElements = tr.querySelectorAll('.dt-text-element'); 

    if (nuevoEstado) {
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

    // 2. Guardar en base de datos en segundo plano silenciosamente
    let updates = {};
    asisData.rutasFirebase.forEach(ruta => {
        updates[`${ruta}/dt_liquidado`] = nuevoEstado;
    });

    try {
        await update(ref(db), updates);
        asisData.todoLiquidado = nuevoEstado;
    } catch (e) {
        console.error("Error al actualizar estado en BD", e);
        alert("Aviso: Hubo una falla de red. Verifica tu conexión.");
    }
}

document.getElementById('btnArchivarContratosDT').addEventListener('click', async () => {
    if (!window.agrupacionDTGlobal || Object.keys(window.agrupacionDTGlobal).length === 0) return;
    
    let updates = {};
    let rutsArchivados = 0;
    let resumenProgramas = new Set();

    for (const prog in window.agrupacionDTGlobal) {
        for (const wk in window.agrupacionDTGlobal[prog]) {
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

    if (!confirm(`¿Archivar definitivamente los ${rutsArchivados} contratos que están en verde?\nEsto los quitará de la vista de pendientes.`)) return;

    const idHistorico = Date.now().toString();
    updates[`5_historial_dt/archivos/${idHistorico}`] = {
        fecha_archivo: new Date().toISOString(),
        cantidad_archivos: rutsArchivados,
        programas: Array.from(resumenProgramas)
    };

    try {
        await update(ref(db), updates);
        alert(`✅ ¡Éxito! Se archivaron ${rutsArchivados} contratos de los programas:\n${Array.from(resumenProgramas).join(', ')}`);
        document.getElementById('btnCargarContratosDT').click();
    } catch (e) {
        alert("Error al archivar en Firebase.");
    }
});

// ==========================================
// PESTAÑA 4: SEGURIDAD (LISTADOS EXCEL)
// ==========================================
async function cargarReportesDT() {
    const contenedor = document.getElementById('acordeonDT');
    const btnRefresh = document.getElementById('btnRefrescarSeguridad');
    let idAbierto = null; const acordeonAbierto = document.querySelector('#acordeonDT .accordion-collapse.show');
    if (acordeonAbierto) idAbierto = acordeonAbierto.id;

    btnRefresh.innerText = "⏳ Cargando..."; btnRefresh.disabled = true;
    const [asisSnap, trabSnap] = await Promise.all([ get(ref(db, '2_asistencias')), get(ref(db, '1_trabajadores')) ]);
    btnRefresh.innerText = "🔄 Actualizar Lista en Vivo"; btnRefresh.disabled = false;

    if (!asisSnap.exists()) { contenedor.innerHTML = "<p class='text-center text-warning'>No hay registros de asistencia.</p>"; return; }
    
    const todasLasAsistencias = asisSnap.val(); const trabajadores = trabSnap.exists() ? trabSnap.val() : {};
    let htmlAcordeon = ""; let index = 0; const fechasOrdenadas = Object.keys(todasLasAsistencias).sort().reverse();

    for (const fecha of fechasOrdenadas) {
        for (const prog in todasLasAsistencias[fecha]) {
            index++; const asistentesDeEseDia = todasLasAsistencias[fecha][prog]; const cantidad = Object.keys(asistentesDeEseDia).length;
            const isOpen = (idAbierto === `collapseDT_${index}`) ? 'show' : '';
            const isCollapsed = (idAbierto === `collapseDT_${index}`) ? '' : 'collapsed';

            htmlAcordeon += `
            <div class="accordion-item">
                <h2 class="accordion-header">
                    <button class="accordion-button ${isCollapsed}" type="button" data-bs-toggle="collapse" data-bs-target="#collapseDT_${index}">
                        📅 ${fecha} | 🎬 ${prog.replace(" - ", " / ")} &nbsp; <span class="badge bg-success ms-2">${cantidad} personas</span>
                    </button>
                </h2>
                <div id="collapseDT_${index}" class="accordion-collapse collapse ${isOpen}" data-bs-parent="#acordeonDT">
                    <div class="accordion-body">
                        <button class="btn btn-outline-info btn-sm mb-3 fw-bold" onclick="window.descargarListaSeguridad('${fecha}', '${prog}')">
                            🛡️ Descargar Excel para Seguridad
                        </button>
                        <div class="table-responsive">
                            <table class="table table-dark table-hover table-sm text-center align-middle" style="font-size: 0.85em;">
                                <thead style="color: #b066ff;"><tr><th>RUT</th><th>Nombre Completo</th><th>Teléfono</th><th>Dirección</th><th>AFP</th><th>Salud</th><th>Banco</th><th>Cuenta</th></tr></thead>
                                <tbody>`;
            for (const rut in asistentesDeEseDia) {
                const tr = trabajadores[rut] || { nombres: "No registrado", apellidos: "" };
                htmlAcordeon += `<tr><td>${rut}</td><td>${tr.nombres} ${tr.apellidos}</td><td>${tr.telefono || '-'}</td><td>${tr.direccion || '-'}</td><td>${tr.afp || '-'}</td><td>${tr.salud || '-'}</td><td>${tr.banco || '-'}</td><td>${tr.numeroCuenta || '-'}</td></tr>`;
            }
            htmlAcordeon += `</tbody></table></div></div></div></div>`;
        }
    }
    contenedor.innerHTML = htmlAcordeon;
}

window.descargarListaSeguridad = async function(fechaElegida, programaElegido) {
    try {
        const asisSnap = await get(child(ref(db), `2_asistencias/${fechaElegida}/${programaElegido}`));
        if (!asisSnap.exists()) return alert("No hay datos para descargar.");
        
        const trabSnap = await get(ref(db, '1_trabajadores'));
        const trabajadores = trabSnap.exists() ? trabSnap.val() : {};
        
        const asistentes = asisSnap.val();
        let csv = "\uFEFFPROGRAMA;FECHA;RUT;NOMBRES;APELLIDOS\n";
        
        for (const rut in asistentes) {
            const tr = trabajadores[rut] || { nombres: "No registrado", apellidos: "" };
            csv += `${programaElegido.replace(" - ", " / ")};${fechaElegida};${rut};${tr.nombres};${tr.apellidos}\n`;
        }
        
        descargarCSV(csv, `Lista_Seguridad_${programaElegido.replace(/[ \/]/g, "_")}_${fechaElegida}.csv`);
    } catch (e) {
        alert("Error al descargar lista de seguridad.");
    }
}

document.getElementById('seguridad-tab').addEventListener('click', cargarReportesDT);
document.getElementById('btnRefrescarSeguridad').addEventListener('click', cargarReportesDT);

// ==========================================
// PESTAÑA 5: MANTENIMIENTO
// ==========================================
document.getElementById('btnRespaldoMaestro').addEventListener('click', async () => {
    try {
        const snap = await get(ref(db, '2_asistencias')); if (!snap.exists()) return alert("No hay datos de asistencias.");
        const trabSnap = await get(ref(db, '1_trabajadores')); if (trabSnap.exists()) listaGlobalCRM = trabSnap.val(); 
        
        let csv = "\uFEFFFecha;Programa;RUT;Nombres;Apellidos;Monto Final;Tipo Ingreso;Hora Ingreso;Hora Salida;Bono Extra;Estado Pago;Invitado Por\n";
        const todas = snap.val();
        for (const fecha in todas) { for (const prog in todas[fecha]) { for (const r in todas[fecha][prog]) {
            const asis = todas[fecha][prog][r]; const trab = listaGlobalCRM[r] || { nombres: "Desconocido", apellidos: "" };
            csv += `${fecha};${prog.replace(" - ", " / ")};${r};${trab.nombres};${trab.apellidos};${asis.monto || 0};${asis.tipo_ingreso || ''};${asis.hora_ingreso || ''};${asis.hora_salida || ''};${asis.bono_horas_extras || 0};${asis.estado_pago || ''};${asis.invitado_por || ''}\n`;
        }}}
        descargarCSV(csv, `Respaldo_Maestro_Asistencias_${new Date().toISOString().split('T')[0]}.csv`);
    } catch (error) { alert("Error al generar el respaldo maestro."); }
});

document.getElementById('btnRespaldoPDFs').addEventListener('click', async () => {
    const btn = document.getElementById('btnRespaldoPDFs');
    try {
        btn.innerText = "⏳ Empaquetando PDFs... (Espera)"; btn.disabled = true;
        const snap = await get(ref(db, '2_asistencias')); if (!snap.exists()) { alert("No hay contratos."); resetBtnZip(btn); return; }
        const trabSnap = await get(ref(db, '1_trabajadores')); if (trabSnap.exists()) listaGlobalCRM = trabSnap.val(); 
        
        const todas = snap.val(); const zip = new JSZip(); let pdfsGenerados = 0; const { jsPDF } = window.jspdf;
        for (const fecha in todas) { for (const prog in todas[fecha]) {
            const carpetaPrograma = zip.folder(`${fecha}_${prog.replace(/[ \/]/g, "_")}`);
            for (const r in todas[fecha][prog]) {
                const asis = todas[fecha][prog][r]; const trab = listaGlobalCRM[r] || { nombres: "Desconocido", apellidos: "" };
                if (asis.firma_digital) {
                    const doc = new jsPDF({ format: 'legal' }); dibujarContratoEnPDF(doc, r, trab, asis, fecha, prog.replace(" - ", " / "));
                    const nombreCompletoLimpio = `${trab.nombres || ''}_${trab.apellidos || ''}`.replace(/[^a-zA-Z0-9_]/g, "");
                    const nombreArchivo = asis.tipo_ingreso === "Cortesía" || !asis.aplica_contrato ? `Cesion_Imagen_${nombreCompletoLimpio}_${r}.pdf` : `Contrato_${nombreCompletoLimpio}_${r}.pdf`;
                    const pdfBlob = doc.output('blob'); carpetaPrograma.file(nombreArchivo, pdfBlob); pdfsGenerados++;
                }
            }
        }}
        if (pdfsGenerados === 0) { alert("No hay firmas digitales."); resetBtnZip(btn); return; }
        const zipContent = await zip.generateAsync({type:"blob"}); const a = document.createElement("a"); 
        a.href = URL.createObjectURL(zipContent); a.download = `Respaldo_Contratos_PDF_${new Date().toISOString().split('T')[0]}.zip`; a.click();
        alert(`¡Éxito! Se empaquetaron ${pdfsGenerados} contratos legales.`); resetBtnZip(btn);
    } catch (error) { alert("Error al empaquetar los PDFs."); resetBtnZip(btn); }
});
function resetBtnZip(btn) { btn.innerText = "🗂️ Descargar ZIP de Contratos"; btn.disabled = false; }

const inputConfirmar = document.getElementById('inputConfirmarLimpieza'); const btnEjecutar = document.getElementById('btnEjecutarLimpieza');
inputConfirmar.addEventListener('input', (e) => { btnEjecutar.disabled = (e.target.value !== "LIMPIAR"); });
btnEjecutar.addEventListener('click', async () => {
    try {
        await remove(ref(db, '2_asistencias')); await remove(ref(db, '3_reservas'));
        alert("✅ Nube limpiada con éxito."); const modal = bootstrap.Modal.getInstance(document.getElementById('modalLimpieza'));
        modal.hide(); inputConfirmar.value = ""; btnEjecutar.disabled = true; window.location.reload();
    } catch (error) { alert("Error al limpiar."); }
});

// ==========================================
// PESTAÑA 6: SORTEO DALE PLAY (ASISTENCIA PERFECTA ABSOLUTA)
// ==========================================
document.getElementById('sorteo-tab').addEventListener('click', async () => {
    const contenedorFechas = document.getElementById('listaFechasSorteo');
    contenedorFechas.innerHTML = "<div class='spinner-border text-warning'></div> Buscando programas...";
    
    try {
        const snap = await get(ref(db, '2_asistencias'));
        if (!snap.exists()) return contenedorFechas.innerHTML = "<p class='text-muted'>No hay asistencias registradas.</p>";
        
        const todas = snap.val();
        let fechasDalePlay = [];
        
        for (const fecha in todas) {
            for (const prog in todas[fecha]) {
                if (prog.includes("Dale Play")) {
                    if (!fechasDalePlay.includes(fecha)) fechasDalePlay.push(fecha);
                }
            }
        }
        
        if (fechasDalePlay.length === 0) return contenedorFechas.innerHTML = "<p class='text-muted'>No se han realizado programas 'Dale Play' aún.</p>";
        
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

document.getElementById('btnRealizarSorteo').addEventListener('click', async () => {
    const checkboxes = document.querySelectorAll('.check-sorteo:checked');
    const fechasSeleccionadas = Array.from(checkboxes).map(cb => cb.value);
    const totalFechasRequeridas = fechasSeleccionadas.length;
    
    if (totalFechasRequeridas === 0) return alert("Debes seleccionar al menos una fecha de Dale Play para el sorteo.");
    
    const btnSorteo = document.getElementById('btnRealizarSorteo');
    btnSorteo.innerText = "🎰 Filtrando asistencia perfecta y girando ruleta...";
    btnSorteo.disabled = true;
    document.getElementById('resultadoSorteo').classList.add('d-none');
    
    try {
        const [asisSnap, trabSnap] = await Promise.all([ get(ref(db, '2_asistencias')), get(ref(db, '1_trabajadores')) ]);
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
                document.getElementById('ganadorNombre').innerText = "SIN GANADOR 😔";
                document.getElementById('ganadorRut').innerText = "";
                document.getElementById('ganadorFechas').innerText = "Ninguna persona cumplió con el requisito de asistir a TODAS las fechas seleccionadas.";
                
                document.getElementById('resultadoSorteo').classList.remove('d-none');
                btnSorteo.innerText = "🔄 Intentar con otras fechas";
                btnSorteo.disabled = false;
            }, 1000);
            return;
        }
        
        const indiceAleatorio = Math.floor(Math.random() * candidatosPerfectos.length);
        const rutGanador = candidatosPerfectos[indiceAleatorio];
        const trabGanador = trabajadores[rutGanador];
        
        setTimeout(() => {
            document.getElementById('ganadorNombre').innerText = `${trabGanador.nombres.toUpperCase()} ${trabGanador.apellidos.toUpperCase()}`;
            document.getElementById('ganadorRut').innerText = `RUT Acreditado: ${rutGanador}`;
            document.getElementById('ganadorFechas').innerText = `🏅 ASISTENCIA PERFECTA: Asistió a las ${totalFechasRequeridas} fechas requeridas (Total de personas en la tómbola: ${candidatosPerfectos.length}).`;
            
            document.getElementById('resultadoSorteo').classList.remove('d-none');
            btnSorteo.innerText = "🔄 Realizar otro Sorteo";
            btnSorteo.disabled = false;
        }, 2000);
        
    } catch (e) {
        alert("Error al realizar el sorteo.");
        btnSorteo.innerText = "🎁 ¡Girar la Ruleta Mágica!";
        btnSorteo.disabled = false;
    }
});

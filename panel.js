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

let nombrePrograma = ""; let fechaPrograma = ""; let montoPago = 0; let horaTerminoGeneral = ""; let pinActivo = "";
let valorHoraExtraGlobal = 0;
let html5QrcodeScanner = null; let signaturePad; let rutActual = ""; let claveActual = "";
let listaGlobalCRM = {}; let blacklistGlobal = {}; let modalFichaInstance;

let totalEsperados = 0; let totalFirmados = 0; window.siguienteTicketAutomatico = 1;
window.asistentesSinSalida = 0; 
let unsubscribeReservas = null; let unsubscribeAsistencias = null;

// ==========================================
// POBLAR SELECTORES (Cada 15 min)
// ==========================================
function poblarSelectoresHora() {
    let opcionesHTML = '<option value="">-- Selecciona --</option>';
    for (let h = 0; h < 24; h++) {
        for (let m = 0; m < 60; m += 15) {
            let hh24 = h.toString().padStart(2, '0');
            let mm = m.toString().padStart(2, '0');
            let ampm = h >= 12 ? 'PM' : 'AM';
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

get(ref(db, '1_trabajadores')).then(snap => { if (snap.exists()) listaGlobalCRM = snap.val(); });

// ==========================================
// PESTAÑA 1: MULTI-SALA Y ESCÁNER
// ==========================================
onValue(ref(db, '0_estado_sistema/programas_activos'), (snapshot) => {
    const container = document.getElementById('contenedorProgramasActivos');
    container.innerHTML = "";
    if (snapshot.exists()) {
        const programas = snapshot.val();
        for (const clave in programas) {
            const p = programas[clave];
            let badgePin = p.pin ? `<span class="badge bg-warning text-dark ms-2 fw-bold fs-6">PIN I/P: ${p.pin}</span>` : "";
            container.innerHTML += `
                <div class="alert mb-2 d-flex justify-content-between align-items-center" style="background: #1c103f; border: 1px solid #b066ff;">
                    <div>
                        <strong class="text-white">${p.nombre}</strong> ${badgePin}<br>
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

    let pinGenerado = ""; if (nom === "Detrás del Muro") pinGenerado = Math.floor(1000 + Math.random() * 9000).toString();
    const claveSegura = nom.replace(/[.#$\[\]]/g, "_");
    
    await set(ref(db, `0_estado_sistema/programas_activos/${claveSegura}`), { 
        nombre: nom, fecha: fec, monto: mon, pin: pinGenerado, hora_termino: horaSal, valor_hora_extra: valorHE, hora_citacion: horaCitacion 
    });
    window.unirseASala(claveSegura, nom, fec, mon, pinGenerado, horaSal, valorHE);
});

window.unirseASala = function(clave, nom, fec, mon, pin, horaSal, valorHE) {
    claveActual = clave; nombrePrograma = nom; fechaPrograma = fec; montoPago = mon; 
    pinActivo = pin || ""; horaTerminoGeneral = horaSal || ""; valorHoraExtraGlobal = parseInt(valorHE) || 0;
    
    let titulo = `Sala: ${nom}`; if (pinActivo) titulo += ` <span class="badge bg-warning text-dark ms-2">PIN: ${pinActivo}</span>`;
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

// CHECKOUT MASIVO AL CERRAR JORNADA
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

            for (const rut in asistencias) {
                const asis = asistencias[rut];
                if (!asis.hora_salida) {
                    let bonoExtra = 0;
                    if (asis.tipo_ingreso !== "Cortesía" && horaTerminoGeneral && valorHoraExtraGlobal > 0) {
                        let [hE, mE] = horaTerminoGeneral.split(':').map(Number);
                        let [hR, mR] = horaSalidaMasiva.split(':').map(Number);
                        let diff = (hR * 60 + mR) - (hE * 60 + mE);
                        if (diff > 0) bonoExtra = Math.round((diff / 60) * valorHoraExtraGlobal);
                    }
                    const nuevoMontoTotal = (parseInt(asis.monto) || 0) + bonoExtra;
                    
                    actualizacionesFirebase[`2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}/hora_salida`] = horaSalidaMasiva;
                    actualizacionesFirebase[`2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}/bono_horas_extras`] = bonoExtra;
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
            
            let btnSalidaContrato = "";
            if (asis.hora_salida) {
                btnSalidaContrato = `<span class="badge bg-secondary">Salió: ${asis.hora_salida}</span> <button class="btn btn-outline-info btn-sm ms-1" onclick="window.generarContratoPDF('${rut}')">📄 PDF</button>`;
            } else { 
                window.asistentesSinSalida++; 
                btnSalidaContrato = `<button class="btn btn-outline-warning btn-sm" onclick="window.marcarSalida('${rut}', '${asis.tipo_ingreso}', ${asis.monto})">Marcar Salida</button>`; 
            }
            
            const btnEditarPago = `<span class="badge bg-success fs-6 btn-pago-editable" onclick="window.editarMontoIndividual('${rut}', ${asis.monto}, '${trab.nombres}')" title="Click para editar sueldo">✏️ $${asis.monto}</span>`;

            const tr = document.createElement('tr');
            tr.innerHTML = `<td><span class="badge bg-secondary fs-6">${num || '-'}</span></td>
                            <td>${trab.nombres} ${trab.apellidos}<br>${btnEditarPago}</td>
                            <td>${asis.hora_ingreso}</td>
                            <td>${btnSalidaContrato}</td>
                            <td><button class="btn btn-danger btn-sm" onclick="window.anularAsistencia('${rut}')">X</button></td>`;
            tbody.appendChild(tr);
        }
        window.siguienteTicketAutomatico = maxNumero + 1;
        if (nombrePrograma === "Detrás del Muro") {
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
    let faltan = totalEsperados - totalFirmados;
    document.getElementById('contFaltan').innerText = faltan < 0 ? 0 : faltan;
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
            let [hE, mE] = horaTerminoGeneral.split(':').map(Number);
            let [hR, mR] = horaSalida.split(':').map(Number);
            let diff = (hR * 60 + mR) - (hE * 60 + mE);
            if (diff > 0) bonoSugerido = Math.round((diff / 60) * valorHoraExtraGlobal);
        }
        
        let msj = bonoSugerido > 0 ? `¡ATENCIÓN! La persona se pasó de la hora.\nCÁLCULO AUTOMÁTICO: $${bonoSugerido}\nPuedes aceptar o escribir otro valor:` : `Ingresa el monto de bono por horas extra (si no, pon 0):`;
        
        let respuesta = prompt(msj, bonoSugerido);
        if (respuesta === null) return; 
        bonoExtra = parseInt(respuesta) || 0;
    }
    
    const nuevoMontoTotal = (parseInt(montoBaseActual) || 0) + bonoExtra;
    try {
        await update(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}`), { hora_salida: horaSalida, bono_horas_extras: bonoExtra, monto: nuevoMontoTotal });
    } catch (error) { alert("Error al marcar salida."); }
}

document.getElementById('btnIngresoManual').addEventListener('click', () => {
    const rutIngresado = document.getElementById('rutManual').value.trim();
    if (!rutIngresado) return alert("Por favor, ingresa el RUT para buscarlo.");
    onScanSuccess(rutIngresado);
    document.getElementById('rutManual').value = "";
});

async function onScanSuccess(decodedText) {
    try { if(html5QrcodeScanner) html5QrcodeScanner.pause(); } catch(e) {} 
    document.getElementById('mensajeEscaneo').classList.remove('d-none'); rutActual = decodedText; 
    try {
        const blacklistSnap = await get(child(ref(db), `4_blacklist/${rutActual}`));
        if (blacklistSnap.exists()) { 
            alert(`⛔ ACCESO DENEGADO ⛔\nMotivo: ${blacklistSnap.val().motivo}`); 
            try { if(html5QrcodeScanner) html5QrcodeScanner.resume(); } catch(e) {} 
            document.getElementById('mensajeEscaneo').classList.add('d-none'); return; 
        }
        
        const reservaSnap = await get(child(ref(db), `3_reservas/${fechaPrograma}/${nombrePrograma}/${rutActual}`));
        const snapshot = await get(child(ref(db), `1_trabajadores/${rutActual}`));
        
        if (snapshot.exists()) {
            const datos = snapshot.val(); listaGlobalCRM[rutActual] = datos; 
            document.getElementById('nombreAsistenteDisplay').innerText = `${datos.nombres} ${datos.apellidos}`;
            const infoInvitado = document.getElementById('infoInvitado');
            infoInvitado.innerText = (reservaSnap.exists() && reservaSnap.val().tipo === "Cortesía") ? `⭐ INVITADO DE CORTESÍA (Por: ${reservaSnap.val().invitado_por})` : `✅ EXTRA CON PAGO ($${montoPago})`; 
            
            document.getElementById('seccionFirma').classList.remove('d-none'); 
            document.getElementById('numeroAsignado').value = window.siguienteTicketAutomatico;
            if(!signaturePad) signaturePad = new SignaturePad(document.getElementById('signature-pad')); 
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
    const firmaBase64 = signaturePad.toDataURL(); const now = new Date();
    const horaActual = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    const numeroFinal = document.getElementById('numeroAsignado').value;
    const textoInfo = document.getElementById('infoInvitado').innerText; const tipo = textoInfo.includes("CORTESÍA") ? "Cortesía" : "Pago";
    let invitadoPor = ""; if (tipo === "Cortesía" && textoInfo.includes("Por: ")) invitadoPor = textoInfo.split("Por: ")[1].replace(")", "");
    try {
        await set(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rutActual}`), { rut: rutActual, nombre_programa: nombrePrograma, monto: (tipo === "Pago" ? montoPago : 0), tipo_ingreso: tipo, hora_ingreso: horaActual, firma_digital: firmaBase64, estado_pago: "Pendiente", numero_asignado: numeroFinal, invitado_por: invitadoPor });
        document.getElementById('seccionFirma').classList.add('d-none'); signaturePad.clear(); 
        try { if(html5QrcodeScanner) html5QrcodeScanner.resume(); } catch(e) {} rutActual = "";
    } catch (error) { alert("Error al guardar."); }
});

window.anularAsistencia = async function(rut) { if(confirm("¿Seguro que deseas anular esta asistencia?")) await remove(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}`)); }

window.generarContratoPDF = async function(rut) {
    const trab = listaGlobalCRM[rut]; const asisSnap = await get(child(ref(db), `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}`));
    if (!trab || !asisSnap.exists()) return alert("Faltan datos.");
    const asis = asisSnap.val(); const { jsPDF } = window.jspdf; const doc = new jsPDF({ format: 'legal' });
    dibujarContratoEnPDF(doc, rut, trab, asis, fechaPrograma, nombrePrograma);
    doc.save(`Contrato_${nombrePrograma.replace(/[ \/]/g, "_")}_${rut}.pdf`);
}

function dibujarContratoEnPDF(doc, rut, trab, asis, fechaProg, nombreProg) {
    let y = 15; doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text("Contrato de Trabajo Extras Público (Televisión)", 105, y, null, null, "center"); y += 15;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    const mesNombres = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const [yearF, monthF, dayF] = fechaProg.split('-'); const fechaTexto = `${dayF} de ${mesNombres[parseInt(monthF)-1]} de ${yearF}`;
    const fechaNac = trab.fechaNacimiento ? trab.fechaNacimiento.split('-').reverse().join('-') : '___________';

    const textoContrato = `En Santiago, a ${fechaTexto}, entre Camila Alejandra Fevre Seguel Produccion E.I.R.L, RUT 76.932.592-1, que en adelante se denominará “el/la empleador/a”, y don/a ${trab.nombres.toUpperCase()} ${trab.apellidos.toUpperCase()}, nacido/a el ${fechaNac}, cédula de identidad Nº ${rut}, de profesión u oficio Extra de Televisión, correo electrónico ${trab.email || '__________________________________'}, domiciliado/a en calle ${trab.direccion ? trab.direccion.toUpperCase() : '_______________________'}, ciudad de Santiago, que en adelante se denominará “el/la trabajador/a”, se ha convenido el siguiente contrato de trabajo temporal:

PRIMERO. El trabajador se compromete a desempeñar los servicios de Público para la producción "${nombreProg}".

SEGUNDO. El empleador se compromete a pagar al trabajador $${asis.monto} por jornada.

TERCERO. El trabajador autoriza la difusión de su imagen para la producción.

CUARTO. De conformidad a la Ley N° 19.799 sobre Documentos Electrónicos y Firma Electrónica, el presente contrato se suscribe mediante Firma Electrónica Simple validada en plataforma.`;

    const lineas = doc.splitTextToSize(textoContrato, 175); doc.text(lineas, 20, y); y += (lineas.length * 4.5) + 30; 

    doc.setFont("helvetica", "bold"); doc.text("_________________________________", 50, y, null, null, "center"); doc.text("Firma Empleador", 50, y + 5, null, null, "center"); doc.setFont("helvetica", "normal"); doc.text("CAMILA FEVRE SEGUEL", 50, y + 10, null, null, "center"); 

    doc.setFont("helvetica", "bold"); 
    if (asis.firma_digital) doc.addImage(asis.firma_digital, 'PNG', 115, y - 25, 80, 25);
    doc.text("_________________________________", 155, y, null, null, "center"); doc.text("Firma Trabajador", 155, y + 5, null, null, "center"); doc.setFont("helvetica", "normal"); doc.text(`${trab.nombres.toUpperCase()} ${trab.apellidos.toUpperCase()}`, 155, y + 10, null, null, "center"); 
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

        // Buscar qué programas tienen personas en estado "Pendiente"
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
                        <span>📅 ${p.fecha} | 🎬 ${p.prog}</span>
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

        // Sumar los montos de la misma persona en los distintos programas elegidos
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
                        📅 ${fecha} | 🎬 ${prog} &nbsp; <span class="badge bg-success ms-2">${cantidad} personas</span>
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
            csv += `${programaElegido};${fechaElegida};${rut};${tr.nombres};${tr.apellidos}\n`;
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
            csv += `${fecha};${prog};${r};${trab.nombres};${trab.apellidos};${asis.monto || 0};${asis.tipo_ingreso || ''};${asis.hora_ingreso || ''};${asis.hora_salida || ''};${asis.bono_horas_extras || 0};${asis.estado_pago || ''};${asis.invitado_por || ''}\n`;
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
                    const doc = new jsPDF({ format: 'legal' }); dibujarContratoEnPDF(doc, r, trab, asis, fecha, prog);
                    const pdfBlob = doc.output('blob'); carpetaPrograma.file(`Contrato_${r}.pdf`, pdfBlob); pdfsGenerados++;
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
            if (todas[fecha]["Dale Play"]) {
                fechasDalePlay.push(fecha);
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
                if (todas[fecha] && todas[fecha]["Dale Play"] && todas[fecha]["Dale Play"][rut]) {
                    asistenciasConfirmadas++;
                }
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

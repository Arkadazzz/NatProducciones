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
let html5QrcodeScanner = null; let signaturePad;
let listaGlobalCRM = {}; let blacklistGlobal = {}; let modalFichaInstance;

let totalEsperados = 0; let totalFirmados = 0; window.siguienteTicketAutomatico = 1;
let unsubscribeReservas = null; let unsubscribeAsistencias = null;

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
                        <small style="color: #d6b3ff;">${p.fecha} | Base: $${p.monto} | Salida: ${p.hora_termino || 'No definida'}</small>
                    </div>
                    <div>
                        <button class="btn btn-success btn-sm fw-bold" onclick="window.unirseASala('${clave}', '${p.nombre}', '${p.fecha}', '${p.monto}', '${p.pin}', '${p.hora_termino}')">🚪 Entrar</button>
                        <button class="btn btn-danger btn-sm fw-bold ms-1" onclick="window.cerrarProgramaGlobal('${clave}')">X</button>
                    </div>
                </div>
            `;
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
    const horaSal = document.getElementById('horaTermino').value;
    if (!nom || !fec || !mon || !horaSal) return alert("Completa todos los campos (incluyendo el Monto y la Hora de Salida).");
    
    let pinGenerado = "";
    if (nom === "Detrás del Muro") pinGenerado = Math.floor(1000 + Math.random() * 9000).toString();
    
    const claveSegura = nom.replace(/[.#$\/\[\]]/g, "_");
    await set(ref(db, `0_estado_sistema/programas_activos/${claveSegura}`), { nombre: nom, fecha: fec, monto: mon, pin: pinGenerado, hora_termino: horaSal });
    
    window.unirseASala(claveSegura, nom, fec, mon, pinGenerado, horaSal);
});

window.unirseASala = function(clave, nom, fec, mon, pin, horaSal) {
    nombrePrograma = nom; fechaPrograma = fec; montoPago = mon; pinActivo = pin || ""; horaTerminoGeneral = horaSal || "";
    
    let titulo = `Sala: ${nom}`;
    if (pinActivo) titulo += ` <span class="badge bg-warning text-dark ms-2">PIN I/P: ${pinActivo}</span>`;
    
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
    if(confirm("¿Estás seguro de TERMINAR este programa para todos?\n\nDesaparecerá de la web pública.")) {
        await remove(ref(db, `0_estado_sistema/programas_activos/${clave}`));
    }
}

document.getElementById('btnVolverMenu').addEventListener('click', salirDeSala);

function salirDeSala() {
    nombrePrograma = ""; fechaPrograma = ""; montoPago = 0; pinActivo = ""; horaTerminoGeneral = "";
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
    if (unsubscribeReservas) unsubscribeReservas();
    if (unsubscribeAsistencias) unsubscribeAsistencias();

    unsubscribeReservas = onValue(ref(db, `3_reservas/${fechaPrograma}/${nombrePrograma}`), (snapshot) => {
        totalEsperados = snapshot.exists() ? Object.keys(snapshot.val()).length : 0;
        actualizarTablero();
    });

    unsubscribeAsistencias = onValue(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}`), (snapshot) => {
        const asistencias = snapshot.exists() ? snapshot.val() : {};
        totalFirmados = Object.keys(asistencias).length;
        actualizarTablero();
        
        let maxNumero = 0;
        const conteoStaff = {}; 
        const tbody = document.getElementById('tablaAsistentes');
        tbody.innerHTML = "";
        
        for (const rut in asistencias) {
            const asis = asistencias[rut];
            const trab = listaGlobalCRM[rut] || { nombres: "Desconocido", apellidos: "" };
            const num = parseInt(asis.numero_asignado) || 0;
            if (num > maxNumero) maxNumero = num; 

            if (asis.tipo_ingreso === "Cortesía" && asis.invitado_por) {
                conteoStaff[asis.invitado_por] = (conteoStaff[asis.invitado_por] || 0) + 1;
            }
            
            let btnSalidaContrato = "";
            if (asis.hora_salida) {
                btnSalidaContrato = `<span class="badge bg-secondary">Salió: ${asis.hora_salida}</span> <button class="btn btn-outline-info btn-sm ms-1" onclick="window.generarContratoPDF('${rut}')">📄 PDF</button>`;
            } else {
                btnSalidaContrato = `<button class="btn btn-outline-warning btn-sm" onclick="window.marcarSalida('${rut}')">Marcar Salida</button>`;
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `<td><span class="badge bg-secondary fs-6">${num || '-'}</span></td>
                            <td>${trab.nombres} ${trab.apellidos}<br><small class="text-success">$${asis.monto}</small></td>
                            <td>${asis.hora_ingreso}</td>
                            <td>${btnSalidaContrato}</td>
                            <td><button class="btn btn-danger btn-sm" onclick="anularAsistencia('${rut}')">X</button></td>`;
            tbody.appendChild(tr);
        }
        window.siguienteTicketAutomatico = maxNumero + 1;

        if (nombrePrograma === "Detrás del Muro") {
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

window.marcarSalida = async function(rut) {
    const horaSalida = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    let bonoExtra = prompt(`La hora de salida es ${horaSalida}.\nLa salida estimada era a las ${horaTerminoGeneral}.\n\nSi el extra acumuló horas extra, ingresa el monto adicional a sumarle a su pago base de $${montoPago}:\n(Si no hay bono, deja en 0)`);
    
    if (bonoExtra === null) return; 
    
    bonoExtra = parseInt(bonoExtra) || 0;
    const nuevoMontoTotal = parseInt(montoPago) + bonoExtra;
    
    try {
        await update(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}`), {
            hora_salida: horaSalida,
            bono_horas_extras: bonoExtra,
            monto: nuevoMontoTotal
        });
        if(bonoExtra > 0) alert(`Se sumaron $${bonoExtra} por horas extra. Monto final: $${nuevoMontoTotal}`);
    } catch (error) {
        alert("Error al marcar salida.");
    }
}

window.generarContratoPDF = async function(rut) {
    const trab = listaGlobalCRM[rut];
    const asisSnap = await get(child(ref(db), `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rut}`));
    if (!trab || !asisSnap.exists()) return alert("Faltan datos para generar el PDF.");
    
    const asis = asisSnap.val();
    const { jsPDF } = window.jspdf;
    
    const doc = new jsPDF({ format: 'legal' });
    let y = 15; 

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("CONTRATO DE TRABAJO A TRATO POR JORNADA EXTRAORDINARIA", 105, y, null, null, "center");
    y += 15;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    
    const mesNombres = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const [yearF, monthF, dayF] = fechaPrograma.split('-');
    const fechaTexto = `${dayF} de ${mesNombres[parseInt(monthF)-1]} del ${yearF}`;

    const textoContrato = `En SANTIAGO, a ${fechaTexto}, entre NAT PRODUCCIONES SpA., RUT 77.200.730-8, representada por don Agustín Pino Lorca, Cédula de Identidad Nº 21.037.108-9, ambos con domicilio en Avenida Vicuña Mackenna 1370, comuna de Ñuñoa, ciudad de Santiago, que en adelante se denominará “el Empleador”, y don(ña) ${trab.nombres.toUpperCase()} ${trab.apellidos.toUpperCase()}, Cédula de Identidad Nº ${rut}, de Nacionalidad Chilena, nacido(a) el ${trab.fechaNacimiento ? trab.fechaNacimiento.split('-').reverse().join('-') : '___________'}, domiciliado(a) en ${trab.direccion.toUpperCase() || '_______________________'}, que en adelante se denominará “el Trabajador”, se ha convenido el siguiente Contrato de Trabajo a Trato:

PRIMERO: El Empleador contrata los servicios del Trabajador para que se desempeñe en calidad de Extra de Televisión. Las partes dejan constancia que la relación laboral se desarrollará en las dependencias de los estudios de grabación que el empleador determine o en locaciones exteriores según sea el requerimiento del programa "${nombrePrograma}".

SEGUNDO: Por acuerdo entre las partes, el presente contrato se pacta por una jornada extraordinaria específica que iniciará a las ${asis.hora_ingreso} horas y finalizará a las ${asis.hora_salida || horaTerminoGeneral} horas del día de la fecha. Las partes acuerdan, de conformidad a lo establecido en el Artículo 22 del Código del Trabajo, que dada la naturaleza de los servicios prestados, este contrato no está sujeto a control de asistencia tradicional, rigiéndose estrictamente por los horarios pactados para la grabación o evento.

TERCERO: Como remuneración a trato por los servicios prestados durante la jornada señalada en la cláusula segunda (incluyendo eventuales extensiones u horas extra que fuesen requeridas y autorizadas por el Productor a cargo), el Empleador pagará al Trabajador la suma bruta/líquida (según corresponda) de $${asis.monto} (pesos chilenos). 
Dicho pago se realizará mediante transferencia electrónica a la cuenta bancaria del trabajador (Banco: ${trab.banco || '______'}, Cuenta: ${trab.numeroCuenta || '______'}) en los plazos estipulados por las políticas de remuneración de la Productora.

CUARTO: El Trabajador declara para todos los efectos legales que se encuentra afiliado a la Administradora de Fondos de Pensiones (A.F.P.) ${trab.afp || '______'} y al sistema de previsión de salud ${trab.salud || '______'}.

QUINTO: El Trabajador cede y transfiere a NAT PRODUCCIONES SpA., y/o a quien ésta determine, todos los derechos de imagen, voz, fijación y reproducción audiovisual derivados de su participación en el programa objeto de este contrato, sin límite de tiempo, territorio ni medios de difusión, renunciando desde ya a cualquier cobro adicional por concepto de retransmisión, comercialización o uso publicitario de dicho material.

SEXTO: Las partes dejan expresa constancia de que, de conformidad a la Ley N° 19.799 sobre Documentos Electrónicos, Firma Electrónica y Servicios de Certificación de dicha Firma, el presente contrato se suscribe mediante Firma Electrónica Simple. El trazo digital (firma en pantalla o dispositivo móvil) plasmado por el Trabajador al momento de su ingreso al recinto, asociado a su Rol Único Tributario (RUT) y validado a través del sistema de acreditación de la Productora, tiene plena validez legal, reconociendo ambas partes su autenticidad, integridad y no repudio. 

SÉPTIMO: Para todos los efectos derivados del presente contrato, las partes fijan su domicilio en la ciudad y comuna de Santiago y se someten a la jurisdicción de sus Tribunales de Justicia.`;

    const lineas = doc.splitTextToSize(textoContrato, 175); 
    doc.text(lineas, 20, y);
    
    y += (lineas.length * 5) + 30; 
    
    doc.setFont("helvetica", "bold");
    doc.text("_________________________________", 50, y, null, null, "center");
    doc.text("AGUSTÍN PINO LORCA", 50, y + 5, null, null, "center");
    doc.setFont("helvetica", "normal");
    doc.text("NAT PRODUCCIONES SpA.", 50, y + 10, null, null, "center");
    doc.text("RUT: 77.200.730-8", 50, y + 15, null, null, "center");

    doc.setFont("helvetica", "bold");
    if (asis.firma_digital) {
        doc.addImage(asis.firma_digital, 'PNG', 115, y - 30, 80, 30);
    }
    doc.text("_________________________________", 155, y, null, null, "center");
    doc.text(`${trab.nombres.toUpperCase()} ${trab.apellidos.toUpperCase()}`, 155, y + 5, null, null, "center");
    doc.setFont("helvetica", "normal");
    doc.text(`RUT: ${rut}`, 155, y + 10, null, null, "center");
    doc.text("EL TRABAJADOR", 155, y + 15, null, null, "center");

    // Reemplazar espacios del nombre por guiones bajos para el archivo
    const nombreLimpio = nombrePrograma.replace(/[ \/]/g, "_");
    doc.save(`Contrato_${nombreLimpio}_${rut}.pdf`);
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
    const horaActual = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}); 
    const numeroFinal = document.getElementById('numeroAsignado').value;

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
            numero_asignado: numeroFinal, invitado_por: invitadoPor 
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
    if (!nombrePrograma) return alert("Debes estar DENTRO de una sala activa en la Pestaña 'Control Puerta' para descargar su Excel Diario.");
    if (nombrePrograma === "Dale Play") {
        if (!confirm("⚠️ ATENCIÓN: Seleccionaste 'Dale Play'.\n\nEste programa normalmente se acumula en la semana. Si descargas esta nómina diaria, estas personas desaparecerán de la Bóveda del viernes.\n\n¿Estás seguro?")) return;
    } else {
        if (!confirm(`¿Descargar nómina diaria para la sala en la que estás actualmente (${nombrePrograma})?\n\nAl confirmar, los asistentes se marcarán como PAGADOS.`)) return;
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
        if (!hayPagosNuevos) return alert("Las personas de esta sala ya fueron marcadas como Pagadas.");
        await update(ref(db), actualizacionesFirebase);
        
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

// ==========================================
// PESTAÑA 4: MANTENIMIENTO
// ==========================================
document.getElementById('btnRespaldoMaestro').addEventListener('click', async () => {
    try {
        const snap = await get(ref(db, '2_asistencias'));
        if (!snap.exists()) return alert("No hay datos de asistencias en la nube para respaldar.");
        
        let csv = "\uFEFFFecha;Programa;RUT;Nombres;Apellidos;Monto Final;Tipo Ingreso;Hora Ingreso;Hora Salida;Bono Extra;Estado Pago;Invitado Por\n";
        const todas = snap.val();
        
        for (const fecha in todas) {
            for (const prog in todas[fecha]) {
                for (const r in todas[fecha][prog]) {
                    const asis = todas[fecha][prog][r];
                    const trab = listaGlobalCRM[r] || { nombres: "Desconocido", apellidos: "" };
                    
                    csv += `${fecha};${prog};${r};${trab.nombres};${trab.apellidos};${asis.monto || 0};${asis.tipo_ingreso || ''};${asis.hora_ingreso || ''};${asis.hora_salida || ''};${asis.bono_horas_extras || 0};${asis.estado_pago || ''};${asis.invitado_por || ''}\n`;
                }
            }
        }
        descargarCSV(csv, `Respaldo_Maestro_Asistencias_${new Date().toISOString().split('T')[0]}.csv`);
        alert("¡Excel Maestro descargado con éxito!");
    } catch (error) {
        alert("Error al generar el respaldo maestro.");
    }
});

// Lógica del Input de Confirmación para borrar
const inputConfirmar = document.getElementById('inputConfirmarLimpieza');
const btnEjecutar = document.getElementById('btnEjecutarLimpieza');

inputConfirmar.addEventListener('input', (e) => {
    if (e.target.value === "LIMPIAR") {
        btnEjecutar.disabled = false;
    } else {
        btnEjecutar.disabled = true;
    }
});

btnEjecutar.addEventListener('click', async () => {
    try {
        await remove(ref(db, '2_asistencias'));
        await remove(ref(db, '3_reservas'));
        
        alert("✅ Nube limpiada con éxito. \nEl espacio ha sido liberado para el próximo mes.");
        
        // Cerrar modal automáticamente
        const modal = bootstrap.Modal.getInstance(document.getElementById('modalLimpieza'));
        modal.hide();
        inputConfirmar.value = "";
        btnEjecutar.disabled = true;
        
        // Refrescar para limpiar las tablas
        window.location.reload();
    } catch (error) {
        alert("Error al limpiar la base de datos.");
    }
});

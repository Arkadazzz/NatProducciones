import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDatabase, ref, get, set, remove, child, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

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
let html5QrcodeScanner; let signaturePad;
let listaGlobalCRM = {}; let blacklistGlobal = {}; let modalFichaInstance;

// ==========================================
// PESTAÑA 1: PUERTA Y ESCÁNER
// ==========================================
document.getElementById('btnActivarWeb').addEventListener('click', async () => {
    nombrePrograma = document.getElementById('nombrePrograma').value.trim();
    fechaPrograma = document.getElementById('fechaPrograma').value;
    montoPago = document.getElementById('montoPago').value;
    if (!nombrePrograma || !fechaPrograma) return alert("Ingresa nombre y fecha.");

    await set(ref(db, '0_estado_sistema/programa_activo'), { nombre: nombrePrograma, fecha: fechaPrograma, monto: montoPago });
    document.getElementById('seccionConfiguracion').classList.add('d-none');
    document.getElementById('seccionEscaner').classList.remove('d-none');
    
    html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: {width: 250, height: 250} }, false);
    html5QrcodeScanner.render(onScanSuccess, () => {});

    onValue(ref(db, `3_reservas/${fechaPrograma}/${nombrePrograma}`), (snapshot) => {
        document.getElementById('contadorEsperados').innerText = snapshot.exists() ? Object.keys(snapshot.val()).length : 0;
    });
});

async function onScanSuccess(decodedText) {
    html5QrcodeScanner.pause();
    document.getElementById('mensajeEscaneo').classList.remove('d-none');
    rutActual = decodedText; 

    try {
        // SEGURIDAD: Revisar Blacklist Primero
        const blacklistSnap = await get(child(ref(db), `4_blacklist/${rutActual}`));
        if (blacklistSnap.exists()) {
            const motivo = blacklistSnap.val().motivo;
            alert(`⛔ ACCESO DENEGADO ⛔\n\nEste RUT está bloqueado.\nMotivo: ${motivo}`);
            html5QrcodeScanner.resume(); 
            document.getElementById('mensajeEscaneo').classList.add('d-none');
            return; // Bloquea el flujo aquí
        }

        const reservaSnap = await get(child(ref(db), `3_reservas/${fechaPrograma}/${nombrePrograma}/${rutActual}`));
        const snapshot = await get(child(ref(db), `1_trabajadores/${rutActual}`));
        
        if (snapshot.exists()) {
            const datos = snapshot.val();
            document.getElementById('nombreAsistenteDisplay').innerText = `${datos.nombres} ${datos.apellidos}`;
            
            const infoInvitado = document.getElementById('infoInvitado');
            if (reservaSnap.exists() && reservaSnap.val().tipo === "Cortesía") {
                infoInvitado.innerText = `⭐ INVITADO DE CORTESÍA (Por: ${reservaSnap.val().invitado_por})`;
            } else { infoInvitado.innerText = `✅ EXTRA CON PAGO ($${montoPago})`; }

            document.getElementById('seccionFirma').classList.remove('d-none');
            if(!signaturePad) signaturePad = new SignaturePad(document.getElementById('signature-pad'));
            signaturePad.clear(); 
            document.getElementById('mensajeEscaneo').classList.add('d-none');
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
    const tipo = document.getElementById('infoInvitado').innerText.includes("CORTESÍA") ? "Cortesía" : "Pago";

    try {
        await set(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rutActual}`), { rut: rutActual, nombre_programa: nombrePrograma, monto: (tipo === "Pago" ? montoPago : 0), tipo_ingreso: tipo, hora_ingreso: horaActual, firma_digital: firmaBase64 });
        const tr = document.createElement('tr'); tr.id = `fila-${rutActual}`;
        tr.innerHTML = `<td>${document.getElementById('nombreAsistenteDisplay').innerText}</td><td>${horaActual}</td><td><span class="badge ${tipo === 'Pago' ? 'bg-success' : 'bg-warning text-dark'}">${tipo}</span></td><td><button class="btn btn-danger btn-sm" onclick="anularAsistencia('${rutActual}')">X</button></td>`;
        document.getElementById('tablaAsistentes').appendChild(tr);
        document.getElementById('contadorAsistentes').innerText = parseInt(document.getElementById('contadorAsistentes').innerText) + 1;
        document.getElementById('seccionFirma').classList.add('d-none');
        signaturePad.clear(); html5QrcodeScanner.resume(); rutActual = "";
    } catch (error) { alert("Error al guardar."); }
});
window.anularAsistencia = function(rut) { if(confirm("¿Anular?")) { document.getElementById(`fila-${rut}`).remove(); document.getElementById('contadorAsistentes').innerText = parseInt(document.getElementById('contadorAsistentes').innerText) - 1; } }

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
        const p = datos[rut];
        const bloqueado = blacklistGlobal[rut] ? true : false;
        const estadoBadge = bloqueado ? '<span class="badge bg-danger">Bloqueado</span>' : '<span class="badge bg-success">Activo</span>';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${rut}</td><td>${p.nombres} ${p.apellidos}</td><td>${p.telefono || '-'}</td><td>${estadoBadge}</td>
                        <td><button class="btn btn-outline-info btn-sm" onclick="verPerfil('${rut}')">Ver Ficha</button></td>`;
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
    rutPerfilActual = rut;
    const p = listaGlobalCRM[rut];
    document.getElementById('contenidoFicha').innerHTML = `
        <p><strong>Nombres:</strong> ${p.nombres} ${p.apellidos}</p>
        <p><strong>Fecha Nacimiento:</strong> ${p.fechaNacimiento || '-'} | <strong>Sexo:</strong> ${p.sexo || '-'}</p>
        <p><strong>RUT:</strong> ${p.rut} | <strong>Tel:</strong> ${p.telefono || '-'}</p>
        <p><strong>Dirección:</strong> ${p.direccion || '-'}</p>
        <hr style="border-color: #333;">
        <p><strong>Banco:</strong> ${p.banco || '-'} | <strong>Cuenta:</strong> ${p.tipoCuenta || '-'}</p>
        <p><strong>N°:</strong> ${p.numeroCuenta || '-'}</p>
        <p><strong>AFP:</strong> ${p.afp || '-'} | <strong>Salud:</strong> ${p.salud || '-'}</p>
    `;
    
    if (blacklistGlobal[rut]) {
        document.getElementById('motivoBloqueo').classList.add('d-none');
        document.getElementById('btnBloquear').classList.add('d-none');
        document.getElementById('btnDesbloquear').classList.remove('d-none');
    } else {
        document.getElementById('motivoBloqueo').classList.remove('d-none');
        document.getElementById('motivoBloqueo').value = "";
        document.getElementById('btnBloquear').classList.remove('d-none');
        document.getElementById('btnDesbloquear').classList.add('d-none');
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
    if(confirm("¿Quitar de la lista negra y permitirle trabajar de nuevo?")) {
        await remove(ref(db, `4_blacklist/${rutPerfilActual}`));
        delete blacklistGlobal[rutPerfilActual];
        modalFichaInstance.hide(); renderCRM(listaGlobalCRM); alert("Usuario desbloqueado.");
    }
});

// ==========================================
// PESTAÑA 3: FINANZAS (Banco y Contador)
// ==========================================
document.getElementById('btnExcelBanco').addEventListener('click', async () => {
    if (!nombrePrograma) return alert("Ve a la pestaña Puerta y abre un programa primero.");
    try {
        const snap = await get(child(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}`)));
        if (!snap.exists()) return alert("No hay asistentes hoy.");
        const asistencias = snap.val();
        let csv = "\uFEFFCuenta origen (obligatorio);Moneda origen (obligatorio);Cuenta destino (obligatorio);Moneda destino (obligatorio);Código banco destino (obligatorio solo si banco destino no es Santander);RUT beneficiario (obligatorio solo si banco destino no es Santander);Nombre beneficiario (obligatorio solo si banco destino no es Santander);Monto transferir (obligatorio);Glosa personalizada transferencia (opcional);Correo beneficiario (opcional);Mensaje correo beneficiario (opcional);Glosa cartola originador (opcional);Glosa cartola beneficiario (opcional, solo Santander)\n";

        for (const r in asistencias) {
            const tr = listaGlobalCRM[r] || (await get(child(ref(db, `1_trabajadores/${r}`)))).val();
            if (tr) {
                const rutSin = r.replace(/[^0-9kK]/g, '');
                csv += `96225970;CLP;${tr.numeroCuenta || ''};CLP;${mapaBancos[tr.banco] || ''};${rutSin};${tr.nombres} ${tr.apellidos};${asistencias[r].monto};;${tr.email || ''};;${nombrePrograma};PAGO NAT\n`;
            }
        }
        descargarCSV(csv, `Nomina_Banco_${fechaPrograma}.csv`);
    } catch (e) { alert("Error al generar Excel."); }
});

document.getElementById('btnExcelContador').addEventListener('click', async () => {
    const mes = new Date().toISOString().substring(0, 7);
    if (!confirm(`¿Descargar reporte de ${mes}?`)) return;
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

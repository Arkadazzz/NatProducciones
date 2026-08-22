import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDatabase, ref, get, set, child } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

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

// Diccionario de Bancos para el CMF/Santander
const mapaBancos = { "CHILE": "1", "ESTADO": "12", "SCOTIABANK": "14", "BCI": "16", "SANTANDER": "37", "ITAU": "39", "SECURITY": "49", "FALABELLA": "52", "RIPLEY": "53", "CONSORCIO": "55", "BICE": "28" };

onAuthStateChanged(auth, (user) => { if (!user) window.location.href = "login.html"; });

document.getElementById('btnCerrarSesion').addEventListener('click', () => { signOut(auth).then(() => { window.location.href = "login.html"; }); });

let nombrePrograma = "";
let montoPago = 0;
let rutActual = "";
let html5QrcodeScanner;
let signaturePad;

document.getElementById('btnIniciarPuerta').addEventListener('click', () => {
    nombrePrograma = document.getElementById('nombrePrograma').value.trim();
    montoPago = document.getElementById('montoPago').value;
    if (!nombrePrograma) return alert("Debes ingresar el nombre del programa.");

    document.getElementById('seccionConfiguracion').classList.add('d-none');
    document.getElementById('seccionEscaner').classList.remove('d-none');
    document.getElementById('indicadorActivo').innerText = `Grabando: ${nombrePrograma}`;

    html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: {width: 250, height: 250} }, false);
    html5QrcodeScanner.render(onScanSuccess, () => {});
});

async function onScanSuccess(decodedText) {
    html5QrcodeScanner.pause();
    document.getElementById('mensajeEscaneo').classList.remove('d-none');
    rutActual = decodedText; 

    try {
        const snapshot = await get(child(ref(db), `1_trabajadores/${rutActual}`));
        if (snapshot.exists()) {
            const datos = snapshot.val();
            document.getElementById('nombreAsistenteDisplay').innerText = `${datos.nombres} ${datos.apellidos}`;
            document.getElementById('seccionFirma').classList.remove('d-none');
            
            if(!signaturePad) signaturePad = new SignaturePad(document.getElementById('signature-pad'));
            signaturePad.clear(); 
            document.getElementById('mensajeEscaneo').classList.add('d-none');
        } else {
            alert("RUT no encontrado. Pídele que se registre en la web.");
            html5QrcodeScanner.resume(); 
            document.getElementById('mensajeEscaneo').classList.add('d-none');
        }
    } catch (error) { html5QrcodeScanner.resume(); }
}

document.getElementById('btnLimpiarFirma').addEventListener('click', () => signaturePad.clear());

document.getElementById('btnGuardarIngreso').addEventListener('click', async () => {
    if (signaturePad.isEmpty()) return alert("El trabajador debe firmar.");

    const firmaBase64 = signaturePad.toDataURL(); 
    const fechaActual = new Date().toISOString().split('T')[0]; 
    const horaActual = new Date().toLocaleTimeString(); 

    const asistenciaData = {
        rut: rutActual, nombre_programa: nombrePrograma, monto: montoPago, tipo_ingreso: "Pago", hora_ingreso: horaActual, firma_digital: firmaBase64
    };

    try {
        await set(ref(db, `2_asistencias/${fechaActual}/${nombrePrograma}/${rutActual}`), asistenciaData);
        agregarFilaATabla(document.getElementById('nombreAsistenteDisplay').innerText, horaActual, "Pago", rutActual);
        document.getElementById('seccionFirma').classList.add('d-none');
        signaturePad.clear(); html5QrcodeScanner.resume(); rutActual = "";
    } catch (error) { alert("Error al guardar."); }
});

function agregarFilaATabla(nombre, hora, tipo, rut) {
    const tr = document.createElement('tr'); tr.id = `fila-${rut}`;
    tr.innerHTML = `<td>${nombre}</td><td>${hora}</td><td><span class="badge bg-success">${tipo}</span></td><td><button class="btn btn-danger btn-sm" onclick="anularAsistencia('${rut}')">X</button></td>`;
    document.getElementById('tablaAsistentes').appendChild(tr);
    document.getElementById('contadorAsistentes').innerText = parseInt(document.getElementById('contadorAsistentes').innerText) + 1;
}

window.anularAsistencia = function(rut) {
    if(confirm("¿Anular pago?")) {
        document.getElementById(`fila-${rut}`).remove();
        document.getElementById('contadorAsistentes').innerText = parseInt(document.getElementById('contadorAsistentes').innerText) - 1;
    }
}

// --------------------------------------------------------
// EXPORTACIÓN 1: NÓMINA MASIVA BANCO (DÍA ACTUAL)
// --------------------------------------------------------
document.getElementById('btnExcelBanco').addEventListener('click', async () => {
    if (!nombrePrograma) return alert("Abre un programa primero.");
    const fechaActual = new Date().toISOString().split('T')[0];
    
    try {
        const snap = await get(child(ref(db), `2_asistencias/${fechaActual}/${nombrePrograma}`));
        if (!snap.exists()) return alert("No hay asistentes hoy.");

        const asistencias = snap.val();
        let csv = "\uFEFFCuenta origen (obligatorio);Moneda origen (obligatorio);Cuenta destino (obligatorio);Moneda destino (obligatorio);Código banco destino (obligatorio solo si banco destino no es Santander);RUT beneficiario (obligatorio solo si banco destino no es Santander);Nombre beneficiario (obligatorio solo si banco destino no es Santander);Monto transferir (obligatorio);Glosa personalizada transferencia (opcional);Correo beneficiario (opcional);Mensaje correo beneficiario (opcional);Glosa cartola originador (opcional);Glosa cartola beneficiario (opcional, solo Santander)\n";

        for (const rut in asistencias) {
            const asis = asistencias[rut];
            const trabSnap = await get(child(ref(db), `1_trabajadores/${rut}`));
            if (trabSnap.exists()) {
                const tr = trabSnap.val();
                const rutSinFormato = rut.replace(/[^0-9kK]/g, ''); // Deja el RUT solo con números y K como pide el banco
                const codBanco = mapaBancos[tr.banco] || "";
                
                csv += `96225970;CLP;${tr.numeroCuenta || ''};CLP;${codBanco};${rutSinFormato};${tr.nombres} ${tr.apellidos};${asis.monto};;${tr.email || ''};;${nombrePrograma};PAGO NAT\n`;
            }
        }
        descargarCSV(csv, `Nomina_Banco_${fechaActual}.csv`);
    } catch (e) { alert("Error al generar Excel del Banco."); }
});

// --------------------------------------------------------
// EXPORTACIÓN 2: REPORTE CONTADOR (MENSUAL)
// --------------------------------------------------------
document.getElementById('btnExcelContador').addEventListener('click', async () => {
    const mesActualStr = new Date().toISOString().split('T')[0].substring(0, 7); // Ej: "2026-08"
    if (!confirm(`¿Descargar reporte contable del mes de ${mesActualStr}?`)) return;

    try {
        const snapTodos = await get(ref(db, '2_asistencias'));
        if (!snapTodos.exists()) return alert("No hay asistencias registradas.");
        
        let totalesMensuales = {}; // Agruparemos los montos por RUT
        const todasAsistencias = snapTodos.val();

        // Recorremos los días del mes actual
        for (const fecha in todasAsistencias) {
            if (fecha.startsWith(mesActualStr)) {
                const programasDia = todasAsistencias[fecha];
                for (const programa in programasDia) {
                    const asistentes = programasDia[programa];
                    for (const rut in asistentes) {
                        if (!totalesMensuales[rut]) totalesMensuales[rut] = { montoTotal: 0, primeraFecha: fecha };
                        totalesMensuales[rut].montoTotal += parseInt(asistentes[rut].monto) || 0;
                    }
                }
            }
        }

        let csv = "\uFEFFRUT (completo);(*) RUT sin DV;(*) DV;Nombre (Completo);(*) Apellido Paterno;(*) Apellido Materno;(*) Nombres;Fec. Nacimiento;Fec. Ingreso;Fec. Contrato;Sexo;Cargo(30);Región;Dirección(40);Comuna;Ciudad;Tipo S.Base;Valor S.Base;AFP;FONASA / ISAPRE;Teléfono;Correo Electrónico\n";

        for (const rut in totalesMensuales) {
            const dataMes = totalesMensuales[rut];
            const trabSnap = await get(child(ref(db), `1_trabajadores/${rut}`));
            if (trabSnap.exists()) {
                const tr = trabSnap.val();
                
                // Formateos especiales para el contador
                const partesRut = rut.split('-');
                const rutSinDv = partesRut[0];
                const dv = partesRut[1] || "";
                
                const apellidosArr = tr.apellidos ? tr.apellidos.trim().split(' ') : [""];
                const apPaterno = apellidosArr[0];
                const apMaterno = apellidosArr.slice(1).join(' ');

                let fecNac = "";
                if (tr.fechaNacimiento) {
                    const [y, m, d] = tr.fechaNacimiento.split('-');
                    fecNac = `${d}-${m}-${y}`; // Pasa de 2026-08-22 a 22-08-2026
                }
                
                const fecIngresoFormateada = dataMes.primeraFecha.split('-').reverse().join('-');

                csv += `${rut};${rutSinDv};${dv};${tr.nombres} ${tr.apellidos};${apPaterno};${apMaterno};${tr.nombres};${fecNac};${fecIngresoFormateada};${fecIngresoFormateada};${tr.sexo || ''};extra publico (televisión);;${tr.direccion || ''};;Santiago;Pesos;${dataMes.montoTotal};${tr.afp || ''};${tr.salud || ''};${tr.telefono || ''};${tr.email || ''}\n`;
            }
        }
        descargarCSV(csv, `Reporte_Contador_${mesActualStr}.csv`);
    } catch (e) { console.error(e); alert("Error al generar Excel del Contador."); }
});

function descargarCSV(contenido, nombreArchivo) {
    const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url); link.setAttribute("download", nombreArchivo);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

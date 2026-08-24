import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDatabase, ref, get, set, child, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

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

onAuthStateChanged(auth, (user) => { if (!user) window.location.href = "login.html"; });
document.getElementById('btnCerrarSesion').addEventListener('click', () => { signOut(auth).then(() => { window.location.href = "login.html"; }); });

let nombrePrograma = "";
let fechaPrograma = "";
let montoPago = 0;
let rutActual = "";
let html5QrcodeScanner;
let signaturePad;

// 1. EL INTERRUPTOR MAESTRO: Activar el programa en la web pública
document.getElementById('btnActivarWeb').addEventListener('click', async () => {
    nombrePrograma = document.getElementById('nombrePrograma').value.trim();
    fechaPrograma = document.getElementById('fechaPrograma').value;
    montoPago = document.getElementById('montoPago').value;

    if (!nombrePrograma || !fechaPrograma) return alert("Debes ingresar el nombre del programa y la fecha.");

    // Guardar el estado activo en la nube para que el celular del público lo lea
    await set(ref(db, '0_estado_sistema/programa_activo'), {
        nombre: nombrePrograma,
        fecha: fechaPrograma,
        monto: montoPago
    });

    document.getElementById('seccionConfiguracion').classList.add('d-none');
    document.getElementById('seccionEscaner').classList.remove('d-none');
    
    // Encender la cámara
    html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: {width: 250, height: 250} }, false);
    html5QrcodeScanner.render(onScanSuccess, () => {});

    // Activar el "Radar" para contar cuántos han llenado el formulario hoy (RSVP)
    escucharEsperados(fechaPrograma, nombrePrograma);
});

// RADAR: Escucha en tiempo real cuántas reservas hay para este programa
function escucharEsperados(fecha, programa) {
    const reservasRef = ref(db, `3_reservas/${fecha}/${programa}`);
    onValue(reservasRef, (snapshot) => {
        const cantidad = snapshot.exists() ? Object.keys(snapshot.val()).length : 0;
        document.getElementById('contadorEsperados').innerText = cantidad;
    });
}

// 2. ESCÁNER
async function onScanSuccess(decodedText) {
    html5QrcodeScanner.pause();
    document.getElementById('mensajeEscaneo').classList.remove('d-none');
    rutActual = decodedText; 

    try {
        // Primero verificamos si agendó para HOY
        const reservaSnap = await get(child(ref(db), `3_reservas/${fechaPrograma}/${nombrePrograma}/${rutActual}`));
        
        // Buscamos sus datos personales
        const snapshot = await get(child(ref(db), `1_trabajadores/${rutActual}`));
        if (snapshot.exists()) {
            const datos = snapshot.val();
            document.getElementById('nombreAsistenteDisplay').innerText = `${datos.nombres} ${datos.apellidos}`;
            
            // Si la persona indicó en el formulario que viene de invitado, lo mostramos en pantalla
            const infoInvitado = document.getElementById('infoInvitado');
            if (reservaSnap.exists() && reservaSnap.val().tipo === "Cortesía") {
                infoInvitado.innerText = `⭐ INVITADO DE CORTESÍA (Por: ${reservaSnap.val().invitado_por})`;
            } else {
                infoInvitado.innerText = `✅ EXTRA CON PAGO ($${montoPago})`;
            }

            document.getElementById('seccionFirma').classList.remove('d-none');
            if(!signaturePad) signaturePad = new SignaturePad(document.getElementById('signature-pad'));
            signaturePad.clear(); 
            document.getElementById('mensajeEscaneo').classList.add('d-none');
        } else {
            alert("RUT no encontrado en la base de datos.");
            html5QrcodeScanner.resume(); 
            document.getElementById('mensajeEscaneo').classList.add('d-none');
        }
    } catch (error) { html5QrcodeScanner.resume(); }
}

document.getElementById('btnLimpiarFirma').addEventListener('click', () => signaturePad.clear());

// 3. GUARDAR ASISTENCIA
document.getElementById('btnGuardarIngreso').addEventListener('click', async () => {
    if (signaturePad.isEmpty()) return alert("El trabajador debe firmar.");

    const firmaBase64 = signaturePad.toDataURL(); 
    const horaActual = new Date().toLocaleTimeString(); 
    
    // Validar visualmente qué tipo de ingreso es
    const textoInvitado = document.getElementById('infoInvitado').innerText;
    const tipo = textoInvitado.includes("CORTESÍA") ? "Cortesía" : "Pago";

    const asistenciaData = {
        rut: rutActual, nombre_programa: nombrePrograma, monto: (tipo === "Pago" ? montoPago : 0), tipo_ingreso: tipo, hora_ingreso: horaActual, firma_digital: firmaBase64
    };

    try {
        await set(ref(db, `2_asistencias/${fechaPrograma}/${nombrePrograma}/${rutActual}`), asistenciaData);
        agregarFilaATabla(document.getElementById('nombreAsistenteDisplay').innerText, horaActual, tipo, rutActual);
        
        document.getElementById('seccionFirma').classList.add('d-none');
        signaturePad.clear(); html5QrcodeScanner.resume(); rutActual = "";
    } catch (error) { alert("Error al guardar."); }
});

function agregarFilaATabla(nombre, hora, tipo, rut) {
    const tr = document.createElement('tr'); tr.id = `fila-${rut}`;
    tr.innerHTML = `<td>${nombre}</td><td>${hora}</td><td><span class="badge ${tipo === 'Pago' ? 'bg-success' : 'bg-warning text-dark'}">${tipo}</span></td><td><button class="btn btn-danger btn-sm" onclick="anularAsistencia('${rut}')">X</button></td>`;
    document.getElementById('tablaAsistentes').appendChild(tr);
    document.getElementById('contadorAsistentes').innerText = parseInt(document.getElementById('contadorAsistentes').innerText) + 1;
}

window.anularAsistencia = function(rut) {
    if(confirm("¿Anular asistencia?")) {
        document.getElementById(`fila-${rut}`).remove();
        document.getElementById('contadorAsistentes').innerText = parseInt(document.getElementById('contadorAsistentes').innerText) - 1;
    }
}

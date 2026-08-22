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

onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = "login.html"; 
    }
});

document.getElementById('btnCerrarSesion').addEventListener('click', () => {
    signOut(auth).then(() => { window.location.href = "login.html"; });
});

let nombrePrograma = "";
let montoPago = 0;
let rutActual = "";
let html5QrcodeScanner;
let signaturePad;

document.getElementById('btnIniciarPuerta').addEventListener('click', () => {
    nombrePrograma = document.getElementById('nombrePrograma').value.trim();
    montoPago = document.getElementById('montoPago').value;

    if (!nombrePrograma) {
        alert("Debes ingresar el nombre del programa (Ej: Matinal VIP).");
        return;
    }

    document.getElementById('seccionConfiguracion').classList.add('d-none');
    document.getElementById('seccionEscaner').classList.remove('d-none');
    document.getElementById('indicadorActivo').innerText = `Grabando: ${nombrePrograma}`;

    html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: {width: 250, height: 250} }, false);
    html5QrcodeScanner.render(onScanSuccess, onScanFailure);
});

async function onScanSuccess(decodedText, decodedResult) {
    html5QrcodeScanner.pause();
    document.getElementById('mensajeEscaneo').classList.remove('d-none');
    rutActual = decodedText; 

    try {
        const dbRef = ref(db);
        const snapshot = await get(child(dbRef, `1_trabajadores/${rutActual}`));
        
        if (snapshot.exists()) {
            const datos = snapshot.val();
            document.getElementById('nombreAsistenteDisplay').innerText = `${datos.nombres} ${datos.apellidos}`;
            document.getElementById('seccionFirma').classList.remove('d-none');
            
            if(!signaturePad) {
                const canvas = document.getElementById('signature-pad');
                signaturePad = new SignaturePad(canvas);
            }
            signaturePad.clear(); 
            document.getElementById('zonaFirmaPad').classList.remove('d-none');
            document.getElementById('mensajeEscaneo').classList.add('d-none');
        } else {
            alert("RUT no encontrado en la base de datos. Pídele que se registre en la web.");
            html5QrcodeScanner.resume(); 
            document.getElementById('mensajeEscaneo').classList.add('d-none');
        }
    } catch (error) {
        console.error(error);
        alert("Error de conexión al buscar el RUT.");
        html5QrcodeScanner.resume();
    }
}

function onScanFailure(error) { }

document.getElementById('btnLimpiarFirma').addEventListener('click', () => {
    signaturePad.clear();
});

document.getElementById('btnGuardarIngreso').addEventListener('click', async () => {
    if (signaturePad.isEmpty()) {
        alert("El trabajador debe firmar en la pantalla antes de ingresar.");
        return;
    }

    const firmaBase64 = signaturePad.toDataURL(); 
    const fechaActual = new Date().toISOString().split('T')[0]; 
    const horaActual = new Date().toLocaleTimeString(); 

    const asistenciaData = {
        rut: rutActual,
        nombre_programa: nombrePrograma,
        monto: montoPago,
        tipo_ingreso: "Pago",
        hora_ingreso: horaActual,
        firma_digital: firmaBase64
    };

    try {
        await set(ref(db, `2_asistencias/${fechaActual}/${nombrePrograma}/${rutActual}`), asistenciaData);
        const nombre = document.getElementById('nombreAsistenteDisplay').innerText;
        agregarFilaATabla(nombre, horaActual, "Pago", rutActual);
        
        document.getElementById('seccionFirma').classList.add('d-none');
        rutActual = "";
        signaturePad.clear();
        html5QrcodeScanner.resume();
        alert("¡Asistencia y firma guardadas con éxito!");
    } catch (error) {
        console.error("Error al guardar asistencia:", error);
        alert("Error al guardar. Revisa tu conexión.");
    }
});

function agregarFilaATabla(nombre, hora, tipo, rut) {
    const tbody = document.getElementById('tablaAsistentes');
    const tr = document.createElement('tr');
    tr.id = `fila-${rut}`;
    tr.innerHTML = `
        <td>${nombre}</td>
        <td>${hora}</td>
        <td><span class="badge bg-success">${tipo}</span></td>
        <td><button class="btn btn-danger btn-sm" onclick="anularAsistencia('${rut}')">X (Anular)</button></td>
    `;
    tbody.appendChild(tr);
    const contador = document.getElementById('contadorAsistentes');
    contador.innerText = parseInt(contador.innerText) + 1;
}

window.anularAsistencia = function(rut) {
    if(confirm("¿Seguro que deseas anular el pago de esta persona porque se retiró del set?")) {
        document.getElementById(`fila-${rut}`).remove();
        const contador = document.getElementById('contadorAsistentes');
        contador.innerText = parseInt(contador.innerText) - 1;
        alert("Pago anulado exitosamente.");
    }
}

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDatabase, ref, get, set, child } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// RECUERDA: Pegar tus claves de Firebase aquí
const firebaseConfig = {
    apiKey: "AQUI_IRA_TU_API_KEY",
    authDomain: "tu-proyecto.firebaseapp.com",
    databaseURL: "https://tu-proyecto-default-rtdb.firebaseio.com",
    projectId: "tu-proyecto",
    storageBucket: "tu-proyecto.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// 1. SEGURIDAD: Verificar si el usuario está logueado
onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = "login.html"; // Si no hay sesión, lo patea al login
    }
});

// Cerrar sesión
document.getElementById('btnCerrarSesion').addEventListener('click', () => {
    signOut(auth).then(() => { window.location.href = "login.html"; });
});

// Variables globales para mantener el estado del evento
let nombrePrograma = "";
let montoPago = 0;
let rutActual = "";
let html5QrcodeScanner;
let signaturePad;

// 2. INICIAR PUERTAS Y CÁMARA
document.getElementById('btnIniciarPuerta').addEventListener('click', () => {
    nombrePrograma = document.getElementById('nombrePrograma').value.trim();
    montoPago = document.getElementById('montoPago').value;

    if (!nombrePrograma) {
        alert("Debes ingresar el nombre del programa (Ej: Matinal VIP).");
        return;
    }

    // Ocultar configuración y mostrar escáner
    document.getElementById('seccionConfiguracion').classList.add('d-none');
    document.getElementById('seccionEscaner').classList.remove('d-none');
    document.getElementById('indicadorActivo').innerText = `Grabando: ${nombrePrograma}`;

    // Encender la cámara
    html5QrcodeScanner = new Html5QrcodeScanner(
        "reader", { fps: 10, qrbox: {width: 250, height: 250} }, false);
    
    html5QrcodeScanner.render(onScanSuccess, onScanFailure);
});

// 3. LECTURA DEL QR EXITOSA
async function onScanSuccess(decodedText, decodedResult) {
    // Pausar el escáner para que no lea 2 veces seguidas
    html5QrcodeScanner.pause();
    document.getElementById('mensajeEscaneo').classList.remove('d-none');
    
    rutActual = decodedText; // El QR contiene el RUT

    try {
        const dbRef = ref(db);
        const snapshot = await get(child(dbRef, `1_trabajadores/${rutActual}`));
        
        if (snapshot.exists()) {
            const datos = snapshot.val();
            // Mostrar nombre en pantalla
            document.getElementById('nombreAsistenteDisplay').innerText = `${datos.nombres} ${datos.apellidos}`;
            document.getElementById('seccionFirma').classList.remove('d-none');
            
            // Inicializar el lienzo de firma si no se ha hecho
            if(!signaturePad) {
                const canvas = document.getElementById('signature-pad');
                signaturePad = new SignaturePad(canvas);
            }
            signaturePad.clear(); // Limpiar firmas anteriores
            document.getElementById('zonaFirmaPad').classList.remove('d-none');
            document.getElementById('mensajeEscaneo').classList.add('d-none');
        } else {
            alert("RUT no encontrado en la base de datos. Pídele que se registre en la web.");
            html5QrcodeScanner.resume(); // Reanudar cámara
            document.getElementById('mensajeEscaneo').classList.add('d-none');
        }
    } catch (error) {
        console.error(error);
        alert("Error de conexión al buscar el RUT.");
        html5QrcodeScanner.resume();
    }
}

function onScanFailure(error) {
    // Errores de lectura continúan ignorados hasta que encuentra un QR
}

// 4. LIMPIAR FIRMA
document.getElementById('btnLimpiarFirma').addEventListener('click', () => {
    signaturePad.clear();
});

// 5. GUARDAR ASISTENCIA Y FIRMA
document.getElementById('btnGuardarIngreso').addEventListener('click', async () => {
    if (signaturePad.isEmpty()) {
        alert("El trabajador debe firmar en la pantalla antes de ingresar.");
        return;
    }

    const firmaBase64 = signaturePad.toDataURL(); // Convertimos el dibujo en código
    const fechaActual = new Date().toISOString().split('T')[0]; // Ej: 2026-08-22
    const horaActual = new Date().toLocaleTimeString(); // Ej: 19:01:10

    // Estructura de datos para guardar la asistencia del día
    const asistenciaData = {
        rut: rutActual,
        nombre_programa: nombrePrograma,
        monto: montoPago,
        tipo_ingreso: "Pago", // Se puede dinamizar luego con los otros botones
        hora_ingreso: horaActual,
        firma_digital: firmaBase64
    };

    try {
        // Guardamos en un nodo nuevo: 2_asistencias / Fecha / Programa / RUT
        await set(ref(db, `2_asistencias/${fechaActual}/${nombrePrograma}/${rutActual}`), asistenciaData);
        
        // Agregar a la tabla en vivo visualmente
        const nombre = document.getElementById('nombreAsistenteDisplay').innerText;
        agregarFilaATabla(nombre, horaActual, "Pago", rutActual);
        
        // Limpiar y preparar la cámara para el siguiente
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

// 6. FUNCIÓN PARA DIBUJAR LA TABLA EN VIVO
function agregarFilaATabla(nombre, hora, tipo, rut) {
    const tbody = document.getElementById('tablaAsistentes');
    const tr = document.createElement('tr');
    tr.id = `fila-${rut}`;
    
    tr.innerHTML = `
        <td>${nombre}</td>
        <td>${hora}</td>
        <td><span class="badge bg-success">${tipo}</span></td>
        <td>
            <button class="btn btn-danger btn-sm" onclick="anularAsistencia('${rut}')">X (Anular)</button>
        </td>
    `;
    tbody.appendChild(tr);
    
    // Actualizar contador
    const contador = document.getElementById('contadorAsistentes');
    contador.innerText = parseInt(contador.innerText) + 1;
}

// Función global para el botón anular de la tabla
window.anularAsistencia = function(rut) {
    if(confirm("¿Seguro que deseas anular el pago de esta persona porque se retiró del set?")) {
        // Aquí luego agregaremos la conexión para borrarlo de Firebase
        document.getElementById(`fila-${rut}`).remove();
        const contador = document.getElementById('contadorAsistentes');
        contador.innerText = parseInt(contador.innerText) - 1;
        alert("Pago anulado exitosamente.");
    }
}

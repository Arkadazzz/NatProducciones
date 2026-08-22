import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, set, get, child } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// RECUERDA: Pegar aquí las credenciales de Firebase cuando las tengas
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
const db = getDatabase(app);

// Función universal para dibujar el QR
function generarQR(texto) {
    document.getElementById('formularioRegistro').classList.add('d-none');
    document.getElementById('encabezadoFormulario').classList.add('d-none');
    document.getElementById('contenedorQR').classList.remove('d-none');
    
    document.getElementById('codigoQR').innerHTML = ""; // Limpiar por si acaso
    new QRCode(document.getElementById("codigoQR"), {
        text: texto,
        width: 200,
        height: 200,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
}

// 1. LÓGICA DEL BOTÓN "CONTINUAR" (Verificar RUT)
document.getElementById('btnVerificarRut').addEventListener('click', async () => {
    const rut = document.getElementById('rut').value.trim();
    
    if (rut.length < 8) {
        alert("Por favor ingresa un RUT válido.");
        return;
    }

    try {
        const dbRef = ref(db);
        const snapshot = await get(child(dbRef, `1_trabajadores/${rut}`));
        
        if (snapshot.exists()) {
            // EL RUT YA EXISTE: Le mostramos el QR de inmediato
            const datos = snapshot.val();
            document.getElementById('mensajeExito').innerText = `¡Hola de nuevo, ${datos.nombres}!`;
            generarQR(rut);
        } else {
            // EL RUT ES NUEVO: Le mostramos el resto del formulario
            document.getElementById('btnVerificarRut').classList.add('d-none'); // Ocultar el botón Continuar
            document.getElementById('rut').readOnly = true; // Bloquear el RUT para que no lo cambie
            document.getElementById('camposExtras').classList.remove('d-none'); // Mostrar los campos
            
            // Hacer que los campos nuevos sean obligatorios ahora
            const inputs = document.querySelectorAll('#camposExtras input, #camposExtras select');
            inputs.forEach(input => input.setAttribute('required', 'true'));
        }
    } catch (error) {
        console.error("Error buscando el RUT:", error);
        // Si hay error (ej. Firebase no configurado aún), mostramos el formulario por defecto para que puedas probar visualmente
        document.getElementById('btnVerificarRut').classList.add('d-none');
        document.getElementById('camposExtras').classList.remove('d-none');
    }
});

// 2. LÓGICA DEL BOTÓN FINAL (Guardar usuario nuevo)
document.getElementById('formularioRegistro').addEventListener('submit', async (e) => {
    e.preventDefault(); 

    const rut = document.getElementById('rut').value.trim();
    const trabajadorData = {
        rut: rut,
        nombres: document.getElementById('nombres').value.trim(),
        apellidos: document.getElementById('apellidos').value.trim(),
        telefono: document.getElementById('telefono').value.trim(),
        email: document.getElementById('email').value.trim(),
        afp: document.getElementById('afp').value,
        salud: document.getElementById('salud').value,
        banco: document.getElementById('banco').value.trim(),
        tipoCuenta: document.getElementById('tipoCuenta').value,
        numeroCuenta: document.getElementById('numeroCuenta').value.trim(),
        fecha_registro_formulario: new Date().toISOString()
    };

    try {
        await set(ref(db, '1_trabajadores/' + rut), trabajadorData);
        document.getElementById('mensajeExito').innerText = "¡Registro Exitoso!";
        generarQR(rut);
    } catch (error) {
        console.error("Error al guardar:", error);
        alert("Error al procesar. Revisa tu conexión (o las claves de Firebase).");
    }
});

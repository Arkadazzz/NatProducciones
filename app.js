import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, set, get, child } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyC5M5p6deAJu4qPeLxy1FdKDNLic5LoVpE",
    authDomain: "natproducciones.firebaseapp.com",
    projectId: "natproducciones",
    storageBucket: "natproducciones.firebasestorage.app",
    messagingSenderId: "553451405946",
    appId: "1:553451405946:web:3a9f5a4a1429466641f1c3"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

function generarQR(texto) {
    document.getElementById('formularioRegistro').classList.add('d-none');
    document.getElementById('encabezadoFormulario').classList.add('d-none');
    document.getElementById('contenedorQR').classList.remove('d-none');
    
    document.getElementById('codigoQR').innerHTML = ""; 
    new QRCode(document.getElementById("codigoQR"), {
        text: texto,
        width: 200,
        height: 200,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
}

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
            const datos = snapshot.val();
            document.getElementById('mensajeExito').innerText = `¡Hola de nuevo, ${datos.nombres}!`;
            generarQR(rut);
        } else {
            document.getElementById('btnVerificarRut').classList.add('d-none');
            document.getElementById('rut').readOnly = true; 
            document.getElementById('camposExtras').classList.remove('d-none');
            const inputs = document.querySelectorAll('#camposExtras input, #camposExtras select');
            inputs.forEach(input => input.setAttribute('required', 'true'));
        }
    } catch (error) {
        console.error("Error buscando el RUT:", error);
    }
});

document.getElementById('formularioRegistro').addEventListener('submit', async (e) => {
    e.preventDefault(); 
    const rut = document.getElementById('rut').value.trim();
    
    const trabajadorData = {
        rut: rut,
        nombres: document.getElementById('nombres').value.trim(),
        apellidos: document.getElementById('apellidos').value.trim(),
        fechaNacimiento: document.getElementById('fechaNacimiento').value,
        sexo: document.getElementById('sexo').value,
        direccion: document.getElementById('direccion').value.trim(),
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
        alert("Error al procesar. Revisa tu conexión.");
    }
});

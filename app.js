// 1. IMPORTAR FIREBASE (Versión Web Modular)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, set, get, child } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// 2. CONFIGURACIÓN DE TU BASE DE DATOS
// IMPORTANTE: Cuando crees tu proyecto en Firebase, debes reemplazar estos valores vacíos por los tuyos.
const firebaseConfig = {
    apiKey: "AQUI_IRA_TU_API_KEY",
    authDomain: "tu-proyecto.firebaseapp.com",
    databaseURL: "https://tu-proyecto-default-rtdb.firebaseio.com",
    projectId: "tu-proyecto",
    storageBucket: "tu-proyecto.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef"
};

// 3. INICIALIZAR LA APLICACIÓN Y LA BASE DE DATOS
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// 4. LÓGICA DE AUTOCOMPLETADO POR RUT
document.getElementById('rut').addEventListener('blur', async (e) => {
    const rutIngresado = e.target.value.trim();
    const mensajeDiv = document.getElementById('mensajeAutocompletado');
    mensajeDiv.innerText = ""; 
    
    if (rutIngresado.length > 7) {
        try {
            const dbRef = ref(db);
            // Busca en la base de datos si el RUT ya existe
            const snapshot = await get(child(dbRef, `1_trabajadores/${rutIngresado}`));
            
            if (snapshot.exists()) {
                const datos = snapshot.val();
                // Rellena los campos automáticamente
                document.getElementById('nombres').value = datos.nombres || "";
                document.getElementById('apellidos').value = datos.apellidos || "";
                document.getElementById('telefono').value = datos.telefono || "";
                document.getElementById('email').value = datos.email || "";
                document.getElementById('afp').value = datos.afp || "";
                document.getElementById('salud').value = datos.salud || "";
                document.getElementById('banco').value = datos.banco || "";
                document.getElementById('tipoCuenta').value = datos.tipoCuenta || "";
                document.getElementById('numeroCuenta').value = datos.numeroCuenta || "";
                
                mensajeDiv.innerText = "✓ ¡Datos recuperados con éxito!";
            }
        } catch (error) {
            console.error("Error buscando el RUT:", error);
        }
    }
});

// 5. LÓGICA DE GUARDADO Y GENERACIÓN DE QR
document.getElementById('formularioRegistro').addEventListener('submit', async (e) => {
    e.preventDefault(); // Evita que la página se refresque al enviar

    // Capturar el RUT y estructurar todos los datos ingresados
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
        // Guardar la información en Firebase (Nodo: 1_trabajadores / RUT)
        await set(ref(db, '1_trabajadores/' + rut), trabajadorData);
        
        // Ocultar el formulario visualmente
        document.getElementById('formularioRegistro').classList.add('d-none');
        
        // Mostrar el contenedor del código QR
        const contenedorQR = document.getElementById('contenedorQR');
        contenedorQR.classList.remove('d-none');

        // Dibujar el Código QR en la pantalla usando la librería
        new QRCode(document.getElementById("codigoQR"), {
            text: rut, // El QR solo almacena el RUT para que el escáner de la puerta lo lea rápido
            width: 200,
            height: 200,
            colorDark : "#000000",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
        });

    } catch (error) {
        console.error("Error al guardar en Firebase:", error);
        alert("Ocurrió un error de conexión al guardar los datos. Revisa tu internet e intenta nuevamente.");
    }
});
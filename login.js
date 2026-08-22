import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// RECUERDA: Pegar aquí las credenciales de Firebase cuando tengas tu proyecto creado
const firebaseConfig = {
    apiKey: "AQUI_IRA_TU_API_KEY",
    authDomain: "tu-proyecto.firebaseapp.com",
    databaseURL: "https://tu-proyecto-default-rtdb.firebaseio.com",
    projectId: "tu-proyecto",
    storageBucket: "tu-proyecto.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef"
};

// Inicializar Firebase y el servicio de Autenticación
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Lógica al presionar el botón "Ingresar al Panel"
document.getElementById('formularioLogin').addEventListener('submit', async (e) => {
    e.preventDefault(); // Evita que la página parpadee o se recargue

    // Capturamos el correo y la clave
    const email = document.getElementById('emailStaff').value.trim();
    const password = document.getElementById('passStaff').value.trim();
    const mensajeError = document.getElementById('mensajeError');
    
    mensajeError.classList.add('d-none'); // Ocultar el mensaje de error si estaba visible

    try {
        // Le pedimos a Firebase que verifique si el usuario existe
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        
        // ¡ÉXITO! Las credenciales son correctas.
        // Redirigimos al usuario al Panel de Administrador
        window.location.href = "panel.html"; 
        
    } catch (error) {
        console.error("Error de acceso:", error.code);
        
        // Mostrar el mensaje rojo de error
        mensajeError.classList.remove('d-none');
        
        if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
            mensajeError.innerText = "Correo o contraseña incorrectos.";
        } else {
            mensajeError.innerText = "Error de conexión. Intenta nuevamente.";
        }
    }
});

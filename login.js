import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

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

document.getElementById('formularioLogin').addEventListener('submit', async (e) => {
    e.preventDefault(); 
    const email = document.getElementById('emailStaff').value.trim();
    const password = document.getElementById('passStaff').value.trim();
    const mensajeError = document.getElementById('mensajeError');
    
    mensajeError.classList.add('d-none'); 

    try {
        await signInWithEmailAndPassword(auth, email, password);
        window.location.href = "panel.html"; 
    } catch (error) {
        console.error("Error de acceso:", error.code);
        mensajeError.classList.remove('d-none');
        if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
            mensajeError.innerText = "Correo o contraseña incorrectos.";
        } else {
            mensajeError.innerText = "Error de conexión. Intenta nuevamente.";
        }
    }
});

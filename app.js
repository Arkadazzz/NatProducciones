import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, set, get, child, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

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

let eventoActivo = null;
let trabajadorExistente = false;
let programasActivos = {};

onValue(ref(db, '0_estado_sistema/programas_activos'), (snapshot) => {
    document.getElementById('spinnerCarga').classList.add('d-none');
    
    if (snapshot.exists()) {
        programasActivos = snapshot.val();
        const keys = Object.keys(programasActivos);
        document.getElementById('pantallaSinEvento').classList.add('d-none');

        if (keys.length === 1) {
            activarFormulario(programasActivos[keys[0]]);
        } else {
            document.getElementById('formularioPrincipal').classList.add('d-none');
            document.getElementById('pantallaSeleccion').classList.remove('d-none');
            const divBotones = document.getElementById('botonesProgramas');
            divBotones.innerHTML = '';
            keys.forEach(k => {
                const btn = document.createElement('button');
                btn.className = 'btn btn-outline-light fs-5 py-3 mb-2 w-100 fw-bold';
                btn.style.borderColor = '#b066ff';
                btn.innerText = programasActivos[k].nombre;
                btn.onclick = () => activarFormulario(programasActivos[k]);
                divBotones.appendChild(btn);
            });
        }
    } else {
        document.getElementById('msgSinEvento').classList.remove('d-none');
        document.getElementById('subMsgSinEvento').classList.remove('d-none');
        document.getElementById('formularioPrincipal').classList.add('d-none');
        document.getElementById('pantallaSeleccion').classList.add('d-none');
    }
});

function activarFormulario(programaSeleccionado) {
    eventoActivo = programaSeleccionado;
    document.getElementById('pantallaSeleccion').classList.add('d-none');
    document.getElementById('formularioPrincipal').classList.remove('d-none');
    
    document.getElementById('lblProgramaActivo').innerText = eventoActivo.nombre.toUpperCase();
    const partes = eventoActivo.fecha.split('-');
    if(partes.length === 3) document.getElementById('lblFechaActiva').innerText = `📅 ${partes[2]}-${partes[1]}-${partes[0]}`;

    if (eventoActivo.nombre === "Detrás del Muro") {
        document.getElementById('zonaCortesia').classList.remove('d-none');
        document.getElementById('tipoAsistencia').setAttribute('required', 'true');
        document.getElementById('tipoAsistencia').value = ""; 
        document.getElementById('divPinSeguridad').classList.add('d-none');
        document.getElementById('divInvitadoPor').classList.add('d-none');
    } else {
        document.getElementById('zonaCortesia').classList.add('d-none');
        document.getElementById('tipoAsistencia').removeAttribute('required');
    }
}

document.getElementById('tipoAsistencia').addEventListener('change', (e) => {
    const seleccion = e.target.value;
    if (seleccion === "Extra") {
        document.getElementById('divPinSeguridad').classList.remove('d-none');
        document.getElementById('pinAcceso').setAttribute('required', 'true');
        document.getElementById('divInvitadoPor').classList.add('d-none');
        document.getElementById('invitadoPor').removeAttribute('required');
    } else if (seleccion === "Cortesía") {
        document.getElementById('divInvitadoPor').classList.remove('d-none');
        document.getElementById('invitadoPor').setAttribute('required', 'true');
        document.getElementById('divPinSeguridad').classList.add('d-none');
        document.getElementById('pinAcceso').removeAttribute('required');
    } else {
        document.getElementById('divPinSeguridad').classList.add('d-none');
        document.getElementById('divInvitadoPor').classList.add('d-none');
    }
});

document.getElementById('btnVerificarRut').addEventListener('click', async () => {
    const rut = document.getElementById('rut').value.trim();
    // VALIDACIÓN ESTRICTA DEL RUT
    const rutRegex = /^[0-9]+-[0-9kK]{1}$/;
    if (!rutRegex.test(rut)) {
        return alert("⚠️ FORMATO INCORRECTO ⚠️\nEl RUT debe ser ingresado SIN PUNTOS y CON GUION.\nEjemplo: 12345678-9");
    }

    try {
        const snapshot = await get(child(ref(db), `1_trabajadores/${rut}`));
        document.getElementById('btnVerificarRut').classList.add('d-none');
        document.getElementById('rut').readOnly = true; 
        document.getElementById('seccionRSVP').classList.remove('d-none');
        document.getElementById('aceptoTerminos').setAttribute('required', 'true');

        if (snapshot.exists()) {
            trabajadorExistente = true;
            const datos = snapshot.val();
            document.getElementById('encabezadoFormulario').innerText = `¡Hola, ${datos.nombres}!`;
        } else {
            trabajadorExistente = false;
            document.getElementById('camposExtras').classList.remove('d-none');
            const inputs = document.querySelectorAll('#camposExtras input, #camposExtras select');
            inputs.forEach(input => input.setAttribute('required', 'true'));
        }
    } catch (error) { console.error(error); }
});

document.getElementById('formularioRegistro').addEventListener('submit', async (e) => {
    e.preventDefault(); 
    if (!eventoActivo) return alert("Error de programa.");

    const rut = document.getElementById('rut').value.trim();
    const esMuro = (eventoActivo.nombre === "Detrás del Muro");
    const tipoAsis = esMuro ? document.getElementById('tipoAsistencia').value : "Pago";
    const invitadoPor = (tipoAsis === "Cortesía") ? document.getElementById('invitadoPor').value : "";

    if (tipoAsis === "Extra" && eventoActivo.pin) {
        const pinIngresado = document.getElementById('pinAcceso').value;
        if (pinIngresado !== eventoActivo.pin) {
            return alert("⛔ ACCESO DENEGADO ⛔\nEl PIN de seguridad es incorrecto.\nSi eres un invitado, por favor cambia la opción a 'Invitado de Cortesía'.");
        }
    }

    try {
        if (!trabajadorExistente) {
            const trabajadorData = {
                rut: rut, nombres: document.getElementById('nombres').value.trim(), apellidos: document.getElementById('apellidos').value.trim(),
                fechaNacimiento: document.getElementById('fechaNacimiento').value, sexo: document.getElementById('sexo').value,
                direccion: document.getElementById('direccion').value.trim(), telefono: document.getElementById('telefono').value.trim(), email: document.getElementById('email').value.trim(),
                afp: document.getElementById('afp').value, salud: document.getElementById('salud').value, banco: document.getElementById('banco').value.trim(),
                tipoCuenta: document.getElementById('tipoCuenta').value, numeroCuenta: document.getElementById('numeroCuenta').value.trim(),
                fecha_registro_formulario: new Date().toISOString()
            };
            await set(ref(db, '1_trabajadores/' + rut), trabajadorData);
        }

        const reservaData = {
            rut: rut, tipo: tipoAsis, invitado_por: invitadoPor, hora_registro: new Date().toLocaleTimeString()
        };
        await set(ref(db, `3_reservas/${eventoActivo.fecha}/${eventoActivo.nombre}/${rut}`), reservaData);

        document.getElementById('formularioPrincipal').classList.add('d-none');
        document.getElementById('encabezadoFormulario').classList.add('d-none');
        document.getElementById('contenedorQR').classList.remove('d-none');
        
        let textoResumen = `${eventoActivo.nombre.toUpperCase()}`;
        if (tipoAsis === "Cortesía") textoResumen += ` (Invitado de ${invitadoPor})`;
        if (tipoAsis === "Extra") textoResumen += ` (I/P Autorizado)`;
        document.getElementById('resumenProgramaQR').innerText = textoResumen;
        
        document.getElementById('codigoQR').innerHTML = ""; 
        new QRCode(document.getElementById("codigoQR"), { text: rut, width: 200, height: 200, colorDark : "#000000", colorLight : "#ffffff", correctLevel : QRCode.CorrectLevel.H });

    } catch (error) { alert("Error al procesar. Revisa tu conexión."); }
});

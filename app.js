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
                
                let nombreBoton = programasActivos[k].nombre.replace(" - ", " / ").toUpperCase();
                if (nombreBoton.includes("DALE PLAY") && !nombreBoton.includes("PÚBLICO")) nombreBoton = "PÚBLICO / " + nombreBoton;
                if (nombreBoton.includes("MURO") && !nombreBoton.includes("PÚBLICO")) nombreBoton = "PÚBLICO / " + nombreBoton;
                
                btn.innerText = nombreBoton;
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
    
    let nombreFormulario = eventoActivo.nombre.replace(" - ", " / ").toUpperCase();
    if (nombreFormulario.includes("DALE PLAY") && !nombreFormulario.includes("PÚBLICO")) nombreFormulario = "PÚBLICO / " + nombreFormulario;
    if (nombreFormulario.includes("MURO") && !nombreFormulario.includes("PÚBLICO")) nombreFormulario = "PÚBLICO / " + nombreFormulario;
    
    document.getElementById('lblProgramaActivo').innerText = nombreFormulario;
    const partes = eventoActivo.fecha.split('-');
    if(partes.length === 3) document.getElementById('lblFechaActiva').innerText = `📅 ${partes[2]}-${partes[1]}-${partes[0]}`;

    if (eventoActivo.nombre.includes("Detrás del Muro")) {
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
        document.getElementById('pinAcceso').removeAttribute('required');
        document.getElementById('invitadoPor').removeAttribute('required');
    }
});

document.getElementById('btnVerificarRut').addEventListener('click', async () => {
    const rut = document.getElementById('rut').value.trim();
    
    // Algoritmo matemático estricto del Dígito Verificador Chileno
    function validarRutChileno(rutCompleto) {
        if (!/^[0-9]+-[0-9kK]{1}$/.test(rutCompleto)) return false;
        let tmp = rutCompleto.split('-');
        let digv = tmp[1].toLowerCase();
        let rutNum = tmp[0];
        let suma = 0; let multiplo = 2;
        for (let i = rutNum.length - 1; i >= 0; i--) {
            suma += parseInt(rutNum.charAt(i)) * multiplo;
            multiplo = multiplo < 7 ? multiplo + 1 : 2;
        }
        let dvEsperado = 11 - (suma % 11);
        let dvCalculado = (dvEsperado === 11) ? "0" : (dvEsperado === 10) ? "k" : dvEsperado.toString();
        return digv === dvCalculado;
    }

    if (!validarRutChileno(rut)) {
        return alert("⚠️ RUT INVÁLIDO ⚠️\nPor favor verifica que el RUT esté bien escrito, sin puntos y con su guion correcto (Ej: 12345678-9).\nEl sistema ha detectado que el dígito verificador no coincide matemáticamente.");
    }

    try {
        const blacklistSnap = await get(child(ref(db), `4_blacklist/${rut}`));
        if (blacklistSnap.exists()) {
            return alert(`⛔ ESTÁS BLOQUEADO(A) DEL SISTEMA ⛔\n\nNo puedes inscribirte para participar en los programas.\nSi crees que esto es un error, por favor contacta a producción.`);
        }

        const snapshot = await get(child(ref(db), `1_trabajadores/${rut}`));
        document.getElementById('btnVerificarRut').classList.add('d-none');
        document.getElementById('rut').readOnly = true; 
        document.getElementById('seccionRSVP').classList.remove('d-none');
        document.getElementById('aceptoTerminos').setAttribute('required', 'true');

        if (snapshot.exists()) {
            trabajadorExistente = true;
            const datos = snapshot.val();
            document.getElementById('encabezadoFormulario').innerText = `¡Hola, ${datos.nombres}!`;
            
            // LÍNEA ANTI-FALLOS: Evita que HTML5 bloquee el formulario por los inputs invisibles
            const inputs = document.querySelectorAll('#camposExtras input, #camposExtras select');
            inputs.forEach(input => input.removeAttribute('required'));

        } else {
            trabajadorExistente = false;
            document.getElementById('camposExtras').classList.remove('d-none');
            const inputs = document.querySelectorAll('#camposExtras input, #camposExtras select');
            inputs.forEach(input => {
                if(input.id !== 'email') input.setAttribute('required', 'true')
            });
        }
    } catch (error) { console.error(error); }
});

document.getElementById('formularioRegistro').addEventListener('submit', async (e) => {
    e.preventDefault(); 
    if (!eventoActivo) return alert("Error de programa.");

    const rut = document.getElementById('rut').value.trim();
    const esMuro = (eventoActivo.nombre.includes("Detrás del Muro"));
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
            const calle = document.getElementById('calle').value.trim();
            const numCalle = document.getElementById('numeroCalle').value.trim();
            const comuna = document.getElementById('comuna').value.trim();
            const direccionCompleta = `${calle} #${numCalle}, ${comuna}`;
            
            const telefonoCompleto = `+569${document.getElementById('telefono').value.trim()}`;

            const trabajadorData = {
                rut: rut, 
                nombres: document.getElementById('nombres').value.trim(), 
                apellidos: document.getElementById('apellidos').value.trim(),
                fechaNacimiento: document.getElementById('fechaNacimiento').value, 
                sexo: document.getElementById('sexo').value,
                direccion: direccionCompleta, 
                telefono: telefonoCompleto, 
                email: document.getElementById('email').value.trim(),
                afp: document.getElementById('afp').value, 
                salud: document.getElementById('salud').value, 
                banco: document.getElementById('banco').value,
                tipoCuenta: document.getElementById('tipoCuenta').value, 
                numeroCuenta: document.getElementById('numeroCuenta').value.trim(),
                fecha_registro_formulario: new Date().toISOString()
            };
            await set(ref(db, '1_trabajadores/' + rut), trabajadorData);
        }

        const reservaData = {
            rut: rut, 
            tipo: tipoAsis, 
            invitado_por: invitadoPor, 
            hora_registro: new Date().toLocaleTimeString()
        };
        await set(ref(db, `3_reservas/${eventoActivo.fecha}/${eventoActivo.nombre}/${rut}`), reservaData);

        document.getElementById('formularioPrincipal').classList.add('d-none');
        document.getElementById('encabezadoFormulario').classList.add('d-none');
        document.getElementById('contenedorQR').classList.remove('d-none');
        
        let textoResumen = `${eventoActivo.nombre.replace(" - ", " / ").toUpperCase()}`;
        if (tipoAsis === "Cortesía") textoResumen += ` (Invitado de ${invitadoPor})`;
        if (tipoAsis === "Extra") textoResumen += ` (I/P Autorizado)`;
        document.getElementById('resumenProgramaQR').innerText = textoResumen;
        
        const partesF = eventoActivo.fecha.split('-');
        const fechaBonita = `${partesF[2]}-${partesF[1]}-${partesF[0]}`;
        const horaCitacionMsg = eventoActivo.hora_citacion || "la hora indicada por producción";
        
        document.getElementById('instruccionesQR').innerHTML = `
            Recuerda guardar este QR (tómale pantallazo) para poder ingresar al canal.<br><br>
            <span class="text-warning">Tienes que estar el día <b>${fechaBonita}</b> a las <b>${horaCitacionMsg} hrs</b> en el canal.</span><br><br>
            ¡Te esperamos para que puedas disfrutar de <b>${eventoActivo.nombre.replace(" - ", " / ")}</b>!
        `;
        
        document.getElementById('codigoQR').innerHTML = ""; 
        new QRCode(document.getElementById("codigoQR"), { text: rut, width: 200, height: 200, colorDark : "#000000", colorLight : "#ffffff", correctLevel : QRCode.CorrectLevel.H });

    } catch (error) { alert("Error al procesar. Revisa tu conexión."); }
});

#!/usr/bin/env python3
"""Genera database.rules.json (reglas v3 de Firebase Realtime Database).

Las reglas de Firebase no admiten funciones, así que las condiciones repetidas
(¿es staff?, ¿es admin?) se escriben una vez aquí y se reemplazan al generar.
Uso:  python3 firebase/generar_reglas.py
"""
import json
import os

# Correo del usuario logueado convertido a clave válida de Firebase ('.' -> ',')
EMAIL_KEY = "auth.token.email.toLowerCase().replace('.', ',')"
STAFF = f"auth != null && root.child('0_roles').child({EMAIL_KEY}).exists()"
ADMIN = f"auth != null && root.child('0_roles').child({EMAIL_KEY}).val() === 'admin'"

# Ficha privada (banco, previsión, salud, PIN): el público solo puede
#  a) crearla si la persona no existía, o
#  b) modificarla demostrando que conoce su PIN (campo 'verif' nuevo que empieza con el hash del PIN).
PRIVADO_PUBLICO = (
    "(!data.exists()"
    " && !root.child('1_trabajadores').child($rut).exists()"
    " && newData.child('pin_hash').isString()"
    " && newData.child('pin_hash').val().length >= 32"
    " && newData.child('verif').val().beginsWith(newData.child('pin_hash').val() + '_'))"
    " || (data.child('pin_hash').exists()"
    " && newData.child('pin_hash').val() === data.child('pin_hash').val()"
    " && newData.child('verif').val() !== data.child('verif').val()"
    " && newData.child('verif').val().beginsWith(data.child('pin_hash').val() + '_'))"
)

# Ficha básica: el público la crea si no existe, o la actualiza solo si en la misma
# escritura también cambia 'verif' de la ficha privada (lo que exige conocer el PIN).
BASICA_PUBLICO = (
    "(!data.exists() && newData.child('rut').val() === $rut)"
    " || (data.exists() && newData.exists()"
    " && newData.parent().parent().child('1p_privado').child($rut).child('verif').val()"
    " !== root.child('1p_privado').child($rut).child('verif').val())"
)

PIN_CAPTADOR = "root.child('0_config').child('pins_captador').child($fecha).child($prog)"
RESERVA_PUBLICO = (
    "!data.exists() && newData.exists() && ("
    "newData.child('tipo').val() === 'Cortesía'"
    f" || !{PIN_CAPTADOR}.exists()"
    f" || newData.child('pin').val() === {PIN_CAPTADOR}.val())"
)

# PIN creado en el formulario por una persona ya registrada que aún no tiene PIN.
# Queda "pendiente": solo se activa cuando la persona lo vuelve a escribir en el iPad al firmar.
# Nadie lo puede leer desde afuera; si alguien escribe uno falso, nunca se activa.
PIN_PENDIENTE_PUBLICO = (
    "newData.exists()"
    " && root.child('1_trabajadores').child($rut).exists()"
    " && root.child('1_trabajadores').child($rut).child('tiene_pin').val() !== true"
)

AUTOCOMPLETAR_ESCRITURA = (
    "(newData.exists() && newData.parent().parent().child('1p_privado')"
    ".child(newData.child('rut').val()).child('auto_key').val() === $k)"
    f" || ({ADMIN})"
)


# Ningún texto guardado puede traer < > " ` (bloquea inyección de código en el panel)
TEXTO_SEGURO = {".validate": "!newData.isString() || !newData.val().matches(/[<>\"`]/)"}

# Primera vez: si todavía no hay roles, el dueño del proyecto puede nombrarse admin desde el panel
DUENO = "pinoelgueta@gmail.com"
ARRANQUE = f"auth != null && !root.child('0_roles').exists() && auth.token.email.toLowerCase() === '{DUENO}'"


def solo(lectura, escritura):
    return {".read": lectura, ".write": escritura}


reglas = {
    "rules": {
        "0_roles": {
            ".read": ADMIN,
            ".write": f"({ADMIN}) || ({ARRANQUE})",
            # Cada persona puede leer solo su propio rol (para que el panel sepa qué mostrar)
            "$email": {".read": f"auth != null && $email === {EMAIL_KEY}"},
        },
        "0_config": {
            ".read": STAFF,
            ".write": ADMIN,
            "invitadores": {".read": True},
            "pins_captador": {".write": STAFF},
        },
        "0_estado_sistema": {
            # El formulario público solo necesita la lista de programas activos
            "programas_activos": solo(True, STAFF),
            # Tasas Previred y parámetros del LRE: solo admins (afectan cotizaciones)
            "config_previred": solo(ADMIN, ADMIN),
            "$otro": solo(STAFF, STAFF),
        },
        "1_trabajadores": {
            ".read": STAFF,
            ".write": STAFF,
            "$rut": {
                ".write": BASICA_PUBLICO,
                # El formulario solo puede saber si un RUT ya está registrado y si tiene PIN (true/false), nada más
                "tiene_pin": {".read": True, ".validate": "newData.isBoolean()"},
                "$campo": TEXTO_SEGURO,
            },
        },
        "1p_privado": {
            ".read": ADMIN,
            ".write": ADMIN,
            "$rut": {
                ".write": PRIVADO_PUBLICO,
                # Desde el iPad, el staff puede crear el PIN de alguien que todavía no tiene
                "pin_hash": {".write": f"{STAFF} && !data.exists()"},
                "verif": {".write": f"{STAFF} && !data.parent().child('pin_hash').exists()"},
                "auto_key": {".write": f"{STAFF} && !data.parent().child('pin_hash').exists()"},
                "$campo": TEXTO_SEGURO,
            },
        },
        "1a_autocompletar": {
            "$k": {
                ".read": True,
                ".write": AUTOCOMPLETAR_ESCRITURA,
                ".validate": "!newData.exists() || newData.hasChildren(['rut', 'nombres'])",
                "$campo": TEXTO_SEGURO,
            }
        },
        "1q_pin_pendiente": {
            ".read": STAFF,
            ".write": STAFF,
            "$rut": {
                ".write": PIN_PENDIENTE_PUBLICO,
                ".validate": "!newData.exists() || (newData.hasChildren(['pin_hash', 'creado'])"
                             " && newData.child('pin_hash').isString() && newData.child('pin_hash').val().length >= 32"
                             " && newData.child('pin_hash').val().length <= 128 && newData.child('creado').val() === now)",
                "pin_hash": {},
                "creado": {},
                "$otro": {".validate": False},
            },
        },
        "2_asistencias": solo(STAFF, STAFF),
        # Contador de tickets por sala: se incrementa con transacciones para que dos iPads no repitan número
        "2_tickets": {".read": STAFF, ".write": STAFF, "$fecha": {"$prog": {".validate": "newData.isNumber() && newData.val() >= 1"}}},
        "3_reservas": {
            ".read": STAFF,
            ".write": STAFF,
            "$fecha": {"$prog": {"$rut": {".write": RESERVA_PUBLICO, "$campo": TEXTO_SEGURO}}},
        },
        # Motivo y fecha del bloqueo: solo staff y admin
        "4_blacklist": solo(STAFF, STAFF),
        # Lo único que ve el público: si un RUT puntual está bloqueado (true, o 'strikes' si fue por 3 strikes). No se puede listar.
        "4_bloqueados": {
            ".read": STAFF,
            ".write": STAFF,
            "$rut": {".read": True, ".validate": "!newData.exists() || newData.val() === true || newData.val() === 'strikes'"},
        },
        # Motivo y fecha de los bloqueos por programa: el staff los lee en la puerta, solo admin los pone
        "4_blacklist_programas": solo(STAFF, ADMIN),
        # Lo que ve el público: de qué programas está bloqueado un RUT puntual (sí/no, sin motivo). No se puede listar.
        "4_bloqueados_programa": {
            ".read": STAFF,
            ".write": ADMIN,
            "$rut": {".read": True, "$prog": {".validate": "!newData.exists() || newData.val() === true"}},
        },
        "5_historial_dt": solo(ADMIN, ADMIN),
        "6_sorteos_fechas_usadas": solo(STAFF, STAFF),
        "7_pagos_efectivo": solo(ADMIN, ADMIN),
        "8_autorizaciones_menores": {
            ".read": STAFF,
            ".write": STAFF,
            "$fecha": {"$prog": {"$rut": {".write": "!data.exists() && newData.exists()", "$campo": TEXTO_SEGURO}}},
        },
        # Strikes por inasistencia: el staff los aplica al cerrar la jornada (con confirmación)
        "9_strikes": solo(STAFF, STAFF),
        "10_firmas": solo(STAFF, STAFF),
        "11_previred_ajustes": solo(ADMIN, ADMIN),
        # Firmas de los recibos de efectivo (separadas de 7_pagos_efectivo para no descargarlas al abrir la pestaña)
        "12_firmas_recibos": solo(ADMIN, ADMIN),
    }
}

destino = os.path.join(os.path.dirname(os.path.abspath(__file__)), "database.rules.json")
with open(destino, "w", encoding="utf-8") as f:
    json.dump(reglas, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(f"Reglas generadas en {destino}")

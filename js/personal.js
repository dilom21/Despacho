import { db, auth, ADMIN_EMAIL } from "./firebase-config.js";
import { ROL, urlModulo, asegurarPerfil, redirigirPorRol } from "./auth-roles.js";
import {
  doc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";

let registrando = false;

function mostrarEstado(idCaja, texto, tipo) {
  const caja = document.getElementById(idCaja);
  caja.textContent = texto;
  caja.className = `estado ${tipo}`;
}

function cambiarPestana(login) {
  document.getElementById("tabLogin").classList.toggle("activo", login);
  document.getElementById("tabRegistro").classList.toggle("activo", !login);
  document.getElementById("formLogin").classList.toggle("oculto", !login);
  document.getElementById("formRegistro").classList.toggle("oculto", login);
}

async function iniciarSesion() {
  const email = document.getElementById("loginEmail").value.trim();
  const pass = document.getElementById("loginPass").value;

  if (!email || !pass) {
    mostrarEstado("loginEstado", "Ingresa tu correo y contraseña.", "error");
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (error) {
    console.error(error);
    mostrarEstado("loginEstado", "Correo o contraseña incorrectos.", "error");
  }
}

async function registrarConductor() {
  if (registrando) return;

  const nombre = document.getElementById("regNombre").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const pass = document.getElementById("regPass").value;
  const confirm = document.getElementById("regConfirm").value;

  if (!nombre || !email || !pass || !confirm) {
    mostrarEstado("registroEstado", "Completa todos los campos.", "error");
    return;
  }
  if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    mostrarEstado("registroEstado", "Ese correo no puede registrarse desde aquí.", "error");
    return;
  }
  if (pass !== confirm) {
    mostrarEstado("registroEstado", "Las contraseñas no coinciden.", "error");
    return;
  }
  if (pass.length < 6) {
    mostrarEstado("registroEstado", "La contraseña debe tener al menos 6 caracteres.", "error");
    return;
  }

  const boton = document.getElementById("btnRegistrar");
  registrando = true;
  boton.disabled = true;

  let cred = null;
  let perfilCreado = false;

  try {
    cred = await createUserWithEmailAndPassword(auth, email, pass);
    const uid = cred.user.uid;

    // Primero el perfil: las reglas exigen rol conductor para poder crear telemetria.
    await setDoc(doc(db, "usuarios", uid), {
      nombre,
      email,
      rol: ROL.CONDUCTOR,
      activo: true,
      creado_en: serverTimestamp()
    });
    perfilCreado = true;

    await setDoc(doc(db, "telemetria", uid), {
      conductor_uid: uid,
      nombre,
      latitud: null,
      longitud: null,
      precision: null,
      velocidad: null,
      rumbo: null,
      fuente_gps: "celular",
      conectado: false,
      estado_operativo: false,
      bloqueado: false,
      actualizado_en: null
    });

    location.replace(urlModulo("conductor"));
  } catch (error) {
    console.error(error);

    // El perfil ya quedo creado: el guard del conductor completara la telemetria.
    if (perfilCreado) {
      location.replace(urlModulo("conductor"));
      return;
    }

    // Si la cuenta Auth quedo sin perfil, se revierte para no dejar cuentas huerfanas.
    if (cred && cred.user) {
      try {
        await cred.user.delete();
      } catch (errorBorrado) {
        console.warn("No se pudo revertir la cuenta:", errorBorrado);
        try { await signOut(auth); } catch (errorSalida) { console.error(errorSalida); }
      }
    }

    if (error && error.code === "permission-denied") {
      mostrarEstado("registroEstado", "No se pudo guardar el perfil de conductor. Verifica que firestore.rules esté desplegado.", "error");
    } else {
      mostrarEstado("registroEstado", "No se pudo crear la cuenta. Revisa los datos.", "error");
    }
  } finally {
    registrando = false;
    boton.disabled = false;
  }
}

document.getElementById("tabLogin").addEventListener("click", () => cambiarPestana(true));
document.getElementById("tabRegistro").addEventListener("click", () => cambiarPestana(false));
document.getElementById("btnLogin").addEventListener("click", iniciarSesion);
document.getElementById("btnRegistrar").addEventListener("click", registrarConductor);

document.getElementById("loginPass").addEventListener("keydown", (evento) => {
  if (evento.key === "Enter") iniciarSesion();
});
document.getElementById("regConfirm").addEventListener("keydown", (evento) => {
  if (evento.key === "Enter") registrarConductor();
});

onAuthStateChanged(auth, async (user) => {
  if (registrando) return;
  if (!user || user.isAnonymous) return;

  const perfil = await asegurarPerfil(user);
  if (!perfil || perfil.activo === false) {
    try { await signOut(auth); } catch (error) { console.error(error); }
    mostrarEstado("loginEstado", "Esta cuenta no tiene un perfil válido. Contacta al administrador.", "error");
    return;
  }

  if (perfil.rol !== ROL.ADMIN && perfil.rol !== ROL.CONDUCTOR) {
    try { await signOut(auth); } catch (error) { console.error(error); }
    mostrarEstado("loginEstado", "Rol no reconocido. La sesión fue cerrada.", "error");
    return;
  }

  redirigirPorRol(perfil.rol);
});

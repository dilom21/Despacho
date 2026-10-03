import { db, auth, ADMIN_EMAIL } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";

export const ROL = { ADMIN: "admin", CONDUCTOR: "conductor" };

// Construye la URL de un modulo (/personal/, /conductor/, /admin/) desde cualquier pagina.
export function urlModulo(nombre) {
  return new URL(`../${nombre}/`, location.href).href;
}

// Lee usuarios/{uid}. Devuelve { uid, ...datos } o null (tambien si falla la lectura).
export async function obtenerPerfil(uid) {
  try {
    const snap = await getDoc(doc(db, "usuarios", uid));
    return snap.exists() ? { uid, ...snap.data() } : null;
  } catch (error) {
    console.error("No se pudo leer el perfil:", error);
    return null;
  }
}

// Garantiza que exista usuarios/{uid}. Bootstrap del admin existente y migracion de conductores previos.
export async function asegurarPerfil(user) {
  const perfil = await obtenerPerfil(user.uid);
  if (perfil) return perfil;

  const email = (user.email || "").toLowerCase();

  try {
    if (email === ADMIN_EMAIL.toLowerCase()) {
      await setDoc(doc(db, "usuarios", user.uid), {
        nombre: "Administrador",
        email: user.email,
        rol: ROL.ADMIN,
        activo: true,
        creado_en: serverTimestamp()
      });
      return { uid: user.uid, nombre: "Administrador", email: user.email, rol: ROL.ADMIN, activo: true };
    }

    // Conductor previo: tiene telemetria/{uid} pero no usuarios/{uid}.
    const telemetria = await getDoc(doc(db, "telemetria", user.uid));
    if (telemetria.exists()) {
      const nombre = telemetria.data().nombre || "Conductor";
      await setDoc(doc(db, "usuarios", user.uid), {
        nombre,
        email: user.email,
        rol: ROL.CONDUCTOR,
        activo: true,
        creado_en: serverTimestamp()
      });
      try {
        await updateDoc(doc(db, "telemetria", user.uid), { conductor_uid: user.uid });
      } catch (error) {
        console.warn("No se pudo normalizar telemetria:", error);
      }
      return { uid: user.uid, nombre, email: user.email, rol: ROL.CONDUCTOR, activo: true };
    }
  } catch (error) {
    console.error("No se pudo preparar el perfil:", error);
    return null;
  }

  return null;
}

export function redirigirPorRol(rol) {
  if (rol === ROL.ADMIN) location.replace(urlModulo("admin"));
  else if (rol === ROL.CONDUCTOR) location.replace(urlModulo("conductor"));
  else location.replace(urlModulo("personal"));
}

// Resuelve { user, perfil } solo si la sesion tiene el rol pedido. En cualquier otro caso redirige.
export function requireRole(rolEsperado) {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user || user.isAnonymous) {
        unsub();
        location.replace(urlModulo("personal"));
        return;
      }
      const perfil = await asegurarPerfil(user);
      const rolValido = perfil && (perfil.rol === ROL.ADMIN || perfil.rol === ROL.CONDUCTOR);
      if (!perfil || perfil.activo === false || !rolValido) {
        unsub();
        try { await signOut(auth); } catch (error) { console.error(error); }
        location.replace(urlModulo("personal"));
        return;
      }
      if (perfil.rol !== rolEsperado) {
        unsub();
        redirigirPorRol(perfil.rol);
        return;
      }
      unsub();
      resolve({ user, perfil });
    });
  });
}

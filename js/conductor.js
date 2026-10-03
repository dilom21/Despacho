import { db, auth, ADMIN_EMAIL } from "./firebase-config.js";
import {
  doc, setDoc, getDoc, updateDoc, onSnapshot, collection, query, where
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";

let uidConductor = null;
let nombreConductor = "Conductor";
let bloqueado = false;
let watchId = null;
let viajePendienteId = null;
let viajeActual = null;
let timerAsignacion = null;
let viajeConTimer = null;
let timerCortesia = null;
let temporizadorEspera = null;
let montoEspera = 0;
let unsubViajes = null;
let unsubEstado = null;
let modoAdminVista = false;

const map = L.map("map").setView([-17.7833, -63.1821], 14);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
let marcadorPropio = null;
let marcadorOrigen = null;
let marcadorDestino = null;
let lineaViaje = null;

function mostrarLoginMensaje(texto, error = false) {
  const caja = document.getElementById("loginEstado");
  caja.textContent = texto;
  caja.className = `estado ${error ? "error" : "ok"}`;
}

function mostrarApp() {
  document.getElementById("loginVista").style.display = "none";
  document.getElementById("appVista").style.display = "grid";
  setTimeout(() => map.invalidateSize(), 100);
}

function mostrarLogin() {
  document.getElementById("loginVista").style.display = "flex";
  document.getElementById("appVista").style.display = "none";
}

function configurarVistaAdmin() {
  modoAdminVista = true;
  const aviso = document.getElementById("modoAdminAviso");
  aviso.classList.remove("oculto");
  aviso.textContent = `Vista de ${nombreConductor} abierta por el administrador. Solo lectura.`;

  ["btnStartGPS", "btnStopGPS", "btnFalla", "btnAceptar", "btnLlegue", "btnAbordo", "btnFinalizar"].forEach((id) => {
    document.getElementById(id).classList.add("oculto");
  });

  document.getElementById("btnCerrar").textContent = "Volver a administración";
}

function estadoGps(texto, tipo = "") {
  const caja = document.getElementById("conductorStatus");
  caja.textContent = texto;
  caja.className = `estado ${tipo}`.trim();
}

function limpiarMapaViaje() {
  if (marcadorOrigen) map.removeLayer(marcadorOrigen);
  if (marcadorDestino) map.removeLayer(marcadorDestino);
  if (lineaViaje) map.removeLayer(lineaViaje);
  marcadorOrigen = null;
  marcadorDestino = null;
  lineaViaje = null;
}

function dibujarViaje(data) {
  limpiarMapaViaje();
  if (data.origen) marcadorOrigen = L.marker([data.origen.lat, data.origen.lng]).addTo(map).bindPopup("Origen del cliente");
  if (data.destino) marcadorDestino = L.marker([data.destino.lat, data.destino.lng]).addTo(map).bindPopup("Destino");
  if (data.origen && data.destino) {
    lineaViaje = L.polyline([
      [data.origen.lat, data.origen.lng],
      [data.destino.lat, data.destino.lng]
    ], { weight: 3 }).addTo(map);
    map.fitBounds(lineaViaje.getBounds(), { padding: [30, 30] });
  }
}

function ocultarBotonesViaje() {
  ["btnAceptar", "btnLlegue", "btnAbordo", "btnFinalizar"].forEach((id) => {
    document.getElementById(id).classList.add("oculto");
  });
}

function detenerCobroEspera() {
  if (timerCortesia) clearTimeout(timerCortesia);
  if (temporizadorEspera) clearInterval(temporizadorEspera);
  timerCortesia = null;
  temporizadorEspera = null;
}

async function iniciarSesion() {
  try {
    await signInWithEmailAndPassword(
      auth,
      document.getElementById("emailConductor").value.trim(),
      document.getElementById("passConductor").value
    );
  } catch (error) {
    console.error(error);
    mostrarLoginMensaje("Correo o contraseña incorrectos.", true);
  }
}

async function activarGps() {
  if (modoAdminVista) return;
  if (!uidConductor) return;
  if (bloqueado) return alert("El conductor está bloqueado por el administrador.");
  if (!navigator.geolocation) return alert("El navegador no permite usar GPS.");
  if (!window.isSecureContext && location.hostname !== "localhost") {
    return alert("El GPS del navegador necesita abrirse mediante HTTPS.");
  }

  if (watchId !== null) navigator.geolocation.clearWatch(watchId);

  await updateDoc(doc(db, "telemetria", uidConductor), {
    estado_operativo: true,
    fuente_gps: "celular"
  });

  estadoGps("GPS activo. El celular está enviando la posición del taxi.", "ok");
  document.getElementById("btnStartGPS").classList.add("oculto");
  document.getElementById("btnStopGPS").classList.remove("oculto");
  document.getElementById("btnFalla").classList.remove("oculto");

  watchId = navigator.geolocation.watchPosition(async (posicion) => {
    const lectura = {
      latitud: posicion.coords.latitude,
      longitud: posicion.coords.longitude,
      precision: Math.round(posicion.coords.accuracy || 0),
      actualizado_en: new Date().toISOString(),
      estado_operativo: true,
      fuente_gps: "celular"
    };

    try {
      await updateDoc(doc(db, "telemetria", uidConductor), lectura);
      document.getElementById("gpsDatos").classList.remove("oculto");
      document.getElementById("gpsDatos").textContent =
        `Lat: ${lectura.latitud.toFixed(6)}\nLng: ${lectura.longitud.toFixed(6)}\nPrecisión: ±${lectura.precision} m\nÚltima lectura: ${new Date(lectura.actualizado_en).toLocaleTimeString()}`;

      if (!marcadorPropio) {
        marcadorPropio = L.marker([lectura.latitud, lectura.longitud]).addTo(map).bindPopup("Este taxi");
      } else {
        marcadorPropio.setLatLng([lectura.latitud, lectura.longitud]);
      }
    } catch (error) {
      console.error(error);
      estadoGps("No se pudo enviar la ubicación a Firebase.", "error");
    }
  }, (error) => {
    console.error(error);
    estadoGps("No se pudo obtener la ubicación. Revisa permisos del celular.", "error");
  }, {
    enableHighAccuracy: true,
    maximumAge: 2000,
    timeout: 10000
  });
}

async function detenerGps() {
  if (modoAdminVista) return;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  document.getElementById("btnStartGPS").classList.remove("oculto");
  document.getElementById("btnStopGPS").classList.add("oculto");
  document.getElementById("btnFalla").classList.add("oculto");
  document.getElementById("gpsDatos").classList.add("oculto");
  estadoGps("GPS apagado.");
  if (uidConductor) {
    await updateDoc(doc(db, "telemetria", uidConductor), {
      estado_operativo: false,
      actualizado_en: new Date().toISOString()
    }).catch(() => {});
  }
}

async function reportarFalla() {
  if (modoAdminVista) return;
  if (!uidConductor) return;
  if (!confirm("¿Reportar falla mecánica? El taxi quedará bloqueado hasta revisión del administrador.")) return;

  const snap = await getDoc(doc(db, "telemetria", uidConductor));
  const data = snap.exists() ? snap.data() : {};
  await updateDoc(doc(db, "telemetria", uidConductor), {
    bloqueado: true,
    estado_operativo: false
  });

  if (viajePendienteId) {
    await updateDoc(doc(db, "viajes", viajePendienteId), { estado: "rechazado_por_bloqueo" });
  }

  await setDoc(doc(db, "auditorias_desvios", `falla_${uidConductor}_${Date.now()}`), {
    conductor_id: uidConductor,
    conductor: nombreConductor,
    lat: data.latitud || 0,
    lng: data.longitud || 0,
    fecha: new Date().toISOString(),
    tipo: "falla_mecanica"
  });
}

function escucharEstadoConductor() {
  if (unsubEstado) unsubEstado();
  unsubEstado = onSnapshot(doc(db, "telemetria", uidConductor), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    nombreConductor = data.nombre || nombreConductor;
    bloqueado = Boolean(data.bloqueado);

    if (data.latitud && data.longitud) {
      if (!marcadorPropio) {
        marcadorPropio = L.marker([data.latitud, data.longitud]).addTo(map).bindPopup(nombreConductor);
      } else {
        marcadorPropio.setLatLng([data.latitud, data.longitud]);
      }

      if (modoAdminVista) {
        map.setView([data.latitud, data.longitud], 15);
        document.getElementById("gpsDatos").classList.remove("oculto");
        document.getElementById("gpsDatos").textContent =
          `Lat: ${Number(data.latitud).toFixed(6)}\nLng: ${Number(data.longitud).toFixed(6)}\nPrecisión: ${data.precision ? `±${data.precision} m` : "sin dato"}\nÚltima lectura: ${data.actualizado_en ? new Date(data.actualizado_en).toLocaleTimeString() : "sin lectura"}`;
        estadoGps(data.estado_operativo ? "GPS activo en el celular del conductor." : "GPS apagado en el celular del conductor.", data.estado_operativo ? "ok" : "");
        document.getElementById("modoAdminAviso").textContent = `Vista de ${nombreConductor} abierta por el administrador. Solo lectura.`;
      }
    }

    if (modoAdminVista) {
      if (bloqueado) document.getElementById("alertaBloqueo").classList.remove("oculto");
      else document.getElementById("alertaBloqueo").classList.add("oculto");
      return;
    }

    if (bloqueado) {
      document.getElementById("alertaBloqueo").classList.remove("oculto");
      detenerGps();
      ocultarBotonesViaje();
    } else {
      document.getElementById("alertaBloqueo").classList.add("oculto");
    }
  });
}
function escucharViajes() {
  if (unsubViajes) unsubViajes();
  const consulta = query(collection(db, "viajes"), where("conductor_asignado", "==", uidConductor));

  unsubViajes = onSnapshot(consulta, (snapshot) => {
    const activos = snapshot.docs
      .map((d) => ({ id: d.id, data: d.data() }))
      .filter(({ data }) => ["buscando_conductor", "conductor_en_camino", "en_espera", "en_viaje"].includes(data.estado));

    if (!activos.length) {
      clearTimeout(timerAsignacion);
      viajeConTimer = null;
      viajePendienteId = null;
      viajeActual = null;
      detenerCobroEspera();
      limpiarMapaViaje();
      ocultarBotonesViaje();
      document.getElementById("montoEspera").classList.add("oculto");
      document.getElementById("viajeInfo").textContent = "No tienes solicitudes pendientes.";
      return;
    }

    const { id, data } = activos[0];
    viajePendienteId = id;
    viajeActual = data;
    montoEspera = data.deuda_espera || 0;
    dibujarViaje(data);
    ocultarBotonesViaje();

    if (data.estado === "buscando_conductor") {
      if (modoAdminVista) {
        document.getElementById("viajeInfo").textContent =
          `Solicitud pendiente de ${data.cliente_nombre}. Destino: ${data.destino_nombre || "sin nombre"}.`;
        return;
      }

      document.getElementById("btnAceptar").classList.remove("oculto");
      document.getElementById("viajeInfo").textContent =
        `Nueva solicitud de ${data.cliente_nombre}. Destino: ${data.destino_nombre || "sin nombre"}. Tienes 30 segundos para aceptar.`;

      if (viajeConTimer !== id) {
        clearTimeout(timerAsignacion);
        viajeConTimer = id;
        timerAsignacion = setTimeout(async () => {
          if (viajePendienteId !== id || modoAdminVista) return;
          viajePendienteId = null;
          viajeConTimer = null;
          ocultarBotonesViaje();
          document.getElementById("viajeInfo").textContent = "La solicitud venció por falta de respuesta.";
          await updateDoc(doc(db, "viajes", id), { estado: "rechazado_por_tiempo" });
        }, 30000);
      }
      return;
    }

    clearTimeout(timerAsignacion);
    viajeConTimer = null;

    if (data.estado === "conductor_en_camino") {
      document.getElementById("viajeInfo").textContent = `Viaje aceptado. Dirígete hacia ${data.cliente_nombre}.`;
      if (!modoAdminVista) document.getElementById("btnLlegue").classList.remove("oculto");
    } else if (data.estado === "en_espera") {
      document.getElementById("viajeInfo").textContent = "Llegaste al origen. Esperando al pasajero.";
      if (!modoAdminVista) document.getElementById("btnAbordo").classList.remove("oculto");
      document.getElementById("montoEspera").classList.remove("oculto");
      document.getElementById("montoEspera").textContent = `Deuda por espera: ${montoEspera} Bs.`;
    } else if (data.estado === "en_viaje") {
      document.getElementById("viajeInfo").textContent = `Pasajero a bordo. Dirígete al destino: ${data.destino_nombre || "destino marcado"}.`;
      if (!modoAdminVista) document.getElementById("btnFinalizar").classList.remove("oculto");
    }
  });
}
async function aceptarViaje() {
  if (modoAdminVista) return;
  if (!viajePendienteId) return;
  clearTimeout(timerAsignacion);
  await updateDoc(doc(db, "viajes", viajePendienteId), {
    estado: "conductor_en_camino",
    conductor_nombre: nombreConductor,
    conductor_id: uidConductor,
    aceptado_en: new Date().toISOString()
  });
}

async function llegueAlOrigen() {
  if (modoAdminVista) return;
  if (!viajePendienteId) return;
  detenerCobroEspera();
  montoEspera = viajeActual?.deuda_espera || 0;
  await updateDoc(doc(db, "viajes", viajePendienteId), {
    estado: "en_espera",
    llegada_origen_en: new Date().toISOString()
  });

  alert("Comenzaron 10 segundos de cortesía. Después se cobrarán 2 Bs cada 5 segundos.");
  timerCortesia = setTimeout(() => {
    temporizadorEspera = setInterval(async () => {
      if (!viajePendienteId) return detenerCobroEspera();
      montoEspera += 2;
      document.getElementById("montoEspera").textContent = `Deuda por espera: ${montoEspera} Bs.`;
      await updateDoc(doc(db, "viajes", viajePendienteId), { deuda_espera: montoEspera });
    }, 5000);
  }, 10000);
}

async function pasajeroAbordo() {
  if (modoAdminVista) return;
  if (!viajePendienteId) return;
  detenerCobroEspera();
  await updateDoc(doc(db, "viajes", viajePendienteId), {
    estado: "en_viaje",
    inicio_viaje_en: new Date().toISOString(),
    deuda_espera: montoEspera
  });
}

async function finalizarViaje() {
  if (modoAdminVista) return;
  if (!viajePendienteId) return;
  const id = viajePendienteId;
  detenerCobroEspera();
  await updateDoc(doc(db, "viajes", id), {
    estado: "finalizado",
    finalizado_en: new Date().toISOString(),
    deuda_espera: montoEspera
  });
}

async function cerrarSesion() {
  detenerCobroEspera();
  if (unsubViajes) unsubViajes();
  if (unsubEstado) unsubEstado();

  if (modoAdminVista) {
    location.href = "../admin/";
    return;
  }

  await detenerGps();
  await signOut(auth);
}

document.getElementById("btnLogin").addEventListener("click", iniciarSesion);
document.getElementById("btnStartGPS").addEventListener("click", activarGps);
document.getElementById("btnStopGPS").addEventListener("click", detenerGps);
document.getElementById("btnFalla").addEventListener("click", reportarFalla);
document.getElementById("btnAceptar").addEventListener("click", aceptarViaje);
document.getElementById("btnLlegue").addEventListener("click", llegueAlOrigen);
document.getElementById("btnAbordo").addEventListener("click", pasajeroAbordo);
document.getElementById("btnFinalizar").addEventListener("click", finalizarViaje);
document.getElementById("btnCerrar").addEventListener("click", cerrarSesion);

onAuthStateChanged(auth, async (user) => {
  if (!user || user.isAnonymous) {
    uidConductor = null;
    modoAdminVista = false;
    mostrarLogin();
    return;
  }

  const esAdmin = user.email && user.email.toLowerCase() === ADMIN_EMAIL;

  if (esAdmin) {
    const uidSeleccionado = new URLSearchParams(location.search).get("uid");
    if (!uidSeleccionado) {
      location.replace("../admin/");
      return;
    }

    const snap = await getDoc(doc(db, "telemetria", uidSeleccionado));
    if (!snap.exists()) {
      location.replace("../admin/");
      return;
    }

    uidConductor = uidSeleccionado;
    nombreConductor = snap.data().nombre || nombreConductor;
    mostrarApp();
    configurarVistaAdmin();
    escucharEstadoConductor();
    escucharViajes();
    return;
  }

  const snap = await getDoc(doc(db, "telemetria", user.uid));
  if (!snap.exists()) {
    await signOut(auth);
    mostrarLogin();
    mostrarLoginMensaje("Esta cuenta no está autorizada como conductor.", true);
    return;
  }

  uidConductor = user.uid;
  nombreConductor = snap.data().nombre || nombreConductor;
  modoAdminVista = false;
  mostrarApp();
  escucharEstadoConductor();
  escucharViajes();
});

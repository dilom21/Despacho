import { db, auth } from "./firebase-config.js";
import { ROL, urlModulo, asegurarPerfil, redirigirPorRol } from "./auth-roles.js";
import {
  doc, setDoc, getDoc, updateDoc, onSnapshot, collection, query, where
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import {
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
import { obtenerRutaCalles, crearRutaThrottled } from "./rutas.js";
import { iconoCarro, iconoPersona, iconoDestino } from "./map-icons.js";
import { mostrarNotificacion } from "./notificaciones.js";

let uidConductor = null;
let nombreConductor = "Conductor";
let emailConductor = "";
let bloqueado = false;
let watchId = null;
const INTERVALO_ESCRITURA = 4000;
let ultimaEscritura = 0;
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
let bloqueadoAnterior = null;
let avisoErrorFirebase = false;

const map = L.map("map").setView([-17.7833, -63.1821], 14);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
let marcadorPropio = null;
let marcadorOrigen = null;
let marcadorDestino = null;
let lineaViaje = null;
let viajeActualData = null;
const rutaViajeThrottled = crearRutaThrottled(12000);

// Acepta 0 como coordenada valida. Solo null/undefined/vacio o no numerico es invalido.
function numeroCoordenada(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function mostrarApp() {
  document.getElementById("appVista").style.display = "grid";
  const nombreEl = document.getElementById("conductorNombre");
  const emailEl = document.getElementById("conductorEmail");
  if (nombreEl) nombreEl.textContent = nombreConductor;
  if (emailEl) emailEl.textContent = emailConductor;
  setTimeout(() => map.invalidateSize(), 100);
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
  viajeActualData = null;
}

// Devuelve los dos puntos [inicio, fin] de la ruta segun la etapa del viaje.
// conductor_en_camino -> conductor actual hasta el origen; en_viaje -> conductor actual
// hasta el destino; cualquier otra etapa -> origen hasta destino (comportamiento previo).
function puntosRutaViaje(data) {
  const propio = marcadorPropio && marcadorPropio.getLatLng();
  const posConductor = propio
    ? { lat: propio.lat, lng: propio.lng }
    : (data.origen ? { lat: data.origen.lat, lng: data.origen.lng } : null);

  if (data.estado === "conductor_en_camino" && posConductor && data.origen) {
    return [posConductor, { lat: data.origen.lat, lng: data.origen.lng }];
  }
  if (data.estado === "en_viaje" && posConductor && data.destino) {
    return [posConductor, { lat: data.destino.lat, lng: data.destino.lng }];
  }
  if (data.origen && data.destino) {
    return [
      { lat: data.origen.lat, lng: data.origen.lng },
      { lat: data.destino.lat, lng: data.destino.lng }
    ];
  }
  return null;
}

// Traza la linea del viaje: ruta real por calles (OSRM) con fallback a recta.
async function actualizarLineaViaje(forzar = false) {
  const data = viajeActualData;
  if (!data) return;
  const puntos = puntosRutaViaje(data);
  if (!puntos) return;

  const puntosLeaflet = puntos.map((p) => [p.lat, p.lng]);
  const geometria = await rutaViajeThrottled(puntos, forzar);

  if (geometria === undefined) {
    // Throttled: conservar la linea actual; si aun no existe, trazar la recta.
    if (!lineaViaje) lineaViaje = L.polyline(puntosLeaflet, { weight: 3 }).addTo(map);
    return;
  }

  const coordenadas = (geometria && geometria.length >= 2) ? geometria : puntosLeaflet;
  if (lineaViaje) map.removeLayer(lineaViaje);
  lineaViaje = L.polyline(coordenadas, { weight: 3 }).addTo(map);
}

// Refresco suave desde el callback GPS (respeta el throttle de 12 s de OSRM).
function refrescarRutaViaje() {
  if (!viajeActualData) return;
  const estado = viajeActualData.estado;
  if (estado !== "conductor_en_camino" && estado !== "en_viaje") return;
  actualizarLineaViaje(false);
}

function dibujarViaje(data, forzar = true) {
  limpiarMapaViaje();
  viajeActualData = data;
  // En en_viaje el pasajero ya va a bordo: se oculta la persona (origen) y el
  // mapa queda con carro + destino, igual que en Uber/Yango.
  if (data.origen && data.estado !== "en_viaje") {
    marcadorOrigen = L.marker([data.origen.lat, data.origen.lng], { icon: iconoPersona }).addTo(map).bindPopup("Origen del cliente");
  }
  if (data.destino) {
    marcadorDestino = L.marker([data.destino.lat, data.destino.lng], { icon: iconoDestino }).addTo(map).bindPopup("Destino");
  }

  const puntos = puntosRutaViaje(data);
  if (!puntos) return;

  actualizarLineaViaje(forzar);
  if (forzar) {
    map.fitBounds(L.latLngBounds(puntos.map((p) => [p.lat, p.lng])), { padding: [30, 30] });
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
    conductor_uid: uidConductor,
    nombre: nombreConductor,
    estado_operativo: false,
    conectado: false,
    bloqueado: bloqueado,
    fuente_gps: "celular"
  });
  await setDoc(doc(db, "flota_publica", uidConductor), {
    conductor_uid: uidConductor,
    nombre: nombreConductor,
    estado_operativo: false,
    conectado: false,
    bloqueado: bloqueado
  }, { merge: true }).catch((error) => console.error(error));

  estadoGps("GPS activo. Esperando la primera lectura del GPS...", "ok");
  document.getElementById("btnStartGPS").classList.add("oculto");
  document.getElementById("btnStopGPS").classList.remove("oculto");
  document.getElementById("btnFalla").classList.remove("oculto");
  mostrarNotificacion("🛰️ GPS activado", "exito", {
    detalle: "Esperando la primera lectura del GPS..."
  });

  ultimaEscritura = 0;
  watchId = navigator.geolocation.watchPosition(async (posicion) => {
    const lectura = {
      conductor_uid: uidConductor,
      latitud: posicion.coords.latitude,
      longitud: posicion.coords.longitude,
      precision: Math.round(posicion.coords.accuracy || 0),
      velocidad: posicion.coords.speed,
      rumbo: posicion.coords.heading,
      fuente_gps: "celular",
      conectado: true,
      estado_operativo: true,
      actualizado_en: new Date().toISOString()
    };

    if (!marcadorPropio) {
      marcadorPropio = L.marker([lectura.latitud, lectura.longitud], { icon: iconoCarro }).addTo(map).bindPopup("Este taxi");
    } else {
      marcadorPropio.setLatLng([lectura.latitud, lectura.longitud]);
    }

    refrescarRutaViaje();

    const caja = document.getElementById("gpsDatos");
    caja.classList.remove("oculto");
    caja.textContent =
      `Lat: ${lectura.latitud.toFixed(6)}\nLng: ${lectura.longitud.toFixed(6)}\nPrecisión: ±${lectura.precision} m\nÚltima lectura: ${new Date().toLocaleTimeString()}`;

    const ahora = Date.now();
    if (ahora - ultimaEscritura < INTERVALO_ESCRITURA) return;
    ultimaEscritura = ahora;

    try {
      await updateDoc(doc(db, "telemetria", uidConductor), lectura);
      await setDoc(doc(db, "flota_publica", uidConductor), {
        conductor_uid: uidConductor,
        nombre: nombreConductor,
        latitud: lectura.latitud,
        longitud: lectura.longitud,
        precision: lectura.precision,
        conectado: true,
        estado_operativo: true,
        bloqueado: bloqueado,
        actualizado_en: lectura.actualizado_en
      }, { merge: true });
      caja.textContent += `\nEnviado: ${new Date().toLocaleTimeString()}`;
      avisoErrorFirebase = false;
    } catch (error) {
      console.error(error);
      estadoGps("No se pudo enviar la ubicación a Firebase.", "error");
      if (!avisoErrorFirebase) {
        avisoErrorFirebase = true;
        mostrarNotificacion("No se pudo enviar la ubicación a Firebase.", "error", {
          detalle: "Revisa la conexión."
        });
      }
    }
  }, async (error) => {
    console.error(error);
    if (uidConductor) {
      const ahora = new Date().toISOString();
      await updateDoc(doc(db, "telemetria", uidConductor), {
        conductor_uid: uidConductor,
        conectado: false,
        estado_operativo: false,
        actualizado_en: ahora
      }).catch(() => {});
      await setDoc(doc(db, "flota_publica", uidConductor), {
        conductor_uid: uidConductor,
        nombre: nombreConductor,
        bloqueado: bloqueado,
        conectado: false,
        estado_operativo: false,
        actualizado_en: ahora
      }, { merge: true }).catch(() => {});
    }
    let mensajeGpsError = "No se pudo obtener la ubicación. Revisa permisos del celular.";
    if (error.code === error.PERMISSION_DENIED) {
      mensajeGpsError = "Permiso de ubicación denegado. Actívalo en el navegador del celular.";
    } else if (error.code === error.POSITION_UNAVAILABLE) {
      mensajeGpsError = "Ubicación no disponible. Revisa el GPS del celular.";
    } else if (error.code === error.TIMEOUT) {
      mensajeGpsError = "Tiempo de espera agotado al obtener la ubicación. Intenta de nuevo.";
    }
    estadoGps(mensajeGpsError, "error");
    mostrarNotificacion("Error de GPS", "error", { detalle: mensajeGpsError, clave: "conductor:gps-error" });
  }, {
    enableHighAccuracy: true,
    maximumAge: 0,
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
  if (!bloqueado) {
    mostrarNotificacion("GPS desactivado", "info", { detalle: "Ya no se envía tu ubicación." });
  }
  if (uidConductor) {
    const ahora = new Date().toISOString();
    await updateDoc(doc(db, "telemetria", uidConductor), {
      conductor_uid: uidConductor,
      conectado: false,
      estado_operativo: false,
      actualizado_en: ahora
    }).catch(() => {});
    await setDoc(doc(db, "flota_publica", uidConductor), {
      conductor_uid: uidConductor,
      nombre: nombreConductor,
      bloqueado: bloqueado,
      conectado: false,
      estado_operativo: false,
      actualizado_en: ahora
    }, { merge: true }).catch(() => {});
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
    conectado: false,
    estado_operativo: false
  });
  await setDoc(doc(db, "flota_publica", uidConductor), {
    conductor_uid: uidConductor,
    nombre: nombreConductor,
    bloqueado: true,
    conectado: false,
    estado_operativo: false
  }, { merge: true }).catch((error) => console.error(error));

  if (viajePendienteId) {
    await updateDoc(doc(db, "viajes", viajePendienteId), { estado: "rechazado_por_bloqueo" });
  }

  await setDoc(doc(db, "auditorias_desvios", `falla_${uidConductor}_${Date.now()}`), {
    conductor_id: uidConductor,
    conductor: nombreConductor,
    lat: numeroCoordenada(data.latitud),
    lng: numeroCoordenada(data.longitud),
    fecha: new Date().toISOString(),
    tipo: "falla_mecanica"
  });

  mostrarNotificacion("🛠️ Falla reportada", "advertencia", {
    detalle: "El taxi quedó bloqueado hasta revisión del administrador."
  });
}

function escucharEstadoConductor() {
  if (unsubEstado) unsubEstado();
  unsubEstado = onSnapshot(doc(db, "telemetria", uidConductor), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    nombreConductor = data.nombre || nombreConductor;
    bloqueado = Boolean(data.bloqueado);

    if (!modoAdminVista && bloqueadoAnterior !== null && bloqueado !== bloqueadoAnterior) {
      if (bloqueado) {
        mostrarNotificacion("⛔ Has sido bloqueado", "error", {
          detalle: "El administrador revisará la auditoría."
        });
      } else {
        mostrarNotificacion("✅ Has sido desbloqueado", "exito", {
          detalle: "Puedes volver a activar el GPS."
        });
      }
    }
    bloqueadoAnterior = bloqueado;

    if (Number.isFinite(numeroCoordenada(data.latitud)) && Number.isFinite(numeroCoordenada(data.longitud))) {
      if (!marcadorPropio) {
        marcadorPropio = L.marker([data.latitud, data.longitud], { icon: iconoCarro }).addTo(map).bindPopup(nombreConductor);
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
    const etapaCambio = !viajeActual || viajeActual.estado !== data.estado || viajePendienteId !== id;
    viajePendienteId = id;
    viajeActual = data;
    montoEspera = data.deuda_espera || 0;
    dibujarViaje(data, etapaCambio);
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
      if (etapaCambio) {
        mostrarNotificacion("👤 Nueva solicitud", "info", {
          detalle: `${data.cliente_nombre} está esperando tu respuesta. Destino: ${data.destino_nombre || "sin nombre"}.`,
          clave: `conductor:solicitud:${id}`
        });
      }

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
  const id = viajePendienteId;
  await updateDoc(doc(db, "viajes", id), {
    estado: "conductor_en_camino",
    conductor_nombre: nombreConductor,
    conductor_id: uidConductor,
    aceptado_en: new Date().toISOString()
  });
  mostrarNotificacion("✅ Viaje aceptado", "exito", {
    detalle: "Dirígete al origen del pasajero.",
    clave: `conductor:aceptado:${id}`
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

  mostrarNotificacion("📍 Llegada al origen registrada", "info", {
    detalle: "10 s de cortesía. Después se cobran 2 Bs cada 5 s."
  });
  timerCortesia = setTimeout(() => {
    mostrarNotificacion("💳 Comenzó el cobro de espera", "advertencia", {
      detalle: "2 Bs cada 5 segundos."
    });
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
  mostrarNotificacion("👤 Pasajero a bordo", "exito", {
    detalle: "Viaje iniciado. Dirígete al destino."
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
  mostrarNotificacion("🏁 Viaje finalizado", "exito", {
    detalle: `Deuda de espera: ${montoEspera} Bs.`
  });
}

async function cerrarSesion() {
  detenerCobroEspera();
  if (unsubViajes) unsubViajes();
  if (unsubEstado) unsubEstado();

  if (modoAdminVista) {
    redirigirPorRol(ROL.ADMIN);
    return;
  }

  await detenerGps();
  await signOut(auth);
}

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
    location.replace(urlModulo("personal"));
    return;
  }

  const perfil = await asegurarPerfil(user);
  if (!perfil || perfil.activo === false) {
    try { await signOut(auth); } catch (error) { console.error(error); }
    location.replace(urlModulo("personal"));
    return;
  }

  const uidParam = new URLSearchParams(location.search).get("uid");

  if (perfil.rol === ROL.ADMIN) {
    if (!uidParam) {
      redirigirPorRol(ROL.ADMIN);
      return;
    }
    const snap = await getDoc(doc(db, "telemetria", uidParam));
    if (!snap.exists()) {
      redirigirPorRol(ROL.ADMIN);
      return;
    }
    uidConductor = uidParam;
    nombreConductor = snap.data().nombre || nombreConductor;
    emailConductor = "Vista de solo lectura";
    mostrarApp();
    configurarVistaAdmin();
    escucharEstadoConductor();
    escucharViajes();
    return;
  }

  if (perfil.rol !== ROL.CONDUCTOR) {
    try { await signOut(auth); } catch (error) { console.error(error); }
    location.replace(urlModulo("personal"));
    return;
  }

  uidConductor = user.uid;
  nombreConductor = perfil.nombre || "Conductor";
  emailConductor = perfil.email || "";
  modoAdminVista = false;
  mostrarApp();
  escucharEstadoConductor();
  escucharViajes();
});

import { clienteDb, clienteAuth } from "./firebase-config.js";
import { calcularDistancia, lecturaReciente } from "./utils.js";
import { crearRutaThrottled } from "./rutas.js";
import { iconoCarro, iconoPersona, iconoDestino } from "./map-icons.js";
import { mostrarNotificacion } from "./notificaciones.js";
import { doc, setDoc, onSnapshot, collection } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import {
  signInAnonymously, onAuthStateChanged, signOut,
  setPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";

function escapar(valor) {
  return String(valor == null ? "" : valor)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Acepta 0 como coordenada valida. Solo null/undefined/vacio o no numerico es invalido.
function numeroCoordenada(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

let usuarioCliente = null;
let origenCliente = { lat: -17.7833, lng: -63.1821 };
let destinoViaje = null;
let destinoNombre = "";
let modoElegirDestino = false;
let viajeClienteActual = null;
let conductorAsignadoUid = null;
let unsubViajeCliente = null;
const flota = {};
const marcadoresVehiculos = {};

const map = L.map("map").setView([origenCliente.lat, origenCliente.lng], 14);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

const marcadorCliente = L.marker([origenCliente.lat, origenCliente.lng], { icon: iconoPersona }).addTo(map).bindPopup("Tu ubicación");
let marcadorDestino = null;
let lineaRuta = null;
let estadoViajeCliente = null;

const rutaThrottled = crearRutaThrottled(12000);

// Predicado unico de disponibilidad: conectado, operativo, sin bloqueo,
// con posicion valida y lectura GPS reciente (<= 20 s).
function conductorDisponible(c) {
  return c.conectado === true
    && c.estado_operativo === true
    && c.bloqueado !== true
    && Number.isFinite(c.lat) && Number.isFinite(c.lng)
    && lecturaReciente(c.actualizado_en, 20000);
}

function mostrarEstado(texto, tipo = "") {
  const caja = document.getElementById("clienteStatus");
  caja.textContent = texto;
  caja.className = `estado ${tipo}`.trim();
}

// Puntos [inicio, fin] de la ruta del cliente segun el estado del viaje.
// previo/buscando/rechazado: origen -> destino.
// conductor_en_camino: posicion del conductor -> origen (va a buscar al pasajero).
// en_viaje: posicion del conductor -> destino. en_espera: origen -> destino.
function puntosRutaCliente() {
  const conductor = conductorAsignadoUid ? flota[conductorAsignadoUid] : null;
  const posCarro = conductor
    && Number.isFinite(conductor.lat)
    && Number.isFinite(conductor.lng)
    ? { lat: conductor.lat, lng: conductor.lng }
    : null;

  if (estadoViajeCliente === "conductor_en_camino" && posCarro && origenCliente) {
    return [posCarro, origenCliente];
  }
  if (estadoViajeCliente === "en_viaje" && posCarro && destinoViaje) {
    return [posCarro, destinoViaje];
  }
  if (origenCliente && destinoViaje) {
    return [origenCliente, destinoViaje];
  }
  return null;
}

function limpiarRutaCliente() {
  if (lineaRuta) {
    map.removeLayer(lineaRuta);
    lineaRuta = null;
  }
}

async function actualizarRuta(forzar = false) {
  if (!origenCliente) return;

  const puntos = puntosRutaCliente();
  if (!puntos) return;

  // El marcador de destino se mantiene visible mientras exista un destino.
  if (destinoViaje) {
    if (!marcadorDestino) {
      marcadorDestino = L.marker([destinoViaje.lat, destinoViaje.lng], { icon: iconoDestino }).addTo(map).bindPopup("Destino");
    } else {
      marcadorDestino.setLatLng([destinoViaje.lat, destinoViaje.lng]);
    }
  }

  const puntosLeaflet = puntos.map((p) => [p.lat, p.lng]);
  const geometria = await rutaThrottled(puntos, forzar);

  if (geometria === undefined) {
    // Throttled: conservar la linea actual; si aun no existe, trazar la recta.
    if (!lineaRuta) lineaRuta = L.polyline(puntosLeaflet, { weight: 3 }).addTo(map);
    return;
  }

  const coordenadas = (geometria && geometria.length >= 2) ? geometria : puntosLeaflet;
  limpiarRutaCliente();
  lineaRuta = L.polyline(coordenadas, { weight: 3 }).addTo(map);
}

function setDestino(coords, nombre = "") {
  destinoViaje = coords;
  destinoNombre = nombre || `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
  actualizarRuta(true);
  map.panTo([coords.lat, coords.lng]);

  const info = document.getElementById("destinoInfo");
  info.textContent = `Destino: ${destinoNombre}`;
  info.classList.remove("oculto");
}

async function buscarDestino() {
  const texto = document.getElementById("destinoCliente").value.trim();
  if (!texto) return alert("Escribe una dirección o lugar.");

  const boton = document.getElementById("btnBuscarDestino");
  boton.disabled = true;
  boton.textContent = "Buscando...";

  try {
    const respuesta = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(texto)}`);
    const datos = await respuesta.json();
    if (!datos.length) return alert("No se encontró ese lugar.");

    setDestino({
      lat: Number(datos[0].lat),
      lng: Number(datos[0].lon)
    }, datos[0].display_name);
  } catch (error) {
    console.error(error);
    alert("No se pudo buscar el destino.");
  } finally {
    boton.disabled = false;
    boton.textContent = "Buscar";
  }
}

function elegirDestinoEnMapa() {
  modoElegirDestino = !modoElegirDestino;
  document.getElementById("btnElegirMapa").textContent = modoElegirDestino ? "Haz clic en el mapa" : "Elegir en mapa";
}

map.on("click", (evento) => {
  if (!modoElegirDestino) return;
  setDestino({ lat: evento.latlng.lat, lng: evento.latlng.lng });
  modoElegirDestino = false;
  document.getElementById("btnElegirMapa").textContent = "Elegir en mapa";
});

function actualizarUbicacionCliente() {
  if (!navigator.geolocation) return alert("Este dispositivo no permite obtener ubicación.");

  document.getElementById("btnUbicacion").textContent = "Buscando ubicación...";
  navigator.geolocation.getCurrentPosition((posicion) => {
    origenCliente = {
      lat: posicion.coords.latitude,
      lng: posicion.coords.longitude
    };
    marcadorCliente.setLatLng([origenCliente.lat, origenCliente.lng]);
    map.setView([origenCliente.lat, origenCliente.lng], 15);
    actualizarRuta(false);
    renderListaChoferes();
    document.getElementById("btnUbicacion").textContent = "Ubicación actualizada";
  }, () => {
    document.getElementById("btnUbicacion").textContent = "Usar mi ubicación actual";
    mostrarNotificacion("No se pudo obtener tu ubicación.", "error", {
      detalle: "Revisa los permisos de GPS del navegador."
    });
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
}

function renderListaChoferes() {
  const caja = document.getElementById("listaChoferes");
  const lista = document.getElementById("choferesList");

  if (conductorAsignadoUid) {
    caja.classList.add("oculto");
    lista.innerHTML = "";
    return;
  }

  const disponibles = Object.entries(flota)
    .filter(([, conductor]) => conductorDisponible(conductor))
    .map(([uid, conductor]) => ({
      uid,
      ...conductor,
      distancia: Number.isFinite(conductor.lat) && Number.isFinite(conductor.lng)
        ? calcularDistancia(origenCliente.lat, origenCliente.lng, conductor.lat, conductor.lng)
        : null
    }))
    .sort((a, b) => {
      if (a.distancia === null) return 1;
      if (b.distancia === null) return -1;
      return a.distancia - b.distancia;
    });

  if (!disponibles.length) {
    caja.classList.add("oculto");
    lista.innerHTML = "";
    return;
  }

  caja.classList.remove("oculto");
  lista.innerHTML = disponibles.map((conductor) => `
    <div class="item-lista">
      <strong>${escapar(conductor.nombre || "Conductor")}</strong>
      ${conductor.distancia !== null ? `${conductor.distancia.toFixed(1)} km de distancia` : "GPS todavía sin lectura"}
      <button data-uid="${conductor.uid}">Elegir</button>
    </div>
  `).join("");

  lista.querySelectorAll("button[data-uid]").forEach((boton) => {
    boton.addEventListener("click", () => elegirConductor(boton.dataset.uid));
  });
}

function solicitarViaje() {
  const nombre = document.getElementById("nombreCliente").value.trim();
  const hora = document.getElementById("horaDestino").value;

  if (!nombre) return alert("Ingresa tu nombre.");
  if (!hora) return alert("Ingresa la hora límite.");
  if (!destinoViaje) return alert("Primero selecciona el destino.");
  if (viajeClienteActual) return alert("Ya tienes un viaje solicitado.");

  const cantidad = Object.values(flota).filter(conductorDisponible).length;
  if (!cantidad) {
    mostrarEstado("No hay conductores disponibles en este momento.", "error");
    mostrarNotificacion("No hay conductores disponibles por ahora.", "advertencia", {
      detalle: "Intenta de nuevo en unos segundos."
    });
    return;
  }

  mostrarEstado(`Hay ${cantidad} conductor(es) disponible(s). Elige uno de la lista.`);
  mostrarNotificacion("🔎 Buscando conductores disponibles...", "info", {
    detalle: `${cantidad} conductor(es) cerca.`
  });
  renderListaChoferes();
}

async function elegirConductor(uid) {
  const nombre = document.getElementById("nombreCliente").value.trim();
  const hora = document.getElementById("horaDestino").value;
  const conductor = flota[uid];

  if (!usuarioCliente) return alert("La sesión del cliente todavía no está lista.");
  if (!nombre || !hora || !destinoViaje) return alert("Completa nombre, hora y destino.");
  if (!conductor || !conductorDisponible(conductor)) return alert("Ese conductor ya no está disponible.");

  const viajeId = `viaje_${Date.now()}_${uid}`;
  viajeClienteActual = viajeId;
  conductorAsignadoUid = uid; renderMarcadores();
  document.getElementById("listaChoferes").classList.add("oculto");
  mostrarEstado(`Solicitud enviada a ${conductor.nombre}. Esperando respuesta...`);
  mostrarNotificacion(`Solicitud enviada a ${conductor.nombre}.`, "info", {
    detalle: "Esperando respuesta del conductor...",
    clave: `cliente:solicitud:${viajeId}`
  });

  await setDoc(doc(clienteDb, "viajes", viajeId), {
    cliente_uid: usuarioCliente.uid,
    cliente_nombre: nombre,
    conductor_asignado: uid,
    estado: "buscando_conductor",
    origen: origenCliente,
    destino: destinoViaje,
    destino_nombre: destinoNombre,
    hora_limite: hora,
    deuda_espera: 0,
    creado_en: new Date().toISOString()
  });

  if (unsubViajeCliente) unsubViajeCliente();
  unsubViajeCliente = onSnapshot(doc(clienteDb, "viajes", viajeId), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    // Los avisos y el recalculo forzado de la ruta solo corren en una transicion
    // real de estado. Durante "en_espera" el cobro reescribe deuda_espera cada 5 s
    // y el onSnapshot vuelve a dispararse: sin esta guarda el toast y OSRM se repetirian.
    const cambioEstado = estadoViajeCliente !== data.estado;
    estadoViajeCliente = data.estado;

    if (data.estado === "buscando_conductor") {
      // Antes de que el conductor acepte: ruta normal origen -> destino.
      if (cambioEstado) actualizarRuta(true);
    } else if (data.estado === "conductor_en_camino") {
      mostrarEstado(`${data.conductor_nombre || "El conductor"} aceptó el viaje y va hacia tu ubicación.`, "ok");
      if (cambioEstado) {
        mostrarNotificacion(`🚕 ${data.conductor_nombre || "El conductor"} aceptó tu viaje`, "exito", {
          detalle: "Va en camino a buscarte.",
          clave: `cliente:aceptado:${viajeId}`
        });
        actualizarRuta(true);
      }
    } else if (data.estado === "en_espera") {
      mostrarEstado(`El conductor llegó. Deuda por espera: ${data.deuda_espera || 0} Bs.`, "ok");
      if (cambioEstado) {
        mostrarNotificacion("📍 El conductor llegó a tu ubicación.", "info", {
          detalle: `Deuda por espera: ${data.deuda_espera || 0} Bs.`,
          clave: `cliente:llego:${viajeId}`
        });
        actualizarRuta(true);
      }
    } else if (data.estado === "en_viaje") {
      mostrarEstado(`Viaje iniciado. Deuda de espera: ${data.deuda_espera || 0} Bs.`, "ok");
      if (cambioEstado) {
        mostrarNotificacion("🛣️ Tu viaje ha comenzado.", "exito", {
          detalle: `Deuda de espera: ${data.deuda_espera || 0} Bs.`,
          clave: `cliente:inicio:${viajeId}`
        });
        actualizarRuta(true);
      }
    } else if (data.estado === "finalizado") {
      mostrarEstado(`Viaje finalizado. Deuda de espera: ${data.deuda_espera || 0} Bs.`, "ok");
      if (cambioEstado) {
        mostrarNotificacion("🏁 Viaje finalizado.", "exito", {
          detalle: `Deuda de espera: ${data.deuda_espera || 0} Bs.`,
          clave: `cliente:fin:${viajeId}`
        });
        limpiarRutaCliente();
        viajeClienteActual = null;
        conductorAsignadoUid = null; renderMarcadores();
      }
    } else if (data.estado === "rechazado_por_tiempo") {
      mostrarEstado("El conductor no respondió a tiempo. Puedes elegir otro.", "error");
      if (cambioEstado) {
        mostrarNotificacion("El conductor no respondió a tiempo.", "advertencia", {
          detalle: "Puedes elegir otro conductor.",
          clave: `cliente:rechazo-tiempo:${viajeId}`
        });
        viajeClienteActual = null;
        conductorAsignadoUid = null; renderMarcadores();
        renderListaChoferes();
        actualizarRuta(true);
      }
    } else if (data.estado === "rechazado_por_bloqueo") {
      mostrarEstado("El conductor fue bloqueado. Puedes elegir otro.", "error");
      if (cambioEstado) {
        mostrarNotificacion("El conductor ya no está disponible.", "advertencia", {
          detalle: "Puedes elegir otro conductor.",
          clave: `cliente:rechazo-bloqueo:${viajeId}`
        });
        viajeClienteActual = null;
        conductorAsignadoUid = null; renderMarcadores();
        renderListaChoferes();
        actualizarRuta(true);
      }
    }

    actualizarVisibilidadCliente();
  });
}

// Representacion tipo Uber/Yango: la persona (origen propio) solo se oculta
// cuando el pasajero ya esta a bordo (en_viaje); en ese momento queda carro + destino.
function actualizarVisibilidadCliente() {
  if (!marcadorCliente) return;
  const enViaje = estadoViajeCliente === "en_viaje";
  const visible = map.hasLayer(marcadorCliente);
  if (enViaje && visible) map.removeLayer(marcadorCliente);
  if (!enViaje && !visible) marcadorCliente.addTo(map);
}

function renderMarcadores() {
  const visibles = {};
  if (conductorAsignadoUid && flota[conductorAsignadoUid]) {
    visibles[conductorAsignadoUid] = flota[conductorAsignadoUid];
  } else if (!conductorAsignadoUid) {
    for (const [uid, c] of Object.entries(flota)) visibles[uid] = c;
  }

  for (const uid of Object.keys(marcadoresVehiculos)) {
    const c = visibles[uid];
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) {
      map.removeLayer(marcadoresVehiculos[uid]);
      delete marcadoresVehiculos[uid];
    }
  }

  for (const [uid, c] of Object.entries(visibles)) {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
    if (!marcadoresVehiculos[uid]) {
      marcadoresVehiculos[uid] = L.marker([c.lat, c.lng], { icon: iconoCarro }).addTo(map);
    } else {
      marcadoresVehiculos[uid].setLatLng([c.lat, c.lng]);
    }
    const etiqueta = conductorAsignadoUid === uid
      ? "Tu conductor"
      : c.estado_operativo ? "Disponible" : "No disponible";
    marcadoresVehiculos[uid].bindPopup(`${escapar(c.nombre || "Conductor")}<br>${etiqueta}`);
  }
}

function escucharFlota() {
  onSnapshot(collection(clienteDb, "flota_publica"), (snapshot) => {
    snapshot.docChanges().forEach((cambio) => {
      const uid = cambio.doc.id;
      const data = cambio.doc.data();

      if (cambio.type === "removed") {
        delete flota[uid];
        return;
      }

      flota[uid] = {
        nombre: data.nombre || "Conductor",
        lat: numeroCoordenada(data.latitud),
        lng: numeroCoordenada(data.longitud),
        estado_operativo: Boolean(data.estado_operativo),
        bloqueado: Boolean(data.bloqueado),
        conectado: Boolean(data.conectado),
        actualizado_en: data.actualizado_en
      };
    });
    renderMarcadores();
    renderListaChoferes();

    // Si se movio el conductor asignado y hay una ruta activa, refrescarla
    // (el throttle de OSRM evita consultar en cada lectura GPS de 4 s).
    if (conductorAsignadoUid
      && (estadoViajeCliente === "conductor_en_camino" || estadoViajeCliente === "en_viaje")) {
      actualizarRuta(false);
    }
  }, (error) => {
    console.error(error);
    mostrarEstado("No se pudo leer la flota. Revisa Firebase y las reglas de Firestore.", "error");
    mostrarNotificacion("No se pudo leer la flota.", "error", {
      detalle: "Revisa Firebase y las reglas de Firestore.",
      clave: "cliente:error-flota"
    });
  });
}

document.getElementById("btnBuscarDestino").addEventListener("click", buscarDestino);
document.getElementById("btnElegirMapa").addEventListener("click", elegirDestinoEnMapa);
document.getElementById("btnUbicacion").addEventListener("click", actualizarUbicacionCliente);
document.getElementById("btnSolicitar").addEventListener("click", solicitarViaje);

let flotaIniciada = false;

async function prepararVistaCliente(user) {
  if (!user) {
    try {
      await signInAnonymously(clienteAuth);
    } catch (error) {
      console.error(error);
      mostrarEstado("No se pudo iniciar la sesión anónima del cliente.", "error");
      mostrarNotificacion("No se pudo iniciar la sesión del cliente.", "error", {
        detalle: "Revisa la conexión con Firebase.",
        clave: "cliente:error-sesion"
      });
    }
    return;
  }

  if (!user.isAnonymous) {
    // Defensivo: en esta app el cliente siempre es anónimo. Nunca redirige.
    try {
      await signOut(clienteAuth);
      await signInAnonymously(clienteAuth);
    } catch (error) {
      console.error(error);
      mostrarEstado("No se pudo iniciar la sesión anónima del cliente.", "error");
      mostrarNotificacion("No se pudo iniciar la sesión del cliente.", "error", {
        detalle: "Revisa la conexión con Firebase.",
        clave: "cliente:error-sesion"
      });
    }
    return;
  }

  usuarioCliente = user;
  if (!flotaIniciada) {
    flotaIniciada = true;
    escucharFlota();
  }
}

try {
  await setPersistence(clienteAuth, browserSessionPersistence);
} catch (error) {
  console.error(error);
}
onAuthStateChanged(clienteAuth, prepararVistaCliente);

import { db, auth } from "./firebase-config.js";
import { calcularDistancia } from "./utils.js";
import { ROL, asegurarPerfil, redirigirPorRol } from "./auth-roles.js";
import { doc, setDoc, onSnapshot, collection } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import { signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";

function escapar(valor) {
  return String(valor == null ? "" : valor)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

const marcadorCliente = L.marker([origenCliente.lat, origenCliente.lng]).addTo(map).bindPopup("Tu ubicación");
let marcadorDestino = null;
let lineaRuta = null;

function mostrarEstado(texto, tipo = "") {
  const caja = document.getElementById("clienteStatus");
  caja.textContent = texto;
  caja.className = `estado ${tipo}`.trim();
}

function actualizarRuta() {
  if (!destinoViaje) return;

  if (!marcadorDestino) {
    marcadorDestino = L.marker([destinoViaje.lat, destinoViaje.lng]).addTo(map).bindPopup("Destino");
  } else {
    marcadorDestino.setLatLng([destinoViaje.lat, destinoViaje.lng]);
  }

  if (lineaRuta) map.removeLayer(lineaRuta);
  lineaRuta = L.polyline([
    [origenCliente.lat, origenCliente.lng],
    [destinoViaje.lat, destinoViaje.lng]
  ], { weight: 3 }).addTo(map);
}

function setDestino(coords, nombre = "") {
  destinoViaje = coords;
  destinoNombre = nombre || `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
  actualizarRuta();
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
    actualizarRuta();
    renderListaChoferes();
    document.getElementById("btnUbicacion").textContent = "Ubicación actualizada";
  }, () => {
    document.getElementById("btnUbicacion").textContent = "Usar mi ubicación actual";
    alert("Debes permitir el acceso a la ubicación.");
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
    .filter(([, conductor]) => conductor.estado_operativo && !conductor.bloqueado)
    .map(([uid, conductor]) => ({
      uid,
      ...conductor,
      distancia: conductor.lat && conductor.lng
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

  const cantidad = Object.values(flota).filter((x) => x.estado_operativo && !x.bloqueado).length;
  if (!cantidad) {
    mostrarEstado("No hay conductores disponibles en este momento.", "error");
    return;
  }

  mostrarEstado(`Hay ${cantidad} conductor(es) disponible(s). Elige uno de la lista.`);
  renderListaChoferes();
}

async function elegirConductor(uid) {
  const nombre = document.getElementById("nombreCliente").value.trim();
  const hora = document.getElementById("horaDestino").value;
  const conductor = flota[uid];

  if (!usuarioCliente) return alert("La sesión del cliente todavía no está lista.");
  if (!nombre || !hora || !destinoViaje) return alert("Completa nombre, hora y destino.");
  if (!conductor || !conductor.estado_operativo || conductor.bloqueado) return alert("Ese conductor ya no está disponible.");

  const viajeId = `viaje_${Date.now()}_${uid}`;
  viajeClienteActual = viajeId;
  conductorAsignadoUid = uid; renderMarcadores();
  document.getElementById("listaChoferes").classList.add("oculto");
  mostrarEstado(`Solicitud enviada a ${conductor.nombre}. Esperando respuesta...`);

  await setDoc(doc(db, "viajes", viajeId), {
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
  unsubViajeCliente = onSnapshot(doc(db, "viajes", viajeId), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();

    if (data.estado === "conductor_en_camino") {
      mostrarEstado(`${data.conductor_nombre || "El conductor"} aceptó el viaje y va hacia tu ubicación.`, "ok");
    } else if (data.estado === "en_espera") {
      mostrarEstado(`El conductor llegó. Deuda por espera: ${data.deuda_espera || 0} Bs.`, "ok");
    } else if (data.estado === "en_viaje") {
      mostrarEstado(`Viaje iniciado. Deuda de espera: ${data.deuda_espera || 0} Bs.`, "ok");
    } else if (data.estado === "finalizado") {
      mostrarEstado(`Viaje finalizado. Deuda de espera: ${data.deuda_espera || 0} Bs.`, "ok");
      viajeClienteActual = null;
      conductorAsignadoUid = null; renderMarcadores();
    } else if (data.estado === "rechazado_por_tiempo") {
      mostrarEstado("El conductor no respondió a tiempo. Puedes elegir otro.", "error");
      viajeClienteActual = null;
      conductorAsignadoUid = null; renderMarcadores();
      renderListaChoferes();
    } else if (data.estado === "rechazado_por_bloqueo") {
      mostrarEstado("El conductor fue bloqueado. Puedes elegir otro.", "error");
      viajeClienteActual = null;
      conductorAsignadoUid = null; renderMarcadores();
      renderListaChoferes();
    }
  });
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
    if (!c || !c.lat || !c.lng) {
      map.removeLayer(marcadoresVehiculos[uid]);
      delete marcadoresVehiculos[uid];
    }
  }

  for (const [uid, c] of Object.entries(visibles)) {
    if (!c.lat || !c.lng) continue;
    if (!marcadoresVehiculos[uid]) {
      marcadoresVehiculos[uid] = L.marker([c.lat, c.lng]).addTo(map);
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
  onSnapshot(collection(db, "flota_publica"), (snapshot) => {
    snapshot.docChanges().forEach((cambio) => {
      const uid = cambio.doc.id;
      const data = cambio.doc.data();

      if (cambio.type === "removed") {
        delete flota[uid];
        return;
      }

      flota[uid] = {
        nombre: data.nombre || "Conductor",
        lat: data.latitud || null,
        lng: data.longitud || null,
        estado_operativo: Boolean(data.estado_operativo),
        bloqueado: Boolean(data.bloqueado)
      };
    });
    renderMarcadores();
    renderListaChoferes();
  }, (error) => {
    console.error(error);
    mostrarEstado("No se pudo leer la flota. Revisa Firebase y las reglas de Firestore.", "error");
  });
}

document.getElementById("btnBuscarDestino").addEventListener("click", buscarDestino);
document.getElementById("btnElegirMapa").addEventListener("click", elegirDestinoEnMapa);
document.getElementById("btnUbicacion").addEventListener("click", actualizarUbicacionCliente);
document.getElementById("btnSolicitar").addEventListener("click", solicitarViaje);

let flotaIniciada = false;

async function prepararVistaCliente(user) {
  if (user && !user.isAnonymous) {
    const perfil = await asegurarPerfil(user);
    if (perfil && perfil.activo !== false && (perfil.rol === ROL.ADMIN || perfil.rol === ROL.CONDUCTOR)) {
      redirigirPorRol(perfil.rol);
      return;
    }
    // Cuenta autenticada sin rol válido: no entra como cliente.
    await signOut(auth);
    return;
  }

  if (user?.isAnonymous) {
    usuarioCliente = user;
    if (!flotaIniciada) {
      flotaIniciada = true;
      escucharFlota();
    }
    return;
  }

  try {
    await signInAnonymously(auth);
  } catch (error) {
    console.error(error);
    mostrarEstado("No se pudo iniciar la sesión anónima del cliente.", "error");
  }
}

onAuthStateChanged(auth, prepararVistaCliente);

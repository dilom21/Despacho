import { db, auth } from "./firebase-config.js";
import { ROL, urlModulo, asegurarPerfil, redirigirPorRol } from "./auth-roles.js";
import { calcularDistancia, horaLocal } from "./utils.js";
import {
  collection, doc, onSnapshot, setDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import {
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";

const UMBRAL_DESVIOS = 3;
const flota = {};
const viajesPorConductor = {};
const marcadores = {};
const distanciasAnteriores = {};
const conteoDesvios = {};
let unsubFlota = null;
let unsubViajes = null;
let unsubAuditorias = null;

const map = L.map("map").setView([-17.7833, -63.1821], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

function mostrarApp() {
  document.getElementById("appVista").style.display = "grid";
  setTimeout(() => map.invalidateSize(), 100);
}

function esViajeActivo(estado) {
  return ["buscando_conductor", "conductor_en_camino", "en_espera", "en_viaje"].includes(estado);
}

function renderConductores() {
  const caja = document.getElementById("conductoresLista");
  const registros = Object.entries(flota);

  document.getElementById("resumen").textContent =
    `Conductores registrados: ${registros.length}. GPS activos: ${registros.filter(([, d]) => d.estado_operativo).length}.`;

  if (!registros.length) {
    caja.innerHTML = '<div class="item-lista">No hay conductores registrados.</div>';
    return;
  }

  caja.innerHTML = registros.map(([uid, conductor]) => {
    const viaje = viajesPorConductor[uid];
    const gps = conductor.lat && conductor.lng
      ? `${conductor.lat.toFixed(5)}, ${conductor.lng.toFixed(5)}`
      : "sin lectura";

    return `
      <div class="item-lista">
        <strong>${conductor.nombre || "Conductor"}</strong>
        Estado: ${conductor.bloqueado ? "BLOQUEADO" : conductor.estado_operativo ? "GPS activo" : "GPS apagado"}<br>
        Posición: ${gps}<br>
        Precisión: ${conductor.precision ? `±${conductor.precision} m` : "sin dato"}<br>
        Última lectura: ${horaLocal(conductor.actualizado_en)}<br>
        Fuente GPS: ${conductor.fuente_gps || "sin dato"}
        ${viaje ? `<br>Viaje: ${viaje.estado} - ${viaje.cliente || "cliente"}<br>Espera: ${viaje.deuda_espera || 0} Bs.` : ""}
        <br><button data-ver-conductor="${uid}">Ver vista conductor</button>
        ${conductor.bloqueado ? `<button data-desbloquear="${uid}">Desbloquear</button>` : ""}
      </div>
    `;
  }).join("");

  caja.querySelectorAll("button[data-ver-conductor]").forEach((boton) => {
    boton.addEventListener("click", () => {
      location.href = `../conductor/?uid=${encodeURIComponent(boton.dataset.verConductor)}`;
    });
  });

  caja.querySelectorAll("button[data-desbloquear]").forEach((boton) => {
    boton.addEventListener("click", () => desbloquearConductor(boton.dataset.desbloquear));
  });
}

async function revisarDesvio(uid, conductor) {
  const viaje = viajesPorConductor[uid];
  if (!viaje || viaje.estado !== "en_viaje" || !viaje.destino || !conductor.lat || !conductor.lng) {
    delete distanciasAnteriores[uid];
    conteoDesvios[uid] = 0;
    return;
  }

  const distancia = calcularDistancia(
    conductor.lat,
    conductor.lng,
    viaje.destino.lat,
    viaje.destino.lng
  );

  const anterior = distanciasAnteriores[uid];
  if (anterior !== undefined && distancia > anterior + 0.1) {
    conteoDesvios[uid] = (conteoDesvios[uid] || 0) + 1;
    const cantidad = conteoDesvios[uid];
    const alerta = document.getElementById("alertaDesvio");
    alerta.classList.remove("oculto");
    alerta.textContent = `Posible desvío de ${conductor.nombre}. Detección ${cantidad}/${UMBRAL_DESVIOS}.`;

    if (cantidad >= UMBRAL_DESVIOS && !conductor.bloqueado) {
      await setDoc(doc(db, "auditorias_desvios", `alerta_${uid}_${Date.now()}`), {
        conductor_id: uid,
        conductor: conductor.nombre,
        lat: conductor.lat,
        lng: conductor.lng,
        fecha: new Date().toISOString(),
        tipo: "desvio"
      });

      await updateDoc(doc(db, "telemetria", uid), {
        bloqueado: true,
        estado_operativo: false
      });

      // Refleja el bloqueo en el espejo publico aunque el conductor este offline.
      await setDoc(doc(db, "flota_publica", uid), {
        conductor_uid: uid,
        nombre: conductor.nombre,
        bloqueado: true,
        estado_operativo: false
      }, { merge: true }).catch((error) => console.error(error));

      if (viaje.viajeId) {
        await updateDoc(doc(db, "viajes", viaje.viajeId), { estado: "rechazado_por_bloqueo" });
      }
      conteoDesvios[uid] = 0;
    }
  } else {
    conteoDesvios[uid] = 0;
  }

  distanciasAnteriores[uid] = distancia;
}

function escucharFlota() {
  if (unsubFlota) unsubFlota();
  unsubFlota = onSnapshot(collection(db, "telemetria"), (snapshot) => {
    snapshot.docChanges().forEach(async (cambio) => {
      const uid = cambio.doc.id;
      const data = cambio.doc.data();

      if (cambio.type === "removed") {
        delete flota[uid];
        if (marcadores[uid]) map.removeLayer(marcadores[uid]);
        delete marcadores[uid];
        return;
      }

      const conductor = {
        nombre: data.nombre || "Conductor",
        lat: data.latitud || null,
        lng: data.longitud || null,
        precision: data.precision || null,
        actualizado_en: data.actualizado_en || null,
        fuente_gps: data.fuente_gps || null,
        estado_operativo: Boolean(data.estado_operativo),
        bloqueado: Boolean(data.bloqueado)
      };
      flota[uid] = conductor;

      if (conductor.lat && conductor.lng) {
        if (!marcadores[uid]) {
          marcadores[uid] = L.marker([conductor.lat, conductor.lng]).addTo(map);
        } else {
          marcadores[uid].setLatLng([conductor.lat, conductor.lng]);
        }
        marcadores[uid].bindPopup(`${conductor.nombre}<br>${conductor.estado_operativo ? "GPS activo" : "GPS apagado"}`);
      }

      await revisarDesvio(uid, conductor);
    });
    renderConductores();
  });
}

function escucharViajes() {
  if (unsubViajes) unsubViajes();
  unsubViajes = onSnapshot(collection(db, "viajes"), (snapshot) => {
    snapshot.docChanges().forEach((cambio) => {
      const data = cambio.doc.data();
      const uid = data.conductor_id || data.conductor_asignado;
      if (!uid) return;

      if (cambio.type === "removed" || !esViajeActivo(data.estado)) {
        delete viajesPorConductor[uid];
      } else {
        viajesPorConductor[uid] = {
          viajeId: cambio.doc.id,
          estado: data.estado,
          cliente: data.cliente_nombre,
          destino: data.destino || null,
          destino_nombre: data.destino_nombre || null,
          deuda_espera: data.deuda_espera || 0
        };
      }
    });
    renderConductores();
  });
}

function escucharAuditorias() {
  if (unsubAuditorias) unsubAuditorias();
  unsubAuditorias = onSnapshot(collection(db, "auditorias_desvios"), (snapshot) => {
    const lista = snapshot.docs
      .map((d) => d.data())
      .sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")))
      .slice(0, 8);

    document.getElementById("auditoriasLista").innerHTML = lista.length
      ? lista.map((x) => `
          <div class="item-lista">
            <strong>${x.tipo === "falla_mecanica" ? "Falla mecánica" : "Desvío"}</strong>
            ${x.conductor || "Conductor"}<br>
            ${Number(x.lat || 0).toFixed(5)}, ${Number(x.lng || 0).toFixed(5)}<br>
            ${x.fecha ? new Date(x.fecha).toLocaleString() : "sin fecha"}
          </div>
        `).join("")
      : '<div class="item-lista">No hay auditorías.</div>';
  });
}

async function desbloquearConductor(uid) {
  await updateDoc(doc(db, "telemetria", uid), {
    bloqueado: false,
    estado_operativo: false
  });

  // Refleja el desbloqueo en el espejo publico.
  await setDoc(doc(db, "flota_publica", uid), {
    conductor_uid: uid,
    bloqueado: false,
    estado_operativo: false
  }, { merge: true }).catch((error) => console.error(error));

  const alerta = document.getElementById("alertaDesvio");
  alerta.classList.remove("oculto");
  alerta.textContent = "Conductor desbloqueado. Debe volver a activar el GPS desde su celular.";
}

async function cerrarSesion() {
  if (unsubFlota) unsubFlota();
  if (unsubViajes) unsubViajes();
  if (unsubAuditorias) unsubAuditorias();
  await signOut(auth);
}

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

  if (perfil.rol !== ROL.ADMIN) {
    redirigirPorRol(perfil.rol);
    return;
  }

  mostrarApp();
  escucharViajes();
  escucharFlota();
  escucharAuditorias();
});

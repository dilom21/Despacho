import { db, auth } from "./firebase-config.js";
import { calcularDistancia, horaLocal } from "./utils.js";
import {
  collection, doc, onSnapshot, setDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import {
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
import { ROL, urlModulo, asegurarPerfil, redirigirPorRol } from "./auth-roles.js";
import { iconoCarro } from "./map-icons.js";
import { mostrarNotificacion } from "./notificaciones.js";

const UMBRAL_DESVIOS = 3;
const flota = {};
const viajesPorConductor = {};
const marcadores = {};
const distanciasAnteriores = {};
const conteoDesvios = {};
let todosLosViajes = [];
let usuariosLista = [];
let telemetriaLista = [];
let auditoriasLista = [];
let unsubFlota = null;
let unsubViajes = null;
let unsubAuditorias = null;
let unsubUsuarios = null;
let adminUid = null;
let flotaCargada = false;
let viajesCargados = false;
let auditoriasCargadas = false;
const estadoConductores = {};
const estadosViajes = {};
const avisoEstadoViaje = {
  buscando_conductor: {
    tipo: "info",
    titulo: () => "🆕 Nuevo viaje solicitado",
    detalle: (v) => `${v.cliente_nombre || "Cliente"} -> ${v.destino_nombre || "destino"}`
  },
  conductor_en_camino: {
    tipo: "info",
    titulo: (v) => `🚕 ${v.conductor_nombre || "Conductor"} aceptó un viaje`,
    detalle: (v) => `Cliente: ${v.cliente_nombre || "cliente"}`
  },
  en_viaje: {
    tipo: "exito",
    titulo: () => "🛣️ Viaje iniciado",
    detalle: (v) => `Cliente: ${v.cliente_nombre || "cliente"}`
  },
  finalizado: {
    tipo: "exito",
    titulo: () => "🏁 Viaje finalizado",
    detalle: (v) => `Cliente: ${v.cliente_nombre || "cliente"}`
  },
  rechazado_por_tiempo: {
    tipo: "advertencia",
    titulo: () => "⚠️ Viaje rechazado por tiempo",
    detalle: (v) => `Cliente: ${v.cliente_nombre || "cliente"}`
  },
  rechazado_por_bloqueo: {
    tipo: "advertencia",
    titulo: () => "⚠️ Viaje rechazado por bloqueo",
    detalle: (v) => `Cliente: ${v.cliente_nombre || "cliente"}`
  }
};

// Acepta 0 como coordenada valida. Solo null/undefined/vacio o no numerico es invalido.
function numeroCoordenada(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

const TITULOS = {
  inicio: "Inicio",
  usuarios: "Usuarios",
  roles: "Roles",
  flota: "Conductores / Flota",
  viajes: "Viajes",
  reportes: "Reportes",
  auditorias: "Auditorías"
};

const map = L.map("map").setView([-17.7833, -63.1821], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

function escapar(valor) {
  return String(valor == null ? "" : valor)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function mostrarSeccion(nombre) {
  document.querySelectorAll(".seccion").forEach((s) => s.classList.remove("activa"));
  const seccion = document.getElementById(`seccion-${nombre}`);
  if (seccion) seccion.classList.add("activa");
  document.querySelectorAll(".menu-item[data-seccion]").forEach((b) => {
    b.classList.toggle("activo", b.dataset.seccion === nombre);
  });
  document.getElementById("tituloSeccion").textContent = TITULOS[nombre] || nombre;
  if (nombre === "flota") setTimeout(() => map.invalidateSize(), 100);
}

function mostrarApp() {
  document.getElementById("appVista").style.display = "grid";
  document.getElementById("adminSesion").textContent = auth.currentUser?.email || "";
  setTimeout(() => map.invalidateSize(), 100);
}

function esViajeActivo(estado) {
  return ["buscando_conductor", "conductor_en_camino", "en_espera", "en_viaje"].includes(estado);
}

async function revisarDesvio(uid, conductor) {
  const viaje = viajesPorConductor[uid];
  if (!viaje || viaje.estado !== "en_viaje" || !viaje.destino
    || !Number.isFinite(conductor.lat) || !Number.isFinite(conductor.lng)) {
    delete distanciasAnteriores[uid];
    conteoDesvios[uid] = 0;
    return;
  }

  const distancia = calcularDistancia(conductor.lat, conductor.lng, viaje.destino.lat, viaje.destino.lng);
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

      await updateDoc(doc(db, "telemetria", uid), { bloqueado: true, estado_operativo: false });

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
    telemetriaLista = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    snapshot.docChanges().forEach(async (cambio) => {
      const uid = cambio.doc.id;
      const data = cambio.doc.data();

      if (cambio.type === "removed") {
        delete flota[uid];
        delete estadoConductores[uid];
        if (marcadores[uid]) map.removeLayer(marcadores[uid]);
        delete marcadores[uid];
        return;
      }

      const conductor = {
        nombre: data.nombre || "Conductor",
        lat: numeroCoordenada(data.latitud),
        lng: numeroCoordenada(data.longitud),
        precision: data.precision || null,
        actualizado_en: data.actualizado_en || null,
        fuente_gps: data.fuente_gps || null,
        estado_operativo: Boolean(data.estado_operativo),
        bloqueado: Boolean(data.bloqueado)
      };
      const previo = estadoConductores[uid];
      if (flotaCargada && previo) {
        if (previo.estado_operativo !== conductor.estado_operativo) {
          mostrarNotificacion(
            conductor.estado_operativo
              ? `🟢 ${conductor.nombre} se conectó`
              : `⚪ ${conductor.nombre} se desconectó`,
            conductor.estado_operativo ? "exito" : "info",
            {
              detalle: conductor.estado_operativo ? "GPS activo y operativo." : "GPS inactivo.",
              clave: `admin:gps:${uid}:${conductor.estado_operativo}`
            }
          );
        }
        if (previo.bloqueado !== conductor.bloqueado) {
          mostrarNotificacion(
            conductor.bloqueado
              ? `⛔ ${conductor.nombre} fue bloqueado`
              : `✅ ${conductor.nombre} fue desbloqueado`,
            conductor.bloqueado ? "error" : "exito",
            { clave: `admin:bloqueo:${uid}:${conductor.bloqueado}` }
          );
        }
      }
      estadoConductores[uid] = {
        estado_operativo: conductor.estado_operativo,
        bloqueado: conductor.bloqueado,
        nombre: conductor.nombre
      };

      flota[uid] = conductor;

      if (Number.isFinite(conductor.lat) && Number.isFinite(conductor.lng)) {
        if (!marcadores[uid]) {
          marcadores[uid] = L.marker([conductor.lat, conductor.lng], { icon: iconoCarro }).addTo(map);
        } else {
          marcadores[uid].setLatLng([conductor.lat, conductor.lng]);
        }
        marcadores[uid].bindPopup(`${escapar(conductor.nombre)}<br>${conductor.estado_operativo ? "GPS activo" : "GPS apagado"}`);
      }

      await revisarDesvio(uid, conductor);
    });
    flotaCargada = true;
    renderConductores();
    renderUsuarios();
  }, (error) => {
    console.error(error);
    mostrarNotificacion("No se pudieron cargar los datos de la flota.", "error", {
      clave: "admin:error-flota"
    });
  });
}

function renderConductores() {
  const caja = document.getElementById("conductoresLista");
  const registros = Object.entries(flota);

  document.getElementById("resumen").textContent =
    `Conductores registrados: ${registros.length}. GPS activos: ${registros.filter(([, d]) => d.estado_operativo).length}.`;

  if (!registros.length) {
    caja.innerHTML = '<div class="item-lista">No hay conductores registrados.</div>';
    renderInicio();
    return;
  }

  caja.innerHTML = registros.map(([uid, conductor]) => {
    const viaje = viajesPorConductor[uid];
    const gps = Number.isFinite(conductor.lat) && Number.isFinite(conductor.lng)
      ? `${conductor.lat.toFixed(5)}, ${conductor.lng.toFixed(5)}`
      : "sin lectura";

    return `
      <div class="item-lista">
        <strong>${escapar(conductor.nombre)}</strong>
        Estado: ${conductor.bloqueado ? "BLOQUEADO" : conductor.estado_operativo ? "GPS activo" : "GPS apagado"}<br>
        Posición: ${gps}<br>
        Precisión: ${conductor.precision ? `±${conductor.precision} m` : "sin dato"}<br>
        Última lectura: ${horaLocal(conductor.actualizado_en)}<br>
        Fuente GPS: ${escapar(conductor.fuente_gps || "sin dato")}
        ${viaje ? `<br>Viaje: ${escapar(viaje.estado)} - ${escapar(viaje.cliente || "cliente")}<br>Espera: ${viaje.deuda_espera || 0} Bs.` : ""}
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

  renderInicio();
}

async function desbloquearConductor(uid) {
  await updateDoc(doc(db, "telemetria", uid), { bloqueado: false, estado_operativo: false });
  await setDoc(doc(db, "flota_publica", uid), {
    conductor_uid: uid,
    bloqueado: false,
    estado_operativo: false
  }, { merge: true }).catch((error) => console.error(error));
  const alerta = document.getElementById("alertaDesvio");
  alerta.classList.remove("oculto");
  alerta.textContent = "Conductor desbloqueado. Debe volver a activar el GPS desde su celular.";
  mostrarNotificacion(`✅ ${flota[uid]?.nombre || "Conductor"} fue desbloqueado`, "exito", {
    detalle: "Debe volver a activar el GPS desde su celular.",
    clave: `admin:bloqueo:${uid}:false`
  });
}

function escucharViajes() {
  if (unsubViajes) unsubViajes();
  unsubViajes = onSnapshot(collection(db, "viajes"), (snapshot) => {
    todosLosViajes = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

    const primeraCargaViajes = !viajesCargados;
    viajesCargados = true;
    todosLosViajes.forEach((v) => {
      const previoEstado = estadosViajes[v.id];
      if (!primeraCargaViajes && previoEstado !== v.estado && avisoEstadoViaje[v.estado]) {
        const aviso = avisoEstadoViaje[v.estado];
        mostrarNotificacion(aviso.titulo(v), aviso.tipo, {
          detalle: aviso.detalle(v),
          clave: `admin:viaje:${v.id}:${v.estado}`
        });
      }
      estadosViajes[v.id] = v.estado;
    });

    for (const k of Object.keys(viajesPorConductor)) delete viajesPorConductor[k];
    todosLosViajes.forEach((v) => {
      const uid = v.conductor_id || v.conductor_asignado;
      if (!uid) return;
      if (esViajeActivo(v.estado)) {
        viajesPorConductor[uid] = {
          viajeId: v.id,
          estado: v.estado,
          cliente: v.cliente_nombre,
          destino: v.destino || null,
          destino_nombre: v.destino_nombre || null,
          deuda_espera: v.deuda_espera || 0
        };
      }
    });

    renderConductores();
    renderViajes();
    renderInicio();
    renderReportes();
  }, (error) => {
    console.error(error);
    mostrarNotificacion("No se pudieron cargar los viajes.", "error", { clave: "admin:error-viajes" });
  });
}

function escucharUsuarios() {
  if (unsubUsuarios) unsubUsuarios();
  unsubUsuarios = onSnapshot(collection(db, "usuarios"), (snapshot) => {
    usuariosLista = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderUsuarios();
    renderRoles();
    renderInicio();
  }, (error) => {
    console.error(error);
    mostrarNotificacion("No se pudieron cargar los usuarios.", "error", { clave: "admin:error-usuarios" });
  });
}

function renderUsuarios() {
  const tbody = document.getElementById("usuariosTabla");
  const idsUsuarios = new Set(usuariosLista.map((u) => u.id));

  const normales = [...usuariosLista].sort((a, b) =>
    String(a.nombre || "").localeCompare(String(b.nombre || ""), "es")
  );

  const legacy = telemetriaLista
    .filter((t) => !idsUsuarios.has(t.id))
    .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));

  const filasNormales = normales.map((u) => `
    <tr>
      <td>${escapar(u.nombre || "sin nombre")}</td>
      <td>${escapar(u.email || "sin correo")}</td>
      <td>${escapar(u.rol || "sin rol")}</td>
      <td>${u.activo === false ? "inactivo" : "activo"}</td>
      <td>${horaLocal(u.creado_en)}</td>
    </tr>
  `);

  const filasLegacy = legacy.map((t) => `
    <tr class="legacy">
      <td>${escapar(t.nombre || "Conductor")} <em>(legacy)</em></td>
      <td>sin correo</td>
      <td>conductor</td>
      <td>pendiente de migración</td>
      <td>—</td>
    </tr>
  `);

  if (!filasNormales.length && !filasLegacy.length) {
    tbody.innerHTML = '<tr><td colspan="5">No hay usuarios.</td></tr>';
    return;
  }

  tbody.innerHTML = filasNormales.concat(filasLegacy).join("");
}

function renderRoles() {
  const tbody = document.getElementById("rolesTabla");
  if (!usuariosLista.length) {
    tbody.innerHTML = '<tr><td colspan="5">No hay usuarios.</td></tr>';
    return;
  }
  tbody.innerHTML = usuariosLista.map((u) => `
    <tr>
      <td>${escapar(u.nombre || "sin nombre")}</td>
      <td>${escapar(u.email || "sin correo")}</td>
      <td>
        <select data-rol-uid="${u.id}">
          <option value="conductor"${u.rol === "conductor" ? " selected" : ""}>conductor</option>
          <option value="admin"${u.rol === "admin" ? " selected" : ""}>admin</option>
        </select>
      </td>
      <td>${u.activo === false ? "no" : "sí"}</td>
      <td>
        <button data-guardar-rol="${u.id}">Guardar rol</button>
        <button data-estado-uid="${u.id}">${u.activo === false ? "Activar" : "Desactivar"}</button>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("button[data-guardar-rol]").forEach((b) => {
    b.addEventListener("click", () => cambiarRol(b.dataset.guardarRol));
  });
  tbody.querySelectorAll("button[data-estado-uid]").forEach((b) => {
    b.addEventListener("click", () => cambiarEstado(b.dataset.estadoUid));
  });
}

function mostrarRolesEstado(texto, error) {
  const caja = document.getElementById("rolesEstado");
  caja.textContent = texto;
  caja.className = `estado ${error ? "error" : "ok"}`;
}

async function cambiarRol(uid) {
  const select = document.querySelector(`select[data-rol-uid="${uid}"]`);
  const usuario = usuariosLista.find((u) => u.id === uid);
  if (!usuario || !select) return;
  const nuevoRol = select.value;

  if (uid === adminUid && nuevoRol !== "admin") {
    mostrarRolesEstado("No puedes quitarte tu propio rol de administrador.", true);
    renderRoles();
    return;
  }
  if (usuario.rol === nuevoRol) {
    mostrarRolesEstado("El rol no cambió.", false);
    return;
  }
  try {
    await updateDoc(doc(db, "usuarios", uid), { rol: nuevoRol });
    mostrarRolesEstado(`Rol actualizado a ${nuevoRol}.`, false);
    mostrarNotificacion("✅ Rol actualizado", "exito", {
      detalle: `${usuario.email || usuario.nombre || "Usuario"}: ${nuevoRol}`,
      clave: `admin:rol:${uid}:${nuevoRol}`
    });
  } catch (error) {
    console.error(error);
    mostrarRolesEstado("No se pudo cambiar el rol.", true);
    mostrarNotificacion("No se pudo cambiar el rol.", "error");
  }
}

async function cambiarEstado(uid) {
  const usuario = usuariosLista.find((u) => u.id === uid);
  if (!usuario) return;
  if (uid === adminUid) {
    mostrarRolesEstado("No puedes desactivar tu propia cuenta.", true);
    return;
  }
  const seActivara = usuario.activo === false;
  try {
    await updateDoc(doc(db, "usuarios", uid), { activo: seActivara });
    mostrarRolesEstado(`Cuenta ${seActivara ? "activada" : "desactivada"}.`, false);
    mostrarNotificacion(
      seActivara ? "✅ Cuenta activada" : "⛔ Cuenta desactivada",
      seActivara ? "exito" : "advertencia",
      { detalle: usuario.email || usuario.nombre || "Usuario" }
    );
  } catch (error) {
    console.error(error);
    mostrarRolesEstado("No se pudo cambiar el estado.", true);
    mostrarNotificacion("No se pudo cambiar el estado de la cuenta.", "error");
  }
}

function renderInicio() {
  const conductores = usuariosLista.filter((u) => u.rol === "conductor").length;
  const conectados = Object.values(flota).filter((c) => c.estado_operativo).length;
  const activos = todosLosViajes.filter((v) => esViajeActivo(v.estado)).length;
  const finalizados = todosLosViajes.filter((v) => v.estado === "finalizado").length;

  document.getElementById("cntConductores").textContent = conductores;
  document.getElementById("cntConectados").textContent = conectados;
  document.getElementById("cntViajesActivos").textContent = activos;
  document.getElementById("cntFinalizados").textContent = finalizados;
  document.getElementById("cntAlertas").textContent = auditoriasLista.length;
}

function renderViajes() {
  const tbody = document.getElementById("viajesTabla");
  if (!todosLosViajes.length) {
    tbody.innerHTML = '<tr><td colspan="6">No hay viajes.</td></tr>';
    return;
  }
  const ordenados = [...todosLosViajes]
    .sort((a, b) => String(b.creado_en || "").localeCompare(String(a.creado_en || "")))
    .slice(0, 50);

  tbody.innerHTML = ordenados.map((v) => `
    <tr>
      <td>${escapar(v.estado || "sin estado")}</td>
      <td>${escapar(v.cliente_nombre || "cliente")}</td>
      <td>${escapar(v.conductor_nombre || "sin asignar")}</td>
      <td>${escapar(v.destino_nombre || "sin destino")}</td>
      <td>${Number(v.deuda_espera || 0)} Bs</td>
      <td>${v.creado_en ? new Date(v.creado_en).toLocaleString() : "sin fecha"}</td>
    </tr>
  `).join("");
}

function renderReportes() {
  const total = todosLosViajes.length;
  const finalizados = todosLosViajes.filter((v) => v.estado === "finalizado").length;
  const rechazados = todosLosViajes.filter((v) => ["rechazado_por_tiempo", "rechazado_por_bloqueo"].includes(v.estado)).length;
  const deuda = todosLosViajes.reduce((acc, v) => acc + Number(v.deuda_espera || 0), 0);

  document.getElementById("reportesResumen").innerHTML = `
    <div class="contador"><span class="contador-num">${total}</span><span class="contador-label">Viajes</span></div>
    <div class="contador"><span class="contador-num">${finalizados}</span><span class="contador-label">Finalizados</span></div>
    <div class="contador"><span class="contador-num">${rechazados}</span><span class="contador-label">Cancelados / rechazados</span></div>
    <div class="contador"><span class="contador-num">${deuda}</span><span class="contador-label">Deuda de espera (Bs)</span></div>
  `;

  const porConductor = {};
  todosLosViajes.forEach((v) => {
    const nombre = v.conductor_nombre || "Sin asignar";
    if (!porConductor[nombre]) porConductor[nombre] = { total: 0, finalizados: 0, rechazados: 0, deuda: 0 };
    porConductor[nombre].total += 1;
    if (v.estado === "finalizado") porConductor[nombre].finalizados += 1;
    if (["rechazado_por_tiempo", "rechazado_por_bloqueo"].includes(v.estado)) porConductor[nombre].rechazados += 1;
    porConductor[nombre].deuda += Number(v.deuda_espera || 0);
  });

  const filas = Object.entries(porConductor);
  document.getElementById("reportesPorConductor").innerHTML = filas.length
    ? filas.map(([nombre, d]) => `<tr><td>${escapar(nombre)}</td><td>${d.total}</td><td>${d.finalizados}</td><td>${d.rechazados}</td><td>${d.deuda} Bs</td></tr>`).join("")
    : '<tr><td colspan="5">Sin datos.</td></tr>';

  document.getElementById("reportesIncidencias").innerHTML = auditoriasLista.length
    ? auditoriasLista.slice(0, 10).map((a) => `
        <div class="item-lista">
          <strong>${a.tipo === "falla_mecanica" ? "Falla mecánica" : "Desvío"}</strong>
          ${escapar(a.conductor || "Conductor")}<br>
          ${a.fecha ? new Date(a.fecha).toLocaleString() : "sin fecha"}
        </div>
      `).join("")
    : '<div class="item-lista">No hay incidencias.</div>';
}

function escucharAuditorias() {
  if (unsubAuditorias) unsubAuditorias();
  unsubAuditorias = onSnapshot(collection(db, "auditorias_desvios"), (snapshot) => {
    auditoriasLista = snapshot.docs
      .map((d) => d.data())
      .sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));

    if (auditoriasCargadas) {
      snapshot.docChanges().forEach((cambio) => {
        if (cambio.type !== "added") return;
        const a = cambio.doc.data();
        mostrarNotificacion(
          a.tipo === "falla_mecanica" ? "🛠️ Reporte de falla mecánica" : "🚨 Nueva auditoría de desvío",
          a.tipo === "falla_mecanica" ? "advertencia" : "error",
          {
            detalle: a.conductor || "Conductor",
            clave: `admin:auditoria:${cambio.doc.id}`
          }
        );
      });
    }
    auditoriasCargadas = true;

    renderAuditorias();
    renderInicio();
    renderReportes();
  }, (error) => {
    console.error(error);
    mostrarNotificacion("No se pudieron cargar las auditorías.", "error", { clave: "admin:error-auditorias" });
  });
}

function renderAuditorias() {
  const item = (x) => `
    <div class="item-lista">
      <strong>${x.tipo === "falla_mecanica" ? "Falla mecánica" : "Desvío"}</strong>
      ${escapar(x.conductor || "Conductor")}<br>
      ${Number(x.lat || 0).toFixed(5)}, ${Number(x.lng || 0).toFixed(5)}<br>
      ${x.fecha ? new Date(x.fecha).toLocaleString() : "sin fecha"}
    </div>
  `;

  document.getElementById("auditoriasLista").innerHTML = auditoriasLista.length
    ? auditoriasLista.map(item).join("")
    : '<div class="item-lista">No hay auditorías.</div>';

  document.getElementById("auditoriasRecientes").innerHTML = auditoriasLista.length
    ? auditoriasLista.slice(0, 8).map(item).join("")
    : '<div class="item-lista">No hay auditorías.</div>';
}

async function cerrarSesion() {
  if (unsubFlota) unsubFlota();
  if (unsubViajes) unsubViajes();
  if (unsubAuditorias) unsubAuditorias();
  if (unsubUsuarios) unsubUsuarios();
  await signOut(auth);
}

document.querySelectorAll(".menu-item[data-seccion]").forEach((boton) => {
  boton.addEventListener("click", () => mostrarSeccion(boton.dataset.seccion));
});
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

  adminUid = user.uid;
  mostrarApp();
  escucharUsuarios();
  escucharViajes();
  escucharFlota();
  escucharAuditorias();
});

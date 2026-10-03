// Notificaciones in-app tipo toast (sin Web Push, sin Service Worker, sin librerias).
// El contenedor se crea dinamicamente para no tocar el HTML de cada vista.

const MAX_VISIBLES = 4;
const DURACION_DEFECTO = 5000;
const VENTANA_DEDUP = 6000;

// Autocierre por tipo de notificacion (ms).
// Un valor explicito en opciones.duracion conserva prioridad sobre este valor.
const DURACIONES_POR_TIPO = {
  exito: 5000,
  info: 5000,
  advertencia: 7000,
  error: 8000,
};

let contenedor = null;
const ultimasClaves = new Map();

function asegurarContenedor() {
  if (contenedor && document.body.contains(contenedor)) return contenedor;
  contenedor = document.getElementById("notificaciones");
  if (!contenedor) {
    contenedor = document.createElement("div");
    contenedor.id = "notificaciones";
    contenedor.className = "notificaciones";
    contenedor.setAttribute("aria-live", "polite");
    contenedor.setAttribute("aria-atomic", "false");
    contenedor.setAttribute("role", "status");
    document.body.appendChild(contenedor);
  }
  return contenedor;
}

function iconoTipo(tipo) {
  switch (tipo) {
    case "exito": return "✅";
    case "advertencia": return "⚠️";
    case "error": return "⛔";
    default: return "ℹ️";
  }
}

function separarTexto(mensaje, detalle) {
  const base = String(mensaje == null ? "" : mensaje).trim();
  if (detalle) return { titulo: base, detalle: String(detalle).trim() };
  const partes = base.split("\n");
  if (partes.length > 1) {
    return { titulo: partes[0].trim(), detalle: partes.slice(1).join(" ").trim() };
  }
  return { titulo: base, detalle: "" };
}

function cancelarAutocierre(tarjeta) {
  if (!tarjeta || !tarjeta._timerAutocierre) return;
  clearTimeout(tarjeta._timerAutocierre);
  tarjeta._timerAutocierre = null;
}

function quitar(tarjeta) {
  if (!tarjeta || tarjeta.dataset.saliendo === "1") return;
  cancelarAutocierre(tarjeta);
  tarjeta.dataset.saliendo = "1";
  tarjeta.classList.add("notificacion--saliendo");
  setTimeout(() => tarjeta.remove(), 220);
}

// API publica: mostrarNotificacion(mensaje, tipo, opciones)
// tipo: "info" | "exito" | "advertencia" | "error"
// opciones: { detalle, duracion, clave }
export function mostrarNotificacion(mensaje, tipo = "info", opciones = {}) {
  if (typeof document === "undefined") return null;

  const { detalle = "", duracion, clave = null } = opciones || {};
  const tipoValido = ["info", "exito", "advertencia", "error"].includes(tipo) ? tipo : "info";
  const duracionResuelta = Number.isFinite(duracion)
    ? duracion
    : (DURACIONES_POR_TIPO[tipoValido] ?? DURACION_DEFECTO);

  if (clave) {
    const ahora = Date.now();
    const previo = ultimasClaves.get(clave);
    if (previo && ahora - previo < VENTANA_DEDUP) return null;
    ultimasClaves.set(clave, ahora);
    if (ultimasClaves.size > 60) {
      for (const [k, v] of ultimasClaves) {
        if (ahora - v > VENTANA_DEDUP) ultimasClaves.delete(k);
      }
    }
  }

  const cont = asegurarContenedor();
  const tarjeta = document.createElement("div");
  tarjeta.className = `notificacion notificacion--${tipoValido}`;

  const icono = document.createElement("span");
  icono.className = "notificacion__icono";
  icono.setAttribute("aria-hidden", "true");
  icono.textContent = iconoTipo(tipoValido);

  const cuerpo = document.createElement("div");
  cuerpo.className = "notificacion__cuerpo";

  const { titulo, detalle: textoDetalle } = separarTexto(mensaje, detalle);

  const tituloEl = document.createElement("p");
  tituloEl.className = "notificacion__titulo";
  tituloEl.textContent = titulo || "";
  cuerpo.appendChild(tituloEl);

  if (textoDetalle) {
    const detalleEl = document.createElement("p");
    detalleEl.className = "notificacion__detalle";
    detalleEl.textContent = textoDetalle;
    cuerpo.appendChild(detalleEl);
  }

  const cerrar = document.createElement("button");
  cerrar.type = "button";
  cerrar.className = "notificacion__cerrar";
  cerrar.setAttribute("aria-label", "Cerrar notificacion");
  cerrar.textContent = "\u00D7";
  cerrar.addEventListener("click", () => quitar(tarjeta));

  tarjeta.append(icono, cuerpo, cerrar);
  cont.appendChild(tarjeta);

  const sobrantes = cont.children.length - MAX_VISIBLES;
  if (sobrantes > 0) {
    Array.from(cont.children).slice(0, sobrantes).forEach((n) => quitar(n));
  }

  if (duracionResuelta > 0) {
    const programar = () => {
      if (tarjeta.dataset.saliendo === "1" || tarjeta.isConnected === false) return;
      cancelarAutocierre(tarjeta);
      tarjeta._timerAutocierre = setTimeout(() => {
        tarjeta._timerAutocierre = null;
        quitar(tarjeta);
      }, duracionResuelta);
    };
    programar();
    tarjeta.addEventListener("mouseenter", () => cancelarAutocierre(tarjeta));
    tarjeta.addEventListener("mouseleave", programar);
  }

  return tarjeta;
}

export function limpiarNotificaciones() {
  const cont = asegurarContenedor();
  cont.querySelectorAll(".notificacion").forEach((n) => {
    cancelarAutocierre(n);
    n.remove();
  });
}

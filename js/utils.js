export function calcularDistancia(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function horaLocal(fecha) {
  if (!fecha) return "sin dato";
  const valor = typeof fecha?.toDate === "function" ? fecha.toDate() : fecha;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? "sin dato" : d.toLocaleString();
}

// Indica si una marca de tiempo es reciente (dentro de toleranciaMs).
// Acepta ISO string, Timestamp de Firestore (toDate), number en ms, o {seconds}.
// Devuelve false si no se puede interpretar o si es mas viejo que la tolerancia.
export function lecturaReciente(valor, toleranciaMs = 20000) {
  if (valor === null || valor === undefined) return false;

  let ms = NaN;

  if (typeof valor === "number") {
    ms = valor;
  } else if (typeof valor === "string") {
    ms = new Date(valor).getTime();
  } else if (typeof valor === "object") {
    if (typeof valor.toDate === "function") {
      try {
        ms = valor.toDate().getTime();
      } catch (error) {
        return false;
      }
    } else if (typeof valor.seconds === "number") {
      ms = valor.seconds * 1000;
    }
  }

  if (!Number.isFinite(ms)) return false;
  return Date.now() - ms <= toleranciaMs;
}

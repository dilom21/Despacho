// Helper de rutas reales por calles usando el servidor publico OSRM.
// Sin dependencias: solo fetch + AbortController.

const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";
const TIMEOUT_MS = 8000;

// Convierte puntos [{lat,lng}] a una geometria [[lat,lng]] siguiendo calles.
// Devuelve null si OSRM falla (red, timeout, respuesta no valida o datos malformados).
export async function obtenerRutaCalles(puntos) {
  if (!Array.isArray(puntos)) return null;

  const validos = puntos
    .filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
    .map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));

  if (validos.length < 2) return null;

  const coords = validos.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `${OSRM_BASE}/${coords}?overview=full&geometries=geojson`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return null;

    const data = await resp.json();
    const coordinates = data?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

    // GeoJSON usa [lng, lat]; Leaflet necesita [lat, lng].
    const ruta = coordinates.map(([lng, lat]) => [lat, lng]);
    return ruta.length >= 2 ? ruta : null;
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Devuelve una funcion async (puntos, forzar=false) que aplica throttle:
// - si no se fuerza y no paso intervaloMs desde la ultima llamada -> undefined
// - si procede, registra el instante y devuelve la geometria o null si OSRM fallo.
export function crearRutaThrottled(intervaloMs = 12000) {
  let ultimaLlamada = 0;

  return async function (puntos, forzar = false) {
    const ahora = Date.now();
    if (!forzar && ahora - ultimaLlamada < intervaloMs) return undefined;

    ultimaLlamada = ahora;
    return obtenerRutaCalles(puntos);
  };
}

// Iconos de mapa reutilizables para la vista tipo Uber/Yango.
// Se definen con L.divIcon (sin librerías externas ni imágenes).
// Leaflet se carga globalmente antes que estos módulos, por eso aquí se usa L.

const TAMANO_ICONO = 34;

const SVG_CARRO = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
  </svg>`;

const SVG_PERSONA = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-2.67 0-8 1.34-8 4v1h16v-1c0-2.66-5.33-4-8-4z"/>
  </svg>`;

const SVG_DESTINO = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/>
  </svg>`;

function crearIcono(clase, svg) {
  return L.divIcon({
    className: "icono-mapa",
    html: `<span class="icono-mapa__pin ${clase}">${svg}</span>`,
    iconSize: [TAMANO_ICONO, TAMANO_ICONO],
    iconAnchor: [TAMANO_ICONO / 2, TAMANO_ICONO / 2],
    popupAnchor: [0, -TAMANO_ICONO / 2]
  });
}

// Conductor o vehiculo de la flota.
export const iconoCarro = crearIcono("icono-carro", SVG_CARRO);
// Pasajero u origen del viaje.
export const iconoPersona = crearIcono("icono-persona", SVG_PERSONA);
// Destino final del viaje.
export const iconoDestino = crearIcono("icono-destino", SVG_DESTINO);

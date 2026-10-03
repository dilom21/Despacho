# ODD: Ruta carro->pasajero en cliente + notificaciones in-app (toast)

## Objetivo
1. En la vista cliente, la linea de ruta destacada debe representar el viaje real segun su estado:
   - previo / `buscando_conductor`: `origenCliente -> destino`
   - `conductor_en_camino`: `posicion actual del conductor -> origenCliente`
   - `en_espera`: `origen -> destino` (el carro ya llego)
   - `en_viaje`: `posicion actual del conductor -> destino`
   - `finalizado`: limpiar la ruta activa
2. Notificaciones in-app tipo toast reutilizables en cliente, conductor y admin.

## Problema
- `cliente.js::actualizarRuta()` siempre traza `origenCliente -> destinoViaje`, por lo que al
  aceptar el conductor no se ve su recorrido hacia el pasajero.
- Los mensajes de estado son solo cajas de texto; falta feedback visual de eventos.

## Alcance (autorizado)
- `js/notificaciones.js` (NUEVO)
- `css/estilos.css` (bloque de toast al final)
- `js/cliente.js` (ruta por estado + toasts)
- `js/conductor.js` (toasts de flujo)
- `js/admin.js` (toasts administrativos con deteccion de transiciones)

## Fuera de alcance / NO TOCAR
- Firebase Auth, `clienteAuth`/`clienteDb`, `firestore.rules`, estructura de roles.
- Logica de cobro de espera, auditorias, GPS, throttle GPS, algoritmo de desvios.
- Sidebar del admin, iconos de mapa, OSRM helper, Leaflet.
- Sin Web Push, Service Worker ni FCM. Sin librerias externas.
- Sin commit (pedido explicito del usuario).

## Criterios de aceptacion
- Cliente: solicitar -> aceptar -> toast -> ruta carro->persona -> el carro se mueve y la ruta
  se refresca respetando el throttle OSRM -> llega -> aborda -> ruta carro->destino -> finalizar limpia.
- Conductor: toast de nueva solicitud y de cada hito, sin tapar controles.
- Admin: toasts en transiciones reales (conectado/desconectado, bloqueo, auditoria, rol), sin spam
  por GPS/onSnapshot al abrir la pagina.
- Fallback de linea recta si OSRM falla (se conserva).

## Tareas (checklist)
- [x] T1 (delegada): `js/notificaciones.js` nuevo + CSS en `estilos.css`.
- [x] T2 (delegada): `js/cliente.js` — ruta por estado, refresco desde `flota_publica`, toasts.
- [x] T3 (delegada): `js/conductor.js` — toasts de flujo con deteccion de primera carga.
- [x] T4 (delegada): `js/admin.js` — toasts administrativos con transiciones (sin spam).
- [x] T5 (padre): verificacion `node --check` de los 4 JS + lectura estructural.

## Verificacion
- `node --check` OK (exit 0) en notificaciones.js, cliente.js, conductor.js, admin.js.
- Verificador independiente (read-only) confirmo A–F PASS.
- Correcciones aplicadas por el padre tras la verificacion:
  - `puntosRutaCliente()`: se dejo de coercer con `Number()` (evita ruta a (0,0) si el conductor no tiene GPS).
  - Guarda `cambioEstado` en el onSnapshot del viaje cliente: evita repetir toast y forzar OSRM cada 5 s durante `en_espera`.
  - Rama `buscando_conductor` que traza la ruta origen->destino en la transicion (viaje nuevo tras uno finalizado).
- Pendiente (no bloqueante): prueba manual en navegador con Firestore real (flujo cliente/conductor/admin).

## Topologia (ODD)
- Exploracion: inline (4+ archivos leidos por el padre para decidir la ruta).
- Escritura: 1 writer bounded (`general`) para los 5 archivos (trigger: 2+ archivos no triviales).
- Verificacion: 1 verificador read-only (`explore`) + spot check del padre.
- TDD: sin framework en el proyecto; chequeo funcional = `node --check` + verificacion estructural/manual.

## Progreso
- Implementado y verificado estaticamente. Sin commit (pedido explicito).
- Risk tier nativo: `medium` (`slice_budget_reached`); RDD esta OFF (decidido por default), por lo
  que no se inicio el ciclo de review nativo; se uso verificacion independiente read-only.
- Follow-up (correccion aislada falsy-zero): se agrego `numeroCoordenada(valor)` en
  cliente.js, conductor.js y admin.js y se reemplazaron los chequeos `data.latitud || null`,
  `data.longitud || null`, `!c.lat`/`!c.lng`, `conductor.lat && conductor.lng` y
  `data.latitud && data.longitud` por validaciones `Number.isFinite(...)`. Ahora 0 es una
  coordenada valida; solo null/undefined/vacio o no numerico se considera invalido.
  `node --check` OK en los tres archivos. Sin commit.


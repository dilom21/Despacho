# Contexto técnico - Despacho Vehicular y Telemetría

## 1. Descripción
Aplicación web para solicitar taxis, recibir viajes y monitorear la ubicación de los vehículos en tiempo real.

Se mantienen tres perfiles:
- Cliente
- Conductor
- Administrador

## 2. Rutas actuales
La aplicación ya no usa un selector de perfiles dentro de una sola pantalla.

- `/` -> página del Cliente.
- `/conductor/` -> ingreso y panel del Conductor.
- `/admin/` -> ingreso y panel del Administrador.

Las rutas son carpetas con su propio `index.html`, por lo que funcionan como sitio estático en GitHub Pages o Vercel.

## 3. Tecnologías
- HTML5
- CSS3
- JavaScript con ES Modules
- Leaflet.js + OpenStreetMap
- Firebase Authentication
- Cloud Firestore y listeners `onSnapshot`

No se agregó React, Vue ni otro framework.

## 4. Diseño
El diseño se simplificó para que sea más parecido a un proyecto académico inicial:
- Fondo blanco/gris.
- Botones simples.
- Sin gradientes ni animaciones decorativas.
- Pocos colores.
- Formularios y paneles básicos.

La simplificación visual no elimina las funciones del sistema.

## 5. GPS mediante celular
Como reemplazo de un chip GPS físico, cada conductor puede abrir `/conductor/` desde un celular.

Al pulsar `Activar GPS del celular`, el navegador usa `navigator.geolocation.watchPosition` y actualiza su documento en `telemetria` con:
- `latitud`
- `longitud`
- `precision`
- `actualizado_en`
- `fuente_gps: "celular"`
- `estado_operativo`

El administrador y el cliente reciben esas coordenadas desde Firestore y mueven el marcador del vehículo en el mapa.

Para usar geolocalización desde un celular, la web debe ejecutarse con HTTPS (o localhost durante desarrollo) y el usuario debe permitir la ubicación.

## 6. Flujo del conductor
Estados principales del viaje:
1. `buscando_conductor`
2. `conductor_en_camino`
3. `en_espera`
4. `en_viaje`
5. `finalizado`

El conductor dispone de 30 segundos para aceptar la solicitud.

Al llegar al origen se mantienen 10 segundos de cortesía. Después se suman 2 Bs cada 5 segundos hasta que el conductor pulsa `Pasajero abordó / detener espera`.

## 7. Administración y auditorías
El administrador puede:
- Ver la posición enviada por los celulares.
- Ver si el GPS de cada conductor está activo.
- Ver precisión y hora de la última lectura.
- Ver viajes activos y deuda de espera.
- Ver auditorías.
- Desbloquear conductores.

La detección de desvío conserva Haversine y tres detecciones consecutivas. Ahora se aplica durante el estado `en_viaje` para no interpretar como desvío el trayecto inicial hacia el pasajero.

## 8. Archivos principales
- `index.html` - Cliente
- `conductor/index.html` - Conductor
- `admin/index.html` - Administrador
- `css/estilos.css` - estilos compartidos
- `js/firebase-config.js` - configuración Firebase
- `js/cliente.js` - lógica Cliente
- `js/conductor.js` - lógica Conductor y GPS del celular
- `js/admin.js` - monitoreo y auditorías
- `js/utils.js` - funciones auxiliares
- `firestore.rules` - reglas de seguridad

## 9. Separación de vistas y control de acceso
- El Cliente no ve enlaces a Conductor ni Administrador.
- El Conductor no ve enlaces a Cliente ni Administrador.
- El Administrador no usa navegación pública entre roles.
- Si una sesión de Conductor intenta abrir `/`, se redirige a `/conductor/`.
- Si una sesión de Administrador intenta abrir `/`, se redirige a `/admin/`.
- Si un Conductor autenticado intenta abrir `/admin/`, vuelve a `/conductor/`.
- El registro público de conductores fue eliminado. Para ser reconocido como Conductor, la cuenta debe existir en Firebase Authentication y tener su documento `telemetria/{uid}` previamente creado.
- El Administrador puede abrir desde su lista la vista de un Conductor mediante el botón `Ver vista conductor`. Esa vista usa `/conductor/?uid=...` y funciona en modo solo lectura: el administrador ve GPS y viaje, pero no puede activar GPS, aceptar viajes ni cambiar estados desde esa pantalla.

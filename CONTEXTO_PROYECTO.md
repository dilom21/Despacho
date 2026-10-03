# Contexto técnico - Despacho Vehicular y Telemetría

## 1. Descripción
Aplicación web para solicitar taxis, recibir viajes y monitorear la ubicación de los vehículos en tiempo real.

Se mantienen tres perfiles:
- Cliente
- Conductor
- Administrador

## 2. Rutas
- `/` -> página del Cliente (pública, no requiere login del personal).
- `/personal/` -> único acceso del personal: iniciar sesión y crear cuenta de conductor.
- `/conductor/` -> panel protegido del Conductor.
- `/admin/` -> panel protegido del Administrador.

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
- El panel del administrador usa una sidebar simple con secciones.

La simplificación visual no elimina las funciones del sistema.

## 5. Autenticación y roles
Los roles se guardan en Firestore en la colección `usuarios/{uid}`:

```js
{
  nombre: "Juan Perez",
  email: "juan@email.com",
  rol: "conductor",   // "conductor" | "admin"
  activo: true,
  creado_en: serverTimestamp()
}
```

Flujo de acceso:
1. El personal entra por `/personal/`.
2. Firebase Authentication valida las credenciales (`signInWithEmailAndPassword`).
3. Se lee `usuarios/{uid}` y se valida `rol` y `activo`.
4. Redirección: `conductor -> /conductor/`, `admin -> /admin/`.

Reglas de acceso:
- `/personal/`: sin sesión muestra login/registro; con sesión redirige según el rol.
- `/conductor/`: sin sesión -> `/personal/`; conductor -> acceso; admin -> `/admin/`.
- `/admin/`: sin sesión -> `/personal/`; admin -> acceso; conductor -> `/conductor/`.
- Rol inválido, perfil ausente o `activo: false` -> se cierra la sesión y se vuelve a `/personal/`.

Registro del conductor (desde `/personal/`):
- El formulario pide nombre, correo, contraseña y confirmación.
- `createUserWithEmailAndPassword()`.
- Se crea `usuarios/{uid}` con `rol: "conductor"` (fijo; nunca se acepta el rol desde un input).
- Se crea/inicializa `telemetria/{uid}` sin coordenadas inventadas.
- Se redirige a `/conductor/`.

No existe registro público de administradores.

## 6. Compatibilidad con cuentas existentes
- **Administrador existente:** la cuenta `admin@despacho.com` genera su perfil `usuarios/{uid}` con `rol: "admin"` la primera vez que inicia sesión en `/personal/` (bootstrap de una sola vez, protegido por las reglas). No se hardcodea la contraseña.
- **Conductores previos:** si una cuenta ya tenía `telemetria/{uid}` pero no `usuarios/{uid}`, al iniciar sesión en `/personal/` se crea automáticamente su perfil con `rol: "conductor"`. Basta con que cada conductor entre una vez.

## 7. GPS mediante celular
Como reemplazo de un chip GPS físico, cada conductor abre `/conductor/` desde un celular.

Al pulsar `Activar GPS del celular`, el navegador usa `navigator.geolocation.watchPosition` con
`{ enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }` y actualiza:
- `telemetria/{uid}` (datos completos): `conductor_uid`, `latitud`, `longitud`, `precision`,
  `velocidad`, `rumbo`, `fuente_gps: "celular"`, `conectado`, `estado_operativo`, `actualizado_en`.
- `flota_publica/{uid}` (espejo mínimo para el cliente): `nombre`, `latitud`, `longitud`,
  `estado_operativo`, `bloqueado`, `actualizado_en`.

Se aplica un throttle de 4 segundos para no saturar Firestore.

Rastreo:
- El administrador escucha `telemetria` con `onSnapshot` y ve toda la flota en el mapa.
- El cliente escucha `flota_publica` para elegir conductor y solo rastrea al conductor asignado.

Para usar geolocalización desde un celular, la web debe ejecutarse con HTTPS (o localhost durante
desarrollo) y el usuario debe permitir la ubicación.

## 8. Flujo del conductor
Estados principales del viaje:
1. `buscando_conductor`
2. `conductor_en_camino`
3. `en_espera`
4. `en_viaje`
5. `finalizado`

El conductor dispone de 30 segundos para aceptar la solicitud. Al llegar al origen se mantienen
10 segundos de cortesía; después se suman 2 Bs cada 5 segundos hasta que el conductor pulsa
`Pasajero abordó / detener espera`.

## 9. Panel del administrador
Sidebar con:
- **Inicio:** contadores (conductores, conectados, viajes activos, finalizados, alertas) y auditorías recientes.
- **Usuarios:** nombre, correo, rol, estado, fecha de creación.
- **Roles:** cambio de rol (`admin`/`conductor`) y activar/desactivar cuentas (solo admin).
- **Conductores / Flota:** listado, conectado/desconectado, estado, precisión, última lectura, mapa y detalle.
- **Viajes:** listado y estados.
- **Reportes:** viajes por conductor, finalizados, cancelados/rechazados, deuda de espera, incidencias.
- **Auditorías:** `auditorias_desvios`.
- **Cerrar sesión.**

La detección de desvío conserva Haversine y tres detecciones consecutivas durante el estado
`en_viaje`. El administrador puede bloquear/desbloquear conductores. La vista de un conductor
(`/conductor/?uid=...`) es de solo lectura.

## 10. Colecciones de Firestore
- `usuarios/{uid}` -> personal y rol.
- `telemetria/{uid}` -> GPS del taxi (datos completos; lectura dueño + admin).
- `flota_publica/{uid}` -> espejo mínimo legible por el cliente.
- `viajes/{viajeId}` -> viajes y estados.
- `auditorias_desvios/{id}` -> desvíos y fallas.

## 11. Reglas de seguridad
`firestore.rules` usa helpers `isAdmin()`, `isConductor()` e `isOwner(uid)`:
- El conductor solo lee/escribe su propio perfil y su propia telemetría.
- El conductor no puede cambiarse el rol ni quitarse un bloqueo.
- El cliente anónimo no puede leer usuarios, auditorías ni la telemetría completa.
- El administrador puede consultar usuarios, flota, viajes y auditorías.
- Las operaciones de viaje respetan propietario/asignación.

**IMPORTANTE:** las reglas deben desplegarse en Firebase para que la seguridad se aplique.

## 12. Archivos principales
- `index.html` - Cliente
- `personal/index.html` - Acceso del personal (login + registro de conductor)
- `conductor/index.html` - Conductor
- `admin/index.html` - Administrador (sidebar)
- `css/estilos.css` - estilos compartidos
- `js/firebase-config.js` - configuración Firebase
- `js/auth-roles.js` - perfil, roles, guards y redirección
- `js/personal.js` - login y registro del personal
- `js/cliente.js` - lógica Cliente
- `js/conductor.js` - lógica Conductor y GPS del celular
- `js/admin.js` - panel, flota, viajes, reportes y auditorías
- `js/utils.js` - funciones auxiliares
- `firestore.rules` - reglas de seguridad

## 13. Pruebas locales
Dentro de la carpeta del proyecto:

```bash
python -m http.server 5500
```

Luego abrir:

```text
http://localhost:5500/
http://localhost:5500/personal/
http://localhost:5500/conductor/
http://localhost:5500/admin/
```

No usar `file://` porque los ES Modules no funcionan así.

## 14. Despliegue de reglas
Con Firebase CLI (si está instalado):

```bash
firebase deploy --only firestore:rules
```

Alternativa manual: copiar el contenido de `firestore.rules` en
Firebase Console -> Firestore Database -> Reglas -> Publicar.

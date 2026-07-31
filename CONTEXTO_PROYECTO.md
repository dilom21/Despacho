# Contexto del Proyecto: Sistema de Despacho y Telemetría Vehicular

## 1. Resumen del Proyecto
Aplicación Web de Página Única (SPA) de alta fidelidad para el despacho de vehículos y telemetría en tiempo real, diseñada con una experiencia de usuario (UX) estilo "Bottom Sheet" similar a Uber, Yango o InDrive. El sistema permite la interacción bidireccional entre clientes y conductores, supervisada por una central de monitoreo.

## 2. Stack Tecnológico
*   **Frontend:** HTML5, CSS3 puro (Flexbox, animaciones CSS, gradientes premium, backdrop-filters) y JavaScript Vanilla (ES Modules).
*   **Mapas y Geolocalización:** Leaflet.js (v1.9.4) con OpenStreetMap. `navigator.geolocation` para rastreo en tiempo real.
*   **Backend & BaaS:** Firebase v9 (Modular SDK).
    *   **Autenticación:** Firebase Auth (Email/Password).
    *   **Base de Datos:** Firestore (Tiempo real con `onSnapshot`).
*   **Despliegue:** Vercel (migrado desde el prototipo local).

## 3. Arquitectura de la Interfaz (UI/UX)
*   **Mapa Global Subyacente:** Un mapa de Leaflet ocupa el `100vh/100vw` en el fondo (`z-index: 1`).
*   **Capa UI Flotante:** Formularios y tarjetas (cards) superpuestas con `z-index` altos.
*   **Portal de Conductor:** Interfaz premium difuminada (`backdrop-filter`) para el inicio de sesión y registro.
*   **Navegación basada en Roles:** Funciones JavaScript (`seleccionarRol()`) controlan la visibilidad de los contenedores HTML (Cliente, Conductor, Admin) sin recargar la página.

## 4. Estructura de Base de Datos (Firestore)
*   **Colección `telemetria`:** Documentos por `{uid}` del conductor.
    *   Guarda: `nombre`, `correo`, `latitud`, `longitud`, `estado_operativo`.
*   **Colección `viajes`:** Documentos por `{id_viaje}` (ID dinámico generado por el cliente).
    *   Guarda: `estado` (buscando_conductor, conductor_en_camino, rechazado_por_tiempo, etc.), `conductor_asignado` (uid del chofer elegido), `origen`, `destino`, `destino_nombre`, `cliente_nombre`, `hora_limite`, `conductor_nombre`, `conductor_id`, `deuda_espera`.
*   **Colección `auditorias_desvios`:** Registro histórico de alertas generadas por el sistema (desvíos y fallas mecánicas).
*   **Nota:** La colección `conductores` está documentada en diseño pero **NO es usada por el código**; el sistema usa `telemetria/{uid}` como fuente de verdad (nombre, correo, `estado_operativo`, `bloqueado`).
*   **Nota de creación:** Las colecciones `telemetria`, `viajes` y `auditorias_desvios` se crean automáticamente con el primer `setDoc`/`addDoc` de la app. **No hay que crearlas a mano** ni configurar índices (el único filtro es `where("conductor_asignado", "==", uid)`, de campo único, que no requiere índice compuesto).

## 5. Roles y Funcionalidades Activas
### 👤 Cliente
*   Usa el GPS del navegador para establecer el punto de origen.
*   Ingresa su nombre y la hora límite de llegada (planificación predictiva).
*   Define su **destino real**: escribe la dirección y la busca (geocodificación Nominatim/OSM) o hace clic en el mapa ("Elegir en el mapa"). La ruta (polilínea) y el marcador 🏁 se actualizan al instante.
*   Ve a los choferes disponibles en el mapa y en una lista ordenada por distancia.
*   Elige al chofer que prefiere (clic en el carrito o en la lista) y el sistema crea el viaje con `conductor_asignado`, `destino`, `destino_nombre` y `hora_limite`.
*   Recibe confirmación y ve el **nombre real del conductor** asignado en la UI al aceptar el viaje. Si el chofer no responde (30s), puede elegir a otro.

### 📱 Conductor
*   Registro e inicio de sesión integrados (Firebase Auth). Al loguearse, el sistema recupera su nombre real.
*   Activa la transmisión de telemetría continua (`watchPosition`). Su documento en `telemetria` se escucha en tiempo real (`onSnapshot`).
*   Recibe notificaciones de viaje con el **nombre real del cliente** y la **hora límite de llegada**. Timeout de inactividad (30s) rechaza el viaje automáticamente.
*   Botones de flujo de viaje: Aceptar, Llegar al origen (inicia cobro por espera de forma automática tras 10s de cortesía).
*   Botón **"🔧 Reportar Falla Mecánica"** (visible al transmitir): se bloquea a sí mismo, cancela el viaje activo y guarda una auditoría tipo `falla_mecanica`.
*   Puede ser **bloqueado** por el sistema (falla mecánica o desvío): se detiene su GPS, se ocultan los controles y se muestra `alertaBloqueo`. El Admin debe desbloquearlo/aprobar la auditoría para que se reconecte.

### 🖥️ Administrador (Central de Monitoreo)
*   **Acceso protegido**: inicia sesión con el correo `admin@despacho.com` (Firebase Auth) en un panel exclusivo. Botón "Cerrar Sesión".
*   Escucha la colección `telemetria` completa (`onSnapshot` de colección).
*   Dibuja marcadores múltiples dinámicos en el mapa (`window.vehicleMarkers`).
*   Fórmula de Haversine integrada: Calcula la distancia de cada vehículo al destino real de su viaje. Si la distancia aumenta en lugar de disminuir, acumula detecciones de desvío y **bloquea tras `UMBRAL_DESVIOS` (3) consecutivos**, guardando auditoría.
*   Visualiza en tiempo real la deuda por espera generada.
*   Panel de conductores BLOQUEADOS con botón para desbloquear/aprobar auditorías.
*   Historial de auditorías de desvíos recientes en tiempo real (`auditorias_desvios`).

## 6. Estado Actual del Código (Contexto Técnico)
*   **Fase 1 completada:** El código base ha sido depurado. Se corrigieron colisiones de IDs, se unificaron los módulos de JavaScript para evitar problemas de alcance (Scope) y Firebase se comunica fluidamente.
*   **Fase 2 completada:** Ya se renderizan múltiples marcadores de vehículos usando identificadores UID únicos.
*   **Fase 3 completada (Selección de Conductor):** El cliente ve a los choferes disponibles en el mapa (solo los que transmiten GPS con `estado_operativo: true`) y en una lista ordenada por distancia. Elige a uno y el viaje se crea con `conductor_asignado: {uid}`. El chofer solo recibe los viajes donde fue elegido (query `where("conductor_asignado", "==", uid)`).
*   **Fase 4 completada (Bloqueo y Auditoría):** Ante un desvío detectado por Haversine, el sistema bloquea al conductor (`bloqueado: true`, `estado_operativo: false`), cancela su viaje activo (`rechazado_por_bloqueo`) y guarda la auditoría. El conductor ve `alertaBloqueo` y su telemetría se detiene. El Admin ve el panel de BLOQUEADOS, el historial de auditorías en tiempo real y puede desbloquear/aprobar (botón `desbloquearConductor`).
*   **Fase 5 completada (Complementos):** La `hora_limite` del cliente se guarda en el viaje y se muestra al conductor y al Admin. El conductor puede reportar falla mecánica (auto-bloqueo + auditoría `tipo: falla_mecanica`).
*   **Fase 6 completada (Destino real):** El cliente define su destino por dirección (Nominatim/OSM) o haciendo clic en el mapa; se guarda `destino` + `destino_nombre` en el viaje, la polilínea y el marcador 🏁 se actualizan, y el conductor/Admin ven el destino (`🏁`) en sus vistas.
*   **Fase 7 completada (Seguridad endurecida):**
    *   Login de **Admin** (Firebase Auth, correo `admin@despacho.com`) con panel propio y botón "Cerrar Sesión". Las escuchas de viajes globales y auditorías solo se activan en sesión Admin.
    *   **Cliente anónimo**: al abrir la app, Firebase Anonymous Auth autentica al Cliente sin registro (requisito de las reglas).
    *   `firestore.rules` endurecidas: lectura solo para autenticados; el conductor escribe únicamente su doc de `telemetria`; solo el conductor asignado o el Admin modifican un `viaje`; solo el Admin bloquea/desbloquea.
    *   **Política de bloqueo ajustada:** ya NO se bloquea con el primer desvío. Se requieren `UMBRAL_DESVIOS` (3) detecciones consecutivas de distancia creciente; antes de bloquear se muestra "Posible desvío (detección N/3)". Si la distancia vuelve a bajar, el contador se reinicia.
*   **Fase 8 completada (Bug: "no hay conductores disponibles"):**
    *   Un conductor **logueado pero sin GPS aún** (`lat/lng` en 0) ya no desaparece: queda visible en la lista del cliente como "🟢 Conectado (sin señal GPS)" y es **elegible** (Opción A). El marcador en el mapa y la verificación de desvíos siguen requiriendo coordenadas reales.
    *   `renderListaChoferes` y `solicitarViaje` cuentan ahora a los conductores **conectados** (`estado_operativo`), no solo a los que emiten GPS.
    *   `actualizarPanelAdmin` ya no rompe con conductores sin señal (muestra "sin señal").
    *   El `onSnapshot` de la flota ahora tiene **handler de error**: si la lectura falla (p. ej. Autenticación Anónima deshabilitada o reglas no publicadas), el cliente ve un mensaje claro en lugar de "no hay choferes" sin explicación.
*   **Nota de Scope para la IA:** Se están usando variables globales ancladas a `window` (ej. `window.uidConductorActual`, `window.flotaGlobal`, `window.viajeClienteActual`, `window.vehicleMarkers`, `window.esAdmin`) para permitir la comunicación entre las funciones que manejan el DOM y los listeners asíncronos de Firebase.

## 7. Directrices para futuras implementaciones
*   Mantener el código en JavaScript Vanilla sin frameworks (No React, No Vue).
*   Usar sintaxis de Firebase modular v9.
*   Priorizar la fluidez de la UI/UX usando clases y estilos en línea o CSS puro en lugar de librerías externas de UI.

## Pasos que estabamos realizando en conjunto con la IA
1. El Registro y Login del Conductor (Autenticación) ✅ **Completado**
   El conductor se registra con correo (usuario) y contraseña mediante Firebase Authentication. Al registrarse se crea su documento en `telemetria/{uid}` y al iniciar sesión el sistema recupera su nombre real y lo marca operativo.

Cómo funciona: Habilitas el módulo de Autenticación en la consola de Firebase (opción Correo/Contraseña).

En tu código: Creas un pequeño formulario de inicio de sesión. Cuando el conductor ingresa, Firebase le asigna un uid (User ID) único e irrepetible.

En la base de datos: A partir de ese momento, cada vez que el conductor envíe su ubicación GPS, la guardará en Firestore bajo un documento con su propio ID (ejemplo: telemetria/uid_del_conductor) y con un campo que diga estado: "disponible".

2. Mostrar Múltiples Conductores al Cliente (Multimarcadores) ✅ **Completado**
   El mapa del cliente (y del Admin) escucha la colección `telemetria` completa y dibuja un marcador por cada chofer que transmite GPS, con su nombre real. El cliente solo ve como seleccionables a los que tienen `estado_operativo: true`.

3. La Selección del Chofer ✅ **Completado**
   El cliente hace clic sobre un carrito del mapa (o usa la lista ordenada por distancia del panel), el popup muestra el nombre del conductor y el botón "Elegir a este conductor". Al pulsarlo se crea el viaje con `conductor_asignado: "uid_del_conductor"` y un ID dinámico. El conductor solo escucha los viajes donde `conductor_asignado` coincide con su propio UID.

4. Bloqueo y Auditoría por Desvío ✅ **Completado**
   Cuando un conductor se desvía de la ruta de su viaje activo, el sistema acumula detecciones consecutivas y lo bloquea al llegar al umbral (`bloqueado: true`), detiene su telemetría, cancela el viaje y guarda la auditoría. El Admin aprueba/desbloquea desde su panel y el conductor puede reconectarse.

5. Seguridad y Reglas de Firestore ✅ **Completado**
   Se agregó login para el Admin (correo `admin@despacho.com`) y autenticación anónima para el Cliente. `firestore.rules` endurecidas: solo usuarios autenticados leen; el conductor solo escribe su propio doc de `telemetria`; solo el conductor asignado o el Admin modifican un viaje; solo el Admin bloquea/desbloquea. Se ajustó la política de bloqueo a `UMBRAL_DESVIOS` (3) detecciones consecutivas.

**Pendiente para la siguiente iteración:**
*   Configuración en la consola de Firebase (imprescindible para que el endurecimiento funcione):
    1. Habilitar **Autenticación Anónima** (Authentication → Sign-in method → Anonymous).
    2. Crear la cuenta del Admin (Authentication → Users → Add user) con el correo `admin@despacho.com` y una contraseña. **Importante:** ese correo debe coincidir exactamente en tres lugares: la cuenta de Auth, la constante `ADMIN_EMAIL` del código (`index.html`) y el `admin@despacho.com` de `firestore.rules` (línea 20). Si se cambia, hay que cambiarlo en los tres.
    3. Publicar `firestore.rules`, por cualquiera de estas vías:
        *   **Consola (recomendado):** Firestore → pestaña "Reglas" → pegar el contenido de `firestore.rules` → Publicar.
        *   **CLI:** `firebase login`, luego `firebase use despacho-1eef3` (o un `.firebaserc`), y `firebase deploy --only firestore:rules`.
*   **Contexto:** si la base de datos Firestore está actualmente en modo de prueba (acceso abierto), publicar estas reglas endurecidas es justamente lo que la protege.
# Guía de Pruebas: Panel de Administración (Centro de Control)

**Módulo:** Panel de Administración (Dashboard Administrativo)
**Ruta de acceso:** `/admin/dashboard`
**Objetivo:** Validar que la pantalla principal de administración muestre correctamente los indicadores clave de la plataforma, gestione el acceso de forma segura y proteja la información sensible de los usuarios.

---

## 1. Seguridad y Control de Acceso (Privacidad)
**Propósito:** Asegurar que solo el personal autorizado pueda ver esta pantalla.

*   **Paso 1:** Iniciar sesión con un usuario que **no** tenga permisos de "Administrador de Dashboard" (por ejemplo, un perfil de visualizador o empleado regular).
*   **Paso 2:** Intentar ingresar directamente escribiendo la ruta `/admin/dashboard` en el navegador.
*   **Resultado esperado:** La pantalla debe bloquearse de inmediato y mostrar un mensaje claro de "Acceso Denegado" (ícono de candado cerrado), impidiendo ver cualquier tipo de información o métrica.
*   **Paso 3:** Iniciar sesión con un usuario que **sí** tenga el permiso de "Administrador de Dashboard".
*   **Resultado esperado:** El panel de administración debe cargar correctamente, mostrando el título "Panel de Administración".

## 2. Indicadores Clave (Tarjetas de Resumen)
**Propósito:** Confirmar que los cuatro cuadros principales de información muestren los números correctos para la toma rápida de decisiones.

*   **Paso 1:** Entrar al Panel de Administración con un usuario autorizado.
*   **Paso 2:** Observar la parte superior de la pantalla.
*   **Resultado esperado:** Deben aparecer cuatro tarjetas informativas:
    *   **Total Empresas:** Número total y su porcentaje de aprobación.
    *   **Pendientes:** Cantidad de empresas que están en sala de espera (requieren revisión).
    *   **Aprobadas:** Cantidad de empresas activas.
    *   **Total Usuarios:** Número general de personas registradas en el sistema.

## 3. Pestaña "Resumen" (Estadísticas Generales)
**Propósito:** Validar que se muestren las industrias y regiones más populares.

*   **Paso 1:** En la sección central, hacer clic en la pestaña que dice **"Resumen"**.
*   **Resultado esperado:** Deben aparecer dos listas claras:
    *   **Top Industrias:** Una tabla o lista que muestre los giros comerciales más frecuentes (ej. Tecnología, Comercio) con la cantidad de empresas en cada uno.
    *   **Top Estados:** Una lista de los estados de donde provienen más empresas, acompañado de su respectivo conteo.

## 4. Pestaña "Empresas" (Bandeja de Aprobaciones)
**Propósito:** Comprobar que el historial reciente de empresas funcione como una bandeja de entrada y evite clics accidentales.

*   **Paso 1:** Hacer clic en la pestaña que dice **"Empresas"**.
*   **Resultado esperado:** Debe mostrarse una lista con las empresas registradas más recientes, indicando nombre, RFC, fecha y quién la creó.
*   **Paso 2:** Observar las "Etiquetas de Estado" (Pendiente, Aprobado, Rechazado).
*   **Paso 3:** Identificar una empresa con el estatus "Pendiente" y revisar el botón con forma de ojo (Visualizar).
*   **Resultado esperado:** El botón debe estar encendido (habilitado) para permitir su revisión.
*   **Paso 4:** Identificar una empresa con el estatus "Aprobado" o "Rechazado" y revisar el mismo botón.
*   **Resultado esperado:** El botón con forma de ojo debe estar apagado (deshabilitado) para evitar que se intente aprobar una empresa que ya fue procesada.

## 5. Pestaña "Actividad" (Bitácora y Protección de Privacidad)
**Propósito:** Validar que el historial de acciones del sistema se muestre correctamente y, lo más importante, que oculte información sensible de los usuarios.

*   **Paso 1:** Hacer clic en la pestaña que dice **"Actividad"**.
*   **Resultado esperado:** Debe desplegarse una lista de acciones recientes (ej. "Se aprobó la empresa X").
*   **Paso 2:** Observar la sección donde aparece el correo electrónico de la persona que realizó la acción.
*   **Resultado esperado (Ciberseguridad):** El correo electrónico **no debe mostrarse completo**. Debe aparecer oculto con asteriscos (enmascarado) para proteger la privacidad. Por ejemplo, en lugar de `juan.perez@empresa.com`, debe leerse algo similar a `ju********@em*******.com`.

# Plan de Pruebas de Calidad (SonarQube) - CFDI TaskManager

Este documento es una lista de verificación (checklist) diseñada para validar que todas las refactorizaciones de calidad de código y seguridad realizadas durante la sesión funcionen correctamente desde la perspectiva del usuario final.

---

## 1. Pruebas de Gestión de Empresas
**Archivos afectados:** `src/app/api/companies/[id]/route.ts` y `src/app/api/companies/register/route.ts`
**Objetivo:** Validar que la extracción de funciones complejas y la actualización de la librería Zod no rompieron los flujos principales.

- [X] **Auditoría de Edición (Normalización de datos):**
  - **Acción:** Entra al sistema y edita los datos de una empresa existente (ej. modifica un campo numérico como *número de empleados* o una *fecha*).
  - **Verificación:** Guarda los cambios y revisa en la base de datos o en la interfaz (si existe un visor de bitácora) que el registro de auditoría haya guardado correctamente los valores "viejos" y los "nuevos" sin mostrar errores extraños como `[object Object]`.

- [X] **Aprobación de Empresas:**
  - **Acción:** Inicia sesión con una cuenta de administrador (ej. `admin@itcomplements.com`). Busca una empresa en estado "Pendiente".
  - **Verificación:** Aprueba (o rechaza) la empresa. El sistema debe mostrar el mensaje de éxito correspondiente y actualizar el estado de la empresa.

- [X] **Actualización General de Empresas:**
  - **Acción:** Edita cualquier dato de texto de una empresa (como la dirección o el teléfono).
  - **Verificación:** Al guardar, el sistema debe confirmar la actualización y los nuevos datos deben reflejarse inmediatamente en pantalla.

---

## 2. Pruebas de Autenticación y Seguridad (Login)
**Archivos afectados:** `src/lib/auth.ts`
**Objetivo:** Garantizar que las simplificaciones de código, la modernización de expresiones regulares y la limpieza de IPs *hardcoded* mantengan el acceso seguro.

- [X] **Validación de Entorno Local (Confianza de Host):**
  - **Acción:** Inicia el proyecto en tu entorno local (`npm run dev` o `npm run start`).
  - **Verificación:** Accede desde el navegador a `http://localhost:3000` o `http://127.0.0.1:3000`. Debes poder ver la pantalla de inicio de sesión y, al ingresar, el sistema no debe regresarte a la pantalla de login por un error de "Host no confiable".

- [X] **Inicio de Sesión y Lectura de Contraseñas:**
  - **Acción:** Cierra tu sesión actual e intenta iniciar sesión nuevamente con tu correo y contraseña habituales.
  - **Verificación:** El acceso debe ser exitoso y debes poder entrar a tu panel de control (Dashboard). Esto confirma que las importaciones agrupadas, el módulo nativo de criptografía y la nueva forma de analizar la encriptación de tu contraseña funcionan a la perfección.

- [ ] **Bloqueo por Intentos Fallidos (Rate Limit):**
  - **Acción:** Intenta iniciar sesión con una contraseña incorrecta varias veces seguidas (si el sistema tiene configurado un límite visible corto).
  - **Verificación:** El sistema debe mostrar un error de "Credenciales inválidas" o pedirte que esperes antes de intentar nuevamente, confirmando que la seguridad contra ataques de fuerza bruta sigue activa.

---

## 3. Pruebas de Descargas y Dashboard Fiscal
**Archivos afectados:** `src/lib/dashboard-fiscal-route-utils.ts`
**Objetivo:** Confirmar que la limpieza de nombres de archivos contra ataques ReDoS y la modernización de caracteres especiales funcionan al descargar documentos.

- [X] **Acceso al Dashboard:**
  - **Acción:** Inicia sesión y navega a la sección del Dashboard Fiscal o Dashboard de Recibidos.
  - **Verificación:** La página debe cargar tus métricas e información sin arrojar errores de permisos (validando que la configuración por defecto optimizada funciona).

- [X] **Descarga de Archivos Básicos:**
  - **Acción:** Descarga cualquier archivo (XML o PDF) desde el Dashboard de Recibidos.
  - **Verificación:** El archivo debe descargarse correctamente con la extensión adecuada (`.xml` o `.pdf`) y debes poder abrirlo en tu computadora.

- [-] **Descarga de Archivos con Caracteres Especiales:**
  - **Acción:** Localiza una factura cuyo emisor o receptor contenga acentos (á, é, í, ó, ú) o la letra "ñ" y descarga su documento PDF o papel de trabajo.
  - **Verificación:** El archivo descargado debe conservar los acentos en su nombre o haberlos limpiado/traducido de forma segura (sin corromper el archivo ni mostrar símbolos como ``). El archivo debe abrirse sin problemas.

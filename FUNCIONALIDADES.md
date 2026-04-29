# Funcionalidades del Sistema - CFDI Task Manager

Este documento enlista las funcionalidades desarrolladas desde el inicio del proyecto, organizadas por módulo y submódulo.

## 1. Administración de la Organización
Este módulo centraliza la gestión multi-tenant, permitiendo a los usuarios administrar sus empresas, usuarios y permisos.

### 1.1. Gestión de Empresas (Companies)
* **Registro de Empresas:** Alta de nuevas razones sociales vinculadas a un RFC, validando que no existan duplicados a nivel global.
* **Carga de Logotipo:** Subida y almacenamiento de logotipo personalizado por empresa para personalizar la interfaz y reportes.
* **Cambio de Contexto:** Selector global en el header que permite al usuario alternar entre las diferentes empresas a las que tiene acceso, filtrando automáticamente toda la información del sistema (Dashboards, CFDIS, Descargas) según la empresa activa.

### 1.2. Gestión de Usuarios y Permisos
* **Directorio de Miembros:** Listado de usuarios pertenecientes a la organización.
* **Asignación de Accesos:** Capacidad para otorgar o revocar acceso a empresas específicas dentro de la organización a cada usuario.
* **Control de Roles:** Asignación de roles (Owner, Admin, Member) que delimitan los permisos de visualización y edición en la plataforma.

### 1.3. Configuración de API Keys
* **Generación de Tokens:** Creación de API Keys seguras para integración con sistemas de terceros (ERP, CRM) para la importación automática de CFDIS.
* **Monitoreo de Uso:** Registro del último uso de la API Key.

---

## 2. Tablero de Ingresos (Dashboard Fiscal)
Dashboard analítico y visual que resume la salud fiscal y el comportamiento de facturación (CFDIs emitidos) de la empresa activa.

* **KPIs Dinámicos:** Tarjetas resumen calculadas en tiempo real desde la base de datos (Total Facturado, Impuestos Trasladados, Impuestos Retenidos).
* **Filtro Temporal:** Selector de rangos de fechas (Mes actual, Año actual, Histórico) que actualiza todas las gráficas y KPIs.
* **Gráficas de Análisis:**
  * **Ingresos vs Gastos:** Comparativa visual de flujo (usando Recharts).
  * **Métodos de Pago:** Gráfica de pastel mostrando la proporción de pagos en una sola exhibición (PUE) vs parcialidades (PPD).
  * **CFDI por Tipo:** Desglose de documentos emitidos por su naturaleza (Ingreso, Egreso, Pago, Traslado).
  * **Desglose de Impuestos:** Visualización detallada de IVA e ISR retenido y trasladado.
* **Top 10:** Tablas resumen con los mejores clientes y los productos más facturados basados en el análisis de los XML.

---

## 3. Ingresos
Módulo operativo para la consulta, análisis y exportación detallada de los comprobantes fiscales emitidos.

### 3.1. Workpaper (Reporte de Ingresos)
* **Tabla de Datos Dinámica:** Listado completo de facturas emitidas con soporte para miles de registros.
* **Filtros Avanzados:** Búsqueda por folio, UUID, RFC receptor, nombre y estatus del SAT.
* **Agrupación de Columnas (XML):** Selector de columnas avanzado que agrupa los campos disponibles basándose en la estructura oficial del anexo 20 del SAT (`<cfdi:Comprobante>`, `<cfdi:Emisor>`, `<cfdi:Receptor>`, `<cfdi:Impuestos>`).
* **Vista Expandible de Conceptos:** Capacidad de desplegar una fila interna por factura para ver la tabla detallada de los productos/servicios vendidos (Extraídos en vivo mediante parseo DOM del XML).
* **Extracción de Nodos Específicos:** Lectura nativa de atributos del XML como Certificado, Versión, Tipo de Relación y CFDI Relacionados.
* **Persistencia de Preferencias:** El sistema recuerda las columnas seleccionadas y su orden exacto por usuario, guardando esta configuración en su perfil.
* **Generación de PDF (Puppeteer):** Descarga individual de la representación impresa de la factura, generada del lado del servidor asegurando el diseño exacto (Tailwind CSS) y el código QR del SAT.

### 3.2. Cancelaciones
* **Monitoreo de Estatus:** Tablero específico para dar seguimiento a facturas canceladas o en proceso de cancelación.
* **Filtro de Clasificación:** Vista unificada que permite ver tanto CFDIS Emitidos cancelados como Recibidos cancelados, dependiendo de la selección del usuario.

### 3.3. Monitor de APIs / Importaciones
* **Log de Sincronización:** Registro de las cargas de XML realizadas mediante el endpoint de importación.

---

## 4. Descargas Masivas de CFDI
Módulo de integración directa con los WebServices del SAT para la obtención automatizada de XMLs y Metadatos, sin necesidad de entrar al portal oficial.

### 4.1. Configuración de Credenciales (Llaves)
* **Bóveda Segura:** Formulario para la carga de los archivos de la FIEL (.cer y .key) y la contraseña privada.
* **Encriptación de Datos Sensibles:** La contraseña y la llave privada (.key) se encriptan a nivel de servidor utilizando AES-256-GCM antes de guardarse en la base de datos (la llave maestra reside únicamente en variables de entorno `.env`).

### 4.2. Nueva Solicitud (Request Form)
* **Parámetros SAT:** Formulario alineado a las reglas del SAT (Fechas de inicio/fin, Tipo de Comprobante, Emitidos/Recibidos).
* **Ajuste de Fechas Automático:** Lógica interna que corrige las fechas idénticas (00:00:00) llevándolas hasta el final del día (23:59:59) para evitar el error `301 - XML Mal Formado` del SAT.
* **Firma SOAP:** Generación de la estructura XML SOAP y firmado electrónico usando `xml-crypto` bajo los estándares del W3C requeridos por el WebService del SAT.
* **Feedback de Errores Mejorado:** Notificaciones en pantalla (Toasts) que muestran el Código de Estatus del SAT, el Mensaje Descriptivo y, en caso de error, el XML de la solicitud enviada para fácil depuración.

### 4.3. Panel de Control Fiscal (Fiscal Control)
* **Tabla de Solicitudes y Paquetes:** Visualización del historial de solicitudes realizadas al SAT.
* **Sincronización de Columnas:** Reutilización de la lógica del Workpaper para agrupar, seleccionar y guardar las preferencias de columnas basadas en los nodos XML.
* **Exportación CSV:** Botón para exportar a Excel/CSV los registros visibles en la tabla, aplicando de manera exacta los mismos filtros y búsquedas que el usuario tiene activos en pantalla, manejando correctamente caracteres especiales y nulos.

### 4.4. Monitor de Verificación y Descargas
* **Verificación Asíncrona (BullMQ + Redis):** Una vez hecha la solicitud, el sistema no bloquea al usuario; un Worker en segundo plano se encarga de preguntar periódicamente al SAT si el paquete ya está listo.
* **Backoff Exponencial:** Algoritmo que incrementa el tiempo de espera entre verificaciones si el SAT demora, evitando bloqueos por peticiones excesivas (Error 5004).
* **Descarga y Extracción Segura:** Proceso para descargar el paquete codificado en Base64, decodificar el ZIP y guardar los XMLs físicos.
* **Parseo de Big Data (Metadatos):** Implementación de Node.js Streams (`createReadStream`) para procesar archivos gigantes de Metadatos (más de 1 millón de registros) línea por línea, evitando el colapso de la memoria RAM del servidor e insertando en la base de datos en lotes de 5,000 registros.
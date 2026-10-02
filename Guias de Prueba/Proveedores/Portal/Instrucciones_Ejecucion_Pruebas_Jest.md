# Instrucciones de Ejecución de Pruebas Automatizadas con Jest
## Módulo: Portal de Proveedores (`/provider/cfdis-report`)

Este documento explica de forma clara cómo ejecutar las pruebas automatizadas (script de Jest) para el **Portal de Proveedores**, y cómo interpretar los resultados de la simulación.

---

### Requisitos Previos

1. Asegúrate de estar en la computadora donde está el proyecto (Windows).
2. Abre la terminal de comandos de tu editor (por ejemplo, en VS Code, presiona `Ctrl + \`` o ve a `Terminal -> Nueva Terminal`).
3. Verifica que estás en la carpeta principal del proyecto (`cfdi_taskmanager_demo`).

---

### Paso 1: Ejecutar el Script de Pruebas

Para correr únicamente las pruebas del **Portal de Proveedores**, debes escribir (o copiar y pegar) el siguiente comando en tu terminal y presionar **Enter**:

```bash
npx jest "Guias de Prueba/Proveedores/Portal/provider_cfdis_report.test.tsx"
```

### Paso 2: ¿Qué hace el sistema durante la ejecución?

Una vez que presiones Enter, el sistema "simulará" que es un Proveedor usando la plataforma. El sistema evaluará los siguientes puntos de forma automática:

1. **Carga Inicial y Visualización del Historial:** Verifica que el proveedor pueda ver su panel principal ("CFDI del proveedor") y que el historial de facturas previamente cargadas se renderice correctamente en la pantalla, incluyendo sus montos y estatus de pago.
2. **Carga de CFDI (Happy Path):** Simula el flujo donde el proveedor hace clic en el botón de "Cargar CFDI" (ícono de carga) para abrir el modal donde se depositan los XML o archivos ZIP.
3. **Interacción con el Grid y Visores:** Verifica que la tabla de resultados cargue el UUID de las facturas correctamente y que los botones de interacción (como expandir fila, ver XML o descargar PDF) estén presentes y listos para ser utilizados por el proveedor.

*(Nota Técnica: Debido a que la carga de archivos (Dropzone) y la consulta a Webservices del SAT reales requieren interacciones complejas de red y navegador completo, Jest valida estructuralmente que la interfaz esté lista y conectada para realizar estas acciones sin romper la página).*

### Paso 3: Interpretar los Resultados

Cuando el proceso termine (toma un par de segundos), la terminal te mostrará un reporte.

#### Si las pruebas son EXITOSAS (Verde):
Verás un mensaje que dice **`PASS`** resaltado en color verde.
Esto significa que el portal carga correctamente, el proveedor puede ver su historial y la interfaz de carga de archivos está operativa.

#### Si las pruebas FALLAN (Rojo):
Verás un mensaje que dice **`FAIL`** en color rojo.
Debajo del error, la terminal te indicará qué sección falló (ej. la tabla no cargó el historial). Si esto sucede, copia el error rojo y repórtalo.

---

### Paso 4: Generar la Evidencia

Al terminar las pruebas, busca en la misma carpeta de este documento el archivo `Evidencia_Resultados_Jest_[Fecha].csv`. 

Este archivo de Excel/CSV contiene el registro oficial de qué pruebas pasaron, y sirve como evidencia documentada para demostrar que la funcionalidad base del portal de proveedores está trabajando de forma óptima.
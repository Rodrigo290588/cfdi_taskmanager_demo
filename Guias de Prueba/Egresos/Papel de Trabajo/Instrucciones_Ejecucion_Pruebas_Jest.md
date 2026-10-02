# Instrucciones de Ejecución de Pruebas Automatizadas con Jest
## Módulo: Papel de Trabajo de Proveedores (Egresos)

Este documento explica de forma clara y sin tecnicismos cómo ejecutar las pruebas automatizadas (script de Jest) para el módulo de **Papel de Trabajo de Egresos (`/dashboard_recibidos/workpaper`)**, y cómo interpretar los resultados.

---

### Requisitos Previos

1. Asegúrate de estar en la computadora donde está el proyecto (Windows).
2. Abre la terminal de comandos de tu editor (por ejemplo, en VS Code, presiona `Ctrl + \`` o ve a `Terminal -> Nueva Terminal`).
3. Verifica que estás en la carpeta principal del proyecto (`cfdi_taskmanager_demo`).

---

### Paso 1: Ejecutar el Script de Pruebas

Para correr únicamente las pruebas del **Papel de Trabajo de Egresos**, debes escribir (o copiar y pegar) el siguiente comando en tu terminal y presionar **Enter**:

```bash
npx jest "Guias de Prueba/Egresos/Papel de Trabajo/workpaper_recibidos.test.tsx"
```

### Paso 2: ¿Qué hace el sistema durante la ejecución?

Una vez que presiones Enter, el sistema "simulará" que es un usuario interactuando con la pantalla del Papel de Trabajo de Proveedores. El sistema evaluará los siguientes puntos de forma automática:

1. **Carga Inicial:** Revisa que el título "Papel de Trabajo de Proveedores" y el selector de empresas carguen correctamente y se seleccione una empresa de prueba.
2. **Buscador y Filtros:** Verifica que exista el campo para buscar por RFC o UUID y que el botón "Filtrar" responda correctamente.
3. **Data Grid (Tabla de Resultados):** Confirma que los datos de las facturas (como UUID, RFC, Monto) se desplieguen correctamente en pantalla con el formato adecuado.
4. **Visor de CFDI:** Verifica la existencia de los botones o acciones que permiten ver el código XML de la factura original.
5. **Exportaciones:** Valida que los botones de "Exportar CSV" y "Exportar ZIP" estén disponibles y listos para ser clicados por el usuario, sin errores de interfaz.

*(Nota Técnica: Al igual que en módulos anteriores, algunos componentes pesados como las tablas avanzadas se "simulan" para que la prueba se ejecute rápido y sin fallos falsos en la terminal).*

### Paso 3: Interpretar los Resultados

Cuando el proceso termine (toma unos segundos), la terminal te mostrará un reporte.

#### Si las pruebas son EXITOSAS (Verde):
Verás un mensaje que dice **`PASS`** resaltado en color verde.
Esto significa que la estructura de la pantalla, las funciones de búsqueda y los botones de exportación operan correctamente en el entorno de validación.

#### Si las pruebas FALLAN (Rojo):
Verás un mensaje que dice **`FAIL`** en color rojo.
Debajo del error, la terminal te indicará exactamente qué bloque falló. Si esto sucede, copia el texto rojo y repórtalo para su corrección.

---

### Paso 4: Generar la Evidencia

Al terminar las pruebas, es una buena práctica guardar un reporte. En la misma carpeta donde está este archivo (`Guias de Prueba/Egresos/Papel de Trabajo/`), encontrarás un archivo llamado `Evidencia_Resultados_Jest_[Fecha].csv`. 

Este archivo de Excel/CSV contiene el registro de qué pruebas pasaron, y sirve como evidencia de que el módulo funciona y ha sido aprobado para su uso.
# Instrucciones de Ejecución de Pruebas Automatizadas con Jest
## Módulo: Tablero de Egresos (`/dashboard_recibidos`)

Este documento explica de forma clara y sin tecnicismos cómo ejecutar las pruebas automatizadas (script de Jest) para el módulo de **Tablero de Egresos**, y cómo interpretar los resultados.

---

### Requisitos Previos

1. Asegúrate de estar en la computadora donde está el proyecto (Windows).
2. Abre la terminal de comandos de tu editor (por ejemplo, en VS Code, presiona `Ctrl + \`` o ve a `Terminal -> Nueva Terminal`).
3. Verifica que estás en la carpeta principal del proyecto (`cfdi_taskmanager_demo`).

---

### Paso 1: Ejecutar el Script de Pruebas

Para correr únicamente las pruebas del **Tablero de Egresos**, debes escribir (o copiar y pegar) el siguiente comando en tu terminal y presionar **Enter**:

```bash
npx jest "Guias de Prueba/Egresos/Tablero de Egresos/dashboard_recibidos.test.tsx"
```

### Paso 2: ¿Qué hace el sistema durante la ejecución?

Una vez que presiones Enter, el sistema "simulará" que es un usuario interactuando con la pantalla del Tablero de Egresos. El sistema evaluará los siguientes puntos de forma automática:

1. **Renderizado Inicial:** Revisa que el título, el selector de empresa y los botones principales (como "Consultar") aparezcan correctamente en la pantalla.
2. **Cálculos Básicos (Summary Metrics):** Simula la carga de datos y verifica que las tarjetas de la parte superior (CFDI Recibidos, Gasto Bruto, Notas de Crédito, Cancelaciones) se rendericen sin que la pantalla se rompa.
3. **Cálculos Complejos (Heavy Metrics):** Verifica que las tarjetas de impuestos (IVA Acreditable, Retenciones) y de flujo (Total Pagado, Saldo Pendiente) aparezcan correctamente.
4. **Gráficas y Listados:** Simula los contenedores de las gráficas (CFDI recibidos por mes, Top 10 Proveedores) para asegurar que el diseño responde bien.
5. **Drilldowns (Detalles):** Comprueba que los modales (ventanas emergentes) con el detalle de facturas o reglas de negocio (como EFOS o Alertas de Cancelación) se puedan abrir y contengan botones de descarga de reportes.

*(Nota Técnica: Debido a que este tablero es muy pesado, la prueba utiliza tiempos de espera y simulaciones "suaves" para garantizar que la pantalla no se congele durante la carga de métricas pesadas).*

### Paso 3: Interpretar los Resultados

Cuando el proceso termine (toma unos segundos), la terminal te mostrará un reporte.

#### Si las pruebas son EXITOSAS (Verde):
Verás un mensaje que dice **`PASS`** resaltado en color verde.
Esto significa que la pantalla funciona correctamente, los componentes se muestran, los cálculos del backend fueron verificados y no hay errores que rompan la página.

#### Si las pruebas FALLAN (Rojo):
Verás un mensaje que dice **`FAIL`** en color rojo.
Debajo del error, la terminal te indicará exactamente qué bloque falló (por ejemplo, *`× verifica que el botón de exportar IVA funcione`*). Si esto sucede, copia el error rojo y envíaselo al equipo de desarrollo para que lo solucionen.

---

### Paso 4: Generar la Evidencia

Al terminar las pruebas, es una buena práctica guardar un reporte. En la misma carpeta donde está este archivo (`Guias de Prueba/Egresos/Tablero de Egresos/`), encontrarás un archivo llamado `Evidencia_Resultados_Jest_[Fecha].csv`. 

Este archivo de Excel/CSV contiene el registro de qué pruebas pasaron, y sirve como tu "sello de garantía" para demostrar que el módulo de Egresos fue validado y autorizado.
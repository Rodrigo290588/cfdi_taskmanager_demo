# Instrucciones de Ejecución de Pruebas Automatizadas con Jest
## Módulo: Descargas Masivas - Configuración de Llaves (`/mass-downloads`)

Este documento explica cómo ejecutar las pruebas automatizadas (script de Jest) para el formulario de **Configuración de Llaves Privadas y Certificados**.

---

### Paso 1: Abrir la Terminal
Abre la terminal de comandos de tu editor de código asegurándote de estar en la carpeta raíz del proyecto (`cfdi_taskmanager_demo`).

### Paso 2: Ejecutar el Comando
Copia y pega el siguiente comando en la terminal y presiona **Enter**:

```bash
npx jest "Guias de Prueba/Descargas Masivas/Configuracion/configuracion_descargas.test.tsx"
```

### Paso 3: ¿Qué está validando el sistema?
El script simula de forma invisible la interacción de un usuario con el formulario, ejecutando 5 escenarios clave:
1. **Renderizado Inicial (UX):** Verifica que el formulario cargue correctamente y que el botón del "ojo" alterne la visibilidad de la contraseña.
2. **Envío en Blanco (Error):** Presiona "Guardar" sin llenar nada para asegurar que el sistema bloquee la petición y exija los archivos.
3. **Archivo Inválido (Error):** Simula subir un archivo `.pdf` en el campo del `.key` para verificar que la interfaz lo rechace instantáneamente.
4. **Rechazo del Servidor (Error):** Envía archivos correctos pero simula que el servidor rechaza la contraseña, asegurando que se muestre la alerta roja al usuario.
5. **Happy Path (Éxito):** Completa todo el flujo de forma válida y verifica que el sistema muestre el mensaje verde de éxito y envíe el `FormData` correctamente.

### Paso 4: Interpretar los Resultados
- Si el resultado es **`PASS` (Verde)**, significa que todas las reglas de negocio y validaciones del formulario están funcionando perfectamente.
- En la misma carpeta encontrarás el archivo `Evidencia_Resultados_Jest_[Fecha].csv` con el registro oficial de la ejecución.
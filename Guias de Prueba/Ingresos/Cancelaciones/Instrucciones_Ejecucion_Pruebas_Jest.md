# 🚀 Guía de Ejecución de Pruebas Automatizadas (Jest)

Este documento explica paso a paso cómo ejecutar el script de pruebas automatizadas (`cancelaciones.test.tsx`) que hemos creado para el módulo de Cancelaciones. Está redactado para que cualquier persona del equipo pueda correr la validación.

---

## 1. ¿Qué es Jest y qué hace?
Jest es una herramienta de código que funciona como un "robot" probador. Lee las instrucciones que le dejamos en el archivo de pruebas, simula que hace clic en los botones de nuestra interfaz y verifica automáticamente que el comportamiento del módulo sea el correcto, incluyendo filtros, visualización y el modal de importación de layout. Todo esto en cuestión de segundos.

---

## 2. Pasos para ejecutar las pruebas

### Paso A: Abrir la terminal
Abra la consola de comandos o terminal dentro de su editor de código (es la misma pantalla negra donde usualmente escribe `npm run dev` para encender el proyecto).

### Paso B: Ejecutar el comando de prueba
Para correr específicamente las pruebas de Cancelaciones que acabamos de crear, copie, pegue el siguiente comando y presione Enter:

```bash
npx jest "Guias de Prueba/Ingresos/Cancelaciones/cancelaciones.test.tsx"
```

*(Nota técnica: Si su equipo de desarrollo configura un atajo global en el archivo `package.json` en el futuro, este comando podría simplificarse).*

---

## 3. ¿Cómo leer los resultados en pantalla?

Una vez que el "robot" termine de revisar todas las reglas de negocio (tardará unos pocos segundos), le mostrará un resumen visual en la consola:

- 🟢 **PASS (Verde):** Significa que la prueba pasó exitosamente. El filtrado, la exportación, y el modal de subida de layout funcionan exactamente como se espera según nuestras reglas fiscales.
- 🔴 **FAIL (Rojo):** Significa que hay un error o discrepancia. Por ejemplo, el sistema permitía subir un archivo diferente a `.txt`. La consola le indicará con un texto en rojo exactamente en qué prueba falló, para que el equipo de programación pueda revisarlo.

---

## 4. ⚠️ Nota importante para el equipo de Desarrollo
El archivo `cancelaciones.test.tsx` contiene pruebas de integración que validan el comportamiento de la UI utilizando JSDOM, simulando las respuestas de las APIs (`/api/dashboard_fiscal/invoices` y `/api/dashboard_fiscal/cancelaciones/import-layout`). 

Si en el futuro se agregan nuevas reglas o se cambian validaciones (por ejemplo, permitir subir archivos `.csv` en lugar de `.txt`), asegúrese de:
1. Actualizar primero la Guía de Pruebas y el Checklist.
2. Ajustar el bloque `it('...')` correspondiente en el archivo de pruebas de Jest.
3. Volver a correr el comando para confirmar que todo sigue funcionando en verde (Regresión).

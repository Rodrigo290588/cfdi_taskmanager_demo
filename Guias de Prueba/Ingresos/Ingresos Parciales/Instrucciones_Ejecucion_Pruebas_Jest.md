# 🚀 Guía de Ejecución de Pruebas Automatizadas (Jest)

Este documento explica paso a paso cómo ejecutar el script de pruebas automatizadas (`ingresos_parciales.test.tsx`) que hemos creado para el módulo de Ingresos Parciales. Está redactado para que cualquier persona del equipo pueda correr la validación.

---

## 1. ¿Qué es Jest y qué hace?
Jest es una herramienta de código que funciona como un "robot" probador. Lee las instrucciones que le dejamos en el archivo de pruebas, simula que hace clic en los botones de nuestra interfaz y verifica automáticamente que los cálculos matemáticos del servidor sean correctos, todo en cuestión de segundos.

---

## 2. Pasos para ejecutar las pruebas

### Paso A: Abrir la terminal
Abra la consola de comandos o terminal dentro de su editor de código (es la misma pantalla negra donde usualmente escribe `npm run dev` para encender el proyecto).

### Paso B: Ejecutar el comando de prueba
Para correr específicamente las pruebas de Ingresos Parciales que acabamos de crear, copie, pegue el siguiente comando y presione Enter:

```bash
npx jest "Guias de Prueba/Ingresos/Ingresos Parciales/ingresos_parciales.test.tsx"
```

*(Nota técnica: Si su equipo de desarrollo configura un atajo global en el archivo `package.json` en el futuro, este comando podría simplificarse).*

---

## 3. ¿Cómo leer los resultados en pantalla?

Una vez que el "robot" termine de revisar todas las reglas de negocio (tardará unos pocos segundos), le mostrará un resumen visual en la consola:

- 🟢 **PASS (Verde):** Significa que la prueba pasó exitosamente. El cálculo de la tarjeta, el comportamiento de los Drilldowns, el filtrado de la tabla y las exportaciones funcionan exactamente como se espera según nuestras reglas fiscales.
- 🔴 **FAIL (Rojo):** Significa que hay un error o discrepancia. Por ejemplo, el sistema esperaba que la tarjeta mostrara un saldo insoluto específico pero en realidad calculó otro. La consola le indicará con un texto en rojo exactamente en qué prueba falló, para que el equipo de programación pueda revisarlo.

---

## 4. ⚠️ Nota importante para el equipo de Desarrollo
El archivo `ingresos_parciales.test.tsx` contiene pruebas de integración que validan el comportamiento de la UI utilizando JSDOM, simulando las respuestas de la API (`/api/dashboard_fiscal/ingresos-parciales`). 

Si en el futuro se agregan nuevas reglas de negocio o se modifican los filtros, asegúrese de:
1. Actualizar primero la Guía de Pruebas y el Checklist.
2. Añadir el nuevo bloque `it('...')` en el archivo de pruebas de Jest correspondiente.
3. Volver a correr el comando para confirmar que todo sigue funcionando en verde (Regresión).

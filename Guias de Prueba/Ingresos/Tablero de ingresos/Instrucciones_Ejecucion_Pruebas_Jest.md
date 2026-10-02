# 🚀 Guía de Ejecución de Pruebas Automatizadas (Jest)

Este documento explica paso a paso cómo ejecutar el script de pruebas automatizadas (`dashboard_fiscal.test.tsx`) que hemos creado para el Tablero de Ingresos. Está redactado para que cualquier persona del equipo pueda correr la validación.

---

## 1. ¿Qué es Jest y qué hace?
Jest es una herramienta de código que funciona como un "robot" probador. Lee las instrucciones que le dejamos en el archivo de pruebas, simula que hace clic en los botones de nuestra interfaz y verifica automáticamente que los cálculos matemáticos del servidor sean correctos, todo en cuestión de segundos.

---

## 2. Pasos para ejecutar las pruebas

### Paso A: Abrir la terminal
Abra la consola de comandos o terminal dentro de su editor de código (es la misma pantalla negra donde usualmente escribe `npm run dev` para encender el proyecto).

### Paso B: Ejecutar el comando de prueba
Para correr específicamente las pruebas del Tablero de Ingresos que acabamos de crear, copie, pegue el siguiente comando y presione Enter:

```bash
npx jest "Guias de Prueba/Ingresos/Tablero de ingresos/dashboard_fiscal.test.tsx"
```

*(Nota técnica: Si su equipo de desarrollo configura un atajo global en el archivo `package.json` en el futuro, este comando podría simplificarse simplemente a `npm run test`).*

---

## 3. ¿Cómo leer los resultados en pantalla?

Una vez que el "robot" termine de revisar todas las reglas de negocio (tardará unos pocos segundos), le mostrará un resumen visual en la consola:

- 🟢 **PASS (Verde):** Significa que la prueba pasó exitosamente. El cálculo de la tarjeta, el bloqueo de los Drilldowns o el comportamiento de la interfaz funcionan exactamente como se espera según nuestras reglas fiscales.
- 🔴 **FAIL (Rojo):** Significa que hay un error o discrepancia. Por ejemplo, el sistema esperaba que la tarjeta mostrara $100 pero en realidad calculó $80. La consola le indicará con un texto en rojo exactamente en qué tarjeta o regla falló, para que el equipo de programación pueda revisarlo.

---

## 4. ⚠️ Nota importante para el equipo de Desarrollo
El archivo `dashboard_fiscal.test.tsx` actual es una **Plantilla Estructural (Scaffold)**. 
Esto significa que ya contiene la estructura lógica y todas las descripciones de las reglas de negocio (basadas en nuestro Checklist oficial), pero el equipo de desarrollo debe realizar la "conexión final". 

**Tareas pendientes para desarrollo antes de correr el test por primera vez:**
1. Importar los componentes reales de React (`DashboardFiscalPage`, etc.).
2. Configurar el *Mocking* de la API (`/api/dashboard_fiscal/heavy-metrics`) o inyectar datos simulados de Prisma para que el robot tenga números reales con los cuales comparar.
3. Reemplazar los placeholders `expect(true).toBe(true)` por los *expects* reales de la librería `@testing-library/react`.
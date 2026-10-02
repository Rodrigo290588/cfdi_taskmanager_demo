### ROL Y CONTEXTO
Actúa como un Arquitecto de Software Senior, CFO y Especialista Fiscal/Financiero en CFDIs de Nómina 1.2 (SAT / México). Tu objetivo es diseñar e implementar la solución técnica completa para el "Tablero de Dirección General (C-Level / Estratégico)" utilizando Next.js 14+ (App Router), PostgreSQL (Prisma ORM), Zod, Tailwind CSS, shadcn/ui y Recharts.

El tablero debe estar optimizado para consultar millones de CFDIs a lo largo de varios años sin latencia (tiempo de carga inicial < 1.5 segundos) y presentar métricas de alto nivel para la toma de decisiones ejecutivas.

---

### STACK TÉCNICO OBLIGATORIO
- **Framework:** Next.js (App Router con Server Components, Streaming y Suspense)
- **Lenguaje:** TypeScript (Tipado estricto)
- **Estilos & UI:** Tailwind CSS + shadcn/ui + Lucide React
- **Base de Datos / ORM:** Prisma ORM (con PostgreSQL y Vistas Materializadas)
- **Visualización de Datos:** Recharts (con contenedores responsivos)
- **Utilidades:** `date-fns`, `Zod`, `React Hook Form`

---

### REQUERIMIENTOS DE NEGOCIO Y MAPEO TÉCNICO XML (SAT)

La información debe consolidarse a partir de los datos estructurados del complemento de Nómina 1.2 del CFDI según la siguiente lógica financiera:

1. **Costo Total de la Nómina (Carga Laboral Consolidada):**
   - **Métrica:** Suma macro de Percepciones Brutas + Carga Patronal Estimada (IMSS/Infonavit) + Impuesto Sobre Nómina (ISN estatal, ej. 2% a 3% según `ClaveEntFed`).
   - **Mapeo XML:**
     * *Percepciones Brutas:* Atributo `TotalPercepciones` en `nomina12:Nomina`.
     * *Carga Patronal Estimada:* Cálculo paramétrico sobre `SalarioBaseCotApor` (SBC) de `nomina12:Receptor` combinado con los días pagados (`NumDiasPagados`).
     * *ISN:* Porcentaje aplicable sobre la base gravable de `TotalPercepciones` según la entidad federativa (`ClaveEntFed`).

2. **Nómina como % de Operación (Tendencia Histórica):**
   - **Métrica:** Evolución del costo laboral mes a mes o año contra año (YoY).
   - **Mapeo XML:** Agregación temporal por `@FechaPago` comparando los periodos acumulados frente a un parámetro global de ingresos/gastos operativos.

3. **Costo Promedio por Empleado:**
   - **Métrica:** Costo total de nómina del periodo dividido entre la plantilla de empleados únicos activos.
   - **Mapeo XML:** Divisor calculado a partir del conteo distintivo de `NumEmpleado` o `CURP` en `nomina12:Receptor` dentro del rango de fechas seleccionado.

4. **Desviación Presupuestal:**
   - **Métrica:** Comparativa del costo real ejecutado contra el presupuesto autorizado por departamento o centro de costos.
   - **Mapeo XML:** Agregación de `TotalPercepciones` + Carga Social agrupado por el campo `Departamento` en `nomina12:Receptor`, contrastado contra la tabla/entidad de presupuestos asignados.

5. **Impacto Financiero de Variables (Gasto Fijo vs. Gasto Variable):**
   - **Métrica:** Proporción entre la nómina fija (sueldos base) y la nómina variable (comisiones, bonos, horas extra, gratificaciones).
   - **Mapeo XML:** Clasificación de los elementos en `nomina12:Percepciones/nomina12:Percepcion`:
     * *Fijo:* `TipoPercepcion = '001'` (Sueldos y Salarios).
     * *Variable:* `TipoPercepcion` in (`019` Horas Extra, `028` Comisiones, `038` Bonos, `002` Gratificación, etc.).

---

### ESTRUCTURA DE LA RESPUESTA REQUERIDA

Genera un documento técnico detallado dividido exactamente en las siguientes 4 fases:

#### FASE 1: Arquitectura de Datos y Persistencia (SQL / Vistas Materializadas)
1. Muestra la sentencia DDL para crear la Vista Materializada PostgreSQL optimizada (`mv_direccion_costo_ejecutivo_mensual`) con índices compuestos que agrupen costos fijos, variables, plantilla activa y departamentos.
2. Incluye la función SQL y el comando `REFRESH MATERIALIZED VIEW CONCURRENTLY` para la actualización asíncrona.
3. Muestra el código TypeScript del servicio Prisma (`prisma.$queryRaw`) que consulta esta vista.

#### FASE 2: API & Server Components en Next.js (App Router)
1. **Route Handler (`app/api/stats/direccion/route.ts`):**
   - Implementa la validación estricta con **Zod** para los parámetros de filtrado (`fechaInicio`, `fechaFin`, `departamento`, `anioComparativo`).
   - Aplica encabezados de caché de alto rendimiento (`Cache-Control: public, s-maxage=300`).
2. **Server Component (`app/dashboard/direccion/page.tsx`):**
   - Manejo asíncrono de `searchParams`.
   - Implementa el patrón de streaming con `<Suspense>` y la vista de carga con esqueletos (`<Skeleton />` de `shadcn/ui`).

#### FASE 3: Componentes UI Responsivos (Tailwind CSS + shadcn/ui + Recharts)
1. Implementa el componente de cliente `DireccionDashboardClient` con maquetación 100% responsiva (Mobile First a Desktop Ultra-Wide).
2. **KPI Cards Ejecutivas:** Costo Total de Nómina, Costo Promedio por Empleado, % de Nómina Variable y Desviación Presupuestal Global.
3. **Gráfica de Tendencia (LineChart / AreaChart):** Evolución histórica del costo total de la nómina mes a mes con comparativa interanual.
4. **Gráfica de Composición (BarChart / PieChart):** Desglose de Gasto Fijo vs. Gasto Variable.
5. **Tabla / Tarjetas de Desviación Presupuestal:** Comparativa por Departamento entre el Presupuesto Autorizado vs. Ejecutado Real.

#### FASE 4: Plan de Pruebas de Estrés y Validación Financiera
1. Script de pruebas de carga en **k6** (`tests/performance/direccion-dashboard-load.js`) para simular consultas concurrentes sobre 10M de CFDIs con un SLA de respuesta `p(95) < 1.5s`.
2. Checklist de auditoría financiera/C-Level para asegurar que la suma de costos fijos, variables y cargas patronales coincide exactamente con la contabilidad de la empresa.

---

### INSTRUCCIÓN DE EJECUCIÓN
Comienza tu respuesta directamente en la FASE 1, adoptando un enfoque técnico profesional, estructurado y listo para producción.
# ✅ Checklist de Pruebas: Tablero de RH

Este documento contiene la lista de verificaciones para el tablero analítico de Recursos Humanos (RH).

## 1. ⚙️ Pre-requisitos
- [ ] Seleccionar una empresa válida en el sistema.
- [ ] Aplicar un rango de fechas en los filtros.
- [ ] (Opcional) Filtrar por Tipo de Nómina o Periodicidad (Quincenal, Semanal).
- [ ] Verificar que la información cargue correctamente en la pantalla.

## 2. 💳 Validación de KPIs
- [ ] **Total de Empleados**: Confirmar que coincida con la plantilla activa en el periodo.
- [ ] **Altas y Bajas (Turnover)**: Validar que el cálculo de rotación de personal sea correcto.
- [ ] **Pago de Beneficios**: Revisar que los montos por vales de despensa, fondo de ahorro, etc., coincidan con los recibos.
- [ ] **Días de Incapacidad**: Asegurar que se sumen correctamente los días descontados por enfermedad o maternidad.

## 3. 🖱️ Experiencia de Usuario
- [ ] Verificar que los códigos del SAT estén acompañados de su descripción textual (para facilitar la lectura).
- [ ] Comprobar que los tooltips (cuadros de información flotantes) muestren cómo se calculó cada valor.
- [ ] Revisar que las ventanas de detalle (Drilldowns) no incluyan columnas con códigos internos técnicos (IDs de base de datos) por seguridad.

## 4. 📈 Visualización de Gráficas
- [ ] **Gráficas de Tendencia**: Verificar que los puntos sean sólidos y las leyendas de comparación de años sean claras y dinámicas (ej. "Año 2026").
- [ ] **Diseño del Tablero**: Confirmar que el tablero esté organizado en secciones bien delimitadas, evitando cuadrículas que aprieten las gráficas.

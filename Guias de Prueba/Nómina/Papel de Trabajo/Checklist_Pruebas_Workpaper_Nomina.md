# ✅ Checklist de Pruebas: Papel de Trabajo de Nómina

Este documento contiene la lista de verificaciones para el papel de trabajo de Nómina, el cual funciona como una sábana detallada para análisis contable.

## 1. ⚙️ Filtros y Configuración
- [ ] Entrar a la sección "Papel de Trabajo de Nómina" y seleccionar una empresa.
- [ ] Aplicar fechas de inicio y fin en los filtros.
- [ ] Confirmar que la tabla carga información correctamente sin quedarse pasmada.

## 2. 📄 Validación de Columnas
- [ ] **Precisión Financiera**: Verificar que todos los montos de la tabla tengan los decimales exactos reportados en el recibo (sin redondear).
- [ ] **Nombres Claros**: Comprobar que los encabezados de las columnas sean legibles (ej. "Subsidio al Empleo") en lugar de mostrar nombres técnicos del XML (`cfdi:SubsidioAlEmpleo`).
- [ ] **Seguridad**: Validar que la tabla no muestre columnas innecesarias de uso interno (como ID de la base de datos o UUID técnicos) por motivos de seguridad y claridad visual.

## 3. 🖱️ Interfaz de Usuario
- [ ] Desplazarse por la tabla. Validar que la visualización sea compacta, evitando espacios en blanco excesivos, para poder ver muchos datos de un solo vistazo.
- [ ] Comprobar que no haya un desplazamiento horizontal infinito y desordenado.
- [ ] Si se exporta a PDF o CSV, comprobar que el archivo respete la información mostrada.

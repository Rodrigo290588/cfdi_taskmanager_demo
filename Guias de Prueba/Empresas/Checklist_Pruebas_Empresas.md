# Checklist de Pruebas: Módulo de Empresas (`/companies`)

Este checklist debe ser completado por el usuario de pruebas. Marca con una 'X' dentro de los corchetes `[ ]` cuando hayas validado exitosamente cada punto.

## 1. Seguridad de Acceso (Permisos)
- [ ] Ingresando como Administrador, puedo ver todas las empresas de la organización.
- [ ] Ingresando como Usuario Normal, solo veo las empresas que me han compartido o que yo he creado (la lista es más pequeña o está vacía).

## 2. Búsqueda y Filtros Avanzados
- [ ] Al escribir el nombre o RFC en la barra de búsqueda, la tabla muestra solo las empresas que coinciden.
- [ ] Al abrir los filtros avanzados y seleccionar un "Régimen Fiscal", la tabla se actualiza correctamente.
- [ ] Al seleccionar un "Estado" (ej. Jalisco), la tabla muestra solo las empresas de ese estado.
- [ ] Si la búsqueda no tiene resultados, el sistema muestra un mensaje indicando que no se encontraron empresas.

## 3. Registro de Nueva Empresa y Validación de Errores
- [ ] Al hacer clic en "Nueva Empresa", se abre correctamente la ventana del formulario.
- [ ] Al intentar guardar el formulario completamente en blanco, el sistema me bloquea y muestra mensajes rojos en los campos obligatorios.
- [ ] Al escribir un RFC con formato incorrecto (ej. muy corto) y tratar de guardar, el sistema muestra un error indicando que el RFC es inválido.
- [ ] Al escribir un correo electrónico sin el símbolo `@` y tratar de guardar, el sistema marca el error.
- [ ] Al llenar correctamente todos los datos y hacer clic en guardar, la ventana se cierra y aparece el mensaje "Empresa creada".
- [ ] La nueva empresa aparece en la lista principal con el estatus "PENDIENTE".

## 4. Edición de Empresa y Validación de Errores
- [ ] Al abrir una empresa existente para editarla, la información actual aparece cargada en el formulario.
- [ ] Si borro el contenido de un campo obligatorio (como la Razón Social) y trato de guardar, el sistema me bloquea y muestra un mensaje rojo.
- [ ] Si escribo letras en un campo que solo acepta números (como el Teléfono) y trato de guardar, el sistema me bloquea.
- [ ] Al corregir los datos y guardar, los cambios se reflejan correctamente en la lista.

## 5. Revisión y Aprobación de Empresa
- [ ] Al entrar a la pantalla de revisión de una empresa en estatus Pendiente, puedo ver correctamente todas las tarjetas con su información.
- [ ] Al hacer clic en "Aprobar Empresa", el sistema muestra un mensaje de éxito ("Empresa aprobada exitosamente").
- [ ] Después de aprobarla, el estatus de la empresa en la lista principal cambia a "APROBADO".
- [ ] En la parte inferior de la pantalla de revisión, el "Historial de Auditoría" registra la fecha, hora y el usuario que aprobó la empresa.

## 6. Rechazo de Empresa (Motivo Obligatorio)
- [ ] Al hacer clic en "Rechazar Empresa", el sistema me pide un motivo.
- [ ] Si intento confirmar el rechazo dejando el motivo en blanco, el sistema me bloquea y me pide que escriba el motivo.
- [ ] Al escribir un motivo y confirmar, el sistema muestra un mensaje de éxito ("Empresa rechazada exitosamente").
- [ ] El estatus de la empresa en la lista principal cambia a "RECHAZADO".
- [ ] El "Historial de Auditoría" registra el motivo exacto por el cual fue rechazada.

## 7. Ciberseguridad (Protección de Sitio Web)
- [ ] Si registro una empresa y en el campo de Sitio Web escribo un código falso como `javascript:alert('Error')`, al entrar a revisarla, el enlace NO aparece en la pantalla.
- [ ] Si registro un Sitio Web normal como `https://www.google.com`, el enlace SÍ aparece en la pantalla y puedo darle clic.

## Notas Adicionales del Usuario de Pruebas
_Usa este espacio para anotar cualquier comportamiento extraño, botones que no funcionen, o textos confusos:_
- 
- 
- 

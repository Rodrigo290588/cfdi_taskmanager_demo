# Checklist de Pruebas: Roles y Permisos (`/admin/roles`)

Este checklist debe ser completado por el usuario de pruebas. Marca con una 'X' dentro de los corchetes `[ ]` cuando hayas validado exitosamente cada punto en el sistema.

## 1. Crear un Nuevo Rol Personalizado
- [ ] Hice clic en el botón "Nuevo Rol".
- [ ] Se abrió correctamente la ventana para crear el rol.
- [ ] Escribí un nombre válido en el campo "Nombre del Rol" (ej. "Auditor Jr.").
- [ ] Apagué el interruptor principal de "CFDI Emitidos (Ingresos)".
- [ ] Hice clic en el botón "Crear Rol".
- [ ] El botón se bloqueó momentáneamente mostrando un círculo de carga.
- [ ] El sistema mostró el mensaje de confirmación verde "Rol creado correctamente".
- [ ] La nueva tarjeta del rol apareció en pantalla.
- [ ] En la nueva tarjeta, la fila de "Emisión" marca "No" (en color rojo).

## 2. Editar un Rol de Sistema (Permisos Granulares)
- [ ] Ubiqué la tarjeta del rol de sistema "Visualizador".
- [ ] Hice clic en el botón "Configurar Permisos".
- [ ] Comprobé que el campo "Nombre del Rol" está bloqueado/oculto y no se puede modificar.
- [ ] En la sección "CFDI Recibidos (Egresos)", apagué el interruptor de "Auditoría fiscal y detección de riesgos".
- [ ] Hice clic en el botón "Actualizar Rol".
- [ ] El sistema mostró el mensaje de confirmación verde "Rol actualizado correctamente".

## 3. Eliminar un Rol Personalizado
- [ ] Ubiqué la tarjeta del rol personalizado que creé ("Auditor Jr.").
- [ ] Hice clic en el botón "Eliminar" (ícono de basurero).
- [ ] El sistema me detuvo y me mostró la ventana/alerta de confirmación ("¿Está seguro que desea eliminar este rol?").
- [ ] Hice clic en "Aceptar" / "Eliminar" en la alerta de confirmación.
- [ ] El sistema mostró el mensaje de confirmación verde "Rol eliminado correctamente".
- [ ] La tarjeta del rol "Auditor Jr." desapareció completamente de la pantalla.

## 4. Seguridad Anti-Intrusos (Bloqueo por Roles)
- [ ] Ingresé al sistema utilizando una cuenta de "Usuario Normal" (sin permisos de Administrador de Organizaciones).
- [ ] Intenté abrir la página de Roles y Permisos.
- [ ] El sistema NO me mostró las tarjetas de roles ni los botones de creación.
- [ ] El sistema me bloqueó inmediatamente y mostró la pantalla de "Acceso Denegado".

## Notas Adicionales del Usuario de Pruebas
_Usa este espacio para anotar cualquier comportamiento extraño, si los interruptores no respondieron, o si los datos no se guardaron correctamente:_
- 
- 
- 

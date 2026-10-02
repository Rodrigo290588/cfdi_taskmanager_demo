# Checklist de Pruebas: Gestión de Usuarios (`/admin/users`)

Este checklist debe ser completado por el usuario de pruebas. Marca con una 'X' dentro de los corchetes `[ ]` cuando hayas validado exitosamente cada punto en el sistema.

## 1. Invitaciones Pendientes (Nuevos Usuarios)
- [ ] Localicé la lista de "Invitaciones Pendientes" y logré ver usuarios con la etiqueta del reloj ("Pendiente").
- [ ] Al hacer clic en el botón de la papelera (🗑️) junto a un invitado, el sistema me pidió confirmar si quería borrarlo.
- [ ] Después de hacer clic en "Eliminar", apareció un pequeño mensaje verde de éxito.
- [ ] La persona eliminada desapareció automáticamente de la lista.

## 2. Suspensión y Activación de Usuarios (Switch)
- [ ] En la lista de "Usuarios Actuales", encontré el interruptor de encendido/apagado al lado de un usuario.
- [ ] Al presionar el interruptor de un usuario "Activo", me salió un mensaje pidiendo confirmar que quería "inactivarlo".
- [ ] Al confirmar, el sistema me mostró un aviso de éxito y la etiqueta del usuario cambió a "Inactivo" (gris).
- [ ] Volví a presionar el interruptor, confirmé la acción, y el usuario regresó a ser "Activo" (verde).

## 3. Edición de Roles y Permisos (Botón Lápiz)
- [ ] Hice clic en el botón del lápiz (✏️) de un usuario y se abrió la ventana "Editar Permisos de Usuario".
- [ ] Logré desplegar el primer menú y cambiarle el Rol (ej. de Administrador a Auditor).
- [ ] Hice clic en el menú de "Empresas Asignadas", pude ver varias casillas de verificación y logré seleccionar/quitar empresas.
- [ ] Al presionar "Guardar Cambios", la ventana se cerró sola y me mostró un aviso verde de éxito.
- [ ] En la lista, comprobé que el Rol del usuario se haya actualizado a la nueva opción que elegí.

## 4. Eliminación Definitiva (Papelera)
- [ ] Hice clic en el botón de la papelera (🗑️) junto a un usuario activo.
- [ ] El sistema me mostró un mensaje de advertencia explicando que se iban a quitar todos los accesos.
- [ ] Al presionar "Eliminar", me salió el aviso de éxito.
- [ ] El usuario desapareció por completo de la lista de "Usuarios Actuales".

## 5. Seguridad: Bloqueo de Intrusos
- [ ] Entré al sistema usando una cuenta de "Usuario Normal" (sin privilegios de Administrador).
- [ ] Al intentar entrar a la pantalla de "Usuarios", el sistema NO cargó ninguna lista y me mostró directamente una pantalla de "Acceso Denegado".

## Notas Adicionales del Usuario de Pruebas
_Usa este espacio para anotar si el sistema se trabó en algún paso, si un botón no hizo nada, o si algún texto fue difícil de entender:_
- 
- 
- 

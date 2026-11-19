# Guía Paso a Paso: Configuración y Ejecución del Importador de Facturas (XML)

Esta guía te ayudará a configurar de manera permanente el programa que sube las facturas (archivos XML) al sistema, y te explicará cómo usarlo. No requieres conocimientos técnicos avanzados para seguir estas instrucciones.

---

## FASE 1: Generar tus credenciales seguras (Solo se hace una vez)

Para que el programa de facturas pueda comunicarse con el sistema de forma segura, necesita un "usuario y contraseña" especiales. A estos les llamamos `CLIENT_ID` y `CLIENT_SECRET`.

1. Abre el programa **PowerShell** en tu servidor.
2. Escribe el siguiente comando para entrar a la carpeta principal del sistema y presiona Enter:
   ```powershell
   cd C:\ITC_IA\cfditaskmanager_demo\cfdi_taskmanager_demo
   ```
3. Confirma que exista un archivo de configuración de producción. No abras ni compartas su contenido porque contiene datos privados:
   ```powershell
   Test-Path .\.env.production
   ```
   Si aparece `False`, revisa si existe `.env`:
   ```powershell
   Test-Path .\.env
   ```
   Debe existir el archivo que contiene la conexión de producción. No uses una conexión de desarrollo. Si no sabes cuál es el archivo correcto, pide apoyo a la persona responsable del servidor; no copies ni compartas el contenido de estos archivos.
4. Ejecuta el programa generador:
   ```powershell
   npx tsx .\scripts\generate-m2m-credentials.mts
   ```
   El programa leerá la configuración desde la carpeta principal y buscará la organización **Grupo Demo ITComplements** en esa base de datos. Si falta la conexión o no encuentra esa organización, se detendrá sin crear credenciales.
5. Al terminar, imprimirá dos comandos de Windows que comienzan con `[Environment]::SetEnvironmentVariable(...)`. Cópialos y ejecútalos en la misma ventana para guardar las credenciales.
6. **IMPORTANTE:** guarda el `CLIENT_SECRET` en un lugar seguro. La base de datos conserva una versión irreversible y no se puede volver a consultar. Ejecuta el generador una sola vez; cada ejecución crea credenciales nuevas.

---

## FASE 2: Guardar las credenciales en Windows para siempre (Solo se hace una vez)

Ahora le diremos a tu computadora (Windows) que memorice estas credenciales para que no tengas que escribirlas cada vez que quieras subir facturas.

El generador imprime los comandos con los valores reales. Ejecútalos en PowerShell para guardarlos en la cuenta de Windows que está abierta. Después cierra la ventana y abre una nueva.

Estas credenciales permanentes quedan asociadas a esa cuenta de Windows. Si el programa se ejecuta con otra cuenta, esa cuenta también debe tener configuradas sus credenciales.

---

## FASE 3: Cómo subir tus facturas (Uso diario)

A partir de este momento, subir facturas es muy sencillo. Tienes varias opciones dependiendo de lo que necesites hacer.

Primero, abre una **nueva ventana de PowerShell**, y entra a la carpeta del programa:
```powershell
cd C:\ITC_IA\cfditaskmanager_demo\cfdi_taskmanager_demo
```

Elige uno de los siguientes escenarios según lo que necesites:

### Escenario A: Subir toda una carpeta llena de facturas (Recomendado)
Si tienes muchos archivos XML guardados en una carpeta y quieres subirlos todos juntos, usa este comando.
*(Cambia la ruta `C:\ruta\a\tu\carpeta` por la ubicación real donde están tus XML).*

```powershell
java -jar .\java-client\target\cfdi-ingest-1.0-SNAPSHOT.jar --dir="C:\ruta\a\tu\carpeta"
```

### Escenario B: Subir un solo archivo XML específico
Si solo necesitas subir una factura en particular y no toda la carpeta, usa este comando.
*(Cambia la ruta para que apunte directamente a tu archivo XML).*

```powershell
java -jar .\java-client\target\cfdi-ingest-1.0-SNAPSHOT.jar --file-path="C:\ruta\a\tu\carpeta\factura_especifica.xml"
```

### Escenario C: Subir facturas al servidor de Producción en internet
Por defecto, el programa asume que el sistema está instalado en tu misma computadora (`localhost`). Si tu sistema ya está publicado en internet con una dirección web, debes decirle al programa a dónde enviarlas usando `--base-url`.

```powershell
java -jar .\java-client\target\cfdi-ingest-1.0-SNAPSHOT.jar --dir="C:\ruta\a\tu\carpeta" --base-url="https://tu-sistema-real.com"
```

---

## ¿Problemas comunes?

- **"No autorizado" o "Error 401"**: Significa que las credenciales no se guardaron correctamente en Windows. Repite la Fase 2 asegurándote de no dejar espacios en blanco ni comillas extra.
- **"El programa se detuvo a la mitad"**: El programa es inteligente y lleva un registro de lo que ya subió. Si se apaga la computadora, simplemente vuelve a correr el comando; el programa saltará los XML que ya subió y continuará donde se quedó.
- **Quiero volver a subir todo desde cero**: Si necesitas forzar al programa a ignorar su memoria y volver a subir todo, agrega la palabra `--skip-progress` al final de tu comando.

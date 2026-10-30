# Documento Técnico: Requerimientos de Infraestructura para Instalación Local (Basada en Docker)

## 1. Introducción
El presente documento detalla los requerimientos de hardware, software y red necesarios para el despliegue local (on-premise) del aplicativo **Platfi Intelligence · CFDI Task Manager** utilizando **Docker**. Esta estrategia de despliegue mediante contenedores simplifica drásticamente la instalación, ya que aísla las dependencias del sistema operativo anfitrión.

## 2. Arquitectura del Sistema (Contenedores)
El aplicativo se compone de los siguientes servicios, los cuales se ejecutarán como contenedores independientes orquestados (ej. mediante `docker-compose`):
- **Frontend / Backend (API):** Contenedor con Node.js ejecutando Next.js 16.
- **Workers (Procesamiento en Segundo Plano):** Contenedor(es) con Node.js ejecutando los procesos de BullMQ para descarga masiva del SAT.
- **Base de Datos Relacional:** Contenedor de PostgreSQL 15/16.
- **Caché y Gestor de Colas:** Contenedor de Redis (Alpine).

## 3. Requerimientos de Hardware (Servidor Windows)
Los contenedores introducen una ligera capa de virtualización (a través de WSL2 en Windows). Se recomiendan las siguientes especificaciones:

### Especificaciones Recomendadas (Producción Local)
- **Procesador (CPU):** 8 Cores (Mínimo 4 Cores). *Requerido para el motor de Docker/WSL2 y el alto procesamiento de CFDI.*
- **Memoria RAM:** 16 GB. *Asignar al menos 8 GB - 10 GB exclusivamente a la máquina virtual de WSL2/Docker.*
- **Almacenamiento (Disco):** 200 GB SSD NVMe. *Los volúmenes de Docker para PostgreSQL y el almacenamiento de los XML requieren alta velocidad de I/O.*

## 4. Requerimientos de Software (Host)
Gracias al uso de Docker, **NO ES NECESARIO** instalar lenguajes de programación, motores de base de datos ni gestores de procesos directamente en Windows. Solo se requiere:

- **Sistema Operativo:** Windows Server 2019 o Windows Server 2022 (64-bits) con la característica de **WSL2 (Windows Subsystem for Linux)** habilitada.
- **Motor de Contenedores:** 
  - **Docker Desktop para Windows** (considerar licenciamiento comercial si aplica).
  - *Alternativa:* Instalar Docker Engine directamente dentro de una distribución de Linux en WSL2 (ej. Ubuntu) para evitar costos de licenciamiento de Docker Desktop.
- **Git (Opcional):** Para clonar el repositorio y los archivos de configuración `docker-compose.yml`.

*(Componentes como Node.js, PM2, PostgreSQL nativo o Memurai quedan descartados del host).*

## 5. Configuración de Red y Puertos (Firewall Interno)
El orquestador de Docker expondrá únicamente los puertos necesarios hacia el host de Windows:

| Puerto Host | Protocolo | Contenedor Destino | Descripción |
| :--- | :--- | :--- | :--- |
| **80 / 443** | TCP | Proxy (Nginx) / Next.js | Acceso de los usuarios internos a la aplicación web. |
| **5432** | TCP | PostgreSQL | (Opcional) Solo exponer si se requiere acceso directo a la BD para mantenimiento. |
| **6379** | TCP | Redis | (Opcional) Solo exponer si se requiere acceso directo para depuración de colas. |

## 6. Consideraciones de Seguridad y Almacenamiento
- **Volúmenes Persistentes (Named Volumes):** Es crucial que la configuración de Docker asigne volúmenes persistentes (`postgres_data`) para la base de datos. Si el contenedor se destruye sin un volumen persistente, se perderá la información.
- **Manejo de Secretos (.env):** Las credenciales, como `DATA_ENCRYPTION_KEY` o las contraseñas de la base de datos, deben inyectarse al contenedor mediante un archivo `.env` local. Este archivo no debe compartirse.
- **Acceso al SAT:** El contenedor que ejecuta los *workers* necesitará resolución DNS y salida HTTPS (puerto 443) hacia `*.sat.gob.mx` para poder conectarse a los Web Services del SAT.

## 7. Despliegue de Componentes (Resumen)
El despliegue se reduce a la ejecución de comandos de orquestación en la terminal (PowerShell o WSL bash) donde resida el archivo `docker-compose.yml` que incluya tanto la infraestructura (DB/Redis) como la aplicación construida:

```bash
# Construir las imágenes de los contenedores (Next.js y Workers)
docker compose build

# Levantar todos los servicios en segundo plano (detached mode)
docker compose up -d
```
El motor de Docker se encargará de reiniciar automáticamente los contenedores si el servidor Windows se reinicia, eliminando la necesidad de herramientas como PM2 o NSSM.

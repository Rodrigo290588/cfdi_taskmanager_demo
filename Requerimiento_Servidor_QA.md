# Requerimiento Técnico de Infraestructura: Servidor de Pruebas (QA)

## 1. Propósito y Objetivo
El presente documento tiene como objetivo solicitar al área de Infraestructura el aprovisionamiento de un servidor dedicado para el entorno de **Pruebas (QA)** de la aplicación de descargas masivas de CFDI (Platfi Intelligence). Este entorno es indispensable para validar el flujo completo de la aplicación, incluyendo la interfaz de usuario, reportes financieros interactivos y la comunicación asíncrona vía SOAP con los Web Services del SAT.

## 2. Arquitectura de la Aplicación
La solución está diseñada con una arquitectura moderna basada en eventos utilizando los siguientes componentes tecnológicos:
- **Frontend & API (Fullstack):** Framework Next.js (v16.1.x) ejecutado sobre Node.js.
- **Base de Datos Relacional:** PostgreSQL 15 (utilizando Prisma ORM).
- **Gestor de Colas y Caché:** Redis (para control de concurrencia y semáforos).
- **Workers en Segundo Plano:** BullMQ (Procesos Node.js ejecutándose en paralelo para: `download.worker`, `verification.worker`, y `mass-download.worker`).

---

## 3. Requerimientos de Hardware (Estimación para QA)
Debido a que la aplicación procesa archivos ZIP del SAT directamente en memoria (Buffers) para cumplir con requerimientos estrictos de seguridad y diseño serverless, se requiere una capacidad de RAM holgada.

| Componente | Especificación Mínima | Especificación Recomendada | Justificación |
| :--- | :--- | :--- | :--- |
| **CPU** | 8 vCores | 16 vCores | Manejo concurrente de peticiones Next.js, 3 Workers de BullMQ procesando XMLs, y cómputo intensivo en base de datos para la regeneración de Vistas Materializadas. |
| **RAM** | 16 GB | 32 GB | Procesamiento de archivos ZIP masivos en memoria (Node.js) y asignación crítica para PostgreSQL (`shared_buffers` y `work_mem`) para agrupar y materializar vistas sobre un histórico de más de 7 millones de registros sin paginar a disco. |
| **Almacenamiento** | 250 GB SSD | 500 GB SSD | Hospedaje de la base de datos con ~7 millones de CFDI históricos (aprox. 60-90 GB considerando datos + índices), espacio para las Vistas Materializadas, margen para el crecimiento de 2 millones de CFDI/año (~20-25 GB/año), además de OS y logs. |

---

## 4. Requerimientos de Software y SO
- **Sistema Operativo:** Ubuntu Server 22.04 LTS o Debian 12 (Recomendado para el ecosistema Node/Redis/Postgres). También es compatible con Windows Server si la política corporativa lo exige.
- **Runtime de Ejecución:** Node.js v20.x LTS.
- **Gestor de Procesos:** PM2 (para administrar la persistencia de Next.js y los Workers) o infraestructura basada en **Docker / Docker Compose** (el proyecto ya cuenta con configuración de contenedores para Base de Datos y Caché).

---

## 5. Requerimientos de Red y Firewall
Para garantizar el correcto funcionamiento y la seguridad de la aplicación, el servidor requiere la siguiente configuración de red:

### Tráfico de Entrada (Inbound)
- **TCP 80 / 443:** Acceso a la interfaz web por parte de los usuarios de prueba.
- **TCP 22:** (Opcional) Acceso SSH para despliegues y administración del equipo de desarrollo.
- *(Nota de seguridad: Los puertos 5432 de PostgreSQL y 6379 de Redis deben permanecer cerrados al exterior y ser accesibles únicamente de manera local o por red privada interna).*

### Tráfico de Salida (Outbound)
La aplicación **DEBE** tener salida a Internet (TCP 443 / HTTPS) estrictamente para consumir los Web Services SOAP del SAT:
- `cfdidescargamasivasolicitud.clouda.sat.gob.mx`
- Otros dominios y subdominios de `*.sat.gob.mx` requeridos para autenticación (FIEL) y descarga de paquetes.

---

## 6. Consideraciones de Seguridad y Operación
1. **Privacidad de Datos Sensibles:** El servidor procesará XMLs y metadatos con información sensible y financiera de la empresa y clientes. El servidor debe estar protegido por las políticas internas de ciberseguridad y no debe contener agentes o software de telemetría hacia servicios de IA públicos.
2. **Certificados TLS/SSL:** Se solicita la asignación de un certificado SSL válido para habilitar HTTPS en el subdominio de pruebas que se asigne, garantizando que el tráfico web no viaje en texto plano.
3. **Variables de Entorno:** El equipo de desarrollo se encargará de proveer de forma segura el archivo de configuración con las llaves criptográficas y credenciales de conexión requeridas para el arranque.

---

## 7. Tareas Solicitadas al Administrador (TI / DevOps)

Para habilitar el servidor de manera óptima según las necesidades de Platfi Intelligence, se solicita amablemente la ejecución de las siguientes tareas técnicas:

### A. Instalación de Base de Datos y Caché
- **PostgreSQL 15:** Instalar el motor de base de datos o proveer una instancia gestionada. Se debe crear una base de datos vacía (ej. `platfi_intelligence_qa`) y un usuario dedicado con permisos de propietario (owner) sobre dicha base de datos para permitir la ejecución de migraciones estructurales vía Prisma ORM.
- **Redis:** Instalar Redis Server. Es fundamental que el servicio esté activo y configurado para arrancar con el sistema, ya que la aplicación depende críticamente de Redis para gestionar las colas de BullMQ (Workers de descarga) y el control de concurrencia (semáforos).
- **Seguridad perimetral:** Ambos servicios (PostgreSQL y Redis) deben estar configurados para aceptar conexiones únicamente desde `localhost` o dentro de la red privada (VPC), nunca expuestos a Internet.

### B. Accesos de Sistema Operativo
- **Usuario de Despliegue:** Crear un usuario estándar de sistema operativo (ej. `deployer` o `platfi_admin`) dedicado a la aplicación.
- **Privilegios:** Otargar acceso SSH mediante intercambio de llaves públicas (preferentemente sin contraseña). Proveer permisos temporales de `sudo` (o permisos específicos) para la instalación inicial de dependencias como Node.js v20 LTS y el gestor de procesos (PM2 o Docker Compose).

### C. Red, DNS y Certificados
- **Asignación de DNS:** Configurar un registro DNS (tipo A o CNAME) apuntando a la IP del servidor (ej. `qa-platfi.tu-dominio.com`).
- **Proxy Inverso:** Instalar y configurar Nginx o Apache como proxy inverso para redirigir el tráfico entrante del puerto 80/443 hacia el puerto interno donde correrá la aplicación Next.js (por defecto TCP 3000).
- **Certificado SSL:** Proveer e instalar un certificado SSL válido para el dominio asignado y forzar la redirección de HTTP a HTTPS.

### D. Consideraciones Técnicas Específicas del Proyecto
- **Límites del Sistema (ulimit):** Aumentar el límite de archivos abiertos (`nofile`) para el usuario de la aplicación a al menos `65535`. La combinación de Next.js, múltiples Workers asíncronos y Redis genera una alta concurrencia de descriptores de archivos de red.
- **Gestión de Memoria:** Asegurar que el servidor cuente con una partición o archivo de intercambio (Swap) de al menos 4 GB como medida de contingencia. Dado que los archivos ZIP del SAT se procesan enteramente en la memoria RAM (Buffer) por motivos de seguridad, un pico masivo de descargas podría agotar la memoria disponible.
- **Tolerancia de Firewall de Salida:** Las peticiones SOAP al SAT suelen tener tiempos de respuesta largos o intermitencias. Garantizar que el firewall perimetral no cierre conexiones TCP inactivas (idle timeouts) hacia `*.sat.gob.mx` en ventanas menores a 5 minutos.

### E. Política de Respaldos de Base de Datos (Backups)
Dado el volumen de datos proyectado (7 millones de históricos + 2 millones anuales), la pérdida de información en QA implicaría un alto costo de tiempo para volver a descargar todo del SAT. Se solicita configurar una política de respaldos con las siguientes características:
- **Respaldo Lógico Completo (Full Backup):** Ejecución semanal (ej. domingo en la madrugada) utilizando `pg_dump` (formato comprimido `custom` o `directory`) de la base de datos `platfi_intelligence_qa`.
- **Retención (Retention Policy):** Mantener localmente o en almacenamiento de red los últimos 4 respaldos completos (1 mes de retención).
- **Almacenamiento Externo:** Idealmente, los respaldos deben enviarse a un volumen de almacenamiento en frío (NFS, S3, Blob Storage) para no comprometer el espacio del disco principal SSD.
- *(Nota para TI: No es estrictamente necesario habilitar WAL Archiving / Point-In-Time-Recovery (PITR) para el entorno de QA, el respaldo lógico semanal es suficiente).*

### F. Entregables Esperados
Al finalizar la configuración, se espera recibir por un canal seguro la siguiente información:
1. **IP y DNS:** Dirección IP interna/externa y el nombre de dominio configurado.
2. **Credenciales de SO:** Llave privada SSH o contraseña temporal del usuario de despliegue.
3. **Credenciales de Base de Datos:** Cadenas de conexión (Connection Strings) para PostgreSQL y Redis (ej. `postgresql://usuario:password@localhost:5432/bd`).
4. **Confirmación de Red:** Evidencia o confirmación de que la salida a Internet por el puerto 443 hacia el dominio del SAT está habilitada.

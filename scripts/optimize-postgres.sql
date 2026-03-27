-- Ajustes de configuración de PostgreSQL para carga masiva de datos (1M+ registros)
-- Ejecutar como superusuario o usuario con permisos de ALTER SYSTEM
-- Nota: Algunos cambios requieren reinicio del servicio PostgreSQL

-- 1. Aumentar el tamaño máximo del WAL (Write Ahead Log) para reducir checkpoints frecuentes
ALTER SYSTEM SET max_wal_size = '4GB';

-- 2. Aumentar el tiempo entre checkpoints para reducir la carga de E/S
ALTER SYSTEM SET checkpoint_timeout = '30min';

-- 3. Aumentar shared_buffers (Memoria compartida para caché de datos)
-- Recomendado: 25% de la RAM total del sistema. Ajustar según disponibilidad.
-- Ejemplo para un sistema con 4GB+ de RAM disponible para DB:
ALTER SYSTEM SET shared_buffers = '1GB';

-- 4. Ajustes adicionales para rendimiento de escritura
ALTER SYSTEM SET work_mem = '64MB';
ALTER SYSTEM SET maintenance_work_mem = '512MB';

-- 5. Desactivar commit síncrono (RIESGO: Posible pérdida de datos en crash, pero mucho más rápido)
-- Útil durante la carga masiva inicial. Revertir a 'on' o 'local' después.
ALTER SYSTEM SET synchronous_commit = 'off';

-- Para aplicar los cambios, reiniciar PostgreSQL:
-- sudo systemctl restart postgresql

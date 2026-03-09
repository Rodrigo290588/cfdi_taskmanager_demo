# PlatFi Intelligence

Plataforma de inteligencia financiera B2B diseñada para la descarga, auditoría y conciliación de CFDI (Facturas electrónicas mexicanas) sincronizando datos del SAT y ERPs externos.

## 🚀 Características Principales

### Dashboard Financiero (PlatFi Overview)
- **KPIs en tiempo real**: Ingresos vs Gastos, IVA Trasladado vs Acreditable
- **Visualizaciones interactivas**: Gráficos de barras apiladas para desglose de impuestos
- **Análisis mensual**: Tendencias y comparativas de datos fiscales

### Bóveda Fiscal
- **Data Grid avanzado** con filtros por columna, paginación y búsqueda
- **Búsqueda inteligente**: Por UUID, RFC, monto, nombre o folio
- **Diferenciación por tipo**: CFDI de Ingreso, Egreso, Nómina y Pago
- **Estados SAT**: Vigente, Cancelado, No encontrado
- **Acciones rápidas**: Ver detalles, descargar XML/PDF, ver en SAT

### Integración ERP
- **API REST** con autenticación por API Key
- **Endpoint /api/v1/ingest** para sincronización de datos
- **Validación de esquemas** con Zod
- **Procesamiento por lotes** de facturas

### Arquitectura Multi-Tenant
- **Organizaciones**: Corporativos con múltiples RFCs
- **Roles de usuario**: Admin, Auditor, Viewer
- **Context switching** entre diferentes RFCs
- **Seguridad granular** por permisos

### Sistema de Gestión de Empresas
- **Registro con RFC Mexicano**: Validación completa del formato RFC
- **Panel de Administración**: Aprobación y gestión de empresas
- **Bitácora de Auditoría**: Trazabilidad completa de operaciones
- **Búsqueda Avanzada**: Filtros múltiples y búsqueda inteligente
- **Permisos por Rol**: Control de acceso basado en roles del sistema
- **Validación Fiscal**: Cumplimiento con requisitos del SAT

## 🛠️ Stack Tecnológico

- **Framework**: Next.js 14/15 (App Router)
- **Lenguaje**: TypeScript (Strict Mode)
- **Estilos**: Tailwind CSS + Shadcn/UI (Radix Primitives)
- **Base de Datos**: PostgreSQL
- **ORM**: Prisma
- **Autenticación**: NextAuth.js v5
- **Estado**: React Query (TanStack Query)
- **Visualización**: Recharts
- **Notificaciones**: Sonner
- **Validación**: Zod

## 📦 Instalación

1. **Clonar el repositorio**
```bash
git clone https://github.com/tu-usuario/platfi-intelligence.git
cd platfi-intelligence
```

2. **Instalar dependencias**
```bash
npm install
```

3. **Configurar variables de entorno**
```bash
cp .env.local.example .env.local
```

Edita `.env.local` con tus credenciales:
```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/platfi_intelligence_demo"

# NextAuth.js
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key"

# Google OAuth
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# API Keys
API_KEY_SECRET="your-api-key-secret"
```

4. **Configurar la base de datos**
```bash
npx prisma migrate dev
npx prisma generate
```

5. **Iniciar el servidor de desarrollo**
```bash
npm run dev
```

## 🗄️ Estructura de la Base de Datos

### Modelos Principales

- **User**: Usuarios del sistema
- **Organization**: Entidades corporativas
- **FiscalEntity**: RFCs de las organizaciones
- **Invoice**: CFDIs almacenados
- **Member**: Relación usuario-organización con roles
- **ApiKey**: Claves de API para integraciones
- **Company**: Empresas registradas con validación RFC
- **AuditLog**: Bitácoras de auditoría para trazabilidad

### Arquitectura Multi-Tenant

```
User → Member → Organization → FiscalEntity → Invoice
```

Los datos (CFDIs) pertenecen a un RFC específico, que a su vez pertenece a una organización.

## 🔌 API de Integración

### Autenticación

Todas las peticiones deben incluir una API Key en el header:
```
X-API-Key: tu-api-key-aqui
```

### Ingestión de Facturas

**POST** `/api/v1/ingest`

```json
{
  "invoices": [
    {
      "uuid": "F7F6F5E4-3D2C-1B0A-9F8E-7D6C5B4A3921",
      "cfdiType": "INGRESO",
      "issuerRfc": "BIMO840515XXX",
      "issuerName": "Grupo Bimbo S.A.B. de C.V.",
      "receiverRfc": "WALM830312XXX",
      "receiverName": "Walmart de México S.A.B. de C.V.",
      "total": 125000.00,
      "subtotal": 107758.62,
      "ivaTrasladado": 17241.38,
      "xmlContent": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>...",
      "issuanceDate": "2024-03-15T10:30:00Z",
      "certificationDate": "2024-03-15T10:31:00Z",
      "fiscalEntityId": "fiscal-entity-id"
    }
  ],
  "syncId": "sync-12345"
}
```

### Consulta de Facturas

**GET** `/api/v1/ingest?limit=50&offset=0&fiscalEntityId=entity-id`

## 🎨 Diseño UI/UX

### Principios de Diseño
- **Fintech Moderno**: Interfaz limpia y profesional
- **Responsive**: Adaptable a todos los dispositivos
- **Accesibilidad**: Cumplimiento con estándares WCAG
- **Feedback Inmediato**: Estados de carga y notificaciones

### Componentes Principales
- **KPI Cards**: Métricas financieras con indicadores de tendencia
- **Data Grid**: Tabla avanzada con filtros y búsqueda
- **Charts**: Visualizaciones interactivas con Recharts
- **Sidebar**: Navegación con context switching de RFC

## 🔐 Seguridad

- **Autenticación**: NextAuth.js con soporte para OAuth (Google)
- **Autorización**: Sistema de roles y permisos granular
- **Encriptación**: Contraseñas hasheadas con bcrypt
- **API Keys**: Sistema seguro de claves de API con expiración
- **Validación**: Validación estricta de entrada con Zod

## 🚀 Despliegue

### Desarrollo
```bash
npm run dev
```

### Producción
```bash
npm run build
npm start
```

### Docker (Próximamente)
```bash
docker build -t platfi-intelligence .
docker run -p 3000:3000 platfi-intelligence
```

## 📋 Scripts Disponibles

- `npm run dev`: Inicia el servidor de desarrollo
- `npm run build`: Construye la aplicación para producción
- `npm start`: Inicia el servidor de producción
- `npm run lint`: Ejecuta el linter
- `npm run type-check`: Verifica tipos de TypeScript
- `npm run prisma:generate`: Genera el cliente de Prisma
- `npm run prisma:migrate`: Ejecuta migraciones de base de datos

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Ver el archivo `LICENSE` para más detalles.

## 📞 Soporte

Para soporte técnico o preguntas:
- Email: soporte@platfi.com
- Documentación: [docs.platfi.com](https://docs.platfi.com)
- Issues: [GitHub Issues](https://github.com/tu-usuario/platfi-intelligence/issues)

## 🎯 Roadmap

- [x] **Panel de administración** - ✅ COMPLETADO
- [x] **Sistema de gestión de empresas** - ✅ COMPLETADO
- [x] **Validación de RFC mexicano** - ✅ COMPLETADO
- [x] **Bitácora de auditoría** - ✅ COMPLETADO
- [x] **Búsqueda avanzada** - ✅ COMPLETADO
- [x] **Permisos por rol** - ✅ COMPLETADO
- [ ] Integración con SAT para descarga automática
- [ ] Motor de reglas de validación fiscal
- [ ] Conciliación automática con ERPs
- [ ] Reportes personalizados
- [ ] Alertas y notificaciones inteligentes
- [ ] API de webhooks
- [ ] Multi-idioma

---

**PlatFi Intelligence** - Potenciando la inteligencia fiscal de

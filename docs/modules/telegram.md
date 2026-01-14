# Telegram Module - Integracion con Telegram

## Descripcion General

Modulo de integracion con Telegram Bot para notificaciones automaticas, distribucion de reportes y alertas en tiempo real.

## Archivos Principales

| Archivo | Descripcion |
|---------|-------------|
| `src/services/TelegramService.ts` | Logica del bot de Telegram |
| `src/resolvers/telegram.ts` | Resolvers GraphQL |

## Modelo de Datos

### TelegramUser
```prisma
model TelegramUser {
  id                 String   @id
  chatId             String   @unique // ID del chat de Telegram
  name               String   // Nombre en Telegram
  username           String   // @username
  isActive           Boolean  // Usuario activo?
  registeredAt       DateTime
  lastActivity       DateTime
  reportsReceived    Int      // Contador de reportes
  isInRecipientsList Boolean  // En lista de distribucion
  notes              String   // Notas administrativas

  platformUser String?  // Usuario del sistema (opcional)
  reportConfigs ReportConfig[]
}
```

### ReportConfig
```prisma
model ReportConfig {
  id         String  @id
  name       String  // Nombre del reporte
  reportType String  // Tipo de reporte
  schedule   Json    // Configuracion de horario
  isActive   Boolean

  routes             Route[]        // Rutas incluidas
  telegramRecipients TelegramUser[] // Destinatarios
  executionLogs      ReportExecutionLog[]
}
```

### ReportExecutionLog
```prisma
model ReportExecutionLog {
  id                   String    @id
  status               String    // 'SUCCESS' | 'FAILED' | 'PARTIAL'
  executionType        String    // 'SCHEDULED' | 'MANUAL'
  message              String
  errorDetails         String
  recipientsCount      Int?
  successfulDeliveries Int?
  failedDeliveries     Int?
  startTime            DateTime
  endTime              DateTime?
  duration             Int?      // ms

  reportConfig String
}
```

## Business Rules

### BR-TG-001: Registro de Usuario
```typescript
// Al iniciar chat con el bot:
1. Usuario envia /start
2. Bot captura chatId, name, username
3. Crear TelegramUser con isActive = true
4. Opcionalmente enlazar con User del sistema
```

### BR-TG-002: Configuracion de Reportes
```typescript
// Schedule format:
{
  "days": [1, 3, 5],        // Lunes, Miercoles, Viernes
  "hour": "09",             // 9 AM
  "timezone": "America/Mexico_City"
}

// El scheduler ejecuta segun esta config
```

### BR-TG-003: Tipos de Reporte
- **DAILY_COLLECTION**: Resumen diario de cobranza
- **WEEKLY_PORTFOLIO**: Reporte semanal de cartera
- **MONTHLY_FINANCIAL**: Reporte mensual financiero
- **DOCUMENT_ERRORS**: Alertas de documentos con error

### BR-TG-004: Notificaciones de Errores
```typescript
// Cuando se marca documento con error:
1. Obtener lead responsable
2. Buscar TelegramUser del lead
3. Enviar mensaje con detalles
4. Registrar en DocumentNotificationLog
```

### BR-TG-005: Tracking de Entregas
```typescript
// Para cada envio:
1. Iniciar ReportExecutionLog
2. Enviar a cada destinatario
3. Registrar exitos/fallos
4. Actualizar contadores
5. Finalizar log con duracion
```

## API GraphQL

### Queries
```graphql
# Usuarios de Telegram
telegramUsers: [TelegramUser!]!

# Configuraciones de reportes
reportConfigs: [ReportConfig!]!

# Logs de ejecucion
reportExecutionLogs(
  reportConfigId: ID
  status: String
  fromDate: DateTime
  toDate: DateTime
): [ReportExecutionLog!]!
```

### Mutations
```graphql
# Crear/actualizar usuario Telegram
upsertTelegramUser(
  chatId: String!
  name: String
  username: String
  platformUserId: ID
): TelegramUser!

# Activar/desactivar usuario
toggleTelegramUser(id: ID!): TelegramUser!

# Crear configuracion de reporte
createReportConfig(
  input: CreateReportConfigInput!
): ReportConfig!

# Actualizar configuracion
updateReportConfig(
  id: ID!
  input: UpdateReportConfigInput!
): ReportConfig!

# Ejecutar reporte manualmente
executeReportManually(
  reportConfigId: ID!
): ReportExecutionLog!

# Enviar mensaje directo
sendTelegramMessage(
  chatId: String!
  message: String!
): Boolean!
```

## Flujos Principales

### Registro via Bot
```
1. Usuario inicia chat con @SolufacilBot
2. Envia /start
3. Bot responde con bienvenida
4. Crea TelegramUser con datos del chat
5. Admin enlaza con usuario del sistema (opcional)
```

### Ejecucion Programada
```
1. Scheduler verifica cada minuto
2. Para cada ReportConfig activo:
   a. Verificar si es hora segun schedule
   b. Si es hora: generar reporte
   c. Enviar a cada destinatario
   d. Registrar resultado
```

### Notificacion de Error de Documento
```
1. DOCUMENT_REVIEWER marca error
2. Sistema identifica lead responsable
3. Busca TelegramUser del lead
4. Envia mensaje con:
   - Tipo de documento
   - Nombre del cliente
   - Descripcion del error
   - Ruta/localidad
5. Registra en log
```

## Estructura de Mensajes

### Reporte Diario
```
📊 Reporte de Cobranza - [Fecha]
Ruta: [Nombre]

💰 Cobranza: $XX,XXX
📈 Meta: XX%
👥 Clientes atendidos: XX

🔴 En CV: XX clientes
⚠️ Nuevos en riesgo: XX
```

### Alerta de Documento
```
⚠️ Documento con Error

📋 Tipo: [INE/DOMICILIO/PAGARE]
👤 Cliente: [Nombre]
📍 Localidad: [Nombre]
🚗 Ruta: [Nombre]

❌ Error: [Descripcion]

Por favor corregir a la brevedad.
```

## Configuracion del Bot

### Variables de Entorno
```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_WEBHOOK_URL=https://api.solufacil.com/telegram/webhook
```

### Comandos del Bot
```
/start   - Registrarse
/status  - Ver estado de suscripcion
/reports - Listar reportes disponibles
/help    - Ayuda
```

## Consideraciones

### Rate Limiting
- Telegram tiene limite de 30 msg/seg
- Se implementa cola con delays
- Los envios masivos se espacian

### Reintentos
- Si falla envio: reintentar hasta 3 veces
- Backoff exponencial entre reintentos
- Registrar cada intento en log

### Seguridad
- Token del bot en variables de entorno
- Validar chatId antes de enviar
- No exponer informacion sensible en mensajes

---

**Ultima actualizacion**: 2024

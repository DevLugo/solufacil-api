# AGENTS.md - Solufacil API (@solufacil/api)

## Reglas Fundamentales

### Reglas de Git
- **NUNCA hacer commits automaticos** - Siempre esperar confirmacion explicita del usuario
- **NUNCA agregar "Co-Authored-By: Claude"** ni ninguna atribucion automatica en commits
- **NUNCA hacer push automatico** - Solo cuando el usuario lo solicite explicitamente

### Reglas de Codigo
- **NUNCA crear archivos nuevos** a menos que sea absolutamente necesario
- **Preferir editar archivos existentes** sobre crear nuevos
- **NUNCA agregar comentarios innecesarios** o documentacion no solicitada
- **NUNCA agregar emojis** a menos que el usuario lo solicite

---

## Reglas de Arquitectura (CRITICAS)

### DRY - Don't Repeat Yourself
- **NUNCA duplicar logica** - Si algo se repite, extraerlo a una funcion/modulo
- **Buscar codigo existente antes de escribir nuevo** - Revisar si ya existe en business-logic
- **Queries similares deben consolidarse** en el repository correspondiente
- **Validaciones repetidas** deben moverse a validators compartidos

### Logica de Balances - Preparacion para Flutter/PowerSync

**IMPORTANTE**: Toda la logica que afecta balances sera migrada a Flutter (offline-first con PowerSync).

#### Reglas de Encapsulamiento:
1. **TODA logica financiera DEBE estar en `@solufacil/business-logic`**
   - Calculos de profit, pagos, balances, renovaciones
   - NO en services, NO en resolvers, NO en repositories

2. **Funciones DEBEN ser puras** (sin efectos secundarios)
   - Input: objetos simples (no tipos Prisma/ORM)
   - Output: objetos simples
   - NO acceso a base de datos dentro de calculos

3. **Usar Decimal.js para precision financiera**
   - NUNCA usar `number` para calculos de dinero
   - Evita errores de punto flotante

4. **Logica portable = Logica en business-logic**
   - Si involucra dinero/balances → va en business-logic
   - Services solo orquestan, NO calculan

#### Que VA en business-logic:
- Calculos de profit (`calculateProfit`, `calculatePaymentProfit`)
- Distribucion de pagos (`processPayment`)
- Renovaciones (`calculateProfitHeredado`, `calculateRenewalMetrics`)
- Cartera vencida (`isInCarteraVencida`, `exitedCarteraVencida`)
- VDO - Valor Deuda Observada (`calculateVDOForLoan`)
- Validaciones financieras

#### Que NO VA en business-logic:
- Acceso a base de datos (Prisma)
- Llamadas a APIs externas
- Logica de autenticacion/autorizacion
- Formateo para UI

---

## Estructura del Proyecto

```
api/
├── src/
│   ├── server.ts          # Entry point - Express + Apollo Server
│   ├── context.ts         # Contexto GraphQL
│   ├── resolvers/         # Resolvers GraphQL
│   │   ├── index.ts       # Export de todos los resolvers
│   │   ├── auth.ts        # Autenticacion
│   │   ├── loans.ts       # Prestamos
│   │   ├── payments.ts    # Pagos
│   │   ├── clients.ts     # Clientes
│   │   ├── routes.ts      # Rutas
│   │   ├── employees.ts   # Empleados
│   │   ├── reports.ts     # Reportes
│   │   └── ...
│   ├── services/          # Logica de negocio
│   │   ├── BalanceService.ts    # IMPORTANTE: Manejo centralizado de balances
│   │   ├── LoanService.ts
│   │   ├── PaymentService.ts
│   │   ├── AuthService.ts
│   │   └── ...
│   ├── repositories/      # Acceso a datos (Prisma)
│   │   ├── LoanRepository.ts
│   │   ├── PaymentRepository.ts
│   │   └── ...
│   ├── middleware/        # Middleware Express
│   └── utils/             # Utilidades
├── packages/              # Paquetes internos del monorepo
│   ├── database/         # Prisma schema y cliente
│   ├── shared/           # Tipos y utilidades compartidas
│   ├── graphql-schema/   # Schema GraphQL
│   └── business-logic/   # Logica de negocio compartida
├── scripts/               # Scripts de utilidad
└── docs/                  # Documentacion especifica del API
```

---

## Stack Tecnologico

- **Runtime**: Node.js con tsx
- **Framework**: Express 5
- **GraphQL**: Apollo Server 4
- **ORM**: Prisma 7
- **Auth**: JWT (jsonwebtoken)
- **Package Manager**: pnpm (workspace)

---

## Arquitectura

### Patron de Capas
```
Resolvers → Services → Repositories → Prisma/DB
```

1. **Resolvers**: Manejan requests GraphQL, validacion basica
2. **Services**: Logica de negocio, orquestacion
3. **Repositories**: Acceso a datos, queries Prisma

### Convenciones
- Un resolver por entidad/dominio
- Services contienen toda la logica de negocio
- Repositories son la unica capa que accede a Prisma
- Usar tipos de `@solufacil/shared` y `@solufacil/graphql-schema`

---

## Scripts Disponibles

```bash
pnpm dev              # Servidor desarrollo (tsx watch)
pnpm build            # Build de produccion
pnpm start            # Ejecutar build

# Base de datos
pnpm db:studio        # Prisma Studio
pnpm db:generate      # Generar cliente Prisma
pnpm db:push          # Push schema a DB
pnpm db:migrate       # Ejecutar migraciones
pnpm db:seed          # Seed de datos
```

---

## Paquetes Internos

Este proyecto usa paquetes del workspace:
- `@solufacil/database` - Prisma client y schema
- `@solufacil/shared` - Tipos y utilidades compartidas
- `@solufacil/graphql-schema` - Schema GraphQL
- `@solufacil/business-logic` - Logica de negocio compartida

---

## Servicios Externos

- **Cloudinary**: Almacenamiento de imagenes
- **Telegram**: Notificaciones via bot
- **PDFKit**: Generacion de PDFs

---

## Entidades Principales

- **Loans**: Prestamos
- **Payments**: Pagos (LoanPayment, LeadPaymentReceived)
- **Clients/Borrowers**: Clientes
- **Routes**: Rutas de cobranza
- **Employees**: Empleados/Cobradores
- **AccountEntry**: Ledger de movimientos contables (reemplaza Transaction)
- **Accounts**: Cuentas de efectivo y banco
- **Documents**: Documentos adjuntos

### Sistema de Balance (AccountEntry)

El balance de cuentas se calcula desde el ledger:
```
Balance = SUM(CREDIT) - SUM(DEBIT)
```

Toda operacion que afecta balance debe usar `BalanceService.createEntry()`:
- Pagos recibidos → CREDIT (LOAN_PAYMENT_CASH/LOAN_PAYMENT_BANK)
- Prestamos otorgados → DEBIT (LOAN_GRANT)
- Comisiones → DEBIT (PAYMENT_COMMISSION/LOAN_GRANT_COMMISSION)
- Gastos → DEBIT (GASOLINE, NOMINA_SALARY, etc.)
- Transfers cash→banco → DEBIT(TRANSFER_OUT) + CREDIT(TRANSFER_IN)

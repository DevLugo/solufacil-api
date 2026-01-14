# Borrowers Module - Prestatarios/Clientes

## Descripcion General

Modulo para la gestion de prestatarios (clientes que reciben prestamos), sus datos personales, historial de creditos y busqueda.

## Archivos Principales

| Archivo | Descripcion |
|---------|-------------|
| `src/services/BorrowerService.ts` | CRUD de prestatarios |
| `src/services/PersonalDataService.ts` | Gestion de datos personales |
| `src/services/ClientHistoryService.ts` | Historial completo del cliente |
| `src/repositories/BorrowerRepository.ts` | Acceso a datos |
| `src/repositories/PersonalDataRepository.ts` | Acceso a PersonalData |
| `src/resolvers/borrowers.ts` | Resolvers GraphQL |
| `src/resolvers/clients.ts` | Resolvers de historial cliente |

## Modelo de Datos

### Borrower
```prisma
model Borrower {
  id                String @id
  loanFinishedCount Int    @default(0) // Contador de prestamos pagados

  personalData String @unique
  personalDataRelation PersonalData

  loans Loan[]
}
```

### PersonalData (compartido)
```prisma
model PersonalData {
  id         String    @id
  fullName   String
  clientCode String    @unique // Codigo unico de cliente
  birthDate  DateTime?

  phones    Phone[]
  addresses Address[]

  // Puede ser: Borrower, Employee, o Collateral (aval)
  borrower  Borrower?
  employee  Employee?
  loansAsCollateral Loan[] // Como aval
}
```

### Phone
```prisma
model Phone {
  id           String @id
  number       String
  personalData String
}
```

### Address
```prisma
model Address {
  id             String @id
  street         String
  exteriorNumber String
  interiorNumber String
  postalCode     String
  references     String

  location String // Referencia a Location
  personalData String
}
```

## Business Rules

### BR-BOR-001: Codigo de Cliente Unico
- Todo borrower tiene un `clientCode` unico
- Se genera automaticamente si no se proporciona
- Formato alfanumerico (ej: "ABC123XY")
- No se puede modificar una vez asignado

### BR-BOR-002: Contador de Prestamos Finalizados
- `loanFinishedCount` se incrementa cuando un prestamo pasa a FINISHED
- Incluye prestamos terminados por pago completo
- Incluye prestamos terminados por renovacion
- Se decrementa si se cancela una renovacion

### BR-BOR-003: Datos Personales Compartidos
- PersonalData es la entidad central de informacion personal
- Puede pertenecer a: Borrower, Employee, o ser Collateral
- Los telefonos y direcciones se asocian a PersonalData

### BR-BOR-004: Busqueda de Clientes
- Busqueda por nombre (fullName) con coincidencia parcial
- Busqueda por clientCode exacto
- Busqueda por ubicacion (Location)
- Los resultados incluyen historial de prestamos

### BR-BOR-005: Aval (Collateral)
- Un prestamo puede tener uno o mas avales
- El aval es un PersonalData (no necesita ser Borrower)
- El aval puede tener sus propios telefonos y direccion

## API GraphQL

### Queries
```graphql
# Obtener borrower por ID
borrower(id: ID!): Borrower

# Listar borrowers
borrowers(limit: Int, offset: Int): [Borrower!]!

# Buscar por nombre
searchBorrowers(query: String!): [Borrower!]!

# Historial completo de cliente
clientHistory(borrowerId: ID!): ClientHistory!
```

### Mutations
```graphql
# Crear borrower con datos personales
createBorrower(input: CreateBorrowerInput!): Borrower!

# Actualizar datos del borrower
updateBorrower(id: ID!, input: UpdateBorrowerInput!): Borrower!

# Actualizar datos personales
updatePersonalData(id: ID!, input: UpdatePersonalDataInput!): PersonalData!
```

## Flujos Principales

### Creacion de Borrower
```
1. Generar clientCode si no se proporciona
2. Crear PersonalData con nombre, fecha nacimiento
3. Crear phones asociados
4. Crear addresses con referencia a Location
5. Crear Borrower enlazado a PersonalData
```

### Historial de Cliente
```
1. Obtener borrower con todos sus prestamos
2. Para cada prestamo: obtener pagos asociados
3. Calcular metricas: total prestado, total pagado, pendiente
4. Incluir informacion de avales y documentos
5. Generar PDF si se solicita
```

## Client History Response

```typescript
interface ClientHistory {
  borrower: Borrower
  loans: LoanWithPayments[]
  summary: {
    totalLoans: number
    activeLoans: number
    finishedLoans: number
    totalBorrowed: Decimal
    totalPaid: Decimal
    totalPending: Decimal
  }
}
```

## Consideraciones

- El `loanFinishedCount` es importante para identificar clientes recurrentes
- Los clientes nuevos (primer prestamo) tienen tratamiento especial en reportes
- La busqueda es case-insensitive y soporta acentos

---

**Ultima actualizacion**: 2024

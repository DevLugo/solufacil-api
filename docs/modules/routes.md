# Routes Module - Rutas y Ubicaciones

## Descripcion General

Modulo de gestion geografica: rutas de cobranza, localidades, municipios y estados. Incluye historial de asignaciones de localidades a rutas.

## Archivos Principales

| Archivo | Descripcion |
|---------|-------------|
| `src/services/RouteService.ts` | CRUD de rutas |
| `src/services/RouteManagementService.ts` | Estadisticas y gestion |
| `src/services/LocationHistoryService.ts` | Historial de localidades |
| `src/repositories/RouteRepository.ts` | Acceso a datos |
| `src/resolvers/routes.ts` | Resolvers GraphQL |
| `src/resolvers/locationHistory.ts` | Resolvers de historial |

## Modelo de Datos

### Route
```prisma
model Route {
  id   String @id
  name String // Ej: "Ruta Norte", "Ruta Centro"

  employees Employee[]  // Empleados asignados
  accounts  Account[]   // Cuentas de la ruta
  locations Location[]  // Localidades actuales

  locationHistory LocationRouteHistory[] // Historial
}
```

### Location
```prisma
model Location {
  id   String @id
  name String @unique // Nombre de la localidad

  municipality String    // Municipio
  route        String?   // Ruta actual (opcional)

  addresses Address[]   // Direcciones en esta localidad
  routeHistory LocationRouteHistory[]
}
```

### Municipality
```prisma
model Municipality {
  id   String @id
  name String

  state String // Estado
  locations Location[]
}
```

### State
```prisma
model State {
  id   String @id
  name String @unique

  municipalities Municipality[]
}
```

### LocationRouteHistory
```prisma
model LocationRouteHistory {
  id String @id

  locationId String
  routeId    String

  startDate DateTime  // Inicio de asignacion
  endDate   DateTime? // Fin (null = vigente)

  @@unique([locationId, startDate])
}
```

## Business Rules

### BR-RTE-001: Jerarquia Geografica
```
State > Municipality > Location
```
- Un estado tiene multiples municipios
- Un municipio tiene multiples localidades
- Una localidad pertenece a un solo municipio

### BR-RTE-002: Asignacion de Localidades
- Una localidad puede tener UNA ruta asignada actualmente
- El historial rastrea cambios de asignacion
- `route = null` significa localidad sin asignar

### BR-RTE-003: Historial de Localidades
```typescript
// Al cambiar ruta de una localidad:
1. Cerrar registro anterior (endDate = ahora)
2. Crear nuevo registro (startDate = ahora, endDate = null)

// Consultar ruta en fecha especifica:
SELECT routeId FROM LocationRouteHistory
WHERE locationId = X
  AND startDate <= fecha
  AND (endDate IS NULL OR endDate >= fecha)
```

### BR-RTE-004: Empleados por Ruta
- Una ruta tiene multiples empleados asignados
- Un empleado puede estar en multiples rutas (N:M)
- Generalmente un LEAD tiene una ruta principal

### BR-RTE-005: Cuentas por Ruta
- Cada ruta tiene cuentas asociadas (CASH, BANK)
- Las operaciones financieras usan la cuenta de la ruta
- Una cuenta puede pertenecer a multiples rutas

## API GraphQL

### Queries
```graphql
# Rutas
route(id: ID!): Route
routes: [Route!]!

# Localidades
location(id: ID!): Location
locations(routeId: ID, municipalityId: ID): [Location!]!

# Historial
locationRouteHistory(
  locationId: ID
  routeId: ID
  fromDate: DateTime
  toDate: DateTime
): [LocationRouteHistory!]!

# Buscar localidades por nombre
searchLocations(query: String!): [Location!]!
```

### Mutations
```graphql
# Rutas
createRoute(input: CreateRouteInput!): Route!
updateRoute(id: ID!, input: UpdateRouteInput!): Route!

# Asignar localidades
assignLocationsToRoute(
  locationIds: [ID!]!
  routeId: ID!
): [Location!]!

# Historial batch
upsertLocationRouteHistory(
  input: [LocationRouteHistoryInput!]!
): [LocationRouteHistory!]!
```

## Flujos Principales

### Cambio de Ruta de Localidad
```
1. Obtener asignacion actual (endDate = null)
2. Si existe: cerrar con endDate = ahora
3. Crear nueva asignacion:
   - startDate = ahora
   - endDate = null
4. Actualizar Location.route
```

### Consulta de Prestamos por Ruta Historica
```
1. Para reportes, usar LocationRouteHistory
2. Filtrar por fecha del reporte
3. Encontrar ruta de la localidad EN ESA FECHA
4. Agrupar prestamos segun ruta historica
```

### Estadisticas de Ruta
```typescript
interface RouteStats {
  totalLoans: number        // Prestamos activos
  totalBorrowers: number    // Clientes activos
  totalPending: Decimal     // Deuda total
  totalLocations: number    // Localidades
  employeeCount: number     // Empleados
}
```

## Snapshot de Ruta en Prestamos

Los prestamos guardan `snapshotLeadId` pero NO `snapshotRouteId` directamente. La ruta se determina via:

1. **LocationRouteHistory**: Usando la direccion del borrower y la fecha del prestamo
2. **Lead actual**: Via `leadRelation.routes`

Esto permite flexibilidad cuando las localidades cambian de ruta.

## Consideraciones

### Reportes Historicos
- Los reportes por ruta deben considerar el historial
- No asumir que la ruta actual es la historica
- Usar LocationRouteHistory para precision

### Batch Operations
- El cambio de multiples localidades se hace en una transaccion
- Se genera historial para cada cambio
- Es idempotente (no duplica registros)

---

**Ultima actualizacion**: 2024

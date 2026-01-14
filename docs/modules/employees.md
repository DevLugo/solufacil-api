# Employees Module - Empleados y Jerarquia Organizacional

## Descripcion General

Modulo para la gestion de empleados, su jerarquia organizacional y asignacion a rutas de cobranza.

## Archivos Principales

| Archivo | Descripcion |
|---------|-------------|
| `src/services/EmployeeService.ts` | CRUD de empleados |
| `src/services/LeaderService.ts` | Logica especifica para liders |
| `src/repositories/EmployeeRepository.ts` | Acceso a datos de empleados |
| `src/resolvers/employees.ts` | Resolvers GraphQL |
| `src/resolvers/leaders.ts` | Resolvers especificos para leads |

## Modelo de Datos

### Employee
```prisma
model Employee {
  id    String       @id
  type  EmployeeType

  personalData String @unique
  personalDataRelation PersonalData

  user String? @unique
  userRelation User?

  routes Route[] @relation("RouteEmployees")

  loansGranted       Loan[] // Prestamos que otorgo
  loansManagedAsLead Loan[] // Prestamos que gestiona como lead

  leadPaymentsReceivedAsLead  LeadPaymentReceived[]
  leadPaymentsReceivedAsAgent LeadPaymentReceived[]
}

enum EmployeeType {
  ROUTE_LEAD      // Responsable de ruta (jefe de lider)
  LEAD            // Lider de cobranza
  ROUTE_ASSISTENT // Asistente de ruta
}
```

## Business Rules

### BR-EMP-001: Tipos de Empleado
- **ROUTE_LEAD**: Supervisa multiples rutas y leads
- **LEAD**: Gestiona la cobranza diaria de una ruta
- **ROUTE_ASSISTENT**: Apoya al lead en operaciones

### BR-EMP-002: Asignacion a Rutas
- Un empleado puede estar asignado a multiples rutas
- Los LEAD generalmente tienen 1 ruta principal
- Los ROUTE_LEAD supervisan varias rutas

### BR-EMP-003: Generacion de Codigo Cliente
- Todo empleado recibe un `clientCode` unico
- El codigo se genera automaticamente si no se proporciona
- Formato: alfanumerico aleatorio unico

### BR-EMP-004: Enlace con Usuario
- Un empleado puede tener un User asociado (para login)
- El enlace es 1:1 y opcional
- Permite que el empleado acceda al sistema

### BR-EMP-005: Promocion a Lead
- Un ROUTE_ASSISTENT puede ser promovido a LEAD
- La promocion actualiza el tipo sin perder historial
- Los prestamos existentes mantienen sus referencias

## API GraphQL

### Queries
```graphql
# Obtener empleado por ID
employee(id: ID!): Employee

# Listar empleados con filtros
employees(type: EmployeeType, routeId: ID): [Employee!]!

# Empleados con rol de LEAD
leads(routeId: ID): [Employee!]!
```

### Mutations
```graphql
# Crear empleado
createEmployee(input: CreateEmployeeInput!): Employee!

# Actualizar empleado
updateEmployee(id: ID!, input: UpdateEmployeeInput!): Employee!

# Promover a lead
promoteToLead(id: ID!): Employee!
```

## Flujos Principales

### Creacion de Empleado
```
1. Validar datos de entrada
2. Generar clientCode si no existe
3. Crear PersonalData asociado
4. Crear Employee con relacion a PersonalData
5. Asignar a rutas si se especifican
```

### Asignacion de Pagos a Lead
```
1. Lead recibe pagos de clientes durante el dia
2. Se crea LeadPaymentReceived con distribucion cash/bank
3. Los pagos individuales se asocian al LPR
4. El lead puede transferir efectivo a banco (cashToBank)
```

## Relaciones Importantes

- **Employee -> PersonalData**: 1:1 (datos personales)
- **Employee -> User**: 1:1 opcional (acceso al sistema)
- **Employee -> Route**: N:M (empleado en multiples rutas)
- **Employee -> Loan (as Lead)**: 1:N (prestamos gestionados)
- **Employee -> LeadPaymentReceived**: 1:N (pagos recibidos)

## Dependencias

- `@solufacil/shared`: generateClientCode()
- Prisma ORM para persistencia

---

**Ultima actualizacion**: 2024

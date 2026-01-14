# Auth Module - Autenticacion y Usuarios

## Descripcion General

Modulo responsable de la autenticacion de usuarios, gestion de sesiones JWT y control de acceso basado en roles (RBAC).

## Archivos Principales

| Archivo | Descripcion |
|---------|-------------|
| `src/services/AuthService.ts` | Logica de autenticacion (login, refresh token) |
| `src/services/UserService.ts` | CRUD de usuarios y verificacion de credenciales |
| `src/repositories/UserRepository.ts` | Acceso a datos de usuarios |
| `src/resolvers/auth.ts` | Resolvers GraphQL de autenticacion |
| `src/middleware/auth.ts` | Middleware JWT y generacion de tokens |

## Modelo de Datos

### User
```prisma
model User {
  id        String   @id
  name      String
  email     String   @unique
  password  String   // Hash bcrypt
  role      UserRole
  employee  Employee? // Enlace opcional a empleado
}

enum UserRole {
  ADMIN           // Acceso total
  NORMAL          // Usuario estandar
  CAPTURA         // Solo captura de datos
  DOCUMENT_REVIEWER // Revision de documentos
}
```

## Business Rules

### BR-AUTH-001: Autenticacion JWT
- Los tokens de acceso expiran en 15 minutos
- Los refresh tokens expiran en 7 dias
- Al hacer refresh, se generan AMBOS tokens nuevos

### BR-AUTH-002: Hasheo de Contrasenas
- Las contrasenas se hashean con bcrypt
- El salt rounds es 10 por defecto
- NUNCA se almacenan contrasenas en texto plano

### BR-AUTH-003: Roles y Permisos
- **ADMIN**: Puede realizar todas las operaciones
- **NORMAL**: Acceso a operaciones de cobranza y reportes
- **CAPTURA**: Solo puede crear prestamos y registrar pagos
- **DOCUMENT_REVIEWER**: Solo puede revisar y aprobar documentos

### BR-AUTH-004: Enlace Usuario-Empleado
- Un usuario puede estar enlazado a un Employee
- El enlace es opcional pero recomendado para leads
- Permite asociar operaciones al empleado correspondiente

## API GraphQL

### Mutations
```graphql
# Login con credenciales
login(email: String!, password: String!): AuthPayload!

# Refrescar tokens
refreshToken(token: String!): AuthPayload!

# Cambiar contrasena
changePassword(oldPassword: String!, newPassword: String!): Boolean!

# Crear usuario (ADMIN)
createUser(input: CreateUserInput!): User!
```

### Queries
```graphql
# Usuario actual (desde token)
me: User

# Lista de usuarios (ADMIN)
users: [User!]!
```

## Flujos Principales

### Login Flow
```
1. Usuario envia email + password
2. AuthService.login() verifica credenciales via UserService
3. Si valido: genera accessToken + refreshToken
4. Retorna AuthPayload con tokens y datos del usuario
```

### Refresh Token Flow
```
1. Cliente envia refresh token expirado/proximo a expirar
2. AuthService.refreshToken() verifica JWT
3. Si valido: obtiene usuario actualizado
4. Genera nuevos tokens
5. Retorna AuthPayload actualizado
```

## Consideraciones de Seguridad

- Los tokens JWT contienen: userId, email, role
- El refresh secret es diferente al access secret
- Las credenciales invalidas retornan error generico "Invalid credentials"
- No se exponen detalles sobre que campo fallo (email vs password)

## Dependencias

- `jsonwebtoken`: Generacion y verificacion de JWT
- `bcryptjs`: Hasheo de contrasenas
- `graphql`: Manejo de errores GraphQL

---

**Ultima actualizacion**: 2024

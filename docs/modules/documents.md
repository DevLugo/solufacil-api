# Documents Module - Documentos y Fotos

## Descripcion General

Modulo para gestion de documentos adjuntos a prestamos y clientes: fotos de identificacion, comprobantes, pagares y validacion de documentos.

## Archivos Principales

| Archivo | Descripcion |
|---------|-------------|
| `src/services/DocumentPhotoService.ts` | Logica de documentos |
| `src/services/CloudinaryService.ts` | Integracion con Cloudinary |
| `src/repositories/DocumentPhotoRepository.ts` | Acceso a datos |
| `src/resolvers/documents.ts` | Resolvers GraphQL |

## Modelo de Datos

### DocumentPhoto
```prisma
model DocumentPhoto {
  id               String       @id
  title            String       // Titulo descriptivo
  description      String       // Descripcion adicional
  photoUrl         String       // URL de la imagen en Cloudinary
  publicId         String       // ID publico en Cloudinary
  documentType     DocumentType // Tipo de documento
  isError          Boolean      // Tiene error?
  errorDescription String       // Descripcion del error
  isMissing        Boolean      // Esta faltante?

  personalData String?   // PersonalData asociado
  loan         String?   // Prestamo asociado

  uploadedBy String      // Usuario que subio
}

enum DocumentType {
  INE       // Identificacion oficial
  DOMICILIO // Comprobante de domicilio
  PAGARE    // Pagare firmado
  OTRO      // Otro documento
}
```

## Business Rules

### BR-DOC-001: Tipos de Documento
- **INE**: Identificacion oficial (INE/IFE)
- **DOMICILIO**: Comprobante de domicilio (recibo luz, agua, etc.)
- **PAGARE**: Documento del prestamo firmado
- **OTRO**: Cualquier otro documento relevante

### BR-DOC-002: Asociaciones
```typescript
// Un documento puede estar asociado a:
1. PersonalData (cliente/aval): INE, DOMICILIO
2. Loan (prestamo): PAGARE, documentos del credito

// Un documento NO puede estar asociado a ambos
```

### BR-DOC-003: Marcado de Errores
```typescript
// Cuando un revisor encuentra problema:
document.isError = true
document.errorDescription = "La foto esta borrosa/incompleta/..."

// Esto dispara notificacion al lead responsable
```

### BR-DOC-004: Documentos Faltantes
```typescript
// Si se espera documento pero no existe:
isMissing = true

// Se puede crear placeholder con isMissing para tracking
```

### BR-DOC-005: Almacenamiento en Cloudinary
```typescript
// Al subir:
1. Validar tipo de archivo (imagen)
2. Subir a Cloudinary con carpeta organizada
3. Guardar publicId para eliminacion futura
4. Guardar URL transformada (optimizada)

// Al eliminar:
1. Eliminar de Cloudinary via publicId
2. Eliminar registro de DB
```

### BR-DOC-006: Tracking de Quien Subio
- `uploadedBy` guarda el User que subio el documento
- Importante para auditoria y responsabilidad
- Permite filtrar documentos por usuario

## API GraphQL

### Queries
```graphql
# Documento por ID
documentPhoto(id: ID!): DocumentPhoto

# Documentos de un cliente (PersonalData)
documentsByPersonalData(personalDataId: ID!): [DocumentPhoto!]!

# Documentos de un prestamo
documentsByLoan(loanId: ID!): [DocumentPhoto!]!

# Documentos con errores
documentsWithErrors(
  routeId: ID
  documentType: DocumentType
): [DocumentPhoto!]!

# Documentos faltantes
missingDocuments(
  routeId: ID
  documentType: DocumentType
): [DocumentPhoto!]!
```

### Mutations
```graphql
# Subir documento
uploadDocument(
  file: Upload!
  documentType: DocumentType!
  personalDataId: ID
  loanId: ID
  title: String
  description: String
): DocumentPhoto!

# Marcar con error
markDocumentError(
  id: ID!
  errorDescription: String!
): DocumentPhoto!

# Limpiar error
clearDocumentError(id: ID!): DocumentPhoto!

# Eliminar documento
deleteDocument(id: ID!): Boolean!

# Marcar como faltante
markDocumentMissing(
  documentType: DocumentType!
  personalDataId: ID
  loanId: ID
): DocumentPhoto!
```

## Flujos Principales

### Subida de Documento
```
1. Recibir archivo via GraphQL Upload
2. Validar tipo (imagen)
3. Subir a Cloudinary
4. Crear registro DocumentPhoto
5. Asociar a PersonalData o Loan
6. Retornar documento creado
```

### Revision de Documentos
```
1. Usuario DOCUMENT_REVIEWER accede a lista
2. Filtrar por ruta, tipo, estado
3. Revisar cada documento
4. Si error: marcar con descripcion
5. Se envia notificacion al lead (via Telegram)
```

### Notificacion de Errores
```
1. Al marcar isError = true
2. Obtener lead responsable (via loan o borrower)
3. Buscar TelegramUser del lead
4. Enviar notificacion con detalles del error
5. Registrar en DocumentNotificationLog
```

## Integracion Cloudinary

### Configuracion
```typescript
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})
```

### Estructura de Carpetas
```
solufacil/
├── documents/
│   ├── ine/
│   ├── domicilio/
│   ├── pagare/
│   └── otro/
```

### Transformaciones
```typescript
// URL optimizada:
url = cloudinary.url(publicId, {
  transformation: [
    { width: 1200, crop: 'limit' },
    { quality: 'auto' },
    { format: 'auto' }
  ]
})
```

## Modelo de Notificacion

### DocumentNotificationLog
```prisma
model DocumentNotificationLog {
  id               String
  documentId       String
  documentType     String
  personName       String
  routeName        String
  issueType        String      // 'error' | 'missing'
  status           String      // 'sent' | 'failed'
  telegramResponse String
  sentAt           DateTime?
}
```

## Consideraciones

### Seguridad
- Solo usuarios autenticados pueden subir
- Solo DOCUMENT_REVIEWER puede marcar errores
- Las URLs de Cloudinary son firmadas

### Performance
- Las imagenes se optimizan automaticamente
- Se usa lazy loading en listados
- Las thumbnails se generan via transformacion

### Auditoria
- Se registra quien subio cada documento
- Se registran notificaciones enviadas
- El historial de errores se mantiene

---

**Ultima actualizacion**: 2024

# Instrucciones para Claude - Solufacil API

## Documentacion de Modulos

Este proyecto tiene documentacion detallada de cada modulo en `docs/modules/`. **ANTES de trabajar en cualquier feature**, debes:

### 1. Identificar el Modulo
Determina que modulo(s) afecta la feature:

| Modulo | Archivo | Descripcion |
|--------|---------|-------------|
| auth | `docs/modules/auth.md` | Autenticacion, usuarios, JWT, roles |
| employees | `docs/modules/employees.md` | Empleados, leads, jerarquia |
| borrowers | `docs/modules/borrowers.md` | Clientes/prestatarios, datos personales |
| loans | `docs/modules/loans.md` | **CRITICO** - Prestamos, renovaciones, cancelaciones |
| payments | `docs/modules/payments.md` | **CRITICO** - Pagos, distribucion, abonos |
| accounts | `docs/modules/accounts.md` | **CRITICO** - Cuentas, ledger, balances |
| routes | `docs/modules/routes.md` | Rutas, localidades, geografia |
| reports | `docs/modules/reports.md` | Reportes financieros, analitica |
| portfolio | `docs/modules/portfolio.md` | Reportes de cartera, KPIs |
| bad-debt | `docs/modules/bad-debt.md` | Cartera vencida y muerta |
| documents | `docs/modules/documents.md` | Documentos, fotos, Cloudinary |
| telegram | `docs/modules/telegram.md` | Integracion Telegram |

### 2. Leer las Business Rules
Cada archivo .md contiene seccion `Business Rules` con reglas criticas prefijadas `BR-XXX-NNN`:

- **SIEMPRE** lee las business rules antes de implementar
- Las reglas con `(CRITICAS)` deben respetarse estrictamente
- Si hay conflicto con la solicitud, consulta primero

### 3. Al Terminar

**IMPORTANTE**: Despues de completar una feature que afecte business rules:

1. Verifica que las reglas existentes sigan siendo validas
2. Si agregaste logica nueva, documenta la nueva regla
3. Si modificaste comportamiento, actualiza la regla correspondiente
4. Formato de nueva regla: `BR-XXX-NNN: Descripcion`

---

## Reglas de Arquitectura (de AGENTS.md)

### Logica de Negocio en business-logic

**TODA la logica financiera DEBE estar en `@solufacil/business-logic`**:
- Calculos de profit
- Distribucion de pagos
- Renovaciones
- Cartera vencida

Los Services solo **orquestan**, NO calculan.

### Precision Financiera

- **SIEMPRE** usar `Decimal.js` para calculos de dinero
- **NUNCA** usar `number` de JavaScript para cantidades
- Las funciones de business-logic usan Decimal.js

### Patron de Capas

```
Resolvers -> Services -> Repositories -> Prisma
```

- Resolvers: Solo manejan requests GraphQL
- Services: Logica de negocio y orquestacion
- Repositories: Unico punto de acceso a Prisma

---

## Modulos Criticos

Los siguientes modulos son especialmente criticos y requieren atencion extra:

### Loans (loans.md)
- Formulas de calculo de prestamo nuevo y renovacion
- Manejo de `profitHeredado`
- Estados del prestamo y transiciones

### Payments (payments.md)
- Distribucion profit vs capital
- Logica de cashToBank
- Bad debt: 100% a profit

### Accounts (accounts.md)
- El balance SIEMPRE se deriva del ledger
- Solo BalanceService puede modificar balances
- Transferencias crean pares de entradas

---

## Documentacion Adicional

- `docs/payment-distribution-logic.md` - Casos edge de distribucion
- `docs/portfolio-report-kpis.md` - Calculo detallado de KPIs
- `AGENTS.md` - Reglas generales de arquitectura

---

## Checklist para Features

Antes de empezar:
- [ ] Identificar modulo(s) afectados
- [ ] Leer documentacion del modulo en `docs/modules/`
- [ ] Revisar business rules relevantes
- [ ] Verificar si hay documentacion adicional en `docs/`

Al terminar:
- [ ] Verificar que business rules existentes siguen validas
- [ ] Documentar nuevas reglas si aplica
- [ ] Actualizar reglas modificadas
- [ ] Asegurar que calculos usan Decimal.js
- [ ] Verificar que logica financiera esta en business-logic

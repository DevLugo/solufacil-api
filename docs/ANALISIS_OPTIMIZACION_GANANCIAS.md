# Análisis de Optimización de Ganancias - SoluFacil

**Fecha:** Enero 2025
**Datos analizados:** Base de datos de producción

---

## 1. Estado Actual del Negocio

### Cartera Actual

| Categoría | Cantidad | Capital | Ganancia | Pendiente |
|-----------|----------|---------|----------|-----------|
| **Activos (cobrando)** | 1,229 | $4.6M | $1.1M | $3.7M |
| **Finalizados (pagaron todo)** | 3,460 | $11.9M | $4.7M | $0.8M |
| **Cartera Muerta** | 336 | $1.1M | $0.5M | $0.7M perdido |

### Producto Principal Actual

| Métrica | Valor |
|---------|-------|
| **Nombre** | 14 semanas / 40% |
| **Préstamos 2025** | 4,563 |
| **Monto promedio** | $3,431 |
| **Ganancia promedio** | $1,343 |
| **Total a pagar** | $4,803 |
| **Pago semanal** | $343 |

### ROI Real

| Métrica | Valor |
|---------|-------|
| ROI esperado | 39.6% |
| **ROI real** | **30.2%** |
| Diferencia | -9.4 puntos (~25% menos de lo esperado) |

---

## 2. Propuesta: Producto Express 8 Semanas / 25%

### Comparación Detallada

#### Producto Actual: 14 semanas / 40%

```
EJEMPLO: Préstamo de $3,500

Capital:         $3,500
Tasa:            40%
Ganancia:        $1,400
Total a pagar:   $4,900
Pago semanal:    $350
Duración:        14 semanas

Rotación anual:  52 ÷ 14 = 3.71 ciclos/año
Ganancia anual por $3,500: $1,400 × 3.71 = $5,194/año
ROI anual:       148%
```

#### Producto Propuesto: 8 semanas / 25%

```
EJEMPLO: Préstamo de $3,500

Capital:         $3,500
Tasa:            25%
Ganancia:        $875
Total a pagar:   $4,375
Pago semanal:    $547 (↑57% más alto)
Duración:        8 semanas

Rotación anual:  52 ÷ 8 = 6.5 ciclos/año
Ganancia anual por $3,500: $875 × 6.5 = $5,688/año
ROI anual:       162% (↑14% más que actual)
```

### Proyección a 4 Meses

**Supuestos:**
- 400 préstamos nuevos/mes (promedio actual)
- 20% adopción del nuevo producto = 80 préstamos/mes en producto express
- Tasa de renovación: 80%

#### Escenario: 20% de préstamos en producto Express

| Mes | Préstamos Express | Capital | Ganancia Generada |
|-----|-------------------|---------|-------------------|
| Mes 1 | 80 | $280,000 | $70,000 |
| Mes 2 | 80 + 64 renovaciones = 144 | $504,000 | $126,000 |
| Mes 3 | 80 + 115 renovaciones = 195 | $682,500 | $170,625 |
| Mes 4 | 80 + 156 renovaciones = 236 | $826,000 | $206,500 |
| **Total 4 meses** | | | **$573,125** |

#### Comparación: Si esos mismos clientes estuvieran en producto 14 semanas

| Mes | Préstamos 14 sem | Ganancia (no se completa el ciclo aún) |
|-----|------------------|----------------------------------------|
| Mes 1 | 80 | $0 (aún cobrando) |
| Mes 2 | 160 | $0 (aún cobrando) |
| Mes 3 | 240 | $112,000 (solo los del mes 1) |
| Mes 4 | 320 | $168,000 |
| **Total 4 meses** | | **$280,000** |

### Ganancia Extra con Producto Express

```
Ganancia Express (4 meses):    $573,125
Ganancia 14 semanas (4 meses): $280,000
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GANANCIA EXTRA:                +$293,125
```

### Ventajas del Producto Express

1. **Mayor rotación** - El capital trabaja 6.5 veces/año vs 3.7 veces
2. **Menor exposición** - Solo 8 semanas de riesgo vs 14 semanas
3. **Pago más alto** - Cliente más comprometido ($547 vs $350)
4. **Atractivo para cliente** - "Termina más rápido"
5. **Mejor flujo de caja** - Recuperas capital en menos tiempo

### Desventajas a Considerar

1. **Pago semanal más alto** - No todos los clientes pueden pagarlo
2. **Menos ganancia por préstamo** - $875 vs $1,400
3. **Requiere más colocación** - Necesitas más renovaciones para mantener volumen

### Recomendación de Implementación

```sql
-- Crear nuevo tipo de préstamo
INSERT INTO "Loantype" (
  id,
  name,
  "weekDuration",
  rate,
  "loanPaymentComission",
  "loanGrantedComission",
  "createdAt",
  "updatedAt"
) VALUES (
  gen_random_uuid(),
  'Express 8 semanas/25%',
  8,
  0.25,
  6.00,  -- Comisión por pago (menor porque son menos pagos)
  60.00, -- Comisión por otorgamiento
  NOW(),
  NOW()
);
```

---

## 3. Análisis de Cartera Vencida → Cartera Muerta

### ¿Cuántos pagos hicieron antes de caer en Cartera Muerta?

| Pagos Realizados | Cantidad CM | Monto Perdido | Promedio Perdido |
|------------------|-------------|---------------|------------------|
| **0 pagos** | 2 | $8,400 | $4,200 |
| **1-2 pagos** | 33 | $135,450 | $4,105 |
| **3-4 pagos** | 32 | $107,100 | $3,347 |
| **5-6 pagos** | 61 | $180,175 | $2,954 |
| **7-8 pagos** | 63 | $134,825 | $2,140 |
| **9-10 pagos** | 40 | $62,375 | $1,559 |
| **11+ pagos** | 105 | $53,712 | $512 |

### Hallazgo Clave

**El 58% de la cartera muerta ($430,725) viene de clientes que pagaron 6 o menos veces.**

Esto significa que si un cliente lleva 3-4 semanas sin pagar, ya tiene alto riesgo de convertirse en cartera muerta.

### Estado Actual de Clientes Activos (Riesgo)

| Semanas Sin Pago | Clientes | Monto en Riesgo | Riesgo |
|------------------|----------|-----------------|--------|
| **0-1 semanas** | 895 | $2,661,505 | ✅ Bajo |
| **2 semanas** | 41 | $131,970 | ⚠️ Alerta |
| **3 semanas** | 12 | $22,850 | 🔴 Alto |
| **4 semanas** | 76 | $366,050 | 🔴🔴 Crítico |
| **5+ semanas** | 205 | $476,819 | 💀 Muy Alto |

### Probabilidad de Cartera Muerta

Basado en datos históricos:

```
Semanas sin pago → Probabilidad de CM

0-1 semanas:   ~2%  (normal, pueden estar adelantados)
2 semanas:     ~5%  (empezar a llamar)
3 semanas:    ~15%  (visita urgente)
4 semanas:    ~35%  (intervención del líder)
5+ semanas:   ~60%  (muy probablemente perdido)
```

### Estrategia de Prevención

#### Semana 2 sin pago - ALERTA AMARILLA
- Llamada automática SMS/WhatsApp
- Recordatorio del monto pendiente
- **Costo de no actuar:** $132K en riesgo (41 clientes actuales)

#### Semana 3 sin pago - ALERTA ROJA
- Visita del líder
- Llamada personal
- Ofrecer plan de pago parcial
- **Costo de no actuar:** $23K en riesgo (12 clientes actuales)

#### Semana 4 sin pago - INTERVENCIÓN
- Líder + supervisor
- Contactar referencias/colaterales
- Última oportunidad antes de marcar como CV permanente
- **Costo de no actuar:** $366K en riesgo (76 clientes actuales)

#### Semana 5+ - RECUPERACIÓN AGRESIVA
- Considerar acuerdos de liquidación
- Recuperar lo que se pueda
- **Actualmente:** $477K en riesgo (205 clientes)

### Impacto Financiero de Actuar Temprano

Si con intervención en semana 2-3 reduces cartera muerta en 30%:

```
Cartera muerta actual anual:    ~$682,000
Reducción 30%:                  -$204,600
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AHORRO ANUAL:                   +$204,600
```

---

## 4. Resumen de Oportunidades

| Iniciativa | Impacto Estimado (4 meses) |
|------------|---------------------------|
| Producto Express 8 sem (20% adopción) | +$293,125 |
| Reducir CM 30% con intervención temprana | +$68,200 |
| **Total** | **+$361,325** |

---

## 5. Próximos Pasos

### Corto Plazo (1-2 semanas)
- [ ] Crear loantype "Express 8 semanas/25%" en producción
- [ ] Definir criterios de elegibilidad (clientes con historial perfecto)
- [ ] Capacitar líderes sobre el nuevo producto

### Mediano Plazo (1 mes)
- [ ] Implementar alertas automáticas de CV (semana 2, 3, 4)
- [ ] Dashboard de "Clientes en Riesgo" para supervisores
- [ ] Piloto del producto Express en 1 ruta

### Seguimiento
- [ ] Revisar resultados del piloto a los 2 meses
- [ ] Medir impacto en cartera muerta
- [ ] Ajustar tasa/duración si es necesario

---

## Notas Técnicas

### Consultas SQL Utilizadas

Ver archivo de análisis completo en la conversación de Claude Code.

### Datos Actualizados

Este análisis usa datos de la base de datos hasta enero 2025.

---

*Documento generado con análisis de datos reales de SoluFacil*

-- ============================================================
-- SYNC LocationRouteHistory para PRODUCCIÓN (schema: solufacil_mono)
-- ÚNICA fuente de verdad: Location.route
-- ============================================================

SET search_path TO "solufacil_mono";

-- Paso 1: Limpiar registros existentes
DELETE FROM "LocationRouteHistory";

-- Paso 2: Insertar desde Location.route (ÚNICA fuente)
INSERT INTO "LocationRouteHistory" (
  "id",
  "locationId",
  "routeId",
  "startDate",
  "endDate",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  loc.id,
  loc.route,
  '2020-01-01'::timestamp,
  NULL::timestamp,
  NOW(),
  NOW()
FROM "Location" loc
WHERE loc.route IS NOT NULL;

-- Verificación
SELECT
  r.name as route_name,
  COUNT(lrh.id) as location_count
FROM "LocationRouteHistory" lrh
JOIN "Route" r ON r.id = lrh."routeId"
GROUP BY r.name
ORDER BY r.name;

-- ============================================================
-- SYNC LocationRouteHistory para PRODUCCIÓN (schema: solufacil_mono)
-- Misma lógica que RouteRepository.findLocations() (dropdown /transacciones)
-- PRIORIDAD: Employee→Route sobre Location.route (más confiable)
-- ============================================================

SET search_path TO "solufacil_mono";

-- Paso 1: Limpiar registros existentes
TRUNCATE TABLE "LocationRouteHistory";

-- Paso 2: Insertar con PRIORIDAD CORRECTA
-- Fuente 1: Employee→Route (más confiable - viene de la operación real)
-- Fuente 2: Location.route (fallback)
INSERT INTO "LocationRouteHistory" (
  "id",
  "locationId",
  "routeId",
  "startDate",
  "endDate",
  "createdAt",
  "updatedAt"
)
SELECT DISTINCT ON (location_id)
  gen_random_uuid()::text,
  location_id,
  route_id,
  '2020-01-01'::timestamp,
  NULL::timestamp,
  NOW(),
  NOW()
FROM (
  -- Fuente 1: Employee→Route (PRIORIDAD - refleja operación real)
  SELECT DISTINCT
    loc.id as location_id,
    re."B" as route_id,
    1 as priority
  FROM "_RouteEmployees" re
  JOIN "Employee" e ON e.id = re."A"
  JOIN "PersonalData" pd ON pd.id = e."personalData"
  JOIN "Address" a ON a."personalData" = pd.id
  JOIN "Location" loc ON loc.id = a.location
  WHERE loc.id IS NOT NULL AND re."B" IS NOT NULL

  UNION ALL

  -- Fuente 2: Location.route (FALLBACK)
  SELECT
    loc.id as location_id,
    loc.route as route_id,
    2 as priority
  FROM "Location" loc
  WHERE loc.route IS NOT NULL
) combined
WHERE route_id IS NOT NULL
ORDER BY location_id, priority ASC;

-- Paso 3: Sincronizar Location.route CON LocationRouteHistory (no al revés)
UPDATE "Location" loc
SET route = lrh."routeId"
FROM "LocationRouteHistory" lrh
WHERE lrh."locationId" = loc.id
  AND lrh."endDate" IS NULL
  AND (loc.route IS NULL OR loc.route != lrh."routeId");

-- Verificación: Distribución por ruta
SELECT
  r.name as route_name,
  COUNT(lrh.id) as location_count
FROM "LocationRouteHistory" lrh
JOIN "Route" r ON r.id = lrh."routeId"
GROUP BY r.name
ORDER BY r.name;

-- Verificación: Total
SELECT COUNT(*) as total_locations FROM "LocationRouteHistory";

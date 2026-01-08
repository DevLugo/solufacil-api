-- Script para verificar el historial de rutas de una localidad
-- Reemplaza 'LOCATION_ID' con el ID real

SET search_path TO "solufacil_mono";

-- Ver todos los registros de historial para una localidad
SELECT
  lrh.id,
  lrh."locationId",
  lrh."routeId",
  r.name as route_name,
  lrh."startDate",
  lrh."endDate",
  lrh."createdAt"
FROM "LocationRouteHistory" lrh
JOIN "Route" r ON r.id = lrh."routeId"
WHERE lrh."locationId" = 'LOCATION_ID'
ORDER BY lrh."startDate" DESC;

-- Ver también el campo Location.route (ruta "actual" en la tabla Location)
SELECT
  l.id,
  l.name as location_name,
  l.route as current_route_id,
  r.name as current_route_name
FROM "Location" l
LEFT JOIN "Route" r ON r.id = l.route
WHERE l.id = 'LOCATION_ID';

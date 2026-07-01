import * as Location from "expo-location";
import { GEOFENCE_TASK } from "./tasks";
import type { GeofenceZone } from "./clock";

export async function startGeofencing(zones: GeofenceZone[]) {
  const regions: Location.LocationRegion[] = zones
    .filter((z) => z.is_active && z.latitude != null && z.longitude != null)
    .slice(0, 20)
    .map((z) => ({
      identifier: `outlet:${z.name}`,
      latitude: Number(z.latitude),
      longitude: Number(z.longitude),
      // Match the server default (GEOFENCE_RADIUS_METERS = 100). A 150 fallback
      // here disagreed with the server's in/out verdict and the clock-out gate.
      radius: z.radius_meters ?? 100,
      notifyOnEnter: true,
      notifyOnExit: true,
    }));

  if (regions.length === 0) return false;

  try {
    const already = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
    if (already) await Location.stopGeofencingAsync(GEOFENCE_TASK);
    await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
    return true;
  } catch {
    return false;
  }
}

export async function stopGeofencing() {
  try {
    const running = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
    if (running) await Location.stopGeofencingAsync(GEOFENCE_TASK);
  } catch {}
}

import { checkAgentKey, sendSuccess, sendError, setCors } from '../lib/apiHelper';
import { readData, pushData } from '../lib/firebaseHelper';

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (!checkAgentKey(req, res)) return;

  if (req.method !== 'GET') {
    return sendError(res, 405, 'method_not_allowed', 'Only GET allowed');
  }

  const { plate } = req.query;
  if (!plate) {
    return sendError(res, 400, 'missing_fields', 'plate query parameter is required');
  }

  try {
    const bazacars = await readData('bazacars');
    if (!bazacars) {
      return sendError(res, 404, 'not_found', 'No vehicles found in database');
    }

    const normalizedPlate = plate.toString().toLowerCase().replace(/\s+/g, '');
    let foundVehicle = null;

    for (const key in bazacars) {
      const v = bazacars[key];
      if (v.carNumber && v.carNumber.toLowerCase().replace(/\s+/g, '') === normalizedPlate) {
        foundVehicle = { id: key, ...v };
        break;
      }
    }

    if (!foundVehicle) {
      return sendError(res, 404, 'not_found', `Vehicle with plate ${plate} not found`);
    }

    // Map to required fields
    const data = {
      id: foundVehicle.id,
      plate: foundVehicle.carNumber,
      trailer: foundVehicle.trailerNumber || '', 
      brand: foundVehicle.brand || '',
      driver: foundVehicle.driverName,
      status: foundVehicle.status,
      currentLocation: foundVehicle.location || '',
      direction: foundVehicle.direction || '',
    };

    // Auto log action
    await pushData('agent_logs', {
      actionType: 'getVehicle',
      initiatedBy: 'agent',
      timestamp: new Date().toISOString(),
      payload: { plate },
      result: 'success'
    });

    return sendSuccess(res, data);
  } catch (err: any) {
    return sendError(res, 500, 'internal_error', err.message);
  }
}

import { checkAgentKey, sendSuccess, sendError, setCors } from '../lib/apiHelper';
import { readData, pushData } from '../lib/firebaseHelper';

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (!checkAgentKey(req, res)) return;

  if (req.method !== 'GET') {
    return sendError(res, 405, 'method_not_allowed', 'Only GET allowed');
  }

  try {
    const bazacars = await readData('bazacars');
    
    const fleet: any[] = [];
    if (bazacars) {
      for (const key in bazacars) {
        const v = bazacars[key];
        fleet.push({
          id: key,
          plate: v.carNumber || '',
          driver: v.driverName || '',
          status: v.status || '',
          currentLocation: v.location || '',
          direction: v.direction || ''
        });
      }
    }

    // Auto log action
    await pushData('agent_logs', {
      actionType: 'getVehicleFleet',
      initiatedBy: 'agent',
      timestamp: new Date().toISOString(),
      payload: {},
      result: 'success'
    });

    return sendSuccess(res, { fleet });
  } catch (err: any) {
    return sendError(res, 500, 'internal_error', err.message);
  }
}

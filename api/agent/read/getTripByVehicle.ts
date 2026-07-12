import { checkAgentKey, sendSuccess, sendError, setCors } from '../lib/apiHelper';
import { readData, pushData } from '../lib/firebaseHelper';

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (!checkAgentKey(req, res)) return;

  if (req.method !== 'GET') {
    return sendError(res, 405, 'method_not_allowed', 'Only GET allowed');
  }

  const { plate, limit = 5 } = req.query;
  if (!plate) {
    return sendError(res, 400, 'missing_fields', 'plate query parameter is required');
  }

  try {
    const tripsData = await readData('tripsdashboard');
    if (!tripsData) {
      return sendSuccess(res, { trips: [] });
    }

    const normalizedPlate = plate.toString().toLowerCase().replace(/\s+/g, '');
    let trips: any[] = [];

    for (const key in tripsData) {
      const t = tripsData[key];
      if (t.carNumber && t.carNumber.toLowerCase().replace(/\s+/g, '') === normalizedPlate) {
        trips.push({
          id: key,
          route: t.direction || '',
          status: t.isArchived ? 'archived' : 'active',
          dateStart: t.dateStart || '',
          dateEnd: t.dateEnd || '',
          cargo: t.tripNote || ''
        });
      }
    }

    // Sort by dateStart descending
    trips.sort((a, b) => new Date(b.dateStart).getTime() - new Date(a.dateStart).getTime());
    
    // Limit
    trips = trips.slice(0, Number(limit));

    // Auto log action
    await pushData('agent_logs', {
      actionType: 'getTripByVehicle',
      initiatedBy: 'agent',
      timestamp: new Date().toISOString(),
      payload: { plate, limit },
      result: 'success'
    });

    return sendSuccess(res, { trips });
  } catch (err: any) {
    return sendError(res, 500, 'internal_error', err.message);
  }
}

import { checkAgentKey, sendSuccess, sendError, setCors } from '../lib/apiHelper';
import { readData, pushData } from '../lib/firebaseHelper';

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (!checkAgentKey(req, res)) return;

  if (req.method !== 'GET') {
    return sendError(res, 405, 'method_not_allowed', 'Only GET allowed');
  }

  const { location, vehicleId } = req.query;
  if (!location) {
    return sendError(res, 400, 'missing_fields', 'location query parameter is required');
  }

  try {
    const permitsData = await readData('dozvolaPermits');
    if (!permitsData) {
      return sendSuccess(res, { permits: [] });
    }

    const normalizedLocation = location.toString().toLowerCase();
    let permits: any[] = [];

    for (const key in permitsData) {
      const p = permitsData[key];
      // Basic matching on country or comments containing the location
      const countryMatch = p.country && p.country.toLowerCase().includes(normalizedLocation);
      const commentMatch = p.comments && p.comments.toLowerCase().includes(normalizedLocation);
      
      if (countryMatch || commentMatch) {
        // If vehicleId is provided, check if it's assigned to it or available
        if (vehicleId) {
          if (p.assignedVehicle && p.assignedVehicle !== vehicleId) continue;
        }

        permits.push({
          id: key,
          number: p.permitNumber || '',
          type: p.type || '',
          dateIssued: p.dateIssued || '',
          status: p.status || '',
          location: p.country || '',
          assignedVehicle: p.assignedVehicle || '',
          tripsRemaining: p.tripsRemaining || null // if applicable for multi-use
        });
      }
    }

    // Auto log action
    await pushData('agent_logs', {
      actionType: 'getDozvolaByLocation',
      initiatedBy: 'agent',
      timestamp: new Date().toISOString(),
      payload: { location, vehicleId },
      result: 'success'
    });

    return sendSuccess(res, { permits });
  } catch (err: any) {
    return sendError(res, 500, 'internal_error', err.message);
  }
}

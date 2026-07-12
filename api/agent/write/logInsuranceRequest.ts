import { checkAgentKey, sendSuccess, sendError, setCors } from '../lib/apiHelper';
import { pushData } from '../lib/firebaseHelper';

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (!checkAgentKey(req, res)) return;

  if (req.method !== 'POST') {
    return sendError(res, 405, 'method_not_allowed', 'Only POST allowed');
  }

  const { vehiclePlate, insuranceStartDate, insuranceDurationDays, sentAt, sentBy } = req.body;

  if (!vehiclePlate || !insuranceStartDate || !insuranceDurationDays) {
    return sendError(res, 400, 'missing_fields', 'vehiclePlate, insuranceStartDate, and insuranceDurationDays are required');
  }

  try {
    const logData = {
      vehiclePlate,
      insuranceStartDate,
      insuranceDurationDays,
      sentAt: sentAt || new Date().toISOString(),
      sentBy: sentBy || 'agent',
    };

    const requestId = await pushData('insurance_requests', logData);

    // Auto log action
    await pushData('agent_logs', {
      actionType: 'logInsuranceRequest',
      initiatedBy: sentBy || 'agent',
      timestamp: new Date().toISOString(),
      payload: logData,
      result: 'success'
    });

    return sendSuccess(res, { requestId });
  } catch (err: any) {
    return sendError(res, 500, 'internal_error', err.message);
  }
}

import { checkAgentKey, sendSuccess, sendError, setCors } from '../lib/apiHelper';
import { pushData } from '../lib/firebaseHelper';

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (!checkAgentKey(req, res)) return;

  if (req.method !== 'POST') {
    return sendError(res, 405, 'method_not_allowed', 'Only POST allowed');
  }

  const { actionType, initiatedBy, timestamp, payload, result } = req.body;

  if (!actionType || !initiatedBy) {
    return sendError(res, 400, 'missing_fields', 'actionType and initiatedBy are required');
  }

  try {
    const logData = {
      actionType,
      initiatedBy,
      timestamp: timestamp || new Date().toISOString(),
      payload: payload || {},
      result: result || 'unknown'
    };

    const logId = await pushData('agent_logs', logData);
    return sendSuccess(res, { logId });
  } catch (err: any) {
    return sendError(res, 500, 'internal_error', err.message);
  }
}

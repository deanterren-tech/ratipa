import { checkAgentKey, sendSuccess, sendError, setCors } from '../lib/apiHelper';
import { pushData } from '../lib/firebaseHelper';

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (!checkAgentKey(req, res)) return;

  if (req.method !== 'POST') {
    return sendError(res, 405, 'method_not_allowed', 'Only POST allowed');
  }

  const payload = req.body;
  if (!payload) {
    return sendError(res, 400, 'missing_fields', 'Request body is required');
  }

  const requiredFields = [
    'tirNumber', 'carrierName', 'vehiclePlate', 
    'customsPoint', 'driverName', 'dateOfWithdrawal', 'reason'
  ];

  const missing = requiredFields.filter(f => !payload[f]);
  if (missing.length > 0) {
    return sendError(res, 400, 'validation_error', `Missing required fields: ${missing.join(', ')}`);
  }

  // Validate TIR format (e.g. XX12345678)
  const tirRegex = /^[A-Za-z]{2}\d{8}$/;
  if (!tirRegex.test(payload.tirNumber)) {
    return sendError(res, 400, 'validation_error', 'Invalid TIR format. Expected 2 letters followed by 8 digits.');
  }

  try {
    const draftData = {
      ...payload,
      createdAt: new Date().toISOString(),
      status: 'draft',
      source: 'agent'
    };

    const draftId = await pushData('declaration_drafts', draftData);

    // Auto log action
    await pushData('agent_logs', {
      actionType: 'createDeclarationDraft',
      initiatedBy: 'agent',
      timestamp: new Date().toISOString(),
      payload: { draftId, ...payload },
      result: 'success'
    });

    return sendSuccess(res, { draftId });
  } catch (err: any) {
    return sendError(res, 500, 'internal_error', err.message);
  }
}

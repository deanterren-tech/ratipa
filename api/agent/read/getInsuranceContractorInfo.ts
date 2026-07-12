import { checkAgentKey, sendSuccess, sendError, setCors } from '../lib/apiHelper';
import { pushData } from '../lib/firebaseHelper';

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (!checkAgentKey(req, res)) return;

  if (req.method !== 'GET') {
    return sendError(res, 405, 'method_not_allowed', 'Only GET allowed');
  }

  const data = {
    contractorEmail: 'insurance_kz@example.com', // Placeholder or fetch from DB settings
    requiredFields: [
      'vehiclePlate',
      'insuranceStartDate',
      'insuranceDurationDays'
    ],
    emailTemplateInfo: 'Укажите госномер тягача, дату начала действия страховки и срок страхования в днях.'
  };

  // Auto log action
  await pushData('agent_logs', {
    actionType: 'getInsuranceContractorInfo',
    initiatedBy: 'agent',
    timestamp: new Date().toISOString(),
    payload: {},
    result: 'success'
  });

  return sendSuccess(res, data);
}

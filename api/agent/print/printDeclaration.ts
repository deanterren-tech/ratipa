import { checkAgentKey, sendSuccess, sendError, setCors } from '../lib/apiHelper';
import { readData, pushData } from '../lib/firebaseHelper';

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (!checkAgentKey(req, res)) return;

  if (req.method !== 'POST') {
    return sendError(res, 405, 'method_not_allowed', 'Only POST allowed');
  }

  const { draftId } = req.body;
  if (!draftId) {
    return sendError(res, 400, 'missing_fields', 'draftId is required');
  }

  try {
    const draftsData = await readData('declaration_drafts');
    if (!draftsData || !draftsData[draftId]) {
      return sendError(res, 404, 'not_found', `Draft with ID ${draftId} not found`);
    }

    const draft = draftsData[draftId];
    
    // Idempotency / duplicate check for print commands.
    // E.g. Check if the draft was already printed recently.
    if (draft.status === 'printed') {
      return sendError(res, 400, 'validation_error', 'This declaration has already been printed.');
    }

    // Since actual print logic (like triggering a printer or generating a PDF) is in the existing UI or backend, 
    // we simulate the queueing mechanism here. We update the draft status to 'print_queued'
    // The main app can watch this status and execute the real print logic, OR we generate a PDF URL if we had a PDF generation endpoint.
    
    // Here we will just return a simulated document URL or queue confirmation
    const documentUrl = `/api/print/declaration/${draftId}`; // Example URL structure

    // Auto log action
    await pushData('agent_logs', {
      actionType: 'printDeclaration',
      initiatedBy: 'agent',
      timestamp: new Date().toISOString(),
      payload: { draftId, documentUrl },
      result: 'success'
    });

    return sendSuccess(res, { 
      message: 'Declaration queued for printing',
      documentUrl,
      draftId
    });
  } catch (err: any) {
    return sendError(res, 500, 'internal_error', err.message);
  }
}

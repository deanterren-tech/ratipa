import { checkAgentKey, sendSuccess, sendError, setCors } from '../lib/apiHelper';

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (!checkAgentKey(req, res)) return;

  if (req.method !== 'GET') {
    return sendError(res, 405, 'method_not_allowed', 'Only GET allowed');
  }

  const schema = {
    fields: [
      {
        name: 'tirNumber',
        type: 'string',
        required: true,
        format: 'XX12345678 (2 letters, 8 digits)',
        description: 'Номер книжки МДП (TIR)'
      },
      {
        name: 'carrierName',
        type: 'string',
        required: true,
        description: 'Наименование перевозчика'
      },
      {
        name: 'vehiclePlate',
        type: 'string',
        required: true,
        description: 'Госномер тягача'
      },
      {
        name: 'trailerPlate',
        type: 'string',
        required: false,
        description: 'Госномер прицепа'
      },
      {
        name: 'customsPoint',
        type: 'string',
        required: true,
        description: 'Пункт изъятия (наименование таможни)'
      },
      {
        name: 'driverName',
        type: 'string',
        required: true,
        description: 'ФИО водителя'
      },
      {
        name: 'dateOfWithdrawal',
        type: 'string',
        required: true,
        format: 'YYYY-MM-DD',
        description: 'Дата изъятия'
      },
      {
        name: 'reason',
        type: 'string',
        required: true,
        description: 'Причина изъятия'
      }
    ]
  };

  return sendSuccess(res, { schema });
}

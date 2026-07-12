// Check agent API key
export function checkAgentKey(req: any, res: any) {
  const key = req.headers['x-agent-key'];
  if (key !== process.env.AGENT_API_KEY) {
    res.status(401).json({ success: false, error: 'unauthorized', message: 'Invalid or missing x-agent-key' });
    return false;
  }
  return true;
}

export function sendSuccess(res: any, data: any) {
  res.status(200).json({ success: true, data });
}

export function sendError(res: any, status: number, error: string, message: string) {
  res.status(status).json({ success: false, error, message });
}

// Ensure CORS allows external agent access
export function setCors(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // Or limit to specific agent domains
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-agent-key');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

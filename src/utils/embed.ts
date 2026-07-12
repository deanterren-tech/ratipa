/**
 * Converts a Google Sheets view link to a clean embeddable link for iframes
 */
export function getEmbeddableSheetUrl(url: string): string {
  if (!url) return "";
  
  let processed = url.trim();

  // Extract ID from standard spreadsheets URL pattern
  const sheetMatch = processed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (sheetMatch && sheetMatch[1]) {
    const id = sheetMatch[1];
    
    // Check for gid parameter in either query string or hash fragment
    const gidMatch = processed.match(/[?&]gid=([0-9]+)/) || processed.match(/#gid=([0-9]+)/);
    const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : "";
    
    // Return standard editable URL showing toolbar, menu, and tabs (no rm=minimal, headers=true)
    return `https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing${gidParam}`;
  }

  // Fallback if not a standard sheets URL but has rm=minimal or is published html
  // We clean any rm=minimal parameter to let the editor show
  if (processed.includes('rm=minimal')) {
    processed = processed.replace(/[?&]rm=minimal/, '');
  }

  return processed;
}

/**
 * Converts a Google Drive link to a clean embeddable folder view link for iframes
 */
export function getEmbeddableDriveUrl(url: string): string {
  if (!url) return "";
  
  let processed = url.trim();
  if (processed.includes('embeddedfolderview')) return processed;
  
  // Extract folder ID
  const folderMatch = processed.match(/\/folders\/([a-zA-Z0-9-_]+)/);
  if (folderMatch && folderMatch[1]) {
    return `https://drive.google.com/embeddedfolderview?id=${folderMatch[1]}#grid`;
  }
  
  const idMatch = processed.match(/[?&]id=([a-zA-Z0-9-_]+)/);
  if (idMatch && idMatch[1]) {
    return `https://drive.google.com/embeddedfolderview?id=${idMatch[1]}#grid`;
  }

  return processed;
}

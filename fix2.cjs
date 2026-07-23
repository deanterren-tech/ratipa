const fs = require('fs');
let lines = fs.readFileSync('src/components/modules/LossDeclarationEditor.tsx', 'utf8').split('\n');

const startIdx = lines.findIndex(l => l.includes('// Draggable component'));
const endIdx = lines.findIndex((l, i) => i > startIdx && l.includes('return (') && lines[i+1].includes('<div'));

console.log(startIdx, endIdx);

const replacement = `// Draggable component
const DraggableItem = ({ id, x, y, onMove, children, isSelected, onClick, onRemove }: any) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragContext = useRef({ startX: 0, startY: 0, initialElemX: 0, initialElemY: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDragging(true);
    dragContext.current = { startX: e.clientX, startY: e.clientY, initialElemX: x, initialElemY: y };
    if (onClick) onClick(id);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const parent = document.getElementById('loss-canvas-container');
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dxPercent = (e.clientX - dragContext.current.startX) / rect.width * 100;
      const dyPercent = (e.clientY - dragContext.current.startY) / rect.height * 100;
      onMove(id, dragContext.current.initialElemX + dxPercent, dragContext.current.initialElemY + dyPercent);
    };

    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, id, onMove]);

  return (`.split('\n');

lines.splice(startIdx, endIdx - startIdx + 1, ...replacement);
fs.writeFileSync('src/components/modules/LossDeclarationEditor.tsx', lines.join('\n'));

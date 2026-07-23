import {useState, useEffect} from 'react'

export default function TypingText({ phrases, className }: { phrases: string[]; className?: string }) {
    const [text, setText] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const [loopNum, setLoopNum] = useState(0);
    const [typingSpeed, setTypingSpeed] = useState(150);

    useEffect(() => {
      if (!phrases || phrases.length === 0) return;
      const i = loopNum % phrases.length;
      const fullText = phrases[i];

      const handleTyping = () => {
          setText(isDeleting ? fullText.substring(0, text.length - 1) : fullText.substring(0, text.length + 1));
          setTypingSpeed(isDeleting ? 30 : 150);

          if (!isDeleting && text === fullText) {
              setTimeout(() => setIsDeleting(true), 1500);
          } else if (isDeleting && text === '') {
              setIsDeleting(false);
              setLoopNum(loopNum + 1);
          }
      };

      const timer = setTimeout(handleTyping, typingSpeed);
      return () => clearTimeout(timer);
    }, [text, isDeleting, loopNum, phrases, typingSpeed]);

    return (
        <span className={className || "text-xl font-mono text-slate-500 font-bold ml-4 inline-block tracking-tight"}>
            {text}
            <span className="animate-pulse">|</span>
        </span>
    );
}

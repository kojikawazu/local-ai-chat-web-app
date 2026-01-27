
import React, { useState, useRef, useEffect } from 'react';
import { NORDIC_THEME } from '../themes';
import { Send, Mic, Paperclip, Smile, Sparkles } from 'lucide-react';

interface ChatBarProps {
  onSendMessage: (content: string) => void;
}

const ChatBar: React.FC<ChatBarProps> = ({ onSendMessage }) => {
  const [content, setContent] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const styles = NORDIC_THEME;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (content.trim()) {
      onSendMessage(content);
      setContent('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 240)}px`;
    }
  }, [content]);

  return (
    <div className={`p-4 md:p-8 ${styles.inputArea}`}>
      <div className="max-w-4xl mx-auto relative group">
        <form 
          onSubmit={handleSubmit}
          className={`flex items-end gap-3 p-3 rounded-2xl transition-all shadow-xl shadow-black/20 ${styles.input}`}
        >
          <div className="flex gap-1 pb-1 pr-1">
            <button 
              type="button" 
              className={`p-2.5 rounded-xl transition-colors ${styles.textMuted} hover:bg-white/10`}
            >
              <Paperclip size={20} />
            </button>
          </div>

          <textarea
            ref={textareaRef}
            rows={1}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            className={`w-full bg-transparent border-none focus:ring-0 p-2 text-sm md:text-base resize-none ${styles.textBase} min-h-[44px]`}
          />

          <div className="flex gap-2 pb-1 pl-1">
            <button 
              type="button"
              onClick={() => setIsRecording(!isRecording)}
              className={`p-2.5 rounded-xl transition-all relative
                ${isRecording ? 'text-[#bf616a] animate-pulse' : styles.textMuted} 
                hover:bg-white/10
              `}
            >
              <Mic size={20} />
              {isRecording && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#bf616a] rounded-full" />}
            </button>
            
            <button 
              type="submit"
              disabled={!content.trim()}
              className={`p-2.5 rounded-xl transition-all ${content.trim() ? styles.button : 'opacity-20 cursor-not-allowed text-[#d8dee9]'}`}
            >
              <Send size={20} />
            </button>
          </div>
        </form>
        
        <div className="absolute -top-14 left-0 right-0 flex justify-center pointer-events-none opacity-0 group-focus-within:opacity-100 transition-opacity">
          <div className={`px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-[#4c566a] text-[#88c0d0] border border-[#5e81ac]/30 flex items-center gap-2 shadow-lg`}>
            <Sparkles size={12} />
            <span>Nordic Engine Active</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatBar;


import React, { useEffect, useRef } from 'react';
import { Message } from '../types';
import { NORDIC_THEME } from '../themes';
import { User, Bot, Copy, ThumbsUp, RotateCw, Volume2 } from 'lucide-react';

interface ChatWindowProps {
  messages: Message[];
}

const ChatWindow: React.FC<ChatWindowProps> = ({ messages }) => {
  const styles = NORDIC_THEME;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div 
      ref={scrollRef}
      className={`flex-1 overflow-y-auto p-4 md:p-8 space-y-8 ${styles.chatArea} scroll-smooth`}
    >
      {messages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center opacity-60">
          <div className={`p-8 rounded-[2rem] bg-[#3b4252] border border-[#4c566a] mb-6 shadow-2xl shadow-black/20`}>
            <Bot size={56} className="text-[#88c0d0]" />
          </div>
          <h2 className={`text-3xl font-bold mb-3 ${styles.textBase}`}>Welcome to Nordic.</h2>
          <p className={`max-w-md ${styles.textMuted}`}>
            Your private, locally accelerated AI workspace. How can I assist you today?
          </p>
        </div>
      ) : (
        messages.map((msg) => (
          <div 
            key={msg.id} 
            className={`flex flex-col max-w-[85%] md:max-w-[70%] ${msg.role === 'user' ? 'ml-auto' : 'mr-auto animate-in fade-in slide-in-from-bottom-4 duration-500'}`}
          >
            <div className={`p-5 md:p-6 ${msg.role === 'user' ? styles.userMessage : styles.aiMessage}`}>
              <div className="flex items-start gap-4">
                {msg.role === 'ai' && <Bot size={22} className="shrink-0 mt-1 text-[#88c0d0]" />}
                <div className="whitespace-pre-wrap leading-relaxed text-sm md:text-base">
                  {msg.content}
                </div>
                {msg.role === 'user' && <User size={22} className="shrink-0 mt-1 text-[#2e3440]" />}
              </div>
            </div>
            
            <div className={`flex items-center gap-4 mt-3 px-2 text-xs ${styles.textMuted} ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'ai' && (
                <>
                  <button className="hover:text-[#88c0d0] transition-colors"><Copy size={14} /></button>
                  <button className="hover:text-[#88c0d0] transition-colors"><ThumbsUp size={14} /></button>
                  <button className="hover:text-[#88c0d0] transition-colors"><Volume2 size={14} /></button>
                </>
              )}
              <span className="opacity-50 font-mono">{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default ChatWindow;

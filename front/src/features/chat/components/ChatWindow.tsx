'use client';

import { useEffect, useRef } from 'react';
import { User, Bot, Copy } from 'lucide-react';
import { Message } from '@/types';
import MarkdownContent from './MarkdownContent';

interface ChatWindowProps {
  messages: Message[];
}

export default function ChatWindow({ messages }: ChatWindowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 bg-nord-0 scroll-smooth"
    >
      {messages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center opacity-60">
          <div className="p-8 rounded-[2rem] bg-nord-1 border border-nord-3 mb-6 shadow-2xl shadow-black/20">
            <Bot size={56} className="text-nord-frost-1" />
          </div>
          <h2 className="text-3xl font-bold mb-3 text-nord-6">
            Nordic Chat へようこそ
          </h2>
          <p className="max-w-md text-nord-4/60">
            プライベートなローカルAIワークスペースです。何かお手伝いできることはありますか？
          </p>
        </div>
      ) : (
        messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col max-w-[85%] md:max-w-[70%] ${
              msg.role === 'user' ? 'ml-auto' : 'mr-auto'
            }`}
          >
            <div
              className={`p-5 md:p-6 ${
                msg.role === 'user'
                  ? 'bg-nord-frost-2 text-nord-0 rounded-xl ml-auto font-medium shadow-lg shadow-black/10'
                  : 'bg-nord-2 text-nord-6 rounded-xl mr-auto border border-nord-3'
              }`}
            >
              <div className="flex items-start gap-4">
                {msg.role === 'assistant' && (
                  <Bot size={22} className="shrink-0 mt-1 text-nord-frost-1" />
                )}
                {msg.role === 'assistant' ? (
                  <MarkdownContent content={msg.content} />
                ) : (
                  <div className="whitespace-pre-wrap leading-relaxed text-sm md:text-base">
                    {msg.content}
                  </div>
                )}
                {msg.role === 'user' && (
                  <User size={22} className="shrink-0 mt-1 text-nord-0" />
                )}
              </div>
            </div>

            <div
              className={`flex items-center gap-4 mt-3 px-2 text-xs text-nord-4/60 ${
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {msg.role === 'assistant' && (
                <button className="hover:text-nord-frost-1 transition-colors">
                  <Copy size={14} />
                </button>
              )}
              <span className="opacity-50 font-mono">
                {msg.createdAt.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

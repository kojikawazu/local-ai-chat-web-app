
import React, { useState, useCallback } from 'react';
import { NORDIC_THEME } from './themes';
import { Message } from './types';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import ChatWindow from './components/ChatWindow';
import ChatBar from './components/ChatBar';
import Footer from './components/Footer';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'ai',
      content: 'Welcome back. I am running locally on the Nordic Frost system. \n\nYour environment is fully encrypted and GPU-accelerated. How can I assist your workflow today?',
      timestamp: new Date()
    }
  ]);

  const handleSendMessage = useCallback((content: string) => {
    const newUserMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, newUserMsg]);

    // Simulate AI response with a slight delay
    setTimeout(() => {
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: `Acknowledged. I'm processing your request using the Llama 3.2 Nordic model weights. \n\nResponse generated for: "${content}"`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiResponse]);
    }, 800);
  }, []);

  return (
    <div className={`flex h-screen w-full transition-colors duration-500 overflow-hidden ${NORDIC_THEME.container} ${NORDIC_THEME.fontFamily}`}>
      <Sidebar />
      
      <main className="flex-1 flex flex-col relative overflow-hidden">
        <Header />
        
        <ChatWindow messages={messages} />
        
        <ChatBar onSendMessage={handleSendMessage} />
        
        <Footer />
      </main>
    </div>
  );
};

export default App;

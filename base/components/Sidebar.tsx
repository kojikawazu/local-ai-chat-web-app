
import React from 'react';
import { NORDIC_THEME } from '../themes';
import { Layout, MessageSquare, Settings, Shield, Zap, Plus, History } from 'lucide-react';

const Sidebar: React.FC = () => {
  const styles = NORDIC_THEME;

  return (
    <aside className={`w-72 flex flex-col h-full transition-all duration-300 ${styles.sidebar}`}>
      <div className="p-6">
        <div className="flex items-center gap-3 mb-8">
          <div className={`p-2 rounded-lg ${styles.button}`}>
            <Layout size={24} />
          </div>
          <h1 className={`text-xl font-bold ${styles.textBase}`}>Nordic Chat</h1>
        </div>

        <button className={`w-full flex items-center justify-center gap-2 py-3 px-4 mb-8 rounded-xl ${styles.button} shadow-lg shadow-black/20`}>
          <Plus size={18} />
          <span>New Conversation</span>
        </button>

        <nav className="space-y-1">
          <p className={`px-3 mb-4 text-xs font-semibold uppercase tracking-wider ${styles.textMuted} flex items-center gap-2`}>
            <History size={14} />
            History
          </p>
          <div className="space-y-1">
            {['Project Architecture', 'Design Review v2', 'Local LLM Setup', 'Nordic System Spec'].map((item, i) => (
              <button
                key={i}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-left text-sm hover:bg-white/5 ${styles.textBase}`}
              >
                <MessageSquare size={16} className={styles.textMuted} />
                <span className="truncate">{item}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>

      <div className="mt-auto p-6 space-y-4">
        <div className={`p-4 rounded-xl text-xs bg-[#434c5e]/50 border border-[#4c566a]`}>
          <div className="flex items-center gap-2 mb-2">
            <Zap size={14} className={styles.accent} />
            <span className={`font-bold ${styles.textBase}`}>Pro Features</span>
          </div>
          <p className={styles.textMuted}>Local GPU acceleration enabled for Nordic Frost optimized builds.</p>
        </div>
        
        <div className="flex gap-2 justify-between">
          <button className={`p-2 rounded-lg ${styles.textMuted} hover:bg-white/5 transition-colors`}><Settings size={20} /></button>
          <button className={`p-2 rounded-lg ${styles.textMuted} hover:bg-white/5 transition-colors`}><Shield size={20} /></button>
          <button className={`p-2 rounded-lg ${styles.textMuted} hover:bg-white/5 transition-colors`}><Zap size={20} /></button>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;

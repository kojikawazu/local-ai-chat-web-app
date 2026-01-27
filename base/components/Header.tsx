
import React from 'react';
import { NORDIC_THEME } from '../themes';
import { Cpu, Wifi, Activity, ChevronDown } from 'lucide-react';

const Header: React.FC = () => {
  const styles = NORDIC_THEME;

  return (
    <header className={`h-16 px-6 flex items-center justify-between sticky top-0 z-10 ${styles.header}`}>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full bg-[#a3be8c] shadow-[0_0_8px_#a3be8c]`} />
          <span className={`text-sm font-semibold ${styles.textBase}`}>Node: Arctic-01</span>
        </div>
        
        <div className="hidden md:flex items-center gap-4">
          <div className={`flex items-center gap-1.5 text-xs ${styles.textMuted}`}>
            <Cpu size={14} />
            <span>GPU: 86% Load</span>
          </div>
          <div className={`flex items-center gap-1.5 text-xs ${styles.textMuted}`}>
            <Activity size={14} />
            <span>Latency: 12ms</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold border border-[#4c566a] bg-[#434c5e] text-[#eceff4] hover:bg-[#4c566a] transition-all`}>
          <span>Llama 3.2 Nordic</span>
          <ChevronDown size={14} />
        </button>
        <div className={`hidden sm:flex items-center gap-2 ${styles.textMuted}`}>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#5e81ac] to-[#88c0d0] border border-[#4c566a]" />
        </div>
      </div>
    </header>
  );
};

export default Header;

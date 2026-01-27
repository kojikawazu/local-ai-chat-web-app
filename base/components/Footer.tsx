
import React from 'react';
import { NORDIC_THEME } from '../themes';
import { Database, GitBranch, Terminal } from 'lucide-react';

const Footer: React.FC = () => {
  const styles = NORDIC_THEME;

  return (
    <footer className={`h-10 px-6 flex items-center justify-between text-[10px] uppercase tracking-widest ${styles.footer}`}>
      <div className="flex items-center gap-6">
        <div className={`flex items-center gap-1.5 ${styles.textMuted}`}>
          <Database size={12} />
          <span>Cache: 256MB</span>
        </div>
        <div className={`flex items-center gap-1.5 ${styles.textMuted}`}>
          <Terminal size={12} />
          <span>Port: 8080</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className={`flex items-center gap-1.5 ${styles.textMuted}`}>
          <GitBranch size={12} />
          <span>Nordic-OS v1.0</span>
        </div>
        <span className={styles.textMuted}>© 2024 Nordic Chat Studio</span>
      </div>
    </footer>
  );
};

export default Footer;

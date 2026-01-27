import { Database, Terminal, GitBranch } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="h-10 px-6 flex items-center justify-between text-[10px] uppercase tracking-widest bg-nord-1 border-t border-nord-3">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-1.5 text-nord-4/60">
          <Database size={12} />
          <span>PostgreSQL</span>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 text-nord-4/60">
          <Terminal size={12} />
          <span>Ollama</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5 text-nord-4/60">
          <GitBranch size={12} />
          <span>Nordic Chat v1.0</span>
        </div>
      </div>
    </footer>
  );
}

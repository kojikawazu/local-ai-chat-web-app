
export interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
  timestamp: Date;
}

export interface ThemeStyles {
  container: string;
  sidebar: string;
  header: string;
  footer: string;
  chatArea: string;
  userMessage: string;
  aiMessage: string;
  inputArea: string;
  input: string;
  button: string;
  accent: string;
  textBase: string;
  textMuted: string;
  fontFamily: string;
}

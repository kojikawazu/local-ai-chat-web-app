/** {@link LoadingDots} の props。 */
type LoadingDotsProps = {
  /** 読み上げる名前（例: 「応答を生成中」） */
  label: string;
};

/**
 * 待っている間に出す、跳ねる 3 つの点（共通の atom。#163）。
 *
 * @param props - 読み上げる名前
 */
export default function LoadingDots({ label }: LoadingDotsProps) {
  return (
    <div className="flex items-center gap-1.5 py-1" aria-label={label}>
      <span className="w-2 h-2 rounded-full bg-nord-frost-1 animate-bounce [animation-delay:0ms]" />
      <span className="w-2 h-2 rounded-full bg-nord-frost-1 animate-bounce [animation-delay:150ms]" />
      <span className="w-2 h-2 rounded-full bg-nord-frost-1 animate-bounce [animation-delay:300ms]" />
    </div>
  );
}

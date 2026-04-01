import { Tool } from './types';

export const getCurrentDatetimeTool: Tool = {
  definition: {
    name: 'get_current_datetime',
    description: '現在の日付と時刻を取得する',
    parameters: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'タイムゾーン (例: Asia/Tokyo, UTC)',
        },
      },
      required: [],
    },
  },
  execute: async (args) => {
    const timezone =
      typeof args.timezone === 'string' ? args.timezone : 'Asia/Tokyo';

    try {
      // ISO 8601 形式でタイムゾーン付き日時を生成
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('sv-SE', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });

      // sv-SE ロケールは YYYY-MM-DD HH:mm:ss 形式を返す
      const parts = formatter.formatToParts(now);
      const get = (type: string) =>
        parts.find((p) => p.type === type)?.value ?? '00';

      const dateStr = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;

      // タイムゾーンオフセットを取得
      const utcOffset = getUtcOffset(now, timezone);

      return `${dateStr}${utcOffset}`;
    } catch {
      // 不正なタイムゾーン指定時は UTC で返す
      return new Date().toISOString();
    }
  },
};

function getUtcOffset(date: Date, timezone: string): string {
  try {
    // UTC と指定タイムゾーンの差分を計算
    const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
    const diffMs = tzDate.getTime() - utcDate.getTime();
    const diffMin = Math.round(diffMs / 60000);

    const sign = diffMin >= 0 ? '+' : '-';
    const absMin = Math.abs(diffMin);
    const hours = String(Math.floor(absMin / 60)).padStart(2, '0');
    const minutes = String(absMin % 60).padStart(2, '0');

    return `${sign}${hours}:${minutes}`;
  } catch {
    return '+00:00';
  }
}

import { describe, it, expect } from 'vitest';
import {
  buildMermaidThemeVariables,
  getDiagramKind,
  getPngSize,
  stepZoom,
  svgToDataUri,
  toMermaidId,
  toPlantUmlDiagramState,
  withBackground,
  withIntrinsicSize,
} from '@/lib/chat/diagram';

/**
 * `lib/chat/diagram` の UT（#169・#171・#176）。
 * 図を `<img>` で表示するための、図の種類の判定・要素 ID・data: URI・SVG の大きさ・
 * テーマの色の組み立てと、PlantUML の API の応答の解釈、拡大の倍率の段階・保存の背景・PNG の大きさを確かめる。純関数のため mock は使わない（CSS 変数の読み取りは表を渡す）。
 */

/** data: URI の接頭辞（`svgToDataUri` の出力の先頭） */
const DATA_URI_PREFIX = 'data:image/svg+xml;charset=utf-8,';

/**
 * data: URI から SVG の文字列に戻す。
 *
 * @param uri - `svgToDataUri` の出力
 * @returns 元の SVG の文字列
 */
function decodeDataUri(uri: string): string {
  return decodeURIComponent(uri.slice(DATA_URI_PREFIX.length));
}

/** mermaid が出すルートの `<svg>` の形（属性の並びは mermaid 12 の flowchart の出力に合わせる） */
const MERMAID_SVG =
  '<svg id="mermaid-r1" width="100%" xmlns="http://www.w3.org/2000/svg" class="flowchart" style="max-width: 120.5px;" viewBox="0 0 120.5 300" role="graphics-document document"><g><text>A</text></g></svg>';

describe('getDiagramKind', () => {
  describe('正常系', () => {
    it('mermaid は Mermaid、plantuml・puml は PlantUML と判定する', () => {
      expect(getDiagramKind('mermaid')).toBe('mermaid');
      expect(getDiagramKind('plantuml')).toBe('plantuml');
      expect(getDiagramKind('puml')).toBe('plantuml');
    });
  });

  describe('準正常系', () => {
    it('大文字が混ざっても判定する', () => {
      expect(getDiagramKind('Mermaid')).toBe('mermaid');
      expect(getDiagramKind('PlantUML')).toBe('plantuml');
      expect(getDiagramKind('PUML')).toBe('plantuml');
    });

    it('図ではない言語・似た名前は判定しない', () => {
      expect(getDiagramKind('typescript')).toBeNull();
      expect(getDiagramKind('mermaidjs')).toBeNull();
      expect(getDiagramKind('uml')).toBeNull();
    });
  });

  describe('異常系', () => {
    it('言語の指定が無い（null）・空文字は判定しない', () => {
      expect(getDiagramKind(null)).toBeNull();
      expect(getDiagramKind('')).toBeNull();
    });

    it('オブジェクトが継承するプロパティ名を図の種類と取り違えない', () => {
      expect(getDiagramKind('constructor')).toBeNull();
      expect(getDiagramKind('toString')).toBeNull();
      expect(getDiagramKind('__proto__')).toBeNull();
    });
  });
});

describe('toMermaidId', () => {
  describe('正常系', () => {
    it('useId の記号を落とし、mermaid- を前に付ける', () => {
      expect(toMermaidId(':r1:')).toBe('mermaid-r1');
      expect(toMermaidId('«r2»')).toBe('mermaid-r2');
      expect(toMermaidId('_r_3_')).toBe('mermaid-r3');
    });
  });

  describe('準正常系', () => {
    it('英数字の部分が違う useId は、記号を落としても別の ID になる', () => {
      expect(toMermaidId(':r1:')).not.toBe(toMermaidId(':r10:'));
    });
  });

  describe('異常系', () => {
    it('英数字を含まない値でも、空でない ID を返す', () => {
      expect(toMermaidId('::')).toBe('mermaid-');
    });
  });
});

describe('svgToDataUri', () => {
  describe('正常系', () => {
    it('data:image/svg+xml の URI にし、元の SVG に戻せる', () => {
      const uri = svgToDataUri(MERMAID_SVG);
      expect(uri.startsWith(DATA_URI_PREFIX)).toBe(true);
      expect(decodeDataUri(uri)).toBe(MERMAID_SVG);
    });
  });

  describe('準正常系', () => {
    it('#・%・改行・日本語を含む SVG も壊さない', () => {
      const svg =
        '<svg><style>#a{fill:#fff;width:50%}</style>\n<text>ユーザー</text></svg>';
      const uri = svgToDataUri(svg);
      // # は URI の断片の区切りとして解釈されるため、エンコードされていること
      expect(uri).not.toContain('#');
      expect(decodeDataUri(uri)).toBe(svg);
    });
  });

  describe('異常系', () => {
    it('空文字でも接頭辞だけの URI を返す', () => {
      expect(svgToDataUri('')).toBe(DATA_URI_PREFIX);
    });
  });
});

describe('withIntrinsicSize', () => {
  describe('正常系', () => {
    it('ルートの svg に viewBox の幅・高さを書き込み、width="100%" と max-width を外す', () => {
      const sized = withIntrinsicSize(MERMAID_SVG);
      const openTag = sized.match(/<svg\b[^>]*>/)?.[0] ?? '';
      expect(openTag).toContain('width="120.5"');
      expect(openTag).toContain('height="300"');
      expect(openTag).not.toContain('width="100%"');
      expect(openTag).not.toContain('max-width');
      // 本文と、ルート以外の属性は変えない
      expect(openTag).toContain('viewBox="0 0 120.5 300"');
      expect(sized).toContain('<g><text>A</text></g></svg>');
    });
  });

  describe('準正常系', () => {
    it('既に width・height があれば viewBox の値で置き換える', () => {
      const svg =
        '<svg width="10" height="20" viewBox="0,0,30,40"><rect width="5" height="5"/></svg>';
      const sized = withIntrinsicSize(svg);
      expect(sized).toBe(
        '<svg width="30" height="40" viewBox="0,0,30,40"><rect width="5" height="5"/></svg>'
      );
    });

    it('置き換える属性に $ が含まれても置換パターンとして解釈しない', () => {
      const svg = '<svg aria-label="$&" viewBox="0 0 1 2"></svg>';
      expect(withIntrinsicSize(svg)).toBe(
        '<svg width="1" height="2" aria-label="$&" viewBox="0 0 1 2"></svg>'
      );
    });
  });

  describe('異常系', () => {
    it('viewBox が無い・壊れている・大きさが 0 の SVG はそのまま返す', () => {
      const cases = [
        '<svg width="100%"></svg>',
        '<svg viewBox="0 0 abc 10"></svg>',
        '<svg viewBox="0 0 10"></svg>',
        '<svg viewBox="0 0 0 10"></svg>',
        'svg ではない文字列',
      ];
      for (const svg of cases) {
        expect(withIntrinsicSize(svg)).toBe(svg);
      }
    });
  });
});

describe('buildMermaidThemeVariables', () => {
  /** Nordic Frost の CSS 変数の値（`globals.css` の既定のテーマ） */
  const NORDIC: Record<string, string> = {
    '--color-nord-0': '#2e3440',
    '--color-nord-1': '#3b4252',
    '--color-nord-2': '#434c5e',
    '--color-nord-3': '#4c566a',
    '--color-nord-6': '#eceff4',
    '--color-nord-frost-1': '#88c0d0',
    '--color-nord-frost-2': '#81a1c1',
    '--color-nord-aurora-yellow': '#ebcb8b',
    '--color-nord-aurora-red': '#bf616a',
  };

  describe('正常系', () => {
    it('テーマの CSS 変数の値を mermaid の変数に対応させる', () => {
      const variables = buildMermaidThemeVariables((name) => NORDIC[name]);
      expect(variables).toEqual({
        background: '#2e3440',
        primaryColor: '#434c5e',
        primaryBorderColor: '#88c0d0',
        primaryTextColor: '#eceff4',
        textColor: '#eceff4',
        lineColor: '#81a1c1',
        secondaryColor: '#3b4252',
        tertiaryColor: '#4c566a',
        noteBkgColor: '#ebcb8b',
        noteTextColor: '#2e3440',
        errorBkgColor: '#bf616a',
      });
    });
  });

  describe('準正常系', () => {
    it('getPropertyValue が返す前後の空白を落とす', () => {
      const variables = buildMermaidThemeVariables(
        (name) => ` ${NORDIC[name]} `
      );
      expect(variables.background).toBe('#2e3440');
    });
  });

  describe('異常系', () => {
    it('未定義の変数（空文字）は入れず、mermaid の既定に任せる', () => {
      const variables = buildMermaidThemeVariables((name) =>
        name === '--color-nord-0' ? '#000000' : ''
      );
      expect(variables).toEqual({
        background: '#000000',
        noteTextColor: '#000000',
      });
    });
  });
});

describe('toPlantUmlDiagramState', () => {
  describe('正常系', () => {
    it('成功の svg を data: URI にし、保存用に元の SVG も持つ', () => {
      const svg = '<svg viewBox="0 0 1 1"><text>A</text></svg>';
      const state = toPlantUmlDiagramState(true, { svg });
      expect(state).toEqual({
        status: 'rendered',
        src: svgToDataUri(svg),
        svg,
      });
    });
  });

  describe('準正常系', () => {
    it('失敗の error をそのまま理由にする', () => {
      expect(
        toPlantUmlDiagramState(false, { error: 'Syntax Error?（2 行目）' })
      ).toEqual({ status: 'error', error: 'Syntax Error?（2 行目）' });
    });
  });

  describe('異常系', () => {
    it.each([
      ['JSON でない（null）', true, null],
      ['成功なのに svg が無い', true, {}],
      ['成功なのに svg が空', true, { svg: '' }],
      ['成功なのに svg が文字列でない', true, { svg: 1 }],
      ['失敗なのに error が無い', false, {}],
      ['失敗なのに error が文字列でない', false, { error: ['x'] }],
      ['失敗なのに svg がある', false, { svg: '<svg/>' }],
      ['配列', true, ['<svg/>']],
    ])('%sは想定外の応答として扱う', (_label, ok, json) => {
      expect(toPlantUmlDiagramState(ok, json)).toEqual({
        status: 'error',
        error: 'PlantUML の図を受け取れませんでした',
      });
    });
  });
});

describe('stepZoom', () => {
  describe('正常系', () => {
    it.each([
      [1, 'in', 1.5],
      [1, 'out', 0.75],
      [0.25, 'in', 0.5],
      [3, 'in', 4],
    ] as const)('%s から %s で %s へ移る', (scale, direction, expected) => {
      expect(stepZoom(scale, direction)).toBe(expected);
    });

    it('段階の間の倍率（「全体」の表示）からは、今より大きい／小さい最も近い段階へ移る', () => {
      expect(stepZoom(0.6, 'in')).toBe(0.75);
      expect(stepZoom(0.6, 'out')).toBe(0.5);
    });
  });

  describe('準正常系', () => {
    it('端の段階ではそれ以上動かない', () => {
      expect(stepZoom(4, 'in')).toBeNull();
      expect(stepZoom(0.25, 'out')).toBeNull();
    });

    it('計算の誤差で段階とほぼ同じ倍率は、その段階とみなす', () => {
      expect(stepZoom(1.0000000001, 'in')).toBe(1.5);
      expect(stepZoom(0.9999999999, 'out')).toBe(0.75);
    });
  });

  describe('異常系', () => {
    it('段階の範囲外の倍率からは、範囲内の端へ移る', () => {
      expect(stepZoom(0.1, 'in')).toBe(0.25);
      expect(stepZoom(0.1, 'out')).toBeNull();
      expect(stepZoom(10, 'out')).toBe(4);
      expect(stepZoom(10, 'in')).toBeNull();
    });
  });
});

describe('withBackground', () => {
  describe('正常系', () => {
    it('viewBox の範囲を塗る rect をルートの先頭に足す', () => {
      const svg = '<svg viewBox="0 0 100 50"><g/></svg>';
      expect(withBackground(svg, '#2e3440')).toBe(
        '<svg viewBox="0 0 100 50"><rect x="0" y="0" width="100" height="50" fill="#2e3440"/><g/></svg>'
      );
    });

    it('viewBox の原点が 0 でなくても、その範囲を塗る', () => {
      const svg = '<svg viewBox="-8 -8 116.5 66"><g/></svg>';
      expect(withBackground(svg, '#fff')).toContain(
        '<rect x="-8" y="-8" width="116.5" height="66" fill="#fff"/>'
      );
    });
  });

  describe('準正常系', () => {
    it('viewBox が無ければ width / height（px 付きも）の範囲を塗る', () => {
      const svg = '<svg width="120px" height="40"><g/></svg>';
      expect(withBackground(svg, '#fff')).toContain(
        '<rect x="0" y="0" width="120" height="40" fill="#fff"/>'
      );
    });

    it('色の前後の空白は落とす（CSS 変数の値は先頭に空白が付くことがある）', () => {
      expect(
        withBackground('<svg viewBox="0 0 1 1"></svg>', ' #000 ')
      ).toContain('fill="#000"');
    });

    it.each([
      ['viewBox も大きさも無い', '<svg><g/></svg>'],
      ['大きさが % で決まらない', '<svg width="100%" height="100%"><g/></svg>'],
      ['viewBox の大きさが 0', '<svg viewBox="0 0 0 10"><g/></svg>'],
      ['ルートが空要素', '<svg viewBox="0 0 1 1"/>'],
      ['SVG でない', '<p>x</p>'],
    ])('%sときはそのまま返す', (_label, svg) => {
      expect(withBackground(svg, '#fff')).toBe(svg);
    });
  });

  describe('異常系', () => {
    it('色に属性を閉じる文字が入っていても、属性の外に出さない', () => {
      const result = withBackground(
        '<svg viewBox="0 0 1 1"></svg>',
        '#000" onload="alert(1)'
      );
      expect(result).toContain('fill="#000&quot; onload=&quot;alert(1)"');
      expect(result).not.toContain('onload="');
    });

    it('置き換え後の文字列の $& を置換パターンとして解釈しない', () => {
      expect(withBackground('<svg viewBox="0 0 1 1"></svg>', '$&')).toContain(
        'fill="$&amp;"'
      );
    });
  });
});

describe('getPngSize', () => {
  describe('正常系', () => {
    it('元の大きさの 2 倍にする', () => {
      expect(getPngSize(400, 300)).toEqual({ width: 800, height: 600 });
    });

    it('小数は切り上げる', () => {
      expect(getPngSize(100.3, 50.2)).toEqual({ width: 201, height: 101 });
    });
  });

  describe('準正常系', () => {
    it('長辺が 8192px を超えるなら、縦横比を保って収まるまで縮める', () => {
      expect(getPngSize(8000, 2000)).toEqual({ width: 8192, height: 2048 });
      expect(getPngSize(1000, 20000)).toEqual({ width: 410, height: 8192 });
    });

    it('ちょうど上限の 2 倍になる大きさは縮めない', () => {
      expect(getPngSize(4096, 100)).toEqual({ width: 8192, height: 200 });
    });
  });

  describe('異常系', () => {
    it.each([
      [0, 100],
      [100, 0],
      [-1, 100],
      [Number.NaN, 100],
      [Number.POSITIVE_INFINITY, 100],
    ])('元の大きさが %s × %s なら null を返す', (width, height) => {
      expect(getPngSize(width, height)).toBeNull();
    });
  });
});

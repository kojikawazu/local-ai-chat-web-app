import { chmod, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';

/**
 * 偽の `gh`（GitHub CLI）。GitHub のツール（#148 Phase C）の IT・E2E で、本物の GitHub に触れずに `gh` の境界を差し替える。
 *
 * フォルダに `gh` という node のスクリプトを置き、そのフォルダを `PATH` の先頭に足して使う。スクリプトは:
 * - 受け取った引数・環境変数の名前（値は残さない）・作業フォルダを、同じフォルダの `calls.jsonl` に 1 行ずつ足す
 * - 同じフォルダの `rules.json` から、引数の先頭が一致する最初の決まりを選び、その標準出力・標準エラー出力・終了コードで終わる
 *   （一致しなければ終了コード 1）
 *
 * アプリは `gh` に絞った環境変数しか渡さないため、決まりはスクリプトの隣のファイルで渡す（環境変数では渡せない）。
 * 拡張子の無いファイルは、近くの package.json の `type` で CommonJS か ESM かが変わるため、package.json の無い一時フォルダに置く。
 */
const FAKE_GH_SCRIPT = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(
  path.join(__dirname, 'calls.jsonl'),
  JSON.stringify({ args, envKeys: Object.keys(process.env).sort(), cwd: process.cwd() }) + '\\n'
);
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules.json'), 'utf8'));
const rule = rules.find((r) => r.args.every((a, i) => args[i] === a));
if (!rule) {
  process.stderr.write('fake gh: no rule for: ' + args.join(' ') + '\\n');
  process.exit(1);
}
if (rule.stdout) process.stdout.write(rule.stdout);
if (rule.stderr) process.stderr.write(rule.stderr);
process.exit(rule.exitCode ?? 0);
`;

/** 偽の `gh` の応答の決まり 1 つ。 */
export type FakeGhRule = {
  /** 引数の先頭がこれと一致したら使う */
  args: string[];
  /** 標準出力（JSON なら文字列にしたもの） */
  stdout?: string;
  /** 標準エラー出力 */
  stderr?: string;
  /** 終了コード（既定 0） */
  exitCode?: number;
};

/** 偽の `gh` が記録した呼び出し 1 回。 */
export type FakeGhCall = {
  /** 受け取った引数 */
  args: string[];
  /** 受け取った環境変数の名前（並べ替えたもの） */
  envKeys: string[];
  /** 作業フォルダ */
  cwd: string;
};

/**
 * 偽の `gh` をフォルダに置く（実行できるようにする）。
 *
 * @param dir - 置くフォルダ（`PATH` の先頭に足す）
 * @param rules - 応答の決まり（先に書いたものが優先）
 */
export async function installFakeGh(
  dir: string,
  rules: FakeGhRule[]
): Promise<void> {
  const script = path.join(dir, 'gh');
  await writeFile(script, FAKE_GH_SCRIPT);
  await chmod(script, 0o755);
  await setFakeGhRules(dir, rules);
}

/**
 * 偽の `gh` の応答の決まりを差し替え、記録した呼び出しを消す。
 *
 * @param dir - 偽の `gh` を置いたフォルダ
 * @param rules - 応答の決まり（先に書いたものが優先）
 */
export async function setFakeGhRules(
  dir: string,
  rules: FakeGhRule[]
): Promise<void> {
  await writeFile(path.join(dir, 'rules.json'), JSON.stringify(rules));
  await rm(path.join(dir, 'calls.jsonl'), { force: true });
}

/**
 * 偽の `gh` が記録した呼び出しを読む。
 *
 * @param dir - 偽の `gh` を置いたフォルダ
 * @returns 呼び出し（古い順）。呼ばれていなければ空
 */
export async function readFakeGhCalls(dir: string): Promise<FakeGhCall[]> {
  const text = await readFile(path.join(dir, 'calls.jsonl'), 'utf8').catch(
    () => ''
  );
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FakeGhCall);
}

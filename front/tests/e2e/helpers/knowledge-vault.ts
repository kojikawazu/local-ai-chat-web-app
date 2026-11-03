import { mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * E2E の dev サーバーに `KNOWLEDGE_VAULTS` として渡す保管庫のフォルダ（#235）。
 *
 * `playwright.config.ts`（dev サーバーへ渡す）と `knowledge-vault.spec.ts`（ノートを置く・消す）が同じ値を使うため、
 * ここを唯一の定義にする。git でないフォルダ（今の中身を読む）で、リポジトリの中（fixtures）を書き換えないよう
 * OS の一時フォルダに置く。dev サーバーは起動時にフォルダの実在を確かめるため、読み込んだ時点で作っておく
 * （`playwright.config.ts` が起動より先に読み込む）。
 */
export const E2E_VAULT_DIR = path.join(tmpdir(), 'nordic-chat-e2e-vault');
mkdirSync(E2E_VAULT_DIR, { recursive: true });

/** 保管庫の名前（フォルダ名）。画面の行・出典の名前に出る */
export const E2E_VAULT_NAME = path.basename(E2E_VAULT_DIR);

/**
 * E2E の dev サーバーに、会話から覚えさせたメモを書く保管庫（`KNOWLEDGE_MEMORY_VAULT`。#236）として渡すフォルダ。
 *
 * 同期の E2E（`knowledge-vault.spec.ts`）はノートを置き直すたびに {@link E2E_VAULT_DIR} を消すため、メモは別のフォルダに書く。
 * git でないフォルダにする（コミットしない。CI に git の作者の設定が無くても動く。コミットは IT で確かめる）。
 * `KNOWLEDGE_VAULTS` にも入れる（保管庫に無い名前はメモの保管庫にできない）。
 */
export const E2E_MEMORY_DIR = path.join(tmpdir(), 'nordic-chat-e2e-memory');
mkdirSync(E2E_MEMORY_DIR, { recursive: true });

/** メモの保管庫の名前（フォルダ名）。承認カードの置き場所・出典の名前に出る */
export const E2E_MEMORY_VAULT_NAME = path.basename(E2E_MEMORY_DIR);

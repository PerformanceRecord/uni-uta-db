# リポジトリ構成・内部仕様

本書は第一段階の内部改修完了時点における `uni-uta-db` の実装仕様です。UIの見た目は `index.html` と `src/ui/renderSongs.js` を正とし、データ経路はWorker非依存のR2直接参照を前提とします。

## 1. システム全体像

1. Googleスプレッドシート `Performance Record` を `gas/Code.gs` がJSON化
2. GitHub ActionsがGASを取得
3. `scripts/build_songs_snapshot.mjs` がデータ契約を検証し `dataVersion` を生成
4. `scripts/sync_songs_to_r2.sh` が差分のある場合だけR2へアップロード
5. アップロード後にR2から読み戻し、ローカルsnapshotと完全一致することを確認
6. ブラウザがR2の `songs.json` を直接取得して表示

## 2. 主要ファイル

| パス | 責務 |
|---|---|
| `index.html` | HTML、CSS、モジュール初期化 |
| `src/app.js` | DOMイベントと各モジュールの調停 |
| `src/data/songsApi.js` | R2取得、JSON検証、キャッシュ、フォールバック |
| `src/domain/songCatalog.js` | 分類、検索、並び替え、URL・日付正規化 |
| `src/features/danmaku.js` | 弾幕Unicode処理、生成、15分TTLキャッシュ |
| `src/features/scrollBubbles.js` | 泡強度・個数・DOM生成 |
| `src/platform/clipboard.js` | Clipboard APIとtextareaフォールバック |
| `src/platform/pwa.js` | Service Worker登録、PWAインストール案内 |
| `src/ui/mobileEffects.js` | モバイル限定装飾、スケルトン、スクロール進捗 |
| `src/ui/renderSongs.js` | 楽曲カード描画、検索語ハイライト |
| `src/ui/swipeTrack.js` | 2面スワイプとページインジケータ |
| `src/utils/scheduling.js` | debounce、requestAnimationFrameスロットリング |
| `sw.js` | 同一オリジンのアプリシェルキャッシュ |
| `gas/Code.gs` | シートからAPI payloadを生成 |
| `sheet_scripts/performance_record.gs` | シート編集・重複整理・履歴処理 |
| `scripts/lib/songSnapshot.mjs` | R2保存前の厳格なデータ契約 |
| `scripts/check_project.mjs` | JS/GAS/JSON/Service Worker参照の静的検証 |

## 3. フロントエンド初期化

`index.html` は次の順に実行します。

1. `bind()`
2. `setupTopSwipe()`
3. `setupBottomSwipe()`
4. `initializeApp()`

`app.js` は状態を `src/state/appState.js` へ集約し、楽曲の判定規則やブラウザAPI実装を内部に重複保持しません。

### 3.1 データ取得

- 候補URLを優先順に試行
- 1候補15秒でタイムアウト
- ネットワークエラー、404、408、429、5xxでは次候補へ移行
- スキーマバージョン、件数、`dataVersion` を検証
- ETagの有無にかかわらずlocalStorageへ保存
- キャッシュ表示後、同じ `dataVersion` なら再描画を省略
- 通信失敗時も検証済みキャッシュの表示を継続

### 3.2 負荷制御

- 検索入力は120ms debounce
- スクロール・リサイズ由来のレイアウト計測は1フレーム1回
- 泡は最大90個
- PCのfine pointer環境ではスクロール泡演出を停止
- モバイル装飾はtouch-firstレイアウトだけで有効化
- スクロール水位線は既存scrollイベント内でCSS変数だけを更新
- 水面光は画像・通信・常時アニメーションを使わない静的CSS
- 楽曲のフィルタ・並び替えは入力配列を変更しない純粋関数

### 3.3 Service Worker

- 画面遷移はnetwork-first
- JS、manifest、アイコンはstale-while-revalidate
- R2など別オリジンと `songs.json` には介入しない
- activate時に旧 `uni-uta-shell-*` キャッシュを削除

## 4. GASデータ仕様

- 対象シート: `Performance Record`
- ヘッダー: 3行目
- データ開始: 4行目
- 読み取り列: A〜F
- 掲載条件: F列が `TRUE / 1 / ✅ / ☑` 等
- チェック済み行はA列アーティスト、B列曲名が必須
- C列を種別・備考、D列を日付・タイトル・リンクとして使用
- E列はWeb表示に含めない

種別優先度は `歌ってみた > 歌枠 > ショート` です。D列にURLや日付があっても、C列が歌ってみたなら `cover` を維持します。

次はAPI生成を停止するデータ契約違反です。

- A+Bの重複（NFKC、大文字小文字、連続空白を正規化）
- チェック済み行のA/B欠損
- 存在しない `YYYYMMDD`
- 必要列不足

エラーは `SONGS_BUILD_FAILED` を含むJSONで返し、同期処理がR2更新前に停止します。

Webアプリ実行時のスプレッドシートはScript Propertiesの `SPREADSHEET_ID` を優先し、未設定時のみ互換用IDを使用します。

### 4.1 シート整理

`sheet_scripts/performance_record.gs` は重複行をAPI生成前に整理します。

- 同一楽曲は `歌ってみた > 歌枠 > ショート`、同カテゴリ内はD列日付の新しい順で1行を選択
- 選択されなかった行は全て `履歴` へ移動
- 残す行で欠けているE列と、いずれかの行で有効なF列を継承
- A/Bが揃った新規行の空F列へ `TRUE` を設定
- 最後に有効行全体をB列昇順、A列昇順、D列降順でソート

## 5. R2 snapshot契約

```json
{
  "items": [],
  "total": 0,
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "schemaVersion": 1,
  "dataVersion": "sha256:..."
}
```

`dataVersion` は `schemaVersion + items` から生成するため、`generatedAt` だけの変化では更新されません。R2上の `dataVersion` が同じ場合はアップロードを省略します。

## 6. CIと検証

`npm run verify` は以下を実行します。

1. JavaScript構文確認
2. Apps Script構文確認
3. JSONファイル解析
4. Service WorkerのAPP_SHELL参照先存在確認
5. Vitest全件

PRワークフローはread-only権限、10分タイムアウト、同一PRの旧実行キャンセルを設定しています。同期ワークフローは多重実行を禁止し、R2アップロード後の読み戻しまで行います。

## 7. 第一段階の不変条件

- `index.html` の構造・CSS・文言を変更しない
- 楽曲カードのHTML生成結果を変更しない
- モバイル／ブラウザの既存操作対象を変更しない
- 重複データを自動選択して公開しない
- GASまたはsnapshot検証失敗時に既存R2データを上書きしない


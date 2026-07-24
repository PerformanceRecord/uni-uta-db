# Worker非依存構成チェック

## 結論

本アプリはCloudflare Workerを必要としません。通常経路は次のとおりです。

`Spreadsheet → GAS → GitHub Actions → validated snapshot → R2 → Browser`

## 更新経路

- GASは `?api=songs` でJSONを返す
- Nodeスクリプトが項目型、URL、日付、件数、重複を検証
- 内容由来の `dataVersion` を付与
- R2上と同一内容ならアップロードを省略
- 更新時はアップロード後に読み戻して完全一致を確認
- 検証失敗時は既存R2オブジェクトを変更しない

## ブラウザ経路

- `meta[name="songs-r2-json-url"]` のR2公開URLを直接取得
- 15秒タイムアウトと候補URLフォールバックを使用
- ETagに依存せずlocalStorageキャッシュを保持
- Service Workerは同一オリジンのアプリシェルだけを扱う
- R2の `songs.json` はService Workerの対象外

## 運用チェックリスト

- [ ] GASのScript Propertiesに `SPREADSHEET_ID` を設定
- [ ] GAS URLへ `?api=songs` を付け、`items` と `total` を確認
- [ ] GitHub SecretsのR2認証情報とオブジェクトキーを確認
- [ ] `npm run verify` が成功
- [ ] 同期Actionsがsnapshot生成、upload、read-backを完了
- [ ] R2公開URLが200かつJSON
- [ ] 本番サイトのOriginを付けたR2応答に `Access-Control-Allow-Origin` がある
- [ ] ブラウザ詳細ログにスキーマ・通信エラーがない

## エラー時の切り分け

- `GAS API error`: メッセージ内のシート行を修正
- `Invalid songs payload`: R2オブジェクトと同期Actionsを確認
- `HTTP 404`: R2バケット・オブジェクトキー・公開URLを確認
- `TimeoutError`: R2公開状態、CORS、候補URLを確認
- キャッシュ表示中: ネットワーク復旧後に再読込し、最新 `dataVersion` を取得

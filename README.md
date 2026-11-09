# Deep Reader

EPUB 閱讀器，整合 AI 閱讀對話、閱讀筆記、白板與間隔複習。

## 下載與安裝

從 [GitHub Releases](https://github.com/highsunday/deep-reader/releases/latest) 下載正式版。

- `Deep-Reader-1.0.0-mac-arm64.dmg`：適用 Apple Silicon（M 系列晶片）Mac。開啟後將 **Deep Reader** 拖到 **Applications**。
- `.zip`：同一應用程式的壓縮版本。
- `SHA256SUMS.txt`：下載檔案的 SHA-256 校驗值。

下載頁與原始碼公開提供；不需要取得私人儲存庫存取權。

v1.0.0 未經 Apple Developer ID 簽署或公證。若 macOS 阻擋首次開啟，請在「系統設定 → 隱私權與安全性」確認來源後選擇「強制打開」。

AI 功能需要已安裝並登入的 Codex（Codex 桌面版或 Codex CLI）。影片產生還需要本機 FFmpeg/FFprobe；Manim、Remotion 等進階引擎需另備執行環境。v1.0.0 的安裝與啟動檢查不包含所有需登入的 AI／影片端對端流程。

安裝版沿用開發版的資料目錄 `~/Library/Application Support/reader-ai-range-chat-example`，包含書庫、筆記與對話。

## 開發與打包

```sh
npm ci
npm run typecheck
npm test
npm run dev
```

在 Apple Silicon Mac 建立下載檔：

```sh
npm run dist:mac
```

輸出位於 `release/`，包含 DMG、ZIP 與應用程式。打包只納入建置結果、正式依賴與啟動程式，不包含本機書庫、測試截圖或報告。

import { Tray, Menu, nativeImage, app, NativeImage } from 'electron';

interface TrayOptions {
  onToggleWindow: () => void;
  onShowWindow: () => void;
}

let tray: Tray | null = null;

// 16x16 の白丸 SVG を data URL 化してトレイアイコンに使う（外部ファイル不要）
const WHITE_CIRCLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="#ffffff"/></svg>`;

function buildTrayIcon(): NativeImage {
  const base64 = Buffer.from(WHITE_CIRCLE_SVG, 'utf8').toString('base64');
  const dataUrl = `data:image/svg+xml;base64,${base64}`;
  const image = nativeImage.createFromDataURL(dataUrl);
  // macOS メニューバー用テンプレート画像として扱う
  image.setTemplateImage(true);
  return image;
}

export function createTray(options: TrayOptions): Tray {
  if (tray) {
    return tray;
  }

  tray = new Tray(buildTrayIcon());
  tray.setToolTip('作業用ラジオ');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'ウィンドウを表示',
      click: () => options.onShowWindow(),
    },
    { type: 'separator' },
    {
      label: '終了',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.on('click', () => options.onToggleWindow());
  tray.on('right-click', () => {
    tray?.popUpContextMenu(contextMenu);
  });
  tray.setContextMenu(contextMenu);

  return tray;
}

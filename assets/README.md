# App Icons

Place the following icon files here for Electron builds:

- `icon.png` — 512x512 PNG (Linux, tray icon)
- `icon.ico` — Multi-size ICO (Windows) — generate from PNG at https://convertio.co/png-ico/
- `icon.icns` — Multi-size ICNS (macOS) — generate from PNG at https://cloudconvert.com/png-to-icns

## Quick generation from a single 1024x1024 PNG

```bash
# Install ImageMagick if needed: brew install imagemagick (macOS) / apt install imagemagick (Linux)

# PNG (just resize)
convert source.png -resize 512x512 icon.png

# ICO (multi-size)
convert source.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico

# ICNS (macOS only — use iconutil)
mkdir icon.iconset
for size in 16 32 64 128 256 512; do
  convert source.png -resize ${size}x${size} icon.iconset/icon_${size}x${size}.png
  convert source.png -resize $((size*2))x$((size*2)) icon.iconset/icon_${size}x${size}@2x.png
done
iconutil -c icns icon.iconset
```

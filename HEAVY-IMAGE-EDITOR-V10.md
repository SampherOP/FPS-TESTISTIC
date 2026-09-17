# HAMU MASTER Heavy UI + Image Editor V10

- Server port: 3000
- Admin-only image uploads via `/api/ui-image`
- PNG/JPG/WebP up to 8 MB
- Drag/drop images no longer navigates the browser away from the game
- Select any UI element, then drop an image to apply it as that element's background image
- Dedicated MENU BACKGROUND control for the PLAY/LOBBY screen
- Menu background size/position are editable and server-persisted
- Uploaded images are stored in the protected account data directory under `ui-assets`
- UI/world/background editor config remains server-saved and live-synced
- Existing account, profile, social, and gameplay systems are preserved
- Sample lobby wallpaper included at `assets/editor-backgrounds/HAMU_MASTER_LOBBY_SAMPLE.png`; it is not auto-applied

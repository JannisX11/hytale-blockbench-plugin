import { track } from "./cleanup";
import { isHytaleFormat } from "./formats";

export function updateUVSize(texture: Texture) {
    let size = [texture.width, texture.display_height];
    let frames = texture.frameCount;
    if (settings.detect_flipbook_textures.value == false || frames <= 2 || (frames%1)) {
        size[1] = texture.height;
    }
    texture.uv_width = size[0];
    texture.uv_height = size[1];
}

export function setupTextureHandling() {

    let setting = new Setting('preview_selected_texture', {
        name: 'Preview Selected Texture',
        description: 'When selecting a texture in a Hytale format, preview the texture on the model instantly',
        category: 'preview',
        type: 'toggle',
        value: true
    })
    track(setting);

    // Auto-set selected texture as default for the model (not for attachments - those use their own system)
    let handler = Blockbench.on('select_texture', (arg) => {
        if (!isHytaleFormat()) return;
        if (setting.value == false) return;

        let texture = arg.texture as Texture;
        // @ts-expect-error - getGroup not in types
        let texture_group = texture.getGroup() as TextureGroup;
        // Only auto-set for non-grouped textures (grouped ones are managed separately)
        if (!texture_group) {
            texture.setAsDefaultTexture();
        }
    });
    track(handler);
}

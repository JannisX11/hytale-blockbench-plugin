//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { AttachmentCollection } from "./attachments";
import { track } from "./cleanup";
import { isHytaleFormat } from "./formats";
import { t } from "./i18n";

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

    let setting = new Setting("preview_selected_texture", {
      name: t("settings.preview_texture.name"), 
      description: t("settings.preview_texture.description"), 
      category: "preview",
      type: "toggle",
      value: true,
    });
    track(setting);

    // Auto-set selected texture: for grouped textures update the collection, otherwise set as default
    let handler = Blockbench.on('select_texture', (arg) => {
        if (!isHytaleFormat()) return;
        if (setting.value == false) return;

        let texture = arg.texture as Texture;
        let texture_group = texture.getGroup() as TextureGroup;
        if (texture_group) {
            let collection = Collection.all.find(c => c.name == texture_group.name) as AttachmentCollection;
            if (collection) {
                collection.texture = texture.uuid;
                Canvas.updateAllFaces(texture);
            }
        } else {
            texture.setAsDefaultTexture();
        }
        UVEditor.vue.updateTexture();
    });
    track(handler);

    /*let on_update_select = Blockbench.on('update_texture_selection', (arg) => {
        if (Texture.getDefault()) updateUVSize(Texture.getDefault());
    })
    track(on_update_select);
    */
}

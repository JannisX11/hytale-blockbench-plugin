//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { setupBlockymodelCodec } from "./blockymodel";
import { track } from "./cleanup";
import { t } from "./i18n";

export const FORMAT_IDS = [
    'hytale_character',
    'hytale_prop'
];
export function setupFormats() {
    
    let codec = setupBlockymodelCodec();

    let common: Partial<FormatOptions> = {
        category: 'hytale',
        target: 'Hytale',
        codec,
        forward_direction: '+z',
        single_texture_default: true,
        animation_files: true,
        animation_grouping: 'custom',
        animation_mode: true,
        bone_rig: true,
        centered_grid: true,
        box_uv: false,
        optional_box_uv: true,
        uv_rotation: true,
        rotate_cubes: true,
        per_texture_uv_size: true,
        stretch_cubes: true,
        confidential: true,
        model_identifier: false,
        animation_loop_wrapping: true,
        quaternion_interpolation: true,
        onActivation() {
            settings.shading.set(false);
            Panels.animations.inside_vue.$data.group_animations_by_file = false;
        }
    }
    let format_page: FormatPage = {
      content: [
        { type: "h3", text: t("formats.page.informations") },
        { text: t("formats.page.info_list") },
        { type: "h3", text: t("formats.page.resources") },
        { text: t("formats.page.resource_list") },
      ],
    };

    let format_character = new ModelFormat("hytale_character", {
      name: t("formats.character.name"),
      description: t("formats.character.description"),
      icon: "icon-format_hytale",
      format_page,
      block_size: 64,
      ...common,
      // TODO: Auto-reload attachments on tab switch. Needs dirty tracking and setting toggle to avoid losing unsaved changes
      /*
        onActivation() {
            common.onActivation?.();
            setTimeout(() => reload_all_attachments?.click(), 0);
        }
        */
    });
    let format_prop = new ModelFormat("hytale_prop", {
      name: t("formats.prop.name"), 
      description: t("formats.prop.description"), 
      icon: "icon-format_hytale",
      format_page,
      block_size: 64,
      ...common,
    });

    codec.format = format_character;
    track(format_character);
    track(format_prop);

    Language.addTranslations("en", {
      "format_category.hytale": t("formats.category"),
    });
}

export function isHytaleFormat() {
    return Format && FORMAT_IDS.includes(Format.id);
}

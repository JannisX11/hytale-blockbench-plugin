//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { FormatOptions, FormatPage } from "blockbench-types/generated/io/format";
import { setupBlockymodelCodec } from "./blockymodel";
import { track } from "./cleanup";

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
        box_uv_float_size: true,
        integer_size: true,
        uv_rotation: true,
        rotate_cubes: true,
        per_texture_uv_size: true,
        texture_wrap_default: 'clamp',
        stretch_cubes: true,
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
            {type: 'h3', text: tl('mode.start.format.informations')},
            {text: `* One texture can be applied to a model at a time
                    * UV sizes are linked to the size of each cube and cannot be modified, except by stretching the cube
                    * Models can have a maximum of 255 nodes`.replace(/(\t| {4,4})+/g, '')
            },
            {type: 'h3', text: tl('mode.start.format.resources')},
            {text: ['* [Modeling Overview and Style Guide](https://hytale.com/news/2025/12/an-introduction-to-making-models-for-hytale)',
                    '* [Modeling Tutorial](https://youtu.be/Q07i3wmGy0Y)'].join('\n')
            }
        ]
    };

    let format_character = new ModelFormat('hytale_character', {
        name: 'Hytale Character',
        description: 'Create character and attachment models using Hytale\'s blockymodel format',
        icon: 'icon-format_hytale',
        format_page,
        block_size: 64,
        ...common
        // TODO: Auto-reload attachments on tab switch. Needs dirty tracking and setting toggle to avoid losing unsaved changes
        /*
        onActivation() {
            common.onActivation?.();
            setTimeout(() => reload_all_attachments?.click(), 0);
        }
        */
    });
    let format_prop = new ModelFormat('hytale_prop', {
        name: 'Hytale Prop',
        description: 'Create prop models using Hytale\'s blockymodel format',
        icon: 'icon-format_hytale',
        format_page,
        block_size: 32,
        ...common
    });

    // Integer size
    let int_setting = new Setting('hytale_integer_size', {
        name: 'Hytale Integer Size',
        category: 'edit',
        description: 'Restrict cube sizes in hytale formats to full integers. Float values are technically supported but make UV mapping more difficult. Using stretch is recommended instead.',
        type: 'toggle',
        value: true
    })
    track(int_setting);
    const integer_size = {get: () => int_setting.value};
    Object.defineProperty(format_character, 'integer_size', integer_size);
    Object.defineProperty(format_prop, 'integer_size', integer_size);

    const single_texture = {get: () => Collection.all.length == 0};
    Object.defineProperty(format_character, 'single_texture', single_texture);
    Object.defineProperty(format_prop, 'single_texture', single_texture);

    codec.format = format_character;
    format_character.codec = codec;
    format_prop.codec = codec;
    track(format_character);
    track(format_prop);

    Language.addTranslations('en', {
        'format_category.hytale': 'Hytale'
    })
}

export function isHytaleFormat() {
    return Format && FORMAT_IDS.includes(Format.id);
}

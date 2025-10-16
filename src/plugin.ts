/// <reference path="../node_modules/blockbench-types/index.d.ts" />
import { setupAnimationActions } from "./animation";
import { setupAttachments } from "./attachments";
import { setupBlockymodelCodec } from "./blockymodel";
import { cleanup, track } from "./cleanup";
import { setupElements } from "./element";

const HytaleAnglePreset: AnglePreset = {
    projection: 'perspective',
    position: [112, 80, 112],
    target: [0, 32, 0],
}

BBPlugin.register('hytale_plugin', {
    title: 'Hytale Plugin',
    author: 'JannisX11',
    icon: 'icon.png',
    version: '1.0.0',
    description: 'Adds support for creating models and animations for Hytale',
    variant: 'both',
    min_version: '4.10.0',
    has_changelog: true,
    repository: 'https://github.com/JannisX11/hytale-blockbench-plugin',
    onload() {

        let codec = setupBlockymodelCodec();

        let format = new ModelFormat('hytale_model', {
            name: 'Hytale Model',
            description: 'Create models using Hytale\'s blockymodel format',
            icon: 'icon-format_hytale',
            category: 'hytale',
            single_texture_default: true,
            animation_files: true,
            animation_mode: true,
            bone_rig: true,
            centered_grid: true,
            box_uv: false,
            optional_box_uv: false,
            uv_rotation: true,
            rotate_cubes: true,
            per_texture_uv_size: true,
            stretch_cubes: true,
            confidential: true,
            model_identifier: true,
            animation_loop_wrapping: true,
            quaternion_interpolation: true,
            codec,
            onActivation() {
                settings.shading.set(false);
                Panels.animations.inside_vue.$data.group_animations_by_file = false;
            }
        });
        codec.format = format;
        track(format);
        Language.addTranslations('en', {
            'format_category.hytale': 'Hytale'
        })

        setupElements();
        setupAnimationActions();
        setupAttachments();

        
		Blockbench.on('load_editor_state', ({project}) => {
            if (Format == format && project && !project.previews[Preview.selected.id]) {
                Preview.selected.loadAnglePreset(HytaleAnglePreset);
            }
        });
        
    },
    onunload() {
        cleanup();
    }
})

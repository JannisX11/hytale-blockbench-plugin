import { setupAnimationActions } from "./animation";
import { setupBlockymodelCodec } from "./blockymodel";
import { cleanup, track } from "./cleanup";
import { setupElements } from "./element";

BBPlugin.register('hytale_plugin', {
    title: 'Test Plugin',
    author: 'JannisX11',
    icon: 'icon.png',
    version: '1.0.0',
    description: 'Hello World',
    variant: 'both',
    min_version: '4.10.0',
    has_changelog: true,
    repository: 'https://github.com/JannisX11/hytale-blockbench-plugin',
    onload() {

        let codec = setupBlockymodelCodec();

        let format = new ModelFormat('hytale_model', {
            name: 'Test Model',
            description: 'Test Format',
            icon: 'icon-format_hytale',
            category: 'hytale',
            animation_files: true,
            animation_mode: true,
            bone_rig: true,
            centered_grid: true,
            box_uv: false,
            optional_box_uv: false,
            uv_rotation: true,
            per_texture_uv_size: true,
            stretch_cubes: true,
            confidential: true,
            model_identifier: true,
            animation_loop_wrapping: true,
            quaternion_interpolation: true,
            codec,
        });
        codec.format = format;
        track(format);
        Language.addTranslations('en', {
            'format_category.hytale': 'Hytale'
        })

        track(...setupElements());
        track(...setupAnimationActions());
        
    },
    onunload() {
        cleanup();
    }
})

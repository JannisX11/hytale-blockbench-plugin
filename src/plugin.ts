import { setupAnimationActions } from "./animation";
import { setupBlockymodelCodec } from "./blockymodel";
import { setupElements } from "./element";

const deletables: Deletable[] = [];

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
            stretch_cubes: true,
            confidential: true,
            model_identifier: true,
            animation_loop_wrapping: true,
            quaternion_interpolation: true,
        })
        deletables.push(format);
        Language.addTranslations('en', {
            'format_category.hytale': 'Hytale'
        })

        deletables.push(
            ...setupElements(),
            ...setupBlockymodelCodec(),
            ...setupAnimationActions(),
        )
        
    },
    onunload() {
        // Delete actions etc. when reloading or uninstalling the plugin
        for (let deletable of deletables) {
            deletable.delete();
        }
        deletables.empty();
    }
})

import { setupAnimationCodec } from "./blockyanim";
import { setupAttachments } from "./attachments";
import { setupAnimation } from "./animations";
import { cleanup, track } from "./cleanup";
import { setupElements } from "./element";
import { setupUVCycling } from "./uv_cycling";
import { setupChecks } from "./validation";
// @ts-expect-error
import Package from './../package.json'
import { setupFormats } from "./formats";
import { setupPhotoshopTools } from "./photoshop_copy_paste";
import { CustomPivotMarker, GroupPivotIndicator } from "./pivot_marker"
import { setupOutlinerFilter } from "./outliner_filter";
import { CustomPivotMarker } from "./pivot_marker"
import { setupTextureHandling } from "./texture";
import { setupNameOverlap } from "./name_overlap";
import { setupUVOutline } from "./uv_outline";
import { setupTempFixes } from './temp_fixes'

BBPlugin.register('hytale_plugin', {
    title: 'Hytale Models',
    author: 'JannisX11, Kanno',
    icon: 'icon.png',
    version: Package.version,
    description: 'Create models and animations for Hytale',
    tags: ['Hytale'],
    variant: 'both',
    min_version: '5.0.5',
    await_loading: true,
    has_changelog: true,
    repository: 'https://github.com/JannisX11/hytale-blockbench-plugin',
    bug_tracker: 'https://github.com/JannisX11/hytale-blockbench-plugin/issues',
    onload() {

        setupFormats();
        setupElements();
        setupAnimation();
        setupAnimationCodec();
        setupAttachments();
        setupOutlinerFilter();
        setupChecks();
        setupPhotoshopTools();
        setupUVCycling();
        setupTextureHandling();
        setupNameOverlap();
        setupUVOutline();
        setupTempFixes();

        // Collections panel setting
        let panel_setup_listener: Deletable;
        function showCollectionPanel(): boolean {
            const local_storage_key = 'hytale_plugin:collection_panel_setup';
            if (localStorage.getItem(local_storage_key)) return true;
            if (!Modes.edit) return false;

            if (Panels.collections.slot == 'hidden') {
                Panels.collections.moveTo('right_bar');
            }
            if (Panels.collections.folded) {
                Panels.collections.fold();
            }
            if (panel_setup_listener) {
                panel_setup_listener.delete();
                panel_setup_listener = undefined;
            }
            localStorage.setItem(local_storage_key, "true");
            return true;
        }
        if (!showCollectionPanel()) {
            panel_setup_listener = Blockbench.on('select_mode', showCollectionPanel);
        }

        let on_finish_edit = Blockbench.on('generate_texture_template', (arg) => {
            for (let element of arg.elements) {
                if (typeof element.autouv != 'number') continue;
                element.autouv = 1;
            }
        })
        track(on_finish_edit);

        let pivot_marker = new CustomPivotMarker();
        track(pivot_marker)

        let group_pivot_indicator = new GroupPivotIndicator();
        track(group_pivot_indicator)
        
    },
    onunload() {
        cleanup();
    }
})

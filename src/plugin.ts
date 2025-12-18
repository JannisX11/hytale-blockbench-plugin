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
import { setupUVFill } from "./uv_fill";

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
        setupUVFill();

        let pivot_marker = new CustomPivotMarker();
        track(pivot_marker)

        let group_pivot_indicator = new GroupPivotIndicator();
        track(group_pivot_indicator)
        
    },
    onunload() {
        cleanup();
    }
})

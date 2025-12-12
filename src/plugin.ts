import { setupAnimationActions } from "./animation";
import { setupAttachments } from "./attachments";
import { cleanup, track } from "./cleanup";
import { setupElements } from "./element";
import { setupChecks } from "./validation";
// @ts-expect-error
import Package from './../package.json'
import { setupFormats } from "./formats";
import { setupPhotoshopTools } from "./photoshop_copy_paste";
import { CustomPivotMarker } from "./pivot_marker"

BBPlugin.register('hytale_plugin', {
    title: 'Hytale Models',
    author: 'JannisX11',
    icon: 'icon.png',
    version: Package.version,
    description: 'Adds support for creating models and animations for Hytale',
    tags: ['Hytale'],
    variant: 'both',
    min_version: '5.0.0',
    has_changelog: true,
    repository: 'https://github.com/JannisX11/hytale-blockbench-plugin',
    bug_tracker: 'https://github.com/JannisX11/hytale-blockbench-plugin/issues',
    onload() {

        setupFormats();
        setupElements();
        setupAnimationActions();
        setupAttachments();
        setupChecks();
        setupPhotoshopTools();

        let pivot_marker = new CustomPivotMarker();
        track(pivot_marker)
        
    },
    onunload() {
        cleanup();
    }
})

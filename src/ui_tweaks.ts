import { track } from "./cleanup";

export function setupUITweaks() {

    let setting = new Setting('hytale_sync_sidebar_width', {
        name: 'Sync Sidebar Width',
        description: 'Sync the width of the sidebars and size of some panels between Edit and Paint mode',
        category: 'interface',
        type: 'toggle',
        value: false
    });
    track(setting);

    let previous_mode: string | null = null;
    let previous_data = null;
    let previous_uv_panel_data = null;

    track(Blockbench.on('unselect_mode', ({mode}) => {
        previous_mode = mode.id;
        previous_data = Interface.getModeData();
        previous_uv_panel_data = Panels.uv.position_data;
    }));
    track(Blockbench.on('select_mode', ({mode}) => {
        if (!setting.value) return;
        if (!previous_data) return;
        if ((mode.id == 'edit' && previous_mode == 'paint') || (mode.id == 'paint' && previous_mode == 'edit')) {
            Object.assign(Interface.getModeData(), previous_data);
            if (previous_uv_panel_data) {
                Object.assign(Panels.uv.position_data, previous_uv_panel_data);
            }
        }
    }));
}
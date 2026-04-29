import { track } from "./cleanup";

export function setupShortcuts() {

    // Press brush button multiple times to switch brushes
    const brush_tool = BarItems.brush_tool as Tool;
    let last_brush_preset = Painter.default_brush_presets[0];
    let selecting = false;

    brush_tool.addSubKeybind('switch_preset', 'Switch Preset', null, (event) => {
        if (Toolbox.selected == brush_tool && !selecting) {
            // @ts-expect-error
            let options: CustomMenuItem[] = (brush_tool.side_menu as Menu).structure();
            options = options.slice(0, -2);
            let index = options.findIndex(option => option.name == last_brush_preset?.name);
            let next_index = (index+1) % options.length;
            let next_option = options[next_index];
            next_option.click(null, event);
            Blockbench.showQuickMessage(`Brush ${next_index+1}: ${tl(next_option.name)}`);
        }
    })
    let select_listener = brush_tool.on('select', () => {
        selecting = true;
        setTimeout(() => selecting = false, 60);
    })


    let originalApplyBrushPreset = Painter.loadBrushPreset;
    Painter.loadBrushPreset = function(preset) {
        last_brush_preset = preset;
        originalApplyBrushPreset.call(Painter, preset);
    }

    track({
        delete() {
            select_listener.delete();
            delete brush_tool.sub_keybinds.switch_preset;
            Painter.loadBrushPreset = originalApplyBrushPreset;
        }
    })
}
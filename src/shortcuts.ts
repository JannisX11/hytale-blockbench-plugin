import { track } from "./cleanup";

export function setupShortcuts() {

    // Press brush button multiple times to switch brushes
    let last_brush_preset = Painter.default_brush_presets[0];
    let brush_tool = BarItems.brush_tool as Tool;

    let original_brush_trigger = brush_tool.trigger;
    brush_tool.trigger = function(event: Event): boolean {

		if (BARS.condition(this.condition, this)) {
		    if (this === Toolbox.selected) {
                // @ts-expect-error
                let options: CustomMenuItem[] = (brush_tool.side_menu as Menu).structure();
                options = options.slice(0, -2);
                let index = options.findIndex(option => option.name == last_brush_preset?.name);
                let next_index = (index+1) % options.length;
                let next_option = options[next_index];
                next_option.click(null, event);
                Blockbench.showQuickMessage(`Brush ${next_index+1}: ${tl(next_option.name)}`);
                return;
            }
			this.select()
			return true;
		} else if (this.modes && event instanceof KeyboardEvent == false) {
			return this.switchModeAndSelect();
		}
		return false;
	}

    let originalApplyBrushPreset = Painter.loadBrushPreset;
    Painter.loadBrushPreset = function(preset) {
        last_brush_preset = preset;
        originalApplyBrushPreset.call(Painter, preset);
    }

    track({
        delete() {
            brush_tool.trigger = original_brush_trigger;
            Painter.loadBrushPreset = originalApplyBrushPreset;
        }
    })
}
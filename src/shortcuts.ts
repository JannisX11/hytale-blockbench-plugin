import { track } from "./cleanup";

export function setupShortcuts() {

    // Press brush button multiple times to switch brushes
    const brush_tool = BarItems.brush_tool as Tool;
    let last_brush_preset = Painter.default_brush_presets[0];
    let selecting = false;

    brush_tool.addSubKeybind('switch_preset', 'Switch Preset', null, (event) => {
        if (Toolbox.selected == brush_tool && !selecting) {
            let options = [...Painter.default_brush_presets, ...StateMemory.brush_presets];
            let index = options.indexOf(last_brush_preset);
            let next_index = (index+1) % options.length;
            let next_option = options[next_index];
            Painter.loadBrushPreset(next_option);
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

    let last_preview_id: string | undefined;
    let last_preview_rotation_y: number | undefined;
    let action = new Action('snap_view_to_side_view', {
        icon: 'recenter',
        name: 'Snap View to Side View',
        category: 'view',
        keybind: new Keybind({key: 18, alt: null, shift: null, ctrl: null}),
        condition: () => Preview.selected instanceof Preview,
        click() {
            let preview = Preview.selected;
			preview.setProjectionMode(true, true);

            let center = preview.controls.target;
            let delta = preview.camera.position.clone().sub(center);
            let distance = delta.length();

            preview.camera.position.copy(center);

            if (Math.abs(delta.x) > Math.abs(delta.y) && Math.abs(delta.x) > Math.abs(delta.z)) {
                preview.camera.position.x += distance * Math.sign(delta.x);
            } else if (Math.abs(delta.y) > Math.abs(delta.z)) {
                preview.camera.position.y += distance * Math.sign(delta.y);
            } else {
                preview.camera.position.z += distance * Math.sign(delta.z);
            }
            preview.controls.stopMovement();

            setTimeout(() => {
                last_preview_id = preview.id;
                last_preview_rotation_y = preview.camera.rotation.y;
            }, 100);
        }
    });
    let on_rotate = Blockbench.on('update_camera_position', ({preview}) => {
        if (preview.id == last_preview_id && preview.camera.rotation.y != last_preview_rotation_y && preview.isOrtho) {
			preview.setProjectionMode(false, true);
            last_preview_id = undefined;
            last_preview_rotation_y = undefined;
        }
    })
    track(action, on_rotate);
}
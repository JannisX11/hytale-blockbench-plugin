import { track, trackTimeout } from "./cleanup";

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
    let is_navigating_timer = 0;
    let action = new Action('snap_view_to_side_view', {
        icon: 'recenter',
        name: 'Snap View to Side View',
        category: 'navigate',
        keybind: new Keybind({key: 18, alt: null, shift: null, ctrl: null}),
        condition: () => Preview.selected instanceof Preview,
        click(event) {
            // ensure this only runs while navigating (if its bound to a modifier key)
            if (is_navigating_timer == 0 && (event as KeyboardEvent).keyCode <= 18) return;

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
        is_navigating_timer = 2;
        if (preview.id == last_preview_id && preview.camera.rotation.y != last_preview_rotation_y && preview.isOrtho) {
			preview.setProjectionMode(false, true);
            last_preview_id = undefined;
            last_preview_rotation_y = undefined;
        }
    })

    document.addEventListener('pointerup', () => {is_navigating_timer = 0}, {passive: true});
    let interval = setInterval(() => {
        if (is_navigating_timer > 0) is_navigating_timer--;
    }, 250);

    trackTimeout(interval);
    track(action, on_rotate);



    // Navigate UV editor
    let uv_navigation_shortcut = new KeybindItem('uv_editor_navigation', {
        // @ts-expect-error
        condition: {modes: ['edit', 'paint']},
		category: 'navigate',
        name: 'UV Editor Navigation',
        description: 'Hold this key to navigate the UV editor',
    });
    track(uv_navigation_shortcut);
    function startUVNavigate(event: KeyboardEvent) {
        if (event.repeat) return;
        if (!uv_navigation_shortcut.keybind.isTriggered(event)) return;
        // Test if inside UV editor
        let target = document.elementFromPoint(mouse_pos.x, mouse_pos.y);
        if (!target || !Panels.uv.node.contains(target)) return;

        // Track mouse movement
		UVEditor.total_zoom_offset = [6, 6];
        let uv_navigation_start = structuredClone(mouse_pos);
        let {viewport} = UVEditor.vue.$refs;
        let margin = UVEditor.vue.getFrameMargin();
        let margin_center = [UVEditor.vue.width/2, UVEditor.vue.height/2];
        let original = [
            viewport.scrollLeft - 5,
            viewport.scrollTop - 5
        ];
        function movePointer(e2: PointerEvent) {
            let x = original[0] + uv_navigation_start.x - e2.clientX + UVEditor.total_zoom_offset[0];
            let y = original[1] + uv_navigation_start.y - e2.clientY + UVEditor.total_zoom_offset[1];
            viewport.scrollLeft = Math.snapToValues(x, [margin[0], margin_center[0]], 10);
            viewport.scrollTop = Math.snapToValues(y, [margin[1], margin_center[1]], 10);

            UVEditor.vue.centered_view = (viewport.scrollLeft == margin[0] || viewport.scrollLeft == margin_center[0])
                                        && (viewport.scrollTop == margin[1] || viewport.scrollTop == margin_center[1]);
            UVEditor.updateUVNavigator();
        }
        function movePointerStop(e: KeyboardEvent) {
            removeEventListeners(document, 'pointermove', movePointer);
            removeEventListeners(document, 'keyup', movePointerStop);
        }
        addEventListeners(document, 'pointermove', movePointer);
        addEventListeners(document, 'keyup', movePointerStop);
    }
    document.addEventListener('keydown', startUVNavigate);
    track({delete() {
        document.removeEventListener('keydown', startUVNavigate);
    }})
}
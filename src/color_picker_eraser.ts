//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { FORMAT_IDS } from "./formats";

/**
 * Hooks into the color picker tool to switch to the eraser when picking an empty pixel.
 * Only active for Hytale formats and when the setting is enabled.
 */
export function setupColorPickerEraser() {

    let setting = new Setting('color_picker_eraser_switch', {
        name: 'Color Picker Eraser Switch',
        description: 'When using the color picker on an empty (transparent) pixel, automatically switch to the eraser tool',
        type: 'toggle',
        category: 'paint',
        value: true
    });
    track(setting);

    let color_picker = BarItems.color_picker as Tool;

    let original_onTextureEditorClick = color_picker.onTextureEditorClick;
    color_picker.onTextureEditorClick = function(texture: any, x: number, y: number, event: MouseEvent) {
        if (setting.value && FORMAT_IDS.includes(Format.id)) {
            try {
                let ctx: CanvasRenderingContext2D;

                if (texture?.ctx) {
                    ctx = texture.ctx;
                } else if (texture?.canvas) {
                    ctx = texture.canvas.getContext('2d');
                }

                if (ctx) {
                    let pixel = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;

                    if (pixel[3] === 0) {
                        (BarItems.eraser as Tool)?.select();
                        Blockbench.showQuickMessage('Switched to Eraser', 1000);
                        return;
                    }
                }
            } catch (e) {
                // Fall through to original behavior
            }
        }

        return original_onTextureEditorClick?.call(this, texture, x, y, event);
    };

    track({
        delete() {
            color_picker.onTextureEditorClick = original_onTextureEditorClick;
        }
    });
}

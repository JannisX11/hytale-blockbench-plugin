//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { isHytaleFormat } from "./formats";

// Blockbench positions UV faces assuming 2px borders. Changing border-width directly causes gaps.
// Fix: keep 2px transparent border for correct positioning, draw visible 1px line via ::before.
const UV_OUTLINE_CSS = `
body.hytale-format[mode=edit] #uv_frame .uv_resize_corner,
body.hytale-format[mode=edit] #uv_frame .uv_resize_side,
body.hytale-format[mode=edit] #uv_frame #uv_scale_handle,
body.hytale-format[mode=edit] #uv_frame #uv_selection_frame {
    display: none;
}

body.hytale-format #uv_frame.overlay_mode {
    --uv-line-width: 2px;
}
body.hytale-format #uv_frame.overlay_mode .cube_uv_face {
    border-color: transparent !important;
}
body.hytale-format #uv_frame.overlay_mode .cube_uv_face::before {
    content: '';
    position: absolute;
    top: -1px;
    left: -1px;
    right: -1px;
    bottom: -1px;
    border: 1px solid var(--color-text);
    pointer-events: none;
}
body.hytale-format #uv_frame.overlay_mode .cube_uv_face.selected:not(.unselected) {
    outline: none;
}

body.hytale-uv-outline-only #uv_frame {
    --color-uv-background: transparent;
    --color-uv-background-hover: transparent;
}
body.hytale-uv-outline-only #uv_frame .cube_uv_face {
    border-color: transparent !important;
}
body.hytale-uv-outline-only #uv_frame .cube_uv_face::before {
    content: '';
    position: absolute;
    top: -1px;
    left: -1px;
    right: -1px;
    bottom: -1px;
    border: 1px solid var(--color-text);
    pointer-events: none;
}
body.hytale-uv-outline-only #uv_frame .cube_uv_face:hover::before {
    border-color: var(--color-accent);
}
body.hytale-uv-outline-only #uv_frame:not(.overlay_mode) .cube_uv_face.selected:not(.unselected)::before {
    top: -2px;
    left: -2px;
    right: -2px;
    bottom: -2px;
    border-width: 2px;
    border-color: var(--color-accent);
}
body.hytale-uv-outline-only #uv_frame .mesh_uv_face polygon {
    stroke-width: 1px;
}
body.hytale-uv-outline-only #uv_frame:not(.overlay_mode) .mesh_uv_face.selected polygon {
    stroke-width: 2px;
}
body.hytale-uv-outline-only #uv_frame .selection_rectangle {
    background-color: transparent;
}
`;

function updateHytaleFormatClass() {
    document.body.classList.toggle('hytale-format', isHytaleFormat());
}

export function setupUVOutline() {
    const style = Blockbench.addCSS(UV_OUTLINE_CSS);
    track(style);

    const setting = new Setting('uv_outline_only', {
        name: 'UV Outline Only',
        description: 'Show only outlines for UV faces instead of filled overlays',
        category: 'edit',
        value: false,
        onChange(value: boolean) {
            document.body.classList.toggle('hytale-uv-outline-only', value);
        }
    });
    track(setting);

    const selectProjectListener = Blockbench.on('select_project', updateHytaleFormatClass);
    track(selectProjectListener);

    document.body.classList.toggle('hytale-uv-outline-only', (settings.uv_outline_only?.value as boolean) ?? true);
    updateHytaleFormatClass();

}

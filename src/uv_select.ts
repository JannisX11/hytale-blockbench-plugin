//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";

/**
 * Fixes "display all elements" mode: clicking a UV face belonging to a
 * non-selected element now selects it on the first click instead of requiring
 * two clicks. Blockbench sets pointer-events:none on unselected face divs,
 * so we override that and let dragFace select the clicked element.
 */

export function setupUVSelect() {
	let style = document.createElement('style');
	style.textContent = '.cube_uv_face.unselected, .cube_box_uv.unselected { pointer-events: auto !important; cursor: pointer; }';
	style.disabled = Modes.paint;
	document.head.appendChild(style);
	track({ delete() { style.remove(); } });

	track(Blockbench.on('select_mode', () => { style.disabled = Modes.paint; }));
}

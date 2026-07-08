//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { FORMAT_IDS } from "./formats";

/**
 * Fixes "display all elements" mode: clicking a UV face belonging to a
 * non-selected element now selects it on the first click instead of requiring
 * two clicks. Blockbench sets pointer-events:none on unselected face divs,
 * so we override that and use a capture-phase listener to auto-select the
 * element in the outliner before dragFace fires.
 */

function findCubeAtUV(u: number, v: number): Cube | null {
	for (let cube of Cube.all) {
		if (!cube.visibility || cube.selected) continue;
		for (let fkey in cube.faces) {
			let face = cube.faces[fkey];
			if ((face as any).enabled === false) continue;
			let rect = face.getBoundingRect();
			if (u >= Math.min(rect.ax, rect.bx) && u <= Math.max(rect.ax, rect.bx) &&
				v >= Math.min(rect.ay, rect.by) && v <= Math.max(rect.ay, rect.by)) {
				return cube;
			}
		}
	}
	return null;
}

export function setupUVSelect() {
	let style = document.createElement('style');
	style.textContent = '.cube_uv_face.unselected, .cube_box_uv.unselected { pointer-events: auto !important; cursor: pointer; }';
	document.head.appendChild(style);
	track({ delete() { style.remove(); } });

	let uvPanel = (Panels as any).uv;
	if (!uvPanel) return;

	function initHandler(): boolean {
		let viewport = uvPanel.node?.querySelector('#uv_viewport') as HTMLElement | null;
		if (!viewport) return false;

		function onMouseDown(event: Event) {
			let me = event as MouseEvent;
			if (!FORMAT_IDS.includes(Format.id)) return;
			if (me.button !== 0) return;

			let target = me.target as HTMLElement;
			if (!target.closest('.cube_uv_face.unselected, .cube_box_uv.unselected')) return;

			let frame = document.getElementById('uv_frame');
			if (!frame) return;
			let frameRect = frame.getBoundingClientRect();
			let vue = (UVEditor as any).vue;
			let u = (me.clientX - frameRect.left) / vue.inner_width * UVEditor.getResolution(0);
			let v = (me.clientY - frameRect.top) / vue.inner_height * UVEditor.getResolution(1);

			let cube = findCubeAtUV(u, v);
			if (!cube) return;

			let add = me.shiftKey || (me as any).ctrlOrCmd || (Pressing as any).overrides?.shift || (Pressing as any).overrides?.ctrl;
			if (!add) {
				(window as any).unselectAllElements([cube]);
			}
			(cube as any).markAsSelected();
		}

		viewport.addEventListener('mousedown', onMouseDown, true);
		track({ delete() { viewport.removeEventListener('mousedown', onMouseDown, true); } });
		return true;
	}

	if (initHandler()) return;

	let attempts = 0;
	let interval = setInterval(() => {
		attempts++;
		if (initHandler() || attempts >= 50) clearInterval(interval);
	}, 100);
	track({ delete() { clearInterval(interval); } });
}

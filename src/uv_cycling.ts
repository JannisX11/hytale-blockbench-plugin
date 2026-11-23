//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { FORMAT_IDS } from "./formats";

/**
 * UV Cycling: When multiple UV faces overlap, clicking cycles through them
 * instead of always selecting the topmost one. Cycle resets when clicking
 * at a different position.
 */

interface UVCycleState {
	lastClickX: number;
	lastClickY: number;
}

let cycleState: UVCycleState | null = null;
const CLICK_THRESHOLD = 4; // Screen pixels

function screenToUV(event: MouseEvent): { x: number; y: number } {
	const frame = document.getElementById('uv_frame')!.getBoundingClientRect();
	const vue = UVEditor.vue as any;
	return {
		x: (event.clientX - frame.left) / vue.inner_width * UVEditor.getResolution(0),
		y: (event.clientY - frame.top) / vue.inner_height * UVEditor.getResolution(1)
	};
}

function isNear(event: MouseEvent, x: number, y: number): boolean {
	return Math.abs(event.clientX - x) <= CLICK_THRESHOLD && Math.abs(event.clientY - y) <= CLICK_THRESHOLD;
}

function isPointInRect(x: number, y: number, rect: any): boolean {
	const minX = Math.min(rect.ax, rect.bx);
	const maxX = Math.max(rect.ax, rect.bx);
	const minY = Math.min(rect.ay, rect.by);
	const maxY = Math.max(rect.ay, rect.by);
	return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

function getFacesAtUVPosition(uvX: number, uvY: number): Array<{ cube: Cube; faceKey: string }> {
	const faces: Array<{ cube: Cube; faceKey: string }> = [];

	for (const cube of Cube.all) {
		if (!cube.visibility || cube.locked) continue;

		for (const faceKey in cube.faces) {
			const face = cube.faces[faceKey];
			// Skip disabled faces. Don't check texture===false because
			// Hytale single-texture format uses false for all faces
			if (face.enabled === false) continue;
			// Only faces the UV editor can draw for the current texture
			if (face.texture === null) continue;
			if (face.getTexture() != UVEditor.texture && UVEditor.texture != 0) continue;

			const rect = face.getBoundingRect();
			if (isPointInRect(uvX, uvY, rect)) {
				faces.push({ cube, faceKey });
			}
		}
	}

	// Sort for consistent cycle order
	faces.sort((a, b) => {
		if (a.cube.name !== b.cube.name) {
			return a.cube.name.localeCompare(b.cube.name);
		}
		return a.faceKey.localeCompare(b.faceKey);
	});

	// Rotate so current selection is first
	const currentSelectedFaces = UVEditor.selected_faces || [];
	const currentCube = Cube.selected[0];

	if (currentCube && currentSelectedFaces.length > 0) {
		const currentFaceKey = currentSelectedFaces[0];
		const currentIndex = faces.findIndex(
			f => f.cube.uuid === currentCube.uuid && f.faceKey === currentFaceKey
		);
		if (currentIndex > 0) {
			return [...faces.slice(currentIndex), ...faces.slice(0, currentIndex)];
		}
	}

	return faces;
}

function isFaceSelected(cube: Cube, faceKey: string): boolean {
	return cube.selected && UVEditor.getSelectedFaces(cube).includes(faceKey);
}

function selectFace(cube: Cube, faceKey: string): void {
	cube.select();
	UVEditor.getSelectedFaces(cube, true).replace([faceKey]);
	UVEditor.vue.$forceUpdate();
	Canvas.updateView({
		elements: [cube],
		element_aspects: { faces: true }
	});
}

export function setupUVCycling() {
	const uvPanel = Panels.uv;
	if (!uvPanel) return;

	function initializeClickHandler() {
		const uv_viewport = uvPanel.node?.querySelector('#uv_viewport');
		if (!uv_viewport) return false;

		let pendingClick: { x: number; y: number } | null = null;

		function handleMouseDown(event: MouseEvent) {
			if (!FORMAT_IDS.includes(Format.id)) return;
			if (Modes.paint) return;
			if (event.button !== 0) return;

			pendingClick = { x: event.clientX, y: event.clientY };
		}

		function handleMouseUp(event: MouseEvent) {
			if (!pendingClick) return;
			if (event.button !== 0) return;

			const { x, y } = pendingClick;
			pendingClick = null;

			// Moving a UV or dragging the mouse is not a click
			if ((UVEditor.vue as any).dragging_uv || !isNear(event, x, y)) {
				cycleState = null;
				return;
			}

			const isSamePosition = cycleState !== null && isNear(event, cycleState.lastClickX, cycleState.lastClickY);
			const uvPos = screenToUV(event);
			const faces = getFacesAtUVPosition(uvPos.x, uvPos.y);

			if (isSamePosition && faces.length > 1) {
				const { cube, faceKey } = isFaceSelected(faces[0].cube, faces[0].faceKey) ? faces[1] : faces[0];
				setTimeout(() => selectFace(cube, faceKey), 50);
			}

			cycleState = faces.length > 1 ? { lastClickX: event.clientX, lastClickY: event.clientY } : null;
		}

		uv_viewport.addEventListener('mousedown', handleMouseDown);
		uv_viewport.addEventListener('mouseup', handleMouseUp);

		track({
			delete() {
				uv_viewport.removeEventListener('mousedown', handleMouseDown);
				uv_viewport.removeEventListener('mouseup', handleMouseUp);
			}
		});

		return true;
	}

	if (uvPanel.node && initializeClickHandler()) return;

	let attempts = 0;
	const interval = setInterval(() => {
		attempts++;
		if (uvPanel.node && initializeClickHandler()) {
			clearInterval(interval);
		} else if (attempts >= 50) {
			clearInterval(interval);
		}
	}, 100);

	track({ delete() { clearInterval(interval); } });
}

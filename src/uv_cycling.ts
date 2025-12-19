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
	currentIndex: number;
	facesAtPosition: Array<{ cube: Cube; faceKey: string }>;
}

let cycleState: UVCycleState | null = null;
const CLICK_THRESHOLD = 0;

function screenToUV(event: MouseEvent): { x: number; y: number } {
	return UVEditor.getBrushCoordinates(event, UVEditor.texture);
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
		if (!cube.visibility) continue;

		for (const faceKey in cube.faces) {
			const face = cube.faces[faceKey];
			// Skip disabled faces. Don't check texture===false because
			// Hytale single-texture format uses false for all faces
			if (face.enabled === false) continue;

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

		let pendingClick: { uvPos: { x: number; y: number } } | null = null;

		function handleMouseDown(event: MouseEvent) {
			if (!FORMAT_IDS.includes(Format.id)) return;
			if (Modes.paint) return;
			if (event.button !== 0) return;

			pendingClick = { uvPos: screenToUV(event) };
		}

		function handleMouseUp(event: MouseEvent) {
			if (!pendingClick) return;
			if (event.button !== 0) return;

			const uvPos = screenToUV(event);
			pendingClick = null;

			const isSamePosition = cycleState !== null &&
				Math.abs(uvPos.x - cycleState.lastClickX) <= CLICK_THRESHOLD &&
				Math.abs(uvPos.y - cycleState.lastClickY) <= CLICK_THRESHOLD;

			if (isSamePosition && cycleState) {
				cycleState.currentIndex = (cycleState.currentIndex + 1) % cycleState.facesAtPosition.length;
				const { cube, faceKey } = cycleState.facesAtPosition[cycleState.currentIndex];
				setTimeout(() => selectFace(cube, faceKey), 50);
			} else {
				const faces = getFacesAtUVPosition(uvPos.x, uvPos.y);
				if (faces.length > 1) {
					cycleState = {
						lastClickX: uvPos.x,
						lastClickY: uvPos.y,
						currentIndex: 0,
						facesAtPosition: faces
					};
				} else {
					cycleState = null;
				}
			}
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

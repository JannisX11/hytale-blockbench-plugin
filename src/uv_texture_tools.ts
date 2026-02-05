//! Copyright (C) 2025 Hypixel Studios Canada inc.
//! Licensed under the GNU General Public License, see LICENSE.MD

import { track } from "./cleanup";
import { FORMAT_IDS } from "./formats";

/**
 * Rotates and flips UV coordinates together with texture pixels.
 * When both are transformed the same way, they cancel out visually,
 * allowing artists to reorganize UV layout without changing appearance.
 */

type FaceUV = [number, number, number, number];

interface TextureRegion {
	texture: Texture;
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Gets the bounding box of a face's UV in texture pixel coordinates
 */
function getFaceTextureRegion(face: CubeFace, texture: Texture): TextureRegion | null {
	if (!texture || face.texture === null) return null;

	const uv = face.uv;
	const x = Math.min(uv[0], uv[2]);
	const y = Math.min(uv[1], uv[3]);
	const width = Math.abs(uv[2] - uv[0]);
	const height = Math.abs(uv[3] - uv[1]);

	return { texture, x, y, width, height };
}

/**
 * Extracts pixel data from a texture region
 */
function extractRegionPixels(region: TextureRegion): ImageData | null {
	const ctx = region.texture.ctx;
	if (!ctx) return null;

	try {
		return ctx.getImageData(
			Math.round(region.x),
			Math.round(region.y),
			Math.round(region.width) || 1,
			Math.round(region.height) || 1
		);
	} catch (e) {
		return null;
	}
}

/**
 * Rotates ImageData 90 degrees clockwise
 */
function rotateImageDataCW(imageData: ImageData): ImageData {
	const { width, height, data } = imageData;
	const rotated = new ImageData(height, width);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const srcIdx = (y * width + x) * 4;
			const dstX = height - 1 - y;
			const dstY = x;
			const dstIdx = (dstY * height + dstX) * 4;

			rotated.data[dstIdx] = data[srcIdx];
			rotated.data[dstIdx + 1] = data[srcIdx + 1];
			rotated.data[dstIdx + 2] = data[srcIdx + 2];
			rotated.data[dstIdx + 3] = data[srcIdx + 3];
		}
	}

	return rotated;
}

/**
 * Rotates ImageData 90 degrees counter-clockwise
 */
function rotateImageDataCCW(imageData: ImageData): ImageData {
	const { width, height, data } = imageData;
	const rotated = new ImageData(height, width);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const srcIdx = (y * width + x) * 4;
			const dstX = y;
			const dstY = width - 1 - x;
			const dstIdx = (dstY * height + dstX) * 4;

			rotated.data[dstIdx] = data[srcIdx];
			rotated.data[dstIdx + 1] = data[srcIdx + 1];
			rotated.data[dstIdx + 2] = data[srcIdx + 2];
			rotated.data[dstIdx + 3] = data[srcIdx + 3];
		}
	}

	return rotated;
}

/**
 * Flips ImageData horizontally
 */
function flipImageDataH(imageData: ImageData): ImageData {
	const { width, height, data } = imageData;
	const flipped = new ImageData(width, height);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const srcIdx = (y * width + x) * 4;
			const dstIdx = (y * width + (width - 1 - x)) * 4;

			flipped.data[dstIdx] = data[srcIdx];
			flipped.data[dstIdx + 1] = data[srcIdx + 1];
			flipped.data[dstIdx + 2] = data[srcIdx + 2];
			flipped.data[dstIdx + 3] = data[srcIdx + 3];
		}
	}

	return flipped;
}

/**
 * Flips ImageData vertically
 */
function flipImageDataV(imageData: ImageData): ImageData {
	const { width, height, data } = imageData;
	const flipped = new ImageData(width, height);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const srcIdx = (y * width + x) * 4;
			const dstIdx = ((height - 1 - y) * width + x) * 4;

			flipped.data[dstIdx] = data[srcIdx];
			flipped.data[dstIdx + 1] = data[srcIdx + 1];
			flipped.data[dstIdx + 2] = data[srcIdx + 2];
			flipped.data[dstIdx + 3] = data[srcIdx + 3];
		}
	}

	return flipped;
}

/**
 * Rotates UV coordinates 90 degrees clockwise around the UV center
 */
function rotateUVCW(uv: FaceUV): FaceUV {
	const centerX = (uv[0] + uv[2]) / 2;
	const centerY = (uv[1] + uv[3]) / 2;
	const halfW = Math.abs(uv[2] - uv[0]) / 2;
	const halfH = Math.abs(uv[3] - uv[1]) / 2;

	// After 90° CW rotation, width becomes height and vice versa
	return [
		centerX - halfH,
		centerY - halfW,
		centerX + halfH,
		centerY + halfW
	];
}

/**
 * Rotates UV coordinates 90 degrees counter-clockwise around the UV center
 */
function rotateUVCCW(uv: FaceUV): FaceUV {
	// Same as CW since we're rotating around center with same dimensions
	return rotateUVCW(uv);
}

/**
 * Flips UV coordinates horizontally (swaps x values)
 */
function flipUVH(uv: FaceUV): FaceUV {
	return [uv[2], uv[1], uv[0], uv[3]];
}

/**
 * Flips UV coordinates vertically (swaps y values)
 */
function flipUVV(uv: FaceUV): FaceUV {
	return [uv[0], uv[3], uv[2], uv[1]];
}

interface FaceOperation {
	cube: Cube;
	faceKey: string;
	face: CubeFace;
	texture: Texture;
	region: TextureRegion;
	originalPixels: ImageData;
}

/**
 * Collects all selected faces with valid texture regions for batch operations
 */
function collectSelectedFaces(): FaceOperation[] {
	const operations: FaceOperation[] = [];

	// Get the texture - either from face or use default for single-texture formats
	const defaultTexture = Texture.getDefault();

	for (const cube of Cube.selected) {
		const selectedFaces = UVEditor.getSelectedFaces(cube);

		for (const faceKey of selectedFaces) {
			const face = cube.faces[faceKey];

			// Skip faces with null texture (disabled faces)
			if (face.texture === null) continue;

			// Get texture from face, or use default for single-texture formats (where face.texture is false)
			let texture: Texture | undefined;
			if (face.texture === false) {
				texture = defaultTexture;
			} else {
				texture = Texture.all.find(t => t.uuid === face.texture);
			}

			if (!texture || !texture.ctx) continue;

			const region = getFaceTextureRegion(face, texture);
			if (!region || region.width < 1 || region.height < 1) continue;

			const originalPixels = extractRegionPixels(region);
			if (!originalPixels) continue;

			operations.push({ cube, faceKey, face, texture, region, originalPixels });
		}
	}

	return operations;
}

/**
 * Performs a combined UV+texture rotation clockwise
 */
function rotateUVTextureCW() {
	const operations = collectSelectedFaces();
	if (operations.length === 0) {
		Blockbench.showQuickMessage('No valid UV faces selected');
		return;
	}

	Undo.initEdit({ elements: Cube.selected, textures: Texture.all });

	const textureUpdates = new Map<Texture, boolean>();

	for (const op of operations) {
		// Clear original region
		op.texture.ctx.clearRect(
			Math.round(op.region.x),
			Math.round(op.region.y),
			Math.round(op.region.width),
			Math.round(op.region.height)
		);

		// Rotate texture pixels
		const rotatedPixels = rotateImageDataCW(op.originalPixels);

		// Calculate new UV (rotated, dimensions swapped)
		const newUV = rotateUVCW(op.face.uv as FaceUV);

		// Write rotated pixels to new position
		const newX = Math.min(newUV[0], newUV[2]);
		const newY = Math.min(newUV[1], newUV[3]);
		op.texture.ctx.putImageData(rotatedPixels, Math.round(newX), Math.round(newY));

		// Update UV coordinates
		op.face.uv = newUV;

		// Rotate UV rotation property (counter-clockwise to cancel visual rotation)
		op.face.rotation = ((op.face.rotation || 0) + 270) % 360 as 0 | 90 | 180 | 270;

		textureUpdates.set(op.texture, true);
	}

	// Update all modified textures
	for (const texture of textureUpdates.keys()) {
		texture.updateSource(texture.ctx.canvas.toDataURL());
	}

	Canvas.updateView({ elements: Cube.selected, element_aspects: { uv: true } });
	UVEditor.loadData();

	Undo.finishEdit('Rotate UV + Texture CW');
}

/**
 * Performs a combined UV+texture rotation counter-clockwise
 */
function rotateUVTextureCCW() {
	const operations = collectSelectedFaces();
	if (operations.length === 0) {
		Blockbench.showQuickMessage('No valid UV faces selected');
		return;
	}

	Undo.initEdit({ elements: Cube.selected, textures: Texture.all });

	const textureUpdates = new Map<Texture, boolean>();

	for (const op of operations) {
		// Clear original region
		op.texture.ctx.clearRect(
			Math.round(op.region.x),
			Math.round(op.region.y),
			Math.round(op.region.width),
			Math.round(op.region.height)
		);

		// Rotate texture pixels
		const rotatedPixels = rotateImageDataCCW(op.originalPixels);

		// Calculate new UV (rotated, dimensions swapped)
		const newUV = rotateUVCCW(op.face.uv as FaceUV);

		// Write rotated pixels to new position
		const newX = Math.min(newUV[0], newUV[2]);
		const newY = Math.min(newUV[1], newUV[3]);
		op.texture.ctx.putImageData(rotatedPixels, Math.round(newX), Math.round(newY));

		// Update UV coordinates
		op.face.uv = newUV;

		// Rotate UV rotation property (clockwise to cancel visual rotation)
		op.face.rotation = ((op.face.rotation || 0) + 90) % 360 as 0 | 90 | 180 | 270;

		textureUpdates.set(op.texture, true);
	}

	// Update all modified textures
	for (const texture of textureUpdates.keys()) {
		texture.updateSource(texture.ctx.canvas.toDataURL());
	}

	Canvas.updateView({ elements: Cube.selected, element_aspects: { uv: true } });
	UVEditor.loadData();

	Undo.finishEdit('Rotate UV + Texture CCW');
}

/**
 * Performs a combined UV+texture horizontal flip
 */
function flipUVTextureH() {
	const operations = collectSelectedFaces();
	if (operations.length === 0) {
		Blockbench.showQuickMessage('No valid UV faces selected');
		return;
	}

	Undo.initEdit({ elements: Cube.selected, textures: Texture.all });

	const textureUpdates = new Map<Texture, boolean>();

	for (const op of operations) {
		// Clear original region
		op.texture.ctx.clearRect(
			Math.round(op.region.x),
			Math.round(op.region.y),
			Math.round(op.region.width),
			Math.round(op.region.height)
		);

		// Flip texture pixels
		const flippedPixels = flipImageDataH(op.originalPixels);

		// Flip UV (same position, just swap x coordinates)
		const newUV = flipUVH(op.face.uv as FaceUV);

		// Write flipped pixels back to same position
		op.texture.ctx.putImageData(flippedPixels, Math.round(op.region.x), Math.round(op.region.y));

		// Update UV coordinates
		op.face.uv = newUV;

		textureUpdates.set(op.texture, true);
	}

	// Update all modified textures
	for (const texture of textureUpdates.keys()) {
		texture.updateSource(texture.ctx.canvas.toDataURL());
	}

	Canvas.updateView({ elements: Cube.selected, element_aspects: { uv: true } });
	UVEditor.loadData();

	Undo.finishEdit('Flip UV + Texture Horizontal');
}

/**
 * Performs a combined UV+texture vertical flip
 */
function flipUVTextureV() {
	const operations = collectSelectedFaces();
	if (operations.length === 0) {
		Blockbench.showQuickMessage('No valid UV faces selected');
		return;
	}

	Undo.initEdit({ elements: Cube.selected, textures: Texture.all });

	const textureUpdates = new Map<Texture, boolean>();

	for (const op of operations) {
		// Clear original region
		op.texture.ctx.clearRect(
			Math.round(op.region.x),
			Math.round(op.region.y),
			Math.round(op.region.width),
			Math.round(op.region.height)
		);

		// Flip texture pixels
		const flippedPixels = flipImageDataV(op.originalPixels);

		// Flip UV (same position, just swap y coordinates)
		const newUV = flipUVV(op.face.uv as FaceUV);

		// Write flipped pixels back to same position
		op.texture.ctx.putImageData(flippedPixels, Math.round(op.region.x), Math.round(op.region.y));

		// Update UV coordinates
		op.face.uv = newUV;

		textureUpdates.set(op.texture, true);
	}

	// Update all modified textures
	for (const texture of textureUpdates.keys()) {
		texture.updateSource(texture.ctx.canvas.toDataURL());
	}

	Canvas.updateView({ elements: Cube.selected, element_aspects: { uv: true } });
	UVEditor.loadData();

	Undo.finishEdit('Flip UV + Texture Vertical');
}

export function setupUVTextureTools() {
	// CSS for the custom toolbar
	const style = Blockbench.addCSS(`
		.hytale-uv-texture-toolbar {
			display: none;
			justify-content: space-evenly;
			padding: 4px 8px;
			background: var(--color-back);
			border-bottom: 1px solid var(--color-border);
		}
		.hytale-uv-texture-toolbar.visible {
			display: flex;
		}
		.hytale-uv-texture-toolbar .tool {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 28px;
			height: 28px;
			cursor: pointer;
			border-radius: 4px;
		}
		.hytale-uv-texture-toolbar .tool:hover {
			background: var(--color-button);
		}
		.hytale-uv-texture-toolbar .tool .material-icons {
			font-size: 20px;
		}
	`);
	track(style);

	// Create custom toolbar element
	const toolbarEl = document.createElement('div');
	toolbarEl.className = 'hytale-uv-texture-toolbar';

	const buttons = [
		{ icon: 'rotate_left', title: 'Rotate UV + Texture CCW', action: rotateUVTextureCCW },
		{ icon: 'rotate_right', title: 'Rotate UV + Texture CW', action: rotateUVTextureCW },
		{ icon: 'swap_horiz', title: 'Flip UV + Texture Horizontal', action: flipUVTextureH },
		{ icon: 'swap_vert', title: 'Flip UV + Texture Vertical', action: flipUVTextureV },
	];

	for (const btn of buttons) {
		const buttonEl = document.createElement('div');
		buttonEl.className = 'tool';
		buttonEl.title = btn.title;
		buttonEl.innerHTML = `<i class="material-icons">${btn.icon}</i>`;
		buttonEl.addEventListener('click', btn.action);
		toolbarEl.appendChild(buttonEl);
	}

	// Insert above the UV editor toolbar
	const uvPanel = Panels.uv;
	if (uvPanel?.node && uvPanel.toolbars?.[0]?.node) {
		const toolbarNode = uvPanel.toolbars[0].node;
		toolbarNode.parentNode.insertBefore(toolbarEl, toolbarNode);
	}

	// Update visibility based on format and toggle
	function updateToolbarVisibility() {
		const formatOk = FORMAT_IDS.includes(Format?.id);
		const toggleOk = (BarItems.move_texture_with_uv as Toggle)?.value === true;
		toolbarEl.classList.toggle('visible', formatOk && toggleOk);
	}

	// Update when toggle changes
	const moveTextureToggle = BarItems.move_texture_with_uv as Toggle;
	if (moveTextureToggle) {
		const originalOnChange = moveTextureToggle.onChange;
		moveTextureToggle.onChange = function(value) {
			if (originalOnChange) originalOnChange.call(this, value);
			updateToolbarVisibility();
		};
		track({
			delete() {
				moveTextureToggle.onChange = originalOnChange;
			}
		});
	}

	// Update when project changes
	const projectListener = Blockbench.on('select_project', updateToolbarVisibility);
	track(projectListener);

	// Initial visibility check
	updateToolbarVisibility();

	// Cleanup
	track({
		delete() {
			toolbarEl.remove();
		}
	});
}
